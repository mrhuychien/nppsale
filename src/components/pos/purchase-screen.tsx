"use client"

/**
 * MÀN 9 — PHIẾU NHẬP HÀNG, và MÀN 10 — SỬA PHIẾU NHẬP.
 *
 * ⚠ MỘT COMPONENT CHO CẢ HAI, cùng lý do §7.1.
 *
 * ⚠ BẢN THIẾT KẾ NÓI SAI HAI CHỖ, VÀ SPEC §7.2 CHO PHÉP CHỈNH:
 *
 *   1. Artboard 10 mượn câu của màn 7 — "huỷ và lập lại trong cùng một
 *      giao dịch". Bên MUA không có hàm lập lại: chỉ có
 *      `cancel_purchase_invoice` và `complete_purchase_invoice` RỜI
 *      NHAU. Huỷ rồi lập lại là HAI bước, và phiếu mới mang số mới.
 *
 *   2. "Giá vốn bình quân được tính lại" — hệ này không có số bình
 *      quân nào. `complete_purchase_invoice` ghi `batches.unit_cost`
 *      cho TỪNG LÔ. Giá vốn là giá vốn THEO LÔ.
 *
 * ⚠ BẢN ĐẦU CỦA MÀN NÀY CÓ MỘT Ô GÕ LÔ, VÀ ĐÓ LÀ SAI (spec §8 mục 1
 * đọc thành một ô nhập). Mã lô và hạn dùng do MÁY CHỦ sinh — xem
 * `generatedLotCode` trong `src/lib/pos/purchase.ts`. Ô ấy đòi người
 * dùng gõ một thứ `linePayloadOf` không ghi xuống và
 * `complete_purchase_invoice` không đọc. Nay cột "Lô / HSD" hiện đúng
 * mã SẼ được đặt, và nói ra hạn dùng lấy theo mặt hàng.
 *
 * ⚠ KHÔNG CÓ BẢNG HÀNG TRẢ/ĐỔI KÈM (spec §8 mục 6). Trả NCC là chứng
 * từ riêng. Trộn vào đây là một phiếu vừa nhập vừa trả trong cùng một
 * bút toán, và không ai đối chiếu nổi kho sau đó.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { loadSupplierDebt } from "@/lib/pos/load"
import { savePosPurchase } from "@/lib/pos/save"
import { formatCurrency } from "@/lib/utils"
import { switchUnit, type DiscountInput } from "@/lib/pos/discount"
import {
  purchaseTotals, generatedLotCode, purchaseCancelLock,
} from "@/lib/pos/purchase"
import type { PosBadge, PosLine } from "@/lib/pos/types"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocSubHeader, SubHeaderDate, SubHeaderSelect, DocBanner } from "@/components/pos/doc-sub-header"
import {
  LineTableFrame, LineTableHeader, POS_GRID, QtyStepper, DiscountCell,
  LineAmountCell, LineMenu,
} from "@/components/pos/line-table"
import {
  MoneyRow, DocDiscountRow, TotalsHero, PaymentButtons, PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
import {
  DeltaPreviewStrip, DeltaStock, type DeltaCell,
} from "@/components/pos/delta-preview-strip"
import type { PosPayMethod } from "@/lib/pos/types"

export interface PurchaseScreenProps {
  mode: "lap" | "sua"
  /** `null` = phiếu mới. */
  receiptId?: string | null
  badge?: PosBadge | null
  /** Đã trả NCC bao nhiêu — quyết định khoá `DA_TRA_TIEN`. */
  paidToSupplier?: number
  /** Hàng của phiếu đã xuất bớt — khoá `HANG_DA_XUAT`. */
  stockIssued?: boolean
}

let dem = 0
const newKey = () => `p${++dem}`

export function PurchaseScreen({
  mode,
  receiptId = null,
  badge,
  paidToSupplier = 0,
  stockIssued = false,
}: PurchaseScreenProps) {
  const { products, suppliers, loading, warnings } = usePosRefData()
  const { user } = useAuth()
  const { toast } = useToast()
  const router = useRouter()
  const [slipCode, setSlipCode] = useState<string | null>(null)
  const [dangLuu, setDangLuu] = useState(false)
  const [loiNap, setLoiNap] = useState<string | null>(null)

  const [lines, setLines] = useState<PosLine[]>([])
  const [ncc, setNcc] = useState<PosPartner | null>(null)
  const [soHdDauVao, setSoHdDauVao] = useState("")
  const [maDatHang, setMaDatHang] = useState("")
  const [docDiscount, setDocDiscount] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  const [chiPhi, setChiPhi] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  const [vatRate, setVatRate] = useState(0)
  const [traTien, setTraTien] = useState(0)
  const [pay, setPay] = useState<PosPayMethod>("no")
  const [ghiChu, setGhiChu] = useState("")
  const [kho, setKho] = useState("")
  const [thoiDiem, setThoiDiem] = useState("")
  const [moTimHang, setMoTimHang] = useState(false)
  const [moTimNcc, setMoTimNcc] = useState(false)

  const t = useMemo(
    () =>
      purchaseTotals({
        lines: lines.map((l) => ({ qty: l.qty, price: l.price, discount: l.discount })),
        docDiscount,
        otherCost: chiPhi,
        vatRate,
      }),
    [lines, docDiscount, chiPhi, vatRate]
  )

  const khoa = mode === "sua" ? purchaseCancelLock({ paidToSupplier, stockIssued }) : null

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
          /* ⚠ GIÁ NHẬP KHÔNG LẤY GIÁ BÁN. `sell_price` là giá mình bán
             ra; điền nó vào ô giá nhập là ghi giá vốn bằng giá bán, và
             mọi báo cáo lãi lỗ về sau báo lãi 0. Để trống, người nhập
             gõ theo hóa đơn NCC. */
          price: 0,
          discount: { value: 0, unit: "vnd" },
        },
      ])
    },
    [products]
  )

  /** ⚠ Spec §10: `F8` ở màn nhập là đưa tiêu điểm về ô tiền trả NCC. */
  usePosKeys({
    F3: () => setMoTimHang(true),
    F4: () => setMoTimNcc(true),
    F8: () => document.getElementById("p-tra")?.focus(),
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

  /** Nạp phiếu nhập đã lưu. */
  useEffect(() => {
    if (!receiptId) return
    let huy = false
    ;(async () => {
      try {
        const sb = createClient()
        const { data, error } = await sb
          .from("purchase_invoices")
          .select("id, receipt_code, supplier_id, invoice_number, invoice_date, warehouse_zone, notes, status, supplier:suppliers(name, code), lines:purchase_invoice_lines(id, product_id, unit_name, quantity, unit_price, line_discount, notes, product:products(name, sku))")
          .eq("id", receiptId)
          .maybeSingle()
        if (huy) return
        if (error) { setLoiNap(errorMessage(error)); return }
        const r = (data as unknown) as {
          receipt_code: string | null; supplier_id: string; invoice_number: string | null
          invoice_date: string; warehouse_zone: string | null; notes: string | null
          supplier?: { name?: string | null; code?: string | null } | null
          lines?: Array<{
            product_id: string; unit_name: string; quantity: number; unit_price: number
            line_discount: number; notes: string | null
            product?: { name?: string | null; sku?: string | null } | null
          }> | null
        } | null
        if (!r) { setLoiNap("Không tìm thấy phiếu nhập này."); return }
        setSlipCode(r.receipt_code)
        setNcc({ id: r.supplier_id, name: r.supplier?.name || "—", meta: r.supplier?.code ?? "" })
        setSoHdDauVao(r.invoice_number || "")
        setThoiDiem(r.invoice_date || "")
        setKho(r.warehouse_zone || "")
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
            note: x.notes ?? undefined,
          }))
        )
      } catch (e) {
        if (!huy) setLoiNap(errorMessage(e))
      }
    })()
    return () => { huy = true }
  }, [receiptId])

  /** Công nợ NCC — `null` là chưa đọc được. */
  useEffect(() => {
    const id = ncc?.id
    if (!id) return
    let huy = false
    ;(async () => {
      const no = await loadSupplierDebt(createClient(), id).catch(() => null)
      if (!huy) setNcc((c) => (c && c.id === id ? { ...c, debt: no } : c))
    })()
    return () => { huy = true }
  }, [ncc?.id])

  /**
   * LƯU PHIẾU NHẬP.
   *
   * ⚠ HOÀN THÀNH ĐI QUA RPC `complete_purchase_invoice`, một giao dịch.
   * Màn này KHÔNG tự cộng `batches` rồi ghi `payables` — màn cũ
   * `/inventory/stock-in` từng làm thế, và mạng rớt giữa chừng là kho
   * đã cộng mà công nợ chưa ghi.
   */
  const luuPhieu = useCallback(
    async (complete: boolean) => {
      if (!user?.org_id || !user.id) return
      if (!ncc) { toast({ title: "Chưa chọn nhà cung cấp", variant: "destructive" }); return }
      if (lines.length === 0) { toast({ title: "Phiếu chưa có dòng hàng nào", variant: "destructive" }); return }
      setDangLuu(true)
      try {
        const r = await savePosPurchase(createClient(), {
          receiptId,
          orgId: user.org_id,
          userId: user.id,
          supplierId: ncc.id,
          invoiceNumber: soHdDauVao,
          invoiceDate: thoiDiem || new Date().toISOString().slice(0, 10),
          zone: kho || "sale",
          discount: t.docDiscount,
          notes: ghiChu,
          lines,
          complete,
          subtotal: t.goods - t.lineDiscount - t.docDiscount,
          vat: t.vat,
          total: t.dueToSupplier,
        })
        toast({ title: complete ? "Đã hoàn thành — nhập kho và ghi công nợ NCC" : "Đã lưu phiếu tạm" })
        if (!receiptId) router.replace(`/pos/nhap-hang/${r.receiptId}`)
      } catch (e) {
        toast({ title: "Chưa lưu được", description: errorMessage(e), variant: "destructive" })
      } finally {
        setDangLuu(false)
      }
    },
    [user, ncc, lines, receiptId, soHdDauVao, thoiDiem, kho, ghiChu, t, router, toast]
  )

  /**
   * DẢI DELTA màn 10 — spec §7.2 ghi ba ô `KHO BÁN · CÔNG NỢ NCC ·
   * GIÁ VỐN BQ`.
   *
   * ⚠ Ô THỨ BA ĐỔI TÊN THÀNH `GIÁ VỐN LÔ`. Hệ này không có số bình
   * quân nào: `complete_purchase_invoice` ghi `batches.unit_cost` cho
   * TỪNG LÔ. Gọi tên một thứ không tồn tại là người đọc đi tìm nó
   * trong báo cáo và không thấy.
   */
  const deltaCells = useMemo<DeltaCell[]>(
    () => [
      {
        label: "Kho bán",
        body:
          lines.length === 0 ? (
            <span className="text-[#94a3b8]">chưa có dòng hàng</span>
          ) : (
            <DeltaStock sku={`${lines.length} lô mới`} net={lines.reduce((s, l) => s + l.qty, 0)} unit="sp" />
          ),
      },
      /* ⚠ Chưa đọc được công nợ NCC hiện tại → `đang tính…`. */
      { label: "Công nợ NCC", body: null },
      {
        label: "Giá vốn lô",
        body: (
          <span className="text-[#64748b]">
            mỗi dòng ghi một lô, giá vốn riêng từng lô
          </span>
        ),
      },
    ],
    [lines]
  )

  const g = POS_GRID.purchase

  return (
    <>
      <DocSubHeader
        title={mode === "sua" ? "Sửa phiếu nhập" : "Phiếu nhập hàng"}
        code={slipCode}
        badge={badge ?? (mode === "lap" ? { label: "NHÁP", tone: "tam" } : { label: "ĐANG SỬA", tone: "dang-sua" })}
        subtitle={mode === "sua" ? "NPP toàn quyền · mọi trường mở" : undefined}
        right={
          <>
            <SubHeaderSelect
              id="p-kho"
              label="Kho nhập"
              value={kho}
              onChange={setKho}
              options={[
                { id: "sale", label: "Kho bán" },
                { id: "date", label: "Kho cận date" },
              ]}
            />
            <SubHeaderDate value={thoiDiem} onChange={setThoiDiem} label="Ngày nhập" />
          </>
        }
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        <div className="flex min-h-0 w-[1012px] shrink-0 flex-col gap-3">
          {warnings.map((w) => (
            <DocBanner key={w} tone="warn">{w}</DocBanner>
          ))}

          {/*
            ⚠ BANNER NÓI ĐÚNG CƠ CHẾ ĐANG CÓ. Artboard 10 mượn câu của
              màn 7 ("cùng một giao dịch", "giá vốn bình quân"); bên MUA
              không có cả hai thứ đó. Xem đầu tệp.
          */}
          {mode === "sua" && (
            <DocBanner tone="warn">
              Bên mua <strong>không có lệnh lập lại một bước</strong> như hóa đơn bán. Sửa
              phiếu nhập là <strong>huỷ phiếu này rồi lập một phiếu mới</strong> — hai thao
              tác riêng, và phiếu mới mang số mới. Giá vốn ghi theo từng lô, không có số
              bình quân nào được tính lại.
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
                grid="purchase"
                cells={[
                  { label: "#" }, { label: "Mã hàng" }, { label: "Tên hàng" },
                  { label: "ĐVT" }, { label: "Lô / HSD" },
                  { label: "Số lượng", align: "center" },
                  { label: "Giá nhập", align: "right" },
                  { label: "Giảm", align: "right" },
                  { label: "Thành tiền", align: "right" },
                  { label: "" },
                ]}
              />
            }
            footer={
              lines.length > 0 ? (
                <div className="shrink-0 bg-[#f8fafc] px-4 py-2 text-[11.5px] text-[#64748b]">
                  Mỗi dòng sinh một lô riêng lúc nhập kho. Mã lô đặt theo mã phiếu, hạn dùng
                  tính theo hạn dùng khai trong hồ sơ mặt hàng — không gõ tay ở đây.
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
              /** ⚠ Mã lô THẬT sẽ được đặt — xem `generatedLotCode`. */
              const maLo = generatedLotCode(slipCode, i + 1)
              return (
                <div
                  key={l.key}
                  className="grid min-h-[54px] items-center border-b border-[#f1f5f9] px-4 py-1.5"
                  style={{ gridTemplateColumns: g.cols, gap: g.gap }}
                >
                  <div className="n text-[11.5px] text-[#94a3b8]">{i + 1}</div>
                  <div className="n truncate text-[11px] text-[#64748b]">{l.sku || "—"}</div>
                  <div className="truncate text-[12.5px] font-semibold text-[#0f172a]">{l.name}</div>
                  <select
                    aria-label={`Đơn vị tính dòng ${i + 1}`}
                    value={l.unit}
                    onChange={(e) => patchLine(l.key, { unit: e.target.value })}
                    className="h-7 w-full rounded-md border border-[#cbd5e1] bg-white px-1 text-[11.5px]"
                  >
                    {l.units.map((u) => (
                      <option key={u.unit_name} value={u.unit_name}>{u.unit_name}</option>
                    ))}
                  </select>
                  {/*
                    ⚠ CỘT NÀY ĐỌC, KHÔNG GÕ. Lô được SINH RA lúc nhập
                      kho: `complete_purchase_invoice` đặt tên theo mã
                      phiếu và lấy hạn dùng từ hồ sơ mặt hàng. Một ô gõ
                      tay ở đây đòi người dùng nhập một thứ không cột
                      nào nhận và không hàm nào đọc. Xem đầu tệp.
                  */}
                  <div className="n truncate text-[10.5px] text-[#64748b]" title={maLo ?? undefined}>
                    {maLo ?? <span className="text-[#94a3b8]">tự sinh khi nhập kho</span>}
                  </div>
                  <QtyStepper
                    compact
                    label={`số lượng dòng ${i + 1}`}
                    value={l.qty}
                    onChange={(v) => patchLine(l.key, { qty: v })}
                  />
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
            <div className="flex items-center justify-between gap-2.5 pb-1">
              <label htmlFor="p-hd" className="text-[13px] text-[#334155]">Số hóa đơn đầu vào</label>
              <input
                id="p-hd"
                className="n h-8 w-[150px] rounded-[7px] border border-[#cbd5e1] px-2 text-right text-[12.5px]"
                /* ⚠ Cho để trống lúc lập (spec §8 mục 2) — hóa đơn NCC
                   thường về sau hàng. */
                placeholder="Chưa có"
                value={soHdDauVao}
                onChange={(e) => setSoHdDauVao(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-2.5 pb-2">
              <label htmlFor="p-po" className="text-[13px] text-[#334155]">Mã đặt hàng nhập</label>
              <select
                id="p-po"
                value={maDatHang}
                onChange={(e) => setMaDatHang(e.target.value)}
                className="h-8 w-[150px] rounded-[7px] border border-[#cbd5e1] bg-white px-2 text-[12.5px]"
              >
                <option value="">Không gắn đơn</option>
              </select>
            </div>

            <div className="border-t border-[#f1f5f9] pt-2">
              <MoneyRow label="Tổng tiền hàng" value={t.goods} />
              <MoneyRow label="Giảm giá dòng" value={t.lineDiscount} tone="muted" />
              <DocDiscountRow
                id="p-giam"
                label="Giảm giá phiếu"
                discount={docDiscount}
                amount={t.docDiscount}
                onChange={(d) => setDocDiscount(d.unit === docDiscount.unit ? d : switchUnit(docDiscount, t.goods))}
              />
              {/*
                ⚠ Ô NÀY CỘNG VÀO, KHÔNG TRỪ — tiền bốc xếp, vận chuyển.
                  Dấu `+` trước con số là thứ duy nhất phân biệt nó với
                  ô giảm giá ngay trên, nên đừng bỏ.
              */}
              <DocDiscountRow
                id="p-chiphi"
                label="Chi phí nhập khác"
                discount={chiPhi}
                amount={t.otherCost}
                onChange={(d) => setChiPhi(d.unit === chiPhi.unit ? d : switchUnit(chiPhi, t.goods))}
              />
              <div className="flex items-center justify-between py-[5px] text-[11px] text-[#16a34a]">
                <span />
                <span className="n">+ {formatCurrency(t.otherCost)} cộng vào</span>
              </div>
              <div className="flex items-center gap-2 py-[5px]">
                <label htmlFor="p-vat" className="flex-grow text-[13px] text-[#334155]">
                  Thuế GTGT đầu vào
                </label>
                <select
                  id="p-vat"
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  className="h-[30px] w-[74px] rounded-md border border-[#cbd5e1] bg-white px-1.5 text-[12.5px]"
                >
                  {[0, 5, 8, 10].map((v) => <option key={v} value={v}>{v}%</option>)}
                </select>
                <span className="n w-[84px] text-right text-[13.5px]">{formatCurrency(t.vat)}</span>
              </div>
            </div>

            <TotalsHero label="Cần trả NCC" value={t.dueToSupplier} />

            <div className="mt-3.5 flex items-center justify-between gap-2.5">
              <label htmlFor="p-tra" className="text-[13px] text-[#334155]">
                Tiền trả NCC <span className="n text-[11px] opacity-70">F8</span>
              </label>
              <input
                id="p-tra"
                className="n h-[34px] w-[150px] rounded-[7px] border border-[#cbd5e1] px-2.5 text-right text-[14px] font-semibold"
                inputMode="numeric"
                value={traTien === 0 ? "0" : String(traTien)}
                onChange={(e) => setTraTien(Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
            </div>
            {/* ⚠ "Ghi nợ hết" là mặc định — spec §6. */}
            <PaymentButtons
              value={pay}
              onChange={(m) => {
                setPay(m)
                if (m === "no") setTraTien(0)
                else if (traTien === 0) setTraTien(t.dueToSupplier)
              }}
            />

            <div className="mt-3.5 flex items-center justify-between border-t border-[#f1f5f9] pt-3">
              <span className="text-[13px] text-[#334155]">Tính vào công nợ</span>
              <span className="n text-[14px] font-bold text-[#b45309]">
                {formatCurrency(Math.max(0, t.dueToSupplier - traTien))}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11.5px] text-[#64748b]">Nợ NCC sau phiếu</span>
              <span className="n text-[11.5px] text-[#64748b]">
                {/* ⚠ Chưa đọc được nợ NCC → nói thế, đừng cộng từ 0. */}
                {ncc?.debt == null
                  ? "chưa xác định"
                  : formatCurrency(ncc.debt + Math.max(0, t.dueToSupplier - traTien))}
              </span>
            </div>

            <input
              type="text"
              aria-label="Ghi chú phiếu nhập"
              placeholder="Ghi chú phiếu nhập…"
              value={ghiChu}
              onChange={(e) => setGhiChu(e.target.value)}
              className="mt-3 h-8 w-full rounded-[7px] border border-[#cbd5e1] px-2 text-[12.5px] text-[#334155]"
            />

            <div className="flex-grow" />
          </div>

          <PanelActions>
            <PanelButton width={54} onClick={() => window.print()}>In</PanelButton>
            <PanelButton
              width={96}
              disabled={dangLuu}
              onClick={() => (mode === "sua" ? router.back() : luuPhieu(false))}
            >
              {mode === "sua" ? "Huỷ" : dangLuu ? "Đang lưu…" : "Lưu tạm"}
            </PanelButton>
            <PanelButton
              variant="primary"
              onClick={() => luuPhieu(true)}
              disabled={!!khoa || lines.length === 0 || dangLuu}
              title={
                khoa
                  ? khoa.message
                  : lines.length === 0
                    ? "Chưa có mặt hàng nào trong phiếu"
                    : undefined
              }
            >
              {dangLuu ? "Đang ghi…" : "Hoàn thành & nhập kho"}
            </PanelButton>
          </PanelActions>

          <div className="relative">
            <SearchDropdown
              open={moTimHang}
              onClose={() => setMoTimHang(false)}
              title="Tìm hàng hóa"
              placeholder="Tên hàng, mã hàng, mã vạch…"
              items={mucHang}
              onPick={(it) => themHang(it.id)}
              emptyHint="Không tìm thấy mặt hàng nào khớp."
            />
          </div>
        </div>
      </div>
    </>
  )
}
