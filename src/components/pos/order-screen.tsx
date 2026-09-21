"use client"

/**
 * MÀN 1 — ĐƠN ĐẶT HÀNG, và MÀN 1b — SỬA ĐƠN HÀNG.
 *
 * ⚠ MỘT COMPONENT CHO CẢ HAI (spec §7.1 chốt nguyên văn: "render đúng
 * component của màn 1. Không tạo layout riêng, không tạo component
 * riêng"). Năm điểm khác nhau đều là PROP, không phải một bản sao:
 * tiêu đề, badge, phụ đề, chấm tab, và hàng nút trái.
 *
 * Lý do không phải thẩm mỹ. Hai bản sao là hai chỗ phải sửa khi đổi
 * quy tắc giảm giá, và bản "sửa đơn" — bản ít người mở hơn — là bản sẽ
 * bị quên. Kho mã này đã có đúng câu chuyện ấy ở `/sell`: màn sửa đơn
 * từng nạp `returnLines: []` để né một lỗi, và cái né ấy đẻ ra một lỗi
 * to hơn.
 *
 * ⚠ RÀNG BUỘC DUY NHẤT CỦA BẢN SỬA: dòng đã xuất một phần thì stepper
 * có `min = số đã xuất`. Không có gì khác bị khoá — spec §7.1 nói rõ
 * "phần còn lại sửa thoải mái".
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { buildOrderPayload } from "@/lib/sell/create-order"
import { generateOrderCode } from "@/lib/utils"
import { cartTotals } from "@/lib/sell/cart"
import { loadInvoiceableLines } from "@/lib/orders/post-invoice"
import { loadCustomerDebt, loadLastPrices, loadLotsByProduct, attachLineExtras } from "@/lib/pos/load"
import { savePosOrder, savePosInvoice, posLinesToCart } from "@/lib/pos/save"
import { invoiceWarnings } from "@/lib/orders/post-invoice"
import { formatCurrency } from "@/lib/utils"
import { lineGross, switchUnit, type DiscountInput } from "@/lib/pos/discount"
import { posTotals, cashSuggestions } from "@/lib/pos/totals"
import type { PosBadge, PosLine, PosPayMethod } from "@/lib/pos/types"
import { usePosSettings } from "@/store/pos/settings"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocSubHeader, SubHeaderDate, SubHeaderSelect, DocBanner } from "@/components/pos/doc-sub-header"
import {
  LineTableFrame, LineTableHeader, POS_GRID, QtyStepper, DiscountCell,
  LineAmountCell, LineMenu, NegativeStockStrip,
} from "@/components/pos/line-table"
import {
  MoneyRow, DocDiscountRow, TotalsHero, PaymentButtons, CashChips,
  PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
import { ReturnExchangeTable } from "@/components/pos/return-exchange-table"

export interface OrderScreenProps {
  /** `lap` = đơn mới hoặc phiếu tạm. `sua` = đơn đã lưu, mở ra sửa. */
  mode: "lap" | "sua"
  /** `null` = đơn mới. Có mã thì nạp đơn ấy lên. */
  orderId?: string | null
}

let demDong = 0
const newKey = () => `d${++demDong}`

export function OrderScreen({ mode, orderId = null }: OrderScreenProps) {
  const { settings } = usePosSettings()
  const { user } = useAuth()
  const { products, customers, sellers, stockByProduct, loading, warnings, productById } =
    usePosRefData()
  const { toast } = useToast()
  const router = useRouter()

  const [lines, setLines] = useState<PosLine[]>([])
  const [retLines, setRetLines] = useState<PosLine[]>([])
  const [khach, setKhach] = useState<PosPartner | null>(null)
  const [docDiscount, setDocDiscount] = useState<DiscountInput>({
    value: 0,
    unit: settings.defaultDiscountUnit,
  })
  const [traTien, setTraTien] = useState(0)
  const [pay, setPay] = useState<PosPayMethod>(settings.defaultCreditAll ? "no" : "tien-mat")
  const [ngayGiao, setNgayGiao] = useState("")
  const [dieuKhoan, setDieuKhoan] = useState("COD")
  const [nvbh, setNvbh] = useState("")
  const [thoiDiem, setThoiDiem] = useState(() => "")
  const [moTimHang, setMoTimHang] = useState(false)
  const [moTimKhach, setMoTimKhach] = useState(false)
  const [orderCode, setOrderCode] = useState<string | null>(null)
  const [orderStatus, setOrderStatus] = useState<"draft" | "submitted" | string>("draft")
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [dangLuu, setDangLuu] = useState(false)
  const [loiNap, setLoiNap] = useState<string | null>(null)

  /** Có dòng nào ĐÃ XUẤT một phần — quyết định banner và sàn stepper. */
  const partiallyIssued = useMemo(() => lines.some((l) => (Number(l.issued) || 0) > 0), [lines])

  /* ---------------------------------------------------------------- */

  const returnCredit = useMemo(
    () =>
      retLines
        // ⚠ CHỈ DÒNG TRẢ TRỪ TIỀN. Dòng ĐỔI lấy hàng mới ra khỏi kho và
        //   không đụng công nợ — cộng nó vào là trừ tiền hai lần.
        .filter((l) => !l.isExchange)
        .reduce((s, l) => s + lineGross(l.qty, l.price), 0),
    [retLines]
  )

  const totals = useMemo(
    () => posTotals({ lines, docDiscount, other: 0, returnCredit }),
    [lines, docDiscount, returnCredit]
  )

  const vuotTon = useMemo(
    () =>
      lines.filter((l) => {
        const ton = l.stock
        return ton != null && l.qty > ton
      }).length,
    [lines]
  )

  const patchLine = useCallback((key: string, p: Partial<PosLine>) => {
    setLines((cu) => cu.map((l) => (l.key === key ? { ...l, ...p } : l)))
  }, [])

  const addProduct = useCallback(
    (productId: string) => {
      const p = products.find((x) => x.id === productId)
      if (!p) return
      const units = (p.units ?? []).map((u) => ({
        unit_name: u.unit_name,
        conversion: Number(u.conversion) || 1,
      }))
      const donVi = units[0]?.unit_name || p.base_unit
      setLines((cu) => {
        /**
         * ⚠ GỘP DÒNG TRÙNG THEO (MÃ HÀNG + ĐƠN VỊ), và chỉ khi người
         * dùng bật thiết lập ấy. Cùng một mã đặt 3 thùng và 5 gói là
         * hai dòng khác nhau, và chúng có thể khác giá — gộp theo mỗi
         * mã hàng là cộng nhầm hai đơn vị vào nhau.
         */
        if (settings.mergeDuplicateLines) {
          const i = cu.findIndex((l) => l.productId === productId && l.unit === donVi)
          if (i >= 0) {
            const sao = [...cu]
            sao[i] = { ...sao[i], qty: sao[i].qty + 1 }
            return sao
          }
        }
        const moi: PosLine = {
          key: newKey(),
          productId: p.id,
          sku: p.sku ?? "",
          name: p.name,
          unit: donVi,
          units: units.length ? units : [{ unit_name: p.base_unit, conversion: 1 }],
          qty: 1,
          price: Number(p.sell_price) || 0,
          // ⚠ Đơn vị giảm lấy từ THIẾT LẬP, và chỉ ở lúc TẠO dòng.
          discount: { value: 0, unit: settings.defaultDiscountUnit },
          stock: stockByProduct[p.id] ?? null,
          ordered: null,
          issued: null,
        }
        return [...cu, moi]
      })
    },
    [products, settings.mergeDuplicateLines, settings.defaultDiscountUnit, stockByProduct]
  )

  /**
   * NẠP ĐƠN ĐÃ LƯU.
   *
   * ⚠ DÒNG HÀNG ĐỌC QUA `get_invoiceable_lines`, KHÔNG ĐỌC THẲNG BẢNG.
   * RPC ấy trả kèm `invoiced_qty` — SỐ ĐÃ XUẤT của từng dòng — và đó
   * chính là sàn của stepper ở màn sửa (spec §7.1). Đọc thẳng
   * `sales_order_lines` thì không có số ấy, và ràng buộc duy nhất của
   * màn này mất tác dụng trong im lặng.
   */
  useEffect(() => {
    if (!orderId) return
    let huy = false
    ;(async () => {
      try {
        const sb = createClient()
        const [h, ds, hd] = await Promise.all([
          sb.from("sales_orders")
            .select("id, order_code, status, customer_id, payment_terms, expected_delivery, notes, sales_user_id")
            .eq("id", orderId).maybeSingle(),
          loadInvoiceableLines(sb, orderId),
          sb.from("sales_invoices")
            .select("invoice_code").eq("order_id", orderId).eq("status", "posted")
            .order("created_at", { ascending: false }).limit(1),
        ])
        if (huy) return
        const head = (h.data as unknown) as {
          order_code: string; status: string; customer_id: string
          payment_terms: string | null; expected_delivery: string | null
          notes: string | null; sales_user_id: string | null
        } | null
        if (!head) { setLoiNap("Không tìm thấy đơn này."); return }
        setOrderCode(head.order_code)
        setOrderStatus(head.status)
        setDieuKhoan(head.payment_terms || "COD")
        setNgayGiao(head.expected_delivery || "")
        setNvbh(head.sales_user_id || "")
        const inv = ((hd.data as unknown) as Array<{ invoice_code: string }>) ?? []
        setIssuedCode(inv[0]?.invoice_code ?? null)

        setLines(
          ds
            /* ⚠ BỎ DÒNG HÀNG ĐỔI. RPC trả cả dòng trả/đổi kèm đơn; chúng
               không phải dòng hàng BÁN và không thuộc bảng này. */
            .filter((r) => !r.isExchange && r.orderLineId)
            .map((r) => ({
              key: newKey(),
              productId: r.productId,
              sku: r.sku ?? "",
              name: r.productName,
              unit: r.unitName,
              units: [{ unit_name: r.unitName, conversion: r.conversionFactor }],
              qty: r.orderedQty,
              unitPriceSource: r.unitPrice,
              price: r.unitPrice,
              discount: { value: 0, unit: settings.defaultDiscountUnit },
              stock: r.availableBase,
              ordered: r.orderedQty,
              /* ⚠ SÀN CỦA STEPPER — spec §7.1. */
              issued: r.invoicedQty,
              note: r.note ?? undefined,
            }) as PosLine)
        )
      } catch (e) {
        if (!huy) setLoiNap(errorMessage(e))
      }
    })()
    return () => { huy = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  /**
   * Công nợ + giá bán gần nhất của khách đang chọn.
   *
   * ⚠ ĐỌC HỎNG THÌ ĐỂ `null`, và panel hiện "chưa xác định". Cộng từ 0
   * ra một con số trông như thật là nói với người đi đòi tiền rằng
   * khách này sạch nợ.
   */
  useEffect(() => {
    const id = khach?.id
    if (!id) return
    let huy = false
    ;(async () => {
      const sb = createClient()
      const [no, gia] = await Promise.all([
        loadCustomerDebt(sb, id).catch(() => null),
        loadLastPrices(sb, id).catch(() => ({})),
      ])
      if (huy) return
      setKhach((c) => (c && c.id === id ? { ...c, debt: no } : c))
      setLines((cu) => attachLineExtras(cu, { lastPrices: gia }))
    })()
    return () => { huy = true }
  }, [khach?.id])

  /** Lô còn hàng của các mặt hàng đang có trong giỏ — spec §4. */
  useEffect(() => {
    const ids = lines.map((l) => l.productId).filter(Boolean)
    if (ids.length === 0) return
    let huy = false
    ;(async () => {
      const lo = await loadLotsByProduct(createClient(), ids).catch(() => ({}))
      if (huy) return
      setLines((cu) => attachLineExtras(cu, { lotsByProduct: lo }))
    })()
    return () => { huy = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length])

  /* --- phím tắt, spec §10 --- */
  usePosKeys({
    F3: () => setMoTimHang(true),
    F4: () => setMoTimKhach(true),
    F8: () => setRetLines((c) => [...c, emptyReturnLine(false)]),
    F9: () => setRetLines((c) => [...c, emptyReturnLine(true)]),
    Escape: () => { setMoTimHang(false); setMoTimKhach(false) },
  })

  /* --- dữ liệu cho hai dropdown --- */
  const mucHang = useMemo<SearchItem[]>(
    () =>
      products.map((p) => {
        const ton = stockByProduct[p.id] ?? 0
        return {
          id: p.id,
          title: p.name,
          meta: `${p.sku ?? "—"} · ${p.base_unit} · Tồn ${ton.toLocaleString("vi-VN")}`,
          alert: ton <= 0,
          keywords: `${p.sku ?? ""} ${p.barcode ?? ""}`,
          right: (
            <span className="n text-[12.5px] font-semibold text-[#0f172a]">
              {formatCurrency(Number(p.sell_price) || 0)}
            </span>
          ),
        }
      }),
    [products, stockByProduct]
  )

  const mucKhach = useMemo<SearchItem[]>(
    () =>
      customers.map((c) => ({
        id: c.id,
        title: c.store_name,
        meta: [c.phone, c.address].filter(Boolean).join(" · "),
        keywords: `${c.owner_name ?? ""} ${c.phone ?? ""}`,
      })),
    [customers]
  )

  /* ---------------------------------------------------------------- */

  /**
   * LƯU ĐƠN — đi qua `savePosOrder`, tức qua `createOrderRecords` /
   * `applyOrderEdit` đang chạy.
   *
   * ⚠ KHÔNG GHI THẲNG `sales_orders` TỪ ĐÂY. Hai lib ấy đã gánh sẵn
   * những thứ không nhìn thấy được: idempotent theo `client_request_id`
   * (bấm hai lần không ra hai đơn), so khớp dòng hàng thay vì xoá sạch
   * rồi chèn lại (khoá ngoại `sales_invoice_lines_order_line_id_fkey`),
   * và đếm dòng trả về sau mỗi lệnh ghi vì RLS từ chối là 0 dòng +
   * HTTP 200 + `error` null.
   */
  const luuDon = useCallback(
    async (asDraft: boolean) => {
      if (!user?.org_id || !user.id) return
      if (!khach) { toast({ title: "Chưa chọn khách hàng", variant: "destructive" }); return }
      if (lines.length === 0) { toast({ title: "Đơn chưa có mặt hàng nào", variant: "destructive" }); return }
      setDangLuu(true)
      try {
        const cart = posLinesToCart(lines)
        const payload = buildOrderPayload({
          clientRequestId:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          orderCode: orderCode || generateOrderCode(),
          customerId: khach.id,
          customerName: khach.name,
          paymentTerms: dieuKhoan,
          expectedDelivery: ngayGiao || null,
          notes: "",
          cart,
          totals: cartTotals(cart),
          createdAt: new Date().toISOString(),
          returnReason: "damaged",
          returnLines: [],
          /* ⚠ ĐI TRONG TẢI TRỌNG, KHÔNG ĐI TRONG `ctx` — xem mig 153. */
          salesUserId: nvbh || null,
        })
        const r = await savePosOrder(createClient(), {
          orderId,
          payload,
          lines,
          status: asDraft ? "draft" : "submitted",
          reason: "",
          userId: user.id,
          orgId: user.org_id,
          salesUserId: nvbh || null,
          productName: (id) => productById(id)?.name,
        })
        if (asDraft) {
          toast({ title: orderId ? `Đã lưu thay đổi ${r.orderCode}` : `Đã lưu đơn ${r.orderCode}` })
          if (!orderId) router.replace(`/pos/don-hang/${r.orderId}`)
          return
        }

        /**
         * ⚠ HAI BƯỚC, VÀ NÓI RÕ KHI BƯỚC HAI HỎNG. Nút mang tên "Xuất
         * hàng & lập HĐ" nên nó phải LÀM cả hai; nhưng ghi đơn và ghi
         * hóa đơn là hai giao dịch riêng của hệ đang chạy, không có
         * lệnh nào gộp chúng.
         *
         * Bước 2 hỏng thì ĐƠN VẪN CÒN ở phiếu tạm — đó là một trạng
         * thái hợp lệ, không phải hỏng. Im lặng ở đây là người dùng
         * tưởng mất cả đơn và đi lập lại một đơn thứ hai.
         */
        try {
          const hd = await savePosInvoice(createClient(), {
            invoiceId: null,
            orderId: r.orderId,
            lines,
            paymentTerms: dieuKhoan,
          })
          toast({
            title: `Đã xuất hàng — hóa đơn ${hd.invoiceCode}`,
            description: invoiceWarnings(hd) ?? undefined,
          })
          router.replace(`/pos/hoa-don/${hd.invoiceId}`)
        } catch (e2) {
          toast({
            title: `Đã lưu đơn ${r.orderCode} nhưng CHƯA xuất được hàng`,
            description: `${errorMessage(e2)} — đơn đang ở Phiếu tạm, mở lại để xuất.`,
            variant: "destructive",
          })
          router.replace(`/pos/don-hang/${r.orderId}`)
        }
      } catch (e) {
        /* ⚠ `errorMessage` — lỗi PostgREST là OBJECT THƯỜNG, không phải
           `Error`. `err instanceof Error ? … : "Lỗi không xác định"` nuốt
           sạch câu máy chủ vừa nói. */
        toast({ title: "Chưa lưu được", description: errorMessage(e), variant: "destructive" })
      } finally {
        setDangLuu(false)
      }
    },
    [user, khach, lines, orderCode, dieuKhoan, ngayGiao, nvbh, orderId, productById, router, toast]
  )

  /**
   * Badge và phụ đề — spec §7.1 bảng năm điểm khác nhau.
   *
   * ⚠ LẤY TỪ TRẠNG THÁI THẬT CỦA ĐƠN, không nhận từ ngoài truyền vào.
   * Truyền từ route là route phải tự đọc đơn lần nữa, và hai chỗ đọc
   * cùng một thứ là hai chỗ nói khác nhau được.
   */
  const badgeThat: PosBadge | null =
    mode === "lap"
      ? { label: "PHIẾU TẠM", tone: "tam" }
      : orderStatus === "completed" || orderStatus === "closed"
        ? { label: "HOÀN THÀNH", tone: "xong" }
        : partiallyIssued
          ? { label: "XUẤT MỘT PHẦN", tone: "mot-phan" }
          : { label: "PHIẾU TẠM", tone: "tam" }

  const phuDe =
    mode === "lap" ? (
      "Tạo offline · chưa kiểm tồn"
    ) : issuedCode ? (
      <>
        Đã xuất 1 lần ·{" "}
        <Link href={`/sales-invoices`} className="font-semibold text-[#2563eb] underline">
          {issuedCode}
        </Link>
      </>
    ) : undefined

  return (
    <>
      <DocSubHeader
        title={mode === "sua" ? "Sửa đơn hàng" : "Đơn đặt hàng"}
        code={orderCode}
        badge={badgeThat}
        subtitle={phuDe}
        right={
          <>
            <SubHeaderSelect
              id="pos-nvbh"
              label="NVBH"
              value={nvbh}
              onChange={setNvbh}
              options={sellers.map((u) => ({ id: u.id, label: u.full_name }))}
            />
            <SubHeaderDate value={thoiDiem} onChange={setThoiDiem} />
          </>
        }
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        {/* ---------------- cột trái ---------------- */}
        <div className="flex min-h-0 w-[1012px] shrink-0 flex-col gap-3">
          {/*
            ⚠ CẢNH BÁO DANH MỤC THIẾU PHẢI NẰM TRÊN CÙNG. Đây đúng là
              những câu "danh mục quá lớn, màn hình còn THIẾU một phần" —
              người đang tìm một mã không ra kết quả cần đọc nó TRƯỚC khi
              kết luận danh mục không có mã ấy.
          */}
          {warnings.map((w) => (
            <DocBanner key={w} tone="warn">{w}</DocBanner>
          ))}
          {loiNap && <DocBanner tone="warn">Không nạp được đơn — {loiNap}</DocBanner>}

          {/* Banner của màn sửa — chỉ khi đơn đã xuất một phần, spec §7.1. */}
          {mode === "sua" && partiallyIssued && (
            <DocBanner>
              Sửa đơn dùng đúng màn lập đơn. Đơn đã xuất một phần thì không giảm số lượng
              xuống dưới phần đã xuất — phần còn lại sửa thoải mái.
            </DocBanner>
          )}

          <LineTableFrame
            header={
              <LineTableHeader
                grid="order"
                cells={[
                  { label: "#" },
                  { label: "Mã hàng" },
                  { label: "Tên hàng" },
                  { label: "ĐVT" },
                  { label: "Số lượng", align: "center" },
                  { label: "Đơn giá", align: "right" },
                  { label: "Giảm", align: "right" },
                  { label: "Thành tiền", align: "right" },
                  { label: "" },
                ]}
              />
            }
            footer={<NegativeStockStrip count={vuotTon} />}
          >
            {lines.length === 0 && (
              <div className="px-4 py-10 text-center">
                <p className="text-[13px] text-[#64748b]">
                  {loading ? "Đang tải danh mục hàng…" : "Chưa có mặt hàng nào trong đơn."}
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
              const g = POS_GRID.order
              /* ⚠ SÀN = SỐ ĐÃ XUẤT. Ràng buộc duy nhất của màn sửa. */
              const san = mode === "sua" ? Math.max(0, Number(l.issued) || 0) : 0
              return (
                <div
                  key={l.key}
                  className="grid min-h-[64px] items-center border-b border-[#f1f5f9] px-4 py-2"
                  style={{ gridTemplateColumns: g.cols, gap: g.gap }}
                >
                  <div className="n text-[12px] text-[#94a3b8]">{settings.colIndex ? i + 1 : ""}</div>
                  <div className="n truncate text-[11.5px] text-[#64748b]">
                    {settings.colSku ? l.sku : ""}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight text-[#0f172a]">
                      {l.name}
                    </div>
                    {settings.colStock && (
                      <div className="mt-[3px] truncate text-[11px] text-[#64748b]">
                        {l.stock == null ? (
                          /* ⚠ CHƯA ĐỌC ĐƯỢC TỒN THÌ NÓI THẾ, đừng ghi
                             "Tồn 0" — số 0 cho một lỗi đọc đọc như hàng
                             đã hết, và người bán từ chối một đơn bán được. */
                          <span className="text-[#94a3b8]">tồn chưa xác định</span>
                        ) : (
                          <>
                            <span className={l.stock <= 0 ? "text-[#b45309]" : undefined}>
                              Tồn {l.stock.toLocaleString("vi-VN")}
                            </span>
                            {l.ordered != null && ` · Đã đặt ${l.ordered.toLocaleString("vi-VN")}`}
                          </>
                        )}
                        {san > 0 && (
                          <>
                            {" · "}
                            <span className="font-semibold text-[#1e40af]">đã xuất {san}</span>
                            {` — không giảm dưới ${san}`}
                          </>
                        )}
                        {settings.showLastPrice && l.lastPrice != null && (
                          <>
                            {" · "}
                            <span className="text-[#2563eb]">
                              giá gần nhất {formatCurrency(l.lastPrice)}
                              {l.lastBuyCount ? ` · ${l.lastBuyCount} lần mua` : ""}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    {l.note != null && l.note !== "" && (
                      <input
                        className="mt-1 h-[21px] w-full rounded border border-[#fde68a] bg-[#fffbeb] px-1.5 text-[10px] text-[#b45309]"
                        aria-label={`Ghi chú dòng ${i + 1}`}
                        value={l.note}
                        onChange={(e) => patchLine(l.key, { note: e.target.value })}
                      />
                    )}
                  </div>
                  <select
                    aria-label={`Đơn vị tính dòng ${i + 1}`}
                    value={l.unit}
                    onChange={(e) => {
                      /**
                       * ⚠ ĐỔI ĐƠN VỊ THÌ GIÁ TÍNH LẠI THEO HỆ SỐ. Giữ
                       * nguyên giá là bán một thùng bằng giá một gói —
                       * và không có gì trên màn nói ra điều đó.
                       */
                      const cu = l.units.find((u) => u.unit_name === l.unit)?.conversion || 1
                      const moi = l.units.find((u) => u.unit_name === e.target.value)?.conversion || 1
                      patchLine(l.key, {
                        unit: e.target.value,
                        price: Math.round((l.price / cu) * moi),
                      })
                    }}
                    className="h-[30px] w-full rounded-md border border-[#cbd5e1] bg-white px-1 text-[12px] text-[#0f172a]"
                  >
                    {l.units.map((u) => (
                      <option key={u.unit_name} value={u.unit_name}>
                        {u.unit_name}
                      </option>
                    ))}
                  </select>
                  <QtyStepper
                    label={`số lượng dòng ${i + 1}`}
                    value={l.qty}
                    min={san}
                    onChange={(v) => patchLine(l.key, { qty: v })}
                  />
                  <input
                    className="n h-[30px] w-full rounded-md border border-[#cbd5e1] px-1.5 text-right text-[13px] text-[#0f172a]"
                    aria-label={`Đơn giá dòng ${i + 1}`}
                    inputMode="numeric"
                    value={l.price === 0 ? "0" : String(l.price)}
                    onChange={(e) =>
                      patchLine(l.key, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })
                    }
                  />
                  {settings.colLineDiscount ? (
                    <DiscountCell
                      line={l}
                      index={i + 1}
                      onChange={(d) => patchLine(l.key, { discount: d })}
                    />
                  ) : (
                    <div />
                  )}
                  <LineAmountCell line={l} />
                  <LineMenu
                    index={i + 1}
                    onNote={() => patchLine(l.key, { note: l.note ?? " " })}
                    onRemove={() => setLines((c) => c.filter((x) => x.key !== l.key))}
                  />
                </div>
              )
            })}
          </LineTableFrame>

          {retLines.length > 0 && (
            <ReturnExchangeTable
              lines={retLines}
              onChange={setRetLines}
              products={products}
            />
          )}
        </div>

        {/* ---------------- panel phải ---------------- */}
        <div className="flex min-h-0 w-[380px] shrink-0 flex-col gap-3">
          <div className="relative">
            <PartnerCard
              partner={khach}
              onPick={() => setMoTimKhach(true)}
              onClear={() => setKhach(null)}
            />
            <SearchDropdown
              open={moTimKhach}
              onClose={() => setMoTimKhach(false)}
              title="Tìm khách hàng"
              placeholder="Tên cửa hàng, SĐT, địa chỉ…"
              items={mucKhach}
              onPick={(it) => setKhach({ id: it.id, name: it.title, meta: it.meta })}
              createLabel="Thêm khách mới"
              emptyHint="Không tìm thấy khách nào khớp."
            />
          </div>

          <div className="flex min-h-0 flex-grow flex-col rounded-xl border border-[#e2e8f0] bg-white p-3.5">
            <MoneyRow label="Tổng tiền hàng" value={totals.gross} />
            <MoneyRow label="Giảm giá dòng" value={totals.lineDiscount} tone="muted" />
            <DocDiscountRow
              id="pos-giam-don"
              label="Giảm giá đơn"
              discount={docDiscount}
              amount={totals.docDiscount}
              onChange={(d) =>
                /* ⚠ Đổi đơn vị thì GIỮ số tiền — cùng luật với cấp dòng. */
                setDocDiscount(
                  d.unit === docDiscount.unit ? d : switchUnit(docDiscount, totals.gross)
                )
              }
            />
            <MoneyRow label="Thu khác · VAT" value={totals.other} tone="muted" />
            <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(totals.returnCredit)}`} tone="warn" />

            <TotalsHero label="Khách cần trả" value={totals.due} />

            <div className="mt-3.5 flex items-center justify-between gap-2.5">
              <label htmlFor="pos-tra" className="text-[13px] text-[#334155]">
                Khách thanh toán
              </label>
              <input
                id="pos-tra"
                className="n h-[34px] w-[150px] rounded-[7px] border border-[#cbd5e1] px-2.5 text-right text-[14px] font-semibold text-[#0f172a]"
                inputMode="numeric"
                value={traTien === 0 ? "0" : String(traTien)}
                onChange={(e) => setTraTien(Number(e.target.value.replace(/\D/g, "")) || 0)}
              />
            </div>

            <PaymentButtons
              value={pay}
              onChange={(m) => {
                setPay(m)
                // ⚠ "Ghi nợ hết" nghĩa là khách chưa đưa đồng nào.
                if (m === "no") setTraTien(0)
                else if (traTien === 0) setTraTien(totals.due)
              }}
            />

            {settings.suggestCash && pay !== "no" && (
              <CashChips values={cashSuggestions(totals.due)} onPick={setTraTien} />
            )}

            <div className="mt-3.5 flex items-center justify-between border-t border-[#f1f5f9] pt-3">
              <span className="text-[13px] text-[#334155]">Tính vào công nợ</span>
              <span className="n text-[14px] font-bold text-[#b45309]">
                {formatCurrency(Math.max(0, totals.due - traTien))}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11.5px] text-[#64748b]">Nợ sau đơn này</span>
              <span className="n text-[11.5px] text-[#64748b]">
                {/* ⚠ CHƯA BIẾT NỢ HIỆN TẠI THÌ ĐỂ TRỐNG, đừng cộng từ 0 —
                    xem `docs/pos-todo.md`. */}
                {khach?.debt == null
                  ? "chưa xác định"
                  : formatCurrency(khach.debt + Math.max(0, totals.due - traTien))}
              </span>
            </div>

            <div className="mt-3.5 flex items-center justify-between gap-2.5 border-t border-[#f1f5f9] pt-3">
              <label htmlFor="pos-ngaygiao" className="text-[13px] text-[#334155]">
                Ngày giao dự kiến
              </label>
              <input
                id="pos-ngaygiao"
                type="date"
                className="n h-8 w-[150px] rounded-[7px] border border-[#cbd5e1] px-2.5 text-right text-[12.5px] text-[#0f172a]"
                value={ngayGiao}
                onChange={(e) => setNgayGiao(e.target.value)}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2.5">
              <label htmlFor="pos-dk" className="text-[13px] text-[#334155]">
                Điều khoản TT
              </label>
              <select
                id="pos-dk"
                value={dieuKhoan}
                onChange={(e) => setDieuKhoan(e.target.value)}
                className="h-8 w-[150px] rounded-[7px] border border-[#cbd5e1] bg-white px-2 text-[12.5px] text-[#0f172a]"
              >
                <option>COD</option>
                <option>Công nợ 15 ngày</option>
                <option>Công nợ 30 ngày</option>
              </select>
            </div>

            <div className="flex-grow" />
          </div>

          <PanelActions>
            {mode === "sua" ? (
              <>
                <PanelButton width={62} onClick={() => router.back()}>Huỷ</PanelButton>
                <PanelButton width={126} disabled={dangLuu} onClick={() => luuDon(true)}>
                  {dangLuu ? "Đang lưu…" : "Lưu thay đổi"}
                </PanelButton>
              </>
            ) : (
              <>
                <PanelButton width={62} onClick={() => window.print()}>In</PanelButton>
                <PanelButton width={104} disabled={dangLuu} onClick={() => luuDon(true)}>
                  {dangLuu ? "Đang lưu…" : "Lưu tạm"}
                </PanelButton>
              </>
            )}
            {/* ⚠ Nút chính GIỮ NGUYÊN ở cả hai bản — spec §7.1. */}
            <PanelButton
              variant="primary"
              disabled={lines.length === 0 || !khach || dangLuu}
              onClick={() => luuDon(false)}
              title={
                lines.length === 0
                  ? "Chưa có mặt hàng nào trong đơn"
                  : !khach
                    ? "Chưa chọn khách hàng"
                    : /* ⚠ NÚT NÀY LÀM ĐÚNG HAI VIỆC TÊN NÓ NÓI: lưu đơn
                         rồi lập hóa đơn. Hai giao dịch riêng — xem
                         `luuDon`, nhánh bước 2 hỏng. */
                      "Lưu đơn rồi xuất hàng và lập hóa đơn"
              }
            >
              {dangLuu ? "Đang lưu…" : "Xuất hàng & lập HĐ"}
            </PanelButton>
          </PanelActions>

          {/* Neo cho dropdown tìm hàng (F3). */}
          <div className="relative">
            <SearchDropdown
              open={moTimHang}
              onClose={() => setMoTimHang(false)}
              title="Tìm hàng hóa"
              placeholder="Tên hàng, mã hàng, mã vạch…"
              items={mucHang}
              onPick={(it) => addProduct(it.id)}
              emptyHint="Không tìm thấy mặt hàng nào khớp."
            />
          </div>
        </div>
      </div>
    </>
  )
}

function emptyReturnLine(isExchange: boolean): PosLine {
  return {
    key: newKey(),
    productId: "",
    sku: "",
    name: "",
    unit: "",
    units: [],
    qty: 1,
    price: 0,
    discount: { value: 0, unit: "vnd" },
    isExchange,
  }
}
