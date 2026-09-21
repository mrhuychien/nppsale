"use client"

/**
 * MÀN 11 — PHIẾU TRẢ NCC, và MÀN 12 — SỬA PHIẾU TRẢ NCC.
 *
 * ⚠ BA CHỖ BẢN THIẾT KẾ NÓI KHÁC HỆ ĐANG CHẠY. Spec §7.2 cho phép
 * chỉnh câu chữ cho khớp hành vi thật, nên màn này nói theo hệ:
 *
 *   1. §8 mục 4 — "select lô chỉ liệt kê lô thuộc phiếu nhập gốc".
 *      KHÔNG CÓ SELECT LÔ Ở ĐÂY ĐƯỢC. `supplier_return_lines` không có
 *      cột lô nào, và `complete_supplier_return` (migration 146, dòng
 *      155-165) tự chọn lô FIFO theo `expires_at` trong vùng kho của
 *      phiếu. Một ô chọn mà máy chủ bỏ qua là nói dối đúng tại chỗ
 *      người dùng cẩn thận nhất. Nên lô của phiếu gốc hiện ra dưới
 *      dạng CHỮ ĐỌC, kèm một câu nói rõ máy chủ lấy theo hạn cũ trước.
 *
 *   2. §8 mục 5 — cột `ĐÃ NHẬP` chặn vượt số đã nhận. Chặn được ở đây,
 *      nhưng CHỈ khi người dùng chọn phiếu nhập gốc trong phiên này:
 *      `supplier_returns` không có cột trỏ về phiếu nhập, nên mở lại
 *      phiếu đã lưu là mất đường về gốc và cột ấy hiện `—`. KHÔNG CÓ
 *      chốt chặn phía máy chủ cho trần này.
 *
 *   3. Artboard 12 mượn câu của màn 8 — "giữ nguyên số phiếu". Phía bán
 *      có `reissue_invoice` nên giữ được số; phía mua chỉ có
 *      `cancel_supplier_return` + `complete_supplier_return` RỜI NHAU,
 *      nên huỷ rồi lập lại là một phiếu MỚI mang số MỚI.
 *
 * ⚠ VÙNG KHO LÀ Ô BẮT BUỘC, KHÔNG PHẢI TUỲ CHỌN. `complete_supplier_return`
 * xuất hàng TỪ vùng kho ghi trên phiếu; chọn nhầm là câu
 * `INSUFFICIENT_STOCK` trong khi kho bên kia đang đầy hàng.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import {
  loadSupplierDebt, loadReceiptsOfSupplier, loadReceiptLinesForReturn,
  type PosReceiptRef,
} from "@/lib/pos/load"
import { savePosSupplierReturn } from "@/lib/pos/save"
import { formatCurrency } from "@/lib/utils"
import { switchUnit, type DiscountInput } from "@/lib/pos/discount"
import {
  supplierReturnTotals, supplierReturnMax, supplierReturnCancelLock,
} from "@/lib/pos/purchase"
import type { PosBadge, PosLine } from "@/lib/pos/types"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import {
  DocSubHeader, SubHeaderDate, SubHeaderSelect, DocBanner, homNay,
} from "@/components/pos/doc-sub-header"
import { usePosDocLabel, usePosDirty } from "@/store/pos/tabs"
import {
  LineTableFrame, LineTableHeader, POS_GRID, QtyStepper, DiscountCell, LineAmountCell, LineMenu,
} from "@/components/pos/line-table"
import {
  MoneyRow, DocDiscountRow, TotalsHero, PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
import { DeltaPreviewStrip, DeltaStock, type DeltaCell } from "@/components/pos/delta-preview-strip"

type HoanTien = "cong-no" | "tien-mat" | "chuyen-khoan"
const HOAN_LABEL: Record<HoanTien, string> = {
  "cong-no": "Trừ công nợ",
  "tien-mat": "Tiền mặt",
  "chuyen-khoan": "Chuyển khoản",
}

/**
 * ⚠ ĐÚNG BỘ MÃ MIGRATION 068 GHI TRONG `reason`: `damaged /
 * near_expiry / wrong_item / other`. Cột `reason` là text tự do nên
 * gõ gì cũng lưu được — và đó chính là lý do phải chọn đúng bộ: báo cáo
 * gom theo chuỗi, mỗi màn một cách viết là gom ra mấy nhóm rỗng.
 */
const LY_DO = [
  { id: "damaged", label: "Hàng hư hỏng" },
  { id: "wrong_item", label: "Giao sai hàng" },
  { id: "near_expiry", label: "Gần hết hạn" },
  { id: "other", label: "Lý do khác" },
]

export interface SupplierReturnScreenProps {
  mode: "lap" | "sua"
  /** `null` = phiếu mới. */
  returnId?: string | null
  badge?: PosBadge | null
  /** Khoản giảm công nợ đã được cấn trừ — khoá `DA_CAN_TRU`. */
  creditOffset?: number
  /** Có lô đã lấy nay không còn mở — khoá `LO_DA_DONG`. */
  lotClosed?: boolean
}

let dem = 0
const newKey = () => `sr${++dem}`

export function SupplierReturnScreen({
  mode,
  returnId = null,
  badge,
  creditOffset = 0,
  lotClosed = false,
}: SupplierReturnScreenProps) {
  const { products, suppliers, loading, warnings } = usePosRefData()
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()

  const [slipCode, setSlipCode] = useState<string | null>(null)
  const [dangLuu, setDangLuu] = useState(false)
  const [loiNap, setLoiNap] = useState<string | null>(null)

  const [lines, setLines] = useState<PosLine[]>([])
  const [ncc, setNcc] = useState<PosPartner | null>(null)
  const [phi, setPhi] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  const [hoan, setHoan] = useState<HoanTien>("cong-no")
  const [lyDo, setLyDo] = useState("damaged")
  const [ghiChu, setGhiChu] = useState("")
  const [hdDieuChinh, setHdDieuChinh] = useState("")
  const [thoiDiem, setThoiDiem] = useState(homNay)
  const [kho, setKho] = useState("date")
  const [daNap, setDaNap] = useState(!returnId)
  const [mocChuaLuu, setMocChuaLuu] = useState<string | null>(null)
  const [moTimHang, setMoTimHang] = useState(false)
  const [moTimNcc, setMoTimNcc] = useState(false)

  /** Phiếu nhập gốc — chỉ sống trong PHIÊN này. Xem đầu tệp, mục 2. */
  const [phieuGoc, setPhieuGoc] = useState<PosReceiptRef[]>([])
  const [phieuGocId, setPhieuGocId] = useState("")

  const t = useMemo(
    () =>
      supplierReturnTotals({
        lines: lines.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount })),
        fee: phi,
      }),
    [lines, phi]
  )

  const khoa = mode === "sua" ? supplierReturnCancelLock({ creditOffset, lotClosed }) : null
  const noConLai = ncc?.debt == null ? null : Math.max(0, ncc.debt - t.dueFromSupplier)

  usePosDocLabel("PRET", returnId, slipCode)
  const chuKy = useMemo(
    () => JSON.stringify([lines.map((l) => [l.productId, l.unit, l.qty, l.price, l.discount]), ncc?.id ?? null, phi, lyDo, ghiChu, kho, thoiDiem]),
    [lines, ncc?.id, phi, lyDo, ghiChu, kho, thoiDiem]
  )
  useEffect(() => {
    if (daNap && mocChuaLuu === null) setMocChuaLuu(chuKy)
  }, [daNap, chuKy, mocChuaLuu])
  usePosDirty(chuKy, mocChuaLuu)

  const patchLine = useCallback((key: string, p: Partial<PosLine>) => {
    setLines((cu) => cu.map((l) => (l.key === key ? { ...l, ...p } : l)))
  }, [])

  const themHang = useCallback(
    (productId: string) => {
      const p = products.find((x) => x.id === productId)
      if (!p) return
      setLines((cu) => [
        ...cu,
        {
          key: newKey(),
          productId: p.id,
          sku: p.sku ?? "",
          name: p.name,
          unit: p.base_unit,
          units: (p.units ?? []).map((u) => ({
            unit_name: u.unit_name,
            conversion: Number(u.conversion) || 1,
          })),
          qty: 1,
          price: 0,
          discount: { value: 0, unit: "vnd" },
          /**
           * ⚠ `lots` ĐỂ RỖNG, KHÔNG ĐỔ TOÀN KHO VÀO (spec §8 mục 4).
           * Lô hiện ra ở đây là lô của PHIẾU NHẬP GỐC; dòng thêm tay
           * không có phiếu gốc nào nên không có lô nào để kể.
           */
          lots: [],
          /* ⚠ `ordered` ở màn này mang nghĩa SỐ ĐÃ NHẬP theo phiếu gốc —
             `null` là chưa biết, và khi đó không chặn. */
          ordered: null,
        },
      ])
    },
    [products]
  )

  usePosKeys({
    F3: () => setMoTimHang(true),
    F4: () => setMoTimNcc(true),
    Escape: () => { setMoTimHang(false); setMoTimNcc(false) },
  })

  const mucHang = useMemo<SearchItem[]>(
    () =>
      products.map((p) => ({
        id: p.id,
        title: p.name,
        meta: `${p.sku ?? "—"} · ${p.base_unit}`,
        keywords: `${p.sku ?? ""} ${p.barcode ?? ""}`,
      })),
    [products]
  )

  const mucNcc = useMemo<SearchItem[]>(
    () =>
      suppliers.map((x) => ({
        id: x.id,
        title: x.name,
        meta: [x.code, x.phone, x.address].filter(Boolean).join(" · "),
        keywords: `${x.code ?? ""} ${x.phone ?? ""}`,
      })),
    [suppliers]
  )

  /** Nạp phiếu trả NCC đã lưu. */
  useEffect(() => {
    if (!returnId) return
    let huy = false
    ;(async () => {
      try {
        const sb = createClient()
        const { data, error } = await sb
          .from("supplier_returns")
          .select(
            "id, return_code, supplier_id, return_date, warehouse_zone, reason, discount, notes, status, " +
              "supplier:suppliers(name, code), " +
              "lines:supplier_return_lines(product_id, unit_name, quantity, unit_price, line_discount, notes, product:products(name, sku))"
          )
          .eq("id", returnId)
          .maybeSingle()
        if (huy) return
        if (error) { setLoiNap(errorMessage(error)); return }
        const r = (data as unknown) as {
          return_code: string | null; supplier_id: string; return_date: string
          warehouse_zone: string | null; reason: string | null; discount: number | null; notes: string | null
          supplier?: { name?: string | null; code?: string | null } | null
          lines?: Array<{
            product_id: string; unit_name: string; quantity: number; unit_price: number
            line_discount: number; notes: string | null
            product?: { name?: string | null; sku?: string | null } | null
          }> | null
        } | null
        if (!r) { setLoiNap("Không tìm thấy phiếu trả NCC này."); return }
        setSlipCode(r.return_code)
        setNcc({ id: r.supplier_id, name: r.supplier?.name || "—", meta: r.supplier?.code ?? "" })
        setThoiDiem(r.return_date || homNay())
        setPhi({ value: Number(r.discount) || 0, unit: "vnd" })
        setKho(r.warehouse_zone || "date")
        if (r.reason) setLyDo(r.reason)
        setGhiChu(r.notes || "")
        setLines(
          (r.lines ?? []).map((x) => ({
            key: newKey(),
            productId: x.product_id,
            sku: x.product?.sku ?? "",
            name: x.product?.name ?? "Sản phẩm đã xoá",
            unit: x.unit_name,
            units: [{ unit_name: x.unit_name, conversion: 1 }],
            qty: Number(x.quantity) || 0,
            price: Number(x.unit_price) || 0,
            discount: { value: Number(x.line_discount) || 0, unit: "vnd" as const },
            /* ⚠ MỞ LẠI PHIẾU LÀ MẤT ĐƯỜNG VỀ PHIẾU NHẬP GỐC —
               `supplier_returns` không có cột trỏ về nó. Nên lô và số
               đã nhập về `null` chứ không về 0: 0 đọc như "đã trả hết
               rồi", và stepper sẽ khoá cứng ở 0. Xem đầu tệp, mục 2. */
            lots: [],
            ordered: null,
            note: x.notes ?? undefined,
          }))
        )
        setDaNap(true)
      } catch (e) {
        if (!huy) setLoiNap(errorMessage(e))
      }
    })()
    return () => { huy = true }
  }, [returnId])

  /** Công nợ NCC + danh sách phiếu nhập của NCC ấy. */
  useEffect(() => {
    const id = ncc?.id
    if (!id) { setPhieuGoc([]); setPhieuGocId(""); return }
    let huy = false
    ;(async () => {
      const sb = createClient()
      const [no, ds] = await Promise.all([
        loadSupplierDebt(sb, id).catch(() => null),
        loadReceiptsOfSupplier(sb, id).catch(() => [] as PosReceiptRef[]),
      ])
      if (huy) return
      setNcc((c) => (c && c.id === id ? { ...c, debt: no } : c))
      setPhieuGoc(ds)
    })()
    return () => { huy = true }
  }, [ncc?.id])

  /**
   * NẠP DÒNG TỪ PHIẾU NHẬP GỐC — spec §8 mục 4 và 5.
   *
   * ⚠ THAY CẢ BỘ DÒNG, và nút chọn đã hỏi trước. Gộp thêm vào bộ đang
   * có là trả hai lần cùng một chuyến hàng mà không ai thấy.
   */
  const napTuPhieuGoc = useCallback(
    async (id: string) => {
      setPhieuGocId(id)
      if (!id) return
      try {
        const { lines: ds } = await loadReceiptLinesForReturn(createClient(), id)
        setLines(
          ds.map((x) => ({
            key: newKey(),
            productId: x.productId,
            sku: x.sku,
            name: x.name,
            unit: x.unitName,
            units: [{ unit_name: x.unitName, conversion: 1 }],
            /* ⚠ SỐ LƯỢNG VỀ 0, KHÔNG BẰNG SỐ ĐÃ NHẬP. Điền sẵn cả
               chuyến là một cú bấm Enter nhầm trả sạch phiếu nhập. */
            qty: 0,
            price: x.unitPrice,
            discount: { value: 0, unit: "vnd" as const },
            lots: x.lots,
            ordered: x.receivedQty,
          }))
        )
      } catch (e) {
        toast({ title: "Không nạp được phiếu nhập gốc", description: errorMessage(e), variant: "destructive" })
      }
    },
    [toast]
  )

  /**
   * LƯU PHIẾU TRẢ NCC.
   *
   * ⚠ XUẤT KHO ĐI QUA RPC `complete_supplier_return`, một giao dịch —
   * nó trừ `batches`, ghi `stock_entries` và ghi dòng `payables` ÂM
   * trong cùng một lần. Màn này không tự làm bất kỳ phần nào trong ba.
   */
  const luuPhieu = useCallback(
    async (complete: boolean) => {
      if (!user?.org_id || !user.id) return
      if (!ncc) { toast({ title: "Chưa chọn nhà cung cấp", variant: "destructive" }); return }
      if (lines.length === 0) { toast({ title: "Phiếu chưa có dòng hàng nào", variant: "destructive" }); return }
      if (complete && lines.every((l) => l.qty <= 0)) {
        toast({ title: "Mọi dòng đang có số lượng 0", description: "Nhập số lượng trả trước khi ghi nhận.", variant: "destructive" })
        return
      }
      setDangLuu(true)
      try {
        const r = await savePosSupplierReturn(createClient(), {
          returnId,
          orgId: user.org_id,
          userId: user.id,
          supplierId: ncc.id,
          returnDate: thoiDiem || homNay(),
          zone: kho,
          reason: lyDo,
          notes: ghiChu,
          /* ⚠ "Chi phí trả hàng" TRỪ đi — cùng chỗ với `discount` của
             phiếu, vì `complete_supplier_return` tính
             `total = subtotal + vat − discount`. */
          discount: t.fee,
          lines,
          complete,
          subtotal: t.goods - t.lineDiscount,
          vat: 0,
          total: t.dueFromSupplier,
        })
        setMocChuaLuu(chuKy)
        toast({ title: complete ? "Đã ghi nhận — xuất kho và giảm công nợ NCC" : "Đã lưu phiếu nháp" })
        if (!returnId) router.replace(`/pos/tra-ncc/${r.returnId}`)
      } catch (e) {
        toast({ title: "Chưa lưu được", description: errorMessage(e), variant: "destructive" })
      } finally {
        setDangLuu(false)
      }
    },
    [user, ncc, lines, returnId, thoiDiem, kho, lyDo, ghiChu, t, chuKy, router, toast]
  )

  const deltaCells = useMemo<DeltaCell[]>(
    () => [
      {
        label: kho === "sale" ? "Kho bán" : "Kho cận date",
        body:
          lines.length === 0 ? (
            <span className="text-[#94a3b8]">chưa có dòng hàng</span>
          ) : (
            <DeltaStock
              sku={`${lines.length} dòng`}
              net={-lines.reduce((s, l) => s + l.qty, 0)}
              unit="sp"
            />
          ),
      },
      { label: "Công nợ NCC", body: null },
      {
        label: "Giá vốn lô",
        body: <span className="text-[#64748b]">lô trả về đóng bớt, giá vốn lô không đổi</span>,
      },
    ],
    [lines, kho]
  )

  const g = POS_GRID.supplierReturn

  return (
    <>
      <DocSubHeader
        title={mode === "sua" ? "Sửa phiếu trả NCC" : "Phiếu trả NCC"}
        code={slipCode}
        badge={badge ?? (mode === "lap" ? { label: "NHÁP", tone: "tam" } : { label: "ĐÃ XUẤT KHO", tone: "da-kho" })}
        right={
          <>
            {/* ⚠ VÙNG KHO QUYẾT ĐỊNH HÀNG LẤY TỪ ĐÂU — xem đầu tệp. */}
            <SubHeaderSelect
              id="sr-kho"
              label="Kho xuất"
              value={kho}
              onChange={setKho}
              options={[
                { id: "date", label: "Kho cận date" },
                { id: "sale", label: "Kho bán" },
              ]}
            />
            <SubHeaderDate value={thoiDiem} onChange={setThoiDiem} label="Ngày trả" />
          </>
        }
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        {/* ⚠ `min-w-0 flex-1`, không cứng 1012px — xem `OrderScreen`. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* ⚠ Neo dropdown tìm hàng ở ĐỈNH cột trái — xem `OrderScreen`. */}
          <div className="relative">
            <SearchDropdown
              open={moTimHang}
              onClose={() => setMoTimHang(false)}
              title="Tìm hàng trả NCC"
              placeholder="Tên hàng, mã hàng…"
              items={mucHang}
              onPick={(it) => themHang(it.id)}
              emptyHint="Không tìm thấy mặt hàng nào khớp."
            />
          </div>
          {warnings.map((w) => (
            <DocBanner key={w} tone="warn">{w}</DocBanner>
          ))}

          {/*
            ⚠ KHÔNG HỨA "GIỮ NGUYÊN SỐ PHIẾU". Phía bán có
              `reissue_invoice` nên giữ được số; phía mua chỉ có
              `cancel_supplier_return` + `complete_supplier_return` rời
              nhau. Xem đầu tệp.
          */}
          {mode === "sua" && (
            <DocBanner tone="warn">
              Phiếu đã xuất kho. Bên mua <strong>không có lệnh lập lại một bước</strong>: sửa
              phiếu là <strong>huỷ phiếu này rồi lập một phiếu mới</strong> — hai thao tác
              riêng, và phiếu mới mang số mới. Phiếu cũ giữ trong sổ để truy vết.
            </DocBanner>
          )}

          {loiNap && <DocBanner tone="warn">Không nạp được phiếu — {loiNap}</DocBanner>}

          {khoa && (
            <DocBanner tone="warn">
              <strong>Chưa huỷ được phiếu này.</strong> {khoa.message}{" "}
              <span className="n text-[11px] opacity-70">({khoa.code})</span>
            </DocBanner>
          )}

          <LineTableFrame
            header={
              <LineTableHeader
                grid="supplierReturn"
                cells={[
                  { label: "#" }, { label: "Mã hàng" }, { label: "Tên hàng" },
                  { label: "Lô của phiếu gốc" },
                  { label: "Đã nhập", align: "center" },
                  { label: "SL trả", align: "center" },
                  { label: "Giá nhập", align: "right" },
                  { label: "Giảm", align: "right" },
                  { label: "Thành tiền", align: "right" },
                  { label: "" },
                ]}
              />
            }
            footer={
              lines.length > 0 ? (
                /*
                  ⚠ NÓI RA AI CHỌN LÔ. `complete_supplier_return` lấy
                    FIFO theo hạn trong vùng kho đã chọn; cột lô bên
                    trái chỉ kể lô mà phiếu nhập gốc đã sinh ra.
                */
                <div className="shrink-0 bg-[#f8fafc] px-4 py-2 text-[11.5px] text-[#64748b]">
                  Lô xuất đi do hệ thống chọn: hạn cũ trước, trong{" "}
                  <strong>{kho === "sale" ? "kho bán" : "kho cận date"}</strong>. Cột
                  &ldquo;Lô của phiếu gốc&rdquo; chỉ để đối chiếu, không phải ô chọn.
                </div>
              ) : undefined
            }
          >
            {lines.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] text-[#64748b]">
                  {loading ? "Đang tải danh mục hàng…" : "Chưa có mặt hàng nào trong phiếu."}
                </p>
                {!loading && (
                  <button
                    type="button"
                    onClick={() => setMoTimHang(true)}
                    className="mt-2 text-[13px] font-semibold text-[#2563eb]"
                  >
                    Thêm hàng <span className="n text-[11px] opacity-70">F3</span>
                  </button>
                )}
              </div>
            )}
            {lines.map((l, i) => {
              /** ⚠ Spec §8 mục 5 — trần đúng số đã nhập theo phiếu gốc. */
              const tran = supplierReturnMax(l.ordered)
              const chamTran = tran != null && l.qty >= tran
              const dsLo = l.lots ?? []
              return (
                <div
                  key={l.key}
                  className="grid min-h-[54px] items-center border-b border-[#f1f5f9] px-4 py-1.5"
                  style={{ gridTemplateColumns: g.cols, gap: g.gap }}
                >
                  <div className="n text-[11.5px] text-[#94a3b8]">{i + 1}</div>
                  <div className="n truncate text-[11px] text-[#64748b]">{l.sku || "—"}</div>
                  <div className="truncate text-[12.5px] font-semibold text-[#0f172a]">{l.name}</div>
                  {/*
                    ⚠ CHỮ ĐỌC, KHÔNG PHẢI Ô CHỌN. Máy chủ lấy lô FIFO và
                      `supplier_return_lines` không có cột lô để nhận
                      lựa chọn nào. Danh sách lấy từ `l.lots` — lô của
                      PHIẾU NHẬP GỐC, không rơi về toàn kho.
                  */}
                  <div
                    className="n truncate text-[10.5px] text-[#64748b]"
                    title={dsLo.map((lo) => `${lo.code}${lo.expiry ? ` · ${lo.expiry}` : ""}`).join(", ")}
                  >
                    {dsLo.length === 0 ? (
                      <span className="text-[#94a3b8]">chưa nối phiếu nhập gốc</span>
                    ) : (
                      `${dsLo[0].code}${dsLo[0].expiry ? ` · ${dsLo[0].expiry}` : ""}${
                        dsLo.length > 1 ? ` +${dsLo.length - 1}` : ""
                      }`
                    )}
                  </div>
                  <div className="n text-center text-[12px] text-[#64748b]">
                    {/* ⚠ Chưa biết thì nói thế, đừng hiện 0 — 0 đọc như
                        "đã nhận hết rồi, không trả được gì". */}
                    {l.ordered == null ? <span className="text-[#94a3b8]">—</span> : l.ordered}
                  </div>
                  <div>
                    <QtyStepper
                      compact
                      label={`số lượng trả dòng ${i + 1}`}
                      value={l.qty}
                      onChange={(v) => patchLine(l.key, { qty: tran == null ? v : Math.min(tran, v) })}
                    />
                    {chamTran && (
                      <div className="mt-px text-center text-[9.5px] font-semibold text-[#b45309]">
                        đã chạm số đã nhập
                      </div>
                    )}
                  </div>
                  <input
                    className="n h-7 w-full rounded-md border border-[#cbd5e1] px-1.5 text-right text-[12px]"
                    aria-label={`Giá nhập dòng ${i + 1}`}
                    inputMode="numeric"
                    value={l.price === 0 ? "" : String(l.price)}
                    placeholder="0"
                    onChange={(e) => patchLine(l.key, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                  />
                  <DiscountCell line={l} index={i + 1} onChange={(d) => patchLine(l.key, { discount: d })} />
                  <LineAmountCell line={l} />
                  <LineMenu index={i + 1} onRemove={() => setLines((c) => c.filter((x) => x.key !== l.key))} />
                </div>
              )
            })}
            {lines.length > 0 && (
              <div className="flex h-10 items-center gap-2 bg-[#f8fafc] px-4">
                <button
                  type="button"
                  onClick={() => setMoTimHang(true)}
                  className="h-7 rounded-md border border-[#cbd5e1] bg-white px-2.5 text-[11.5px] font-semibold text-[#334155]"
                >
                  + Thêm hàng <span className="n opacity-70">F3</span>
                </button>
                <span className="text-[11px] text-[#64748b]">
                  {lines.length} dòng · {lines.reduce((s, l) => s + l.qty, 0)} sp
                </span>
              </div>
            )}
          </LineTableFrame>

          {mode === "sua" && (
            <DeltaPreviewStrip subtitle="Huỷ phiếu rồi lập phiếu mới" cells={deltaCells} />
          )}
        </div>

        <div className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3">
          <div className="relative">
            <PartnerCard
              partner={ncc}
              label="nhà cung cấp"
              onPick={() => setMoTimNcc(true)}
              onClear={() => setNcc(null)}
            />
            <SearchDropdown
              open={moTimNcc}
              onClose={() => setMoTimNcc(false)}
              title="Tìm nhà cung cấp"
              placeholder="Tên NCC, mã, SĐT…"
              items={mucNcc}
              onPick={(it) => setNcc({ id: it.id, name: it.title, meta: it.meta })}
              emptyHint="Không tìm thấy nhà cung cấp nào khớp."
            />
          </div>

          <div className="flex min-h-0 flex-grow flex-col overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white p-3.5">
            {/*
              ⚠ Ô NÀY LÀ ĐƯỜNG DUY NHẤT LẤY ĐƯỢC "SỐ ĐÃ NHẬP" VÀ LÔ CỦA
                PHIẾU GỐC, và nó KHÔNG lưu xuống — xem đầu tệp, mục 2.
                Câu dưới ô nói thẳng điều đó để người dùng không tưởng
                phiếu đang giữ đường về gốc.
            */}
            <label htmlFor="sr-goc" className="block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              Phiếu nhập gốc
            </label>
            <select
              id="sr-goc"
              value={phieuGocId}
              onChange={(e) => napTuPhieuGoc(e.target.value)}
              disabled={!ncc}
              className="mt-1 h-8 w-full rounded-[7px] border border-[#cbd5e1] bg-white px-2 text-[12.5px] disabled:bg-[#f8fafc] disabled:text-[#94a3b8]"
            >
              <option value="">
                {!ncc
                  ? "chọn nhà cung cấp trước"
                  : phieuGoc.length === 0
                    ? "NCC này chưa có phiếu nhập nào đã hoàn thành"
                    : "Không nạp từ phiếu nào"}
              </option>
              {phieuGoc.map((p) => (
                <option key={p.id} value={p.id}>{p.code} · {p.date}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-[#94a3b8]">
              Nạp sẵn dòng hàng, giá nhập và số đã nhập. Đường nối này{" "}
              <strong>không lưu vào phiếu</strong> — mở lại phiếu sẽ không còn cột
              &ldquo;Đã nhập&rdquo;. 50 phiếu gần nhất.
            </p>

            <div className="mt-3 border-t border-[#f1f5f9] pt-2">
              <MoneyRow label="Tổng tiền hàng trả" value={t.goods} />
            </div>
            {/*
              ⚠ Ô NÀY TRỪ ĐI, ngược hẳn "Chi phí nhập khác" của màn 9.
                Cùng chữ "chi phí", hai chiều ngược nhau — dấu `−` là
                thứ duy nhất phân biệt.
            */}
            <DocDiscountRow
              id="sr-phi"
              label="Chi phí trả hàng"
              discount={phi}
              amount={t.fee}
              onChange={(d) => setPhi(d.unit === phi.unit ? d : switchUnit(phi, t.goods))}
            />
            <div className="flex items-center justify-between py-[5px] text-[11px] text-[#b45309]">
              <span />
              <span className="n">− {formatCurrency(t.fee)} trừ đi</span>
            </div>
            <MoneyRow label="Giảm giá dòng" value={t.lineDiscount} tone="muted" />

            <TotalsHero
              label="NCC cần hoàn"
              value={t.dueFromSupplier}
              tone="green"
              sub={
                hoan === "cong-no"
                  ? noConLai == null
                    ? "Trừ vào công nợ · nợ NCC còn chưa xác định"
                    : `Trừ vào công nợ · nợ NCC còn ${formatCurrency(noConLai)}`
                  : `Hoàn bằng ${HOAN_LABEL[hoan].toLowerCase()}`
              }
            />

            <p className="mt-3.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              Hình thức hoàn
            </p>
            {/*
              ⚠ BA NÚT NÀY CHƯA ĐI XUỐNG SỔ. `complete_supplier_return`
                luôn ghi một dòng `payables` ÂM — tức LUÔN là "trừ công
                nợ". Tiền mặt / chuyển khoản là một phiếu chi riêng, và
                màn POS chưa lập phiếu chi. Nên ô này chỉ đổi câu chữ
                trên màn, và `docs/pos-todo.md` giữ mục ấy.
            */}
            <div className="mt-1.5 flex gap-1.5">
              {(Object.keys(HOAN_LABEL) as HoanTien[]).map((h) => (
                <button
                  key={h}
                  type="button"
                  aria-pressed={hoan === h}
                  onClick={() => setHoan(h)}
                  className={`h-8 flex-grow rounded-[7px] border text-[12px] ${
                    hoan === h
                      ? "border-[#2563eb] bg-[#eff6ff] font-semibold text-[#1d4ed8]"
                      : "border-[#cbd5e1] bg-white font-medium text-[#334155]"
                  }`}
                >
                  {HOAN_LABEL[h]}
                </button>
              ))}
            </div>
            {hoan !== "cong-no" && (
              <p className="mt-1 text-[11px] text-[#b45309]">
                Phiếu vẫn ghi giảm công nợ NCC. Tiền mặt / chuyển khoản phải lập phiếu chi
                riêng — màn này chưa làm được việc đó.
              </p>
            )}

            <label htmlFor="sr-lydo" className="mt-3.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              Lý do trả NCC
            </label>
            <select
              id="sr-lydo"
              value={lyDo}
              onChange={(e) => setLyDo(e.target.value)}
              className="mt-1 h-8 w-full rounded-[7px] border border-[#cbd5e1] bg-white px-2 text-[12.5px]"
            >
              {LY_DO.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>

            <input
              type="text"
              aria-label="Ghi chú phiếu trả NCC"
              placeholder="Ghi chú phiếu trả…"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              className="mt-2.5 h-8 w-full rounded-[7px] border border-[#cbd5e1] px-2 text-[12.5px] text-[#334155]"
            />

            {/* ⚠ Spec §8 mục 3 — ô riêng trên panel phiếu trả NCC. */}
            <label htmlFor="sr-hddc" className="mt-2.5 block text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#64748b]">
              HĐ điều chỉnh NCC
            </label>
            <input
              id="sr-hddc"
              className="n mt-1 h-8 w-full rounded-[7px] border border-[#cbd5e1] px-2 text-[12.5px]"
              placeholder="Chưa có"
              value={hdDieuChinh}
              onChange={(e) => setHdDieuChinh(e.target.value)}
            />
            {/* ⚠ Bảng `supplier_returns` chưa có cột cho số này — nói ra. */}
            <p className="mt-1 text-[11px] text-[#94a3b8]">
              Chưa có cột lưu số này; ghi vào đây chỉ để in trên phiếu.
            </p>

            <div className="flex-grow" />
          </div>

          <PanelActions>
            {/* ⚠ Chưa có mẫu in phiếu trả NCC — nút mờ kèm lý do. */}
            <PanelButton width={54} disabled title="Chưa có mẫu in phiếu trả NCC">In</PanelButton>
            <PanelButton
              width={96}
              disabled={dangLuu}
              onClick={() => (mode === "sua" ? router.back() : luuPhieu(false))}
            >
              {mode === "sua" ? "Huỷ" : dangLuu ? "Đang lưu…" : "Lưu nháp"}
            </PanelButton>
            <PanelButton
              variant="primary"
              onClick={() => luuPhieu(true)}
              disabled={!!khoa || lines.length === 0 || dangLuu}
              title={khoa ? khoa.message : lines.length === 0 ? "Chưa có dòng hàng nào trong phiếu" : undefined}
            >
              {dangLuu ? "Đang ghi…" : "Ghi nhận & xuất kho"}
            </PanelButton>
          </PanelActions>
        </div>
      </div>
    </>
  )
}
