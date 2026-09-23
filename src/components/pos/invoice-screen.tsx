"use client"

/**
 * MÀN HÓA ĐƠN BÁN TRÊN POS — XUẤT HÀNG (lập hóa đơn từ đơn) và SỬA HÓA ĐƠN.
 *
 * ⚠ CHỦ NHÀ CHỐT 23/09/2026: "Màn xuất hàng → POS tại hoá đơn", "Màn sửa
 *   hoá đơn / tạo hoá đơn làm giống màn tạo đơn hàng / sửa đơn hàng (trên
 *   pos)", và báo lỗi "Sửa hoá đơn mất phần Hàng đổi trả gắn với Hoá đơn".
 *
 * ⚠ GIAO DIỆN CỦA MÀN ĐƠN HÀNG POS, NGHIỆP VỤ CỦA `InvoiceEditor`. Hai thứ
 *   ấy đã có sẵn và đã được chốt nhiều vòng; màn này không tính lại cái gì:
 *     · dòng hàng: `seedForNew` / `seedForReissue` / `toDraft`
 *       (@/lib/orders/invoice-editor) — cùng một bộ với màn Xuất hàng cũ;
 *     · ghi sổ: `postInvoice` / `reissueInvoice`, kèm `returnEdits` (mig
 *       149) và `returnAdds` (mig 152) trong CÙNG một giao dịch;
 *     · khoá lập lại: `reissueLock` (tiền thu, hóa đơn điện tử).
 *
 * ⚠ VÌ SAO KHÔNG GHÉP VÀO `OrderScreen`. Đơn hàng sửa TẠI CHỖ và mọi dòng
 *   là của nó; hóa đơn thì mỗi dòng bám một dòng đơn (còn lại bao nhiêu,
 *   đã xuất bao nhiêu), dòng HÀNG ĐỔI đến từ phiếu trả, và lưu là HUỶ rồi
 *   LẬP LẠI. Nhét hai bộ luật ấy vào một component 1.900 dòng là mỗi chỗ
 *   rẽ nhánh một `if (hoaDon)`. Màn này dùng CHUNG các khối vẽ (bảng dòng,
 *   khối hàng đổi trả, panel tiền, ô tìm) nên nhìn và bấm như màn đơn.
 *
 * ⚠ BẢN TRƯỚC (`InvoiceEditScreen`) LÀM RƠI HÀNG ĐỔI TRẢ. Nó không đọc
 *   `is_exchange` của dòng hóa đơn — lập lại là dòng hàng ĐỔI thành dòng
 *   BÁN, tính tiền khách — và không có khối hàng trả nào để xem hay sửa.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { MoneyInput } from "@/components/ui/money-input"
import { CompactSelect } from "@/components/ui/compact-select"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { PAYMENT_TERMS } from "@/lib/constants"
import {
  invoiceTotals, loadInvoiceableLines, postInvoice, reissueInvoice,
  invoiceWarnings, shortageOf, type PostInvoiceResult,
} from "@/lib/orders/post-invoice"
import {
  seedForNew, seedForReissue, makeAddedRow, toDraft, rowsOverOrdered,
  type EditorRow, type ReissueSeedLine,
} from "@/lib/orders/invoice-editor"
import { reissueLock } from "@/lib/pos/invoice-edit"
import { dongHangDoi, giaTheoHeSo } from "@/lib/pos/invoice-exchange"
import { conversionFor, sellableUnits, unitPriceFor } from "@/lib/sell/pricing"
import { viMatchAllWords } from "@/lib/search"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import { usePosDocLabel, usePosDocCount, usePosDirty } from "@/store/pos/tabs"
import { posPrintHref } from "@/lib/pos/tabs"
import { DocBanner, SubHeaderDate, homNay } from "@/components/pos/doc-sub-header"
import { LineTableFrame, LineTableHeader, QtyStepper } from "@/components/pos/line-table"
import { MoneyRow, TotalsHero, PanelActions, PanelButton } from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { PosProductSearchBox } from "@/components/pos/product-search-box"
import {
  focusPosPicker, useRegisterPosProductSearch, usePosSearchTerm,
} from "@/store/pos/product-search"
import { DocPeople } from "@/components/pos/doc-people"
import { assignDocSeller } from "@/lib/pos/save"
import { useAuth } from "@/hooks/use-auth"

export interface InvoiceScreenProps {
  /** Xuất hàng: đơn cần lập hóa đơn. */
  orderId?: string | null
  /** Sửa hóa đơn: tờ đang sửa (sẽ bị huỷ và lập lại). */
  invoiceId?: string | null
}

/** Cột bảng hàng BÁN — cùng nhịp với màn đơn: # · Sản phẩm · SL · Đơn giá · Thành tiền · (xoá). */
const COT_BAN = "34px minmax(190px,1fr) 100px 112px 120px 40px"
/** Cột khối HÀNG ĐỔI TRẢ — Sản phẩm · Xử lý · SL · Đơn giá · Trừ đơn · (xoá). */
const COT_TRA = "minmax(170px,1fr) 70px 100px 108px 110px 34px"

/** Dòng hàng trả ĐÃ có trong sổ (phiếu trả kèm đơn / kèm hóa đơn). */
interface DongTraCu {
  id: string
  returnId: string
  productId: string
  name: string
  sku: string
  unit: string
  qty: number
  unitPrice: number
  vatRate: number
  isExchange: boolean
  /** Sửa được qua `return_edits` không — xem `_apply_return_edits` (mig 149). */
  suaDuoc: boolean
}

/** Dòng hàng đổi / trả VỪA THÊM, chưa ghi sổ. */
interface DongTraMoi {
  key: string
  productId: string
  name: string
  sku: string
  unit: string
  qty: number
  price: number
  vatRate: number
  isExchange: boolean
}

interface Receipt { id: string; amount: number; ref: string | null }

/** Khoản trừ của một dòng — CÙNG công thức với máy chủ: round(qty × giá × (1 + thuế)). */
const tienTru = (qty: number, gia: number, vat: number, doi: boolean) =>
  doi ? 0 : Math.round(qty * gia * (1 + (vat || 0)))

let dem = 0
const keyMoi = () => `iv${++dem}`

/** Dải chip quy cách — cùng dáng chip của bảng bán. */
function ChipDonVi({
  ds, dang, nhan, onChon,
}: { ds: string[]; dang: string; nhan: string; onChon: (u: string) => void }) {
  if (ds.length <= 1) return <span className="n text-[11.5px] font-semibold text-[var(--pos-muted)]">{dang}</span>
  return (
    <span className="flex shrink-0 gap-0.5 rounded-[8px] bg-[var(--pos-line-soft)] p-0.5">
      {ds.map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={u === dang}
          aria-label={`Đơn vị ${u} ${nhan}`}
          onClick={() => onChon(u)}
          className={`h-6 min-w-[42px] rounded-[6px] px-1.5 text-[11.5px] font-extrabold ${
            u === dang ? "bg-white text-[var(--pos-ink)] shadow-[0_1px_2px_rgba(24,28,30,.12)]" : "text-[var(--pos-muted)]"
          }`}
        >
          {u}
        </button>
      ))}
    </span>
  )
}

export function InvoiceScreen({ orderId: orderIdProp = null, invoiceId = null }: InvoiceScreenProps) {
  const sua = !!invoiceId
  const router = useRouter()
  const { toast } = useToast()
  const { products, stockByProduct, warnings, productById, customerById } = usePosRefData()
  const { user } = useAuth()

  const [orderId, setOrderId] = useState<string | null>(orderIdProp)
  const [orderCode, setOrderCode] = useState<string | null>(null)
  const [invoiceCode, setInvoiceCode] = useState<string | null>(null)
  const [khach, setKhach] = useState<PosPartner | null>(null)
  const [nguoi, setNguoi] = useState<{ taoId: string | null; ganId: string | null }>({ taoId: null, ganId: null })
  const [dieuKhoan, setDieuKhoan] = useState<string | null>(null)
  const [ghiChuDon, setGhiChuDon] = useState<string | null>(null)
  const [ghiChu, setGhiChu] = useState("")
  const [ngay, setNgay] = useState(homNay)

  const [rows, setRows] = useState<EditorRow[]>([])
  const [traCu, setTraCu] = useState<DongTraCu[]>([])
  const [traSua, setTraSua] = useState<Record<string, number>>({})
  /** Quy cách mới của dòng trả đã có (mig 181) — theo `id` dòng. */
  const [traDv, setTraDv] = useState<Record<string, string>>({})
  /**
   * Dòng hàng đổi CŨ trên tờ đang sửa mà KHÔNG có dòng phiếu trả tương ứng
   * (dữ liệu trước khi hai nơi được nối) — giữ nguyên để hàng đã rời kho
   * không bị "hoàn" lặng lẽ khi lập lại.
   */
  const [hangDoiCu, setHangDoiCu] = useState<EditorRow[]>([])
  const [traMoi, setTraMoi] = useState<DongTraMoi[]>([])
  const [moThemTra, setMoThemTra] = useState(false)

  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [receiptErr, setReceiptErr] = useState<string | null>(null)
  const [eInvoiceIssued, setEInvoiceIssued] = useState(false)

  const [dangTai, setDangTai] = useState(true)
  const [loi, setLoi] = useState<string | null>(null)
  const [loiTra, setLoiTra] = useState<string | null>(null)
  const [dangLuu, setDangLuu] = useState(false)
  const [dangGan, setDangGan] = useState(false)
  /** Người đứng tên ĐƠN — hóa đơn mới mặc định đứng tên người này. */
  const [ganCuaDon, setGanCuaDon] = useState<string | null>(null)
  const [mocChuaLuu, setMocChuaLuu] = useState<string | null>(null)
  const seq = useRef(0)

  const groupId = customerById(khach?.id)?.group_id ?? null

  /* ------------------------------------------------------------------ */
  /* NẠP                                                                 */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    let huy = false
    ;(async () => {
      const sb = createClient()
      try {
        let oid = orderIdProp
        let seed: ReissueSeedLine[] | null = null

        if (invoiceId) {
          const [h, l, e, rc] = await Promise.all([
            sb.from("sales_invoices")
              .select("id, invoice_code, status, order_id, notes, payment_terms, posted_by, sales_user_id")
              .eq("id", invoiceId).maybeSingle(),
            sb.from("sales_invoice_lines")
              .select("order_line_id, product_id, unit_name, conversion_factor, quantity, unit_price, line_discount, vat_rate, is_exchange, note, product:products(name, sku)")
              .eq("invoice_id", invoiceId).order("sort_order", { ascending: true }),
            sb.from("invoices")
              .select("status, misa_inv_no, misa_status")
              .eq("sales_invoice_id", invoiceId)
              .order("misa_inv_no", { ascending: false, nullsFirst: false })
              .order("created_at", { ascending: false })
              .limit(1).maybeSingle(),
            sb.from("cash_receipt_lines")
              .select("id, amount, receipt:cash_receipts(status, receipt_code)")
              .eq("invoice_id", invoiceId),
          ])
          if (huy) return
          const err = h.error || l.error
          if (err) throw err
          const hd = h.data as unknown as {
            invoice_code: string; status: string; order_id: string; notes: string | null
            payment_terms: string | null; posted_by: string | null; sales_user_id: string | null
          } | null
          if (!hd) throw new Error("Không tìm thấy hóa đơn này, hoặc bạn không có quyền xem nó.")
          if (hd.status !== "posted") {
            throw new Error(`Hóa đơn ${hd.invoice_code} đang ở trạng thái "${hd.status}" — chỉ sửa được hóa đơn đã xuất.`)
          }
          oid = hd.order_id
          setInvoiceCode(hd.invoice_code)
          setGhiChu(hd.notes ?? "")
          setDieuKhoan(hd.payment_terms)
          setNguoi({ taoId: hd.posted_by, ganId: hd.sales_user_id })
          type L = {
            order_line_id: string | null; product_id: string; unit_name: string
            conversion_factor: number | null; quantity: number; unit_price: number
            line_discount: number | null; vat_rate: number | null; is_exchange: boolean | null
            note: string | null; product?: { name?: string | null; sku?: string | null } | null
          }
          seed = ((l.data as unknown as L[]) ?? []).map((x) => ({
            orderLineId: x.order_line_id,
            productId: x.product_id,
            unitName: x.unit_name,
            quantity: Number(x.quantity) || 0,
            unitPrice: Number(x.unit_price) || 0,
            lineDiscount: Number(x.line_discount) || 0,
            vatRate: Number(x.vat_rate) || 0,
            /* ⚠ ĐÂY LÀ CHỖ BẢN TRƯỚC LÀM RƠI: dòng hàng ĐỔI phải lập lại
               là hàng đổi, không thành dòng bán tính tiền. */
            isExchange: x.is_exchange === true,
            conversionFactor: Number(x.conversion_factor) || 1,
            productName: x.product?.name || "Sản phẩm đã xoá",
            sku: x.product?.sku || null,
            note: x.note,
          }))
          const ei = e.data as unknown as { status?: string; misa_inv_no?: string | null; misa_status?: string | null } | null
          setEInvoiceIssued(!!ei && (ei.status === "issued" || !!ei.misa_inv_no || ei.misa_status === "signed" || ei.misa_status === "replaced"))
          if (rc.error) setReceiptErr(errorMessage(rc.error))
          else {
            type R = { id: string; amount: number; receipt?: { status?: string; receipt_code?: string | null } | null }
            setReceipts(
              ((rc.data as unknown as R[]) ?? [])
                .filter((x) => x.receipt?.status !== "voided")
                .map((x) => ({ id: x.id, amount: Number(x.amount) || 0, ref: x.receipt?.receipt_code ?? null }))
            )
          }
        }

        if (!oid) throw new Error("Thiếu đơn hàng để lập hóa đơn.")
        setOrderId(oid)

        const [o, ds, rt] = await Promise.all([
          sb.from("sales_orders")
            .select("order_code, status, notes, payment_terms, sales_user_id, customer_id, customer:customers(store_name, phone, address)")
            .eq("id", oid).maybeSingle(),
          loadInvoiceableLines(sb, oid),
          sb.from("returns")
            .select("id, status, invoice_id, lines:return_lines(id, product_id, unit_name, quantity, unit_price, vat_rate, is_exchange, product:products(name, sku))")
            /* ⚠ Theo đơn VÀ theo tờ đang sửa — phiếu trả độc lập chỉ có `invoice_id`. */
            .or(invoiceId ? `order_id.eq.${oid},invoice_id.eq.${invoiceId}` : `order_id.eq.${oid}`)
            .neq("status", "cancelled"),
        ])
        if (huy) return
        if (o.error) throw o.error
        const don = o.data as unknown as {
          order_code: string; status: string; notes: string | null; payment_terms: string | null
          sales_user_id: string | null; customer_id: string
          customer?: { store_name?: string | null; phone?: string | null; address?: string | null } | null
        } | null
        if (!don) throw new Error("Không tìm thấy đơn hàng, hoặc bạn không có quyền xem nó.")
        setOrderCode(don.order_code)
        if (!invoiceId) setDieuKhoan(don.payment_terms)
        setGhiChuDon((don.notes ?? "").trim() || null)
        if (!invoiceId) {
          setNguoi((n) => ({ ...n, ganId: don.sales_user_id }))
          setGanCuaDon(don.sales_user_id)
        }
        setKhach({
          id: don.customer_id,
          name: don.customer?.store_name || "Khách lẻ",
          meta: [don.customer?.phone, don.customer?.address].filter(Boolean).join(" · "),
        })
        /**
         * ⚠ DÒNG HÀNG ĐỔI KHÔNG NẰM TRONG BẢNG BÁN NỮA — nó dựng lại từ khối
         *   hàng đổi trả lúc lưu (`dongHangDoi`). Xem @/lib/pos/invoice-exchange.
         */
        const tatCa = seed ? seedForReissue(ds, seed) : seedForNew(ds)
        setRows(tatCa.filter((r) => !r.isExchange))
        const doiTuPhieu = new Set(
          ((rt.data as unknown as Array<{ status: string; invoice_id: string | null; lines?: Array<{ product_id: string; is_exchange: boolean | null }> | null }>) ?? [])
            .filter((r) => (r.status === "draft" || r.status === "submitted") && (invoiceId ? r.invoice_id === invoiceId : r.invoice_id === null))
            .flatMap((r) => (r.lines ?? []).filter((l) => l.is_exchange).map((l) => l.product_id))
        )
        setHangDoiCu(seed ? tatCa.filter((r) => r.isExchange && !doiTuPhieu.has(r.productId)) : [])

        /**
         * ⚠ PHIẾU TRẢ ĐỌC HỎNG THÌ NÓI RA, KHÔNG CHẶN XUẤT HÀNG — và KHÔNG
         *   gửi phần sửa nào (không biết thì không đụng).
         */
        if (rt.error) setLoiTra(errorMessage(rt.error))
        else {
          type RL = {
            id: string; product_id: string; unit_name: string; quantity: number
            unit_price: number | null; vat_rate: number | null; is_exchange: boolean | null
            product?: { name?: string | null; sku?: string | null } | null
          }
          type RR = { id: string; status: string; invoice_id: string | null; lines?: RL[] | null }
          setTraCu(
            ((rt.data as unknown as RR[]) ?? []).flatMap((r) =>
              (r.lines ?? []).map((l) => ({
                id: l.id,
                returnId: r.id,
                productId: l.product_id,
                name: l.product?.name || "Sản phẩm đã xoá",
                sku: l.product?.sku || "",
                unit: l.unit_name,
                qty: Number(l.quantity) || 0,
                unitPrice: Number(l.unit_price ?? 0),
                vatRate: Number(l.vat_rate ?? 0),
                isExchange: l.is_exchange === true,
                /**
                 * ⚠ ĐÚNG ĐIỀU KIỆN CỦA `_apply_return_edits`: phiếu còn nháp /
                 *   chờ xử lý, và bám ĐÚNG tờ sẽ ghi sổ —
                 *     · sửa hóa đơn: phiếu đang bám chính tờ này;
                 *     · xuất hàng: phiếu kèm đơn CHƯA bám tờ nào — `post_invoice`
                 *       gắn nó vào tờ mới rồi áp phần sửa (mig 180).
                 *   Ngoài điều kiện ấy máy chủ BỎ QUA lặng lẽ — cho sửa ở đây
                 *   là người dùng gõ số rồi sổ không đổi.
                 */
                suaDuoc:
                  (r.status === "draft" || r.status === "submitted") &&
                  (invoiceId ? r.invoice_id === invoiceId : r.invoice_id === null),
              }))
            )
          )
        }
      } catch (e) {
        if (!huy) setLoi(errorMessage(e))
      } finally {
        if (!huy) setDangTai(false)
      }
    })()
    return () => { huy = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderIdProp, invoiceId])

  /* ------------------------------------------------------------------ */
  /* TIỀN                                                                */
  /* ------------------------------------------------------------------ */

  const soTraCu = (l: DongTraCu) => traSua[l.id] ?? l.qty
  const dvTraCu = (l: DongTraCu) => traDv[l.id] ?? l.unit
  /** Hệ số theo danh mục (đơn vị cơ sở = 1). */
  const heSo = useCallback(
    (productId: string, unit: string) => {
      const p = productById(productId)
      return p ? conversionFor(p, unit) || 1 : 1
    },
    [productById]
  )
  /** Giá dòng trả cũ theo quy cách đang chọn — CÙNG phép máy chủ (mig 181). */
  const giaTraCu = (l: DongTraCu) =>
    dvTraCu(l) === l.unit ? l.unitPrice : giaTheoHeSo(l.unitPrice, heSo(l.productId, l.unit), heSo(l.productId, dvTraCu(l)))
  /**
   * Hàng đổi xuất theo tờ này = dòng ĐỔI của phiếu trả đi cùng tờ (đã sửa) +
   * dòng đổi vừa thêm + dòng đổi cũ không có phiếu tương ứng.
   */
  const hangDoiXuat = useMemo(
    () => [
      ...dongHangDoi(
        [
          ...traCu.filter((l) => l.isExchange && l.suaDuoc).map((l) => ({ productId: l.productId, unit: traDv[l.id] ?? l.unit, qty: traSua[l.id] ?? l.qty })),
          ...traMoi.filter((a) => a.isExchange).map((a) => ({ productId: a.productId, unit: a.unit, qty: a.qty })),
        ],
        heSo
      ),
      ...toDraft(hangDoiCu),
    ],
    [traCu, traMoi, traSua, traDv, hangDoiCu, heSo]
  )
  const draft = useMemo(() => [...toDraft(rows), ...hangDoiXuat], [rows, hangDoiXuat])
  const tong = useMemo(() => invoiceTotals(draft), [draft])
  const truHangTra =
    traCu.reduce((s, l) => s + tienTru(soTraCu(l), giaTraCu(l), l.vatRate, l.isExchange), 0) +
    traMoi.reduce((s, a) => s + tienTru(a.qty, a.price, a.vatRate, a.isExchange), 0)
  const khachTra = Math.max(0, tong.total - truHangTra)
  const daThu = receipts.reduce((s, r) => s + r.amount, 0)
  const vuotConLai = rowsOverOrdered(rows)
  const thieuHang = rows.filter((r) => r.qty > 0 && r.stockKnown && shortageOf(r, r.qty) > 0)
  const soDong = rows.filter((r) => r.qty > 0).length
  /** Thuế suất chung của các dòng (phần trăm), `null` khi các dòng lệch nhau. */
  const vatChung = (() => {
    const ds = Array.from(new Set(rows.map((r) => Math.round((Number(r.vatRate) || 0) * 100))))
    return ds.length === 1 ? ds[0] : null
  })()

  const khoa = sua
    ? reissueLock({ paidAmount: daThu, receiptCount: receiptErr ? 1 : receipts.length, eInvoiceIssued })
    : null

  const chuKy = useMemo(
    () => JSON.stringify([
      rows.map((r) => [r.key, r.unitName, r.qty, r.price]),
      traSua, traDv, traMoi.map((a) => [a.productId, a.unit, a.qty, a.price, a.isExchange]), ghiChu, ngay, dieuKhoan,
      rows.map((r) => r.vatRate),
    ]),
    [rows, traSua, traDv, traMoi, ghiChu, ngay, dieuKhoan]
  )
  useEffect(() => {
    if (!dangTai && mocChuaLuu === null) setMocChuaLuu(chuKy)
  }, [dangTai, chuKy, mocChuaLuu])
  usePosDirty(chuKy, mocChuaLuu)
  usePosDocLabel("INV", invoiceId, invoiceCode)
  usePosDocCount(soDong)

  /* ------------------------------------------------------------------ */
  /* SỬA DÒNG                                                            */
  /* ------------------------------------------------------------------ */

  const suaDong = useCallback((key: string, p: Partial<EditorRow>) => {
    setRows((c) => c.map((r) => (r.key === key ? { ...r, ...p } : r)))
  }, [])

  /**
   * ĐỔI ĐƠN VỊ — MỌI DÒNG, kể cả dòng lấy từ đơn (chủ nhà chốt 23/09/2026:
   * "khi sửa toàn quyền được thay đổi mọi thông tin như khi tạo").
   *
   * ⚠ GIÁ TRA BẢNG GIÁ THEO NHÓM KHÁCH, HỆ SỐ THEO DANH MỤC. Số "đặt / đã
   *   xuất / còn lại" của dòng đơn vẫn theo đơn vị ĐƠN; máy chủ quy về đơn
   *   vị cơ sở khi cộng "đã xuất" (mig 179), màn này so cũng như vậy
   *   (`rowsOverOrdered`).
   */
  const doiDonVi = useCallback(
    (r: EditorRow, u: string) => {
      const p = productById(r.productId)
      if (!p || u === r.unitName) return
      const gia = unitPriceFor(p, u, groupId)
      suaDong(r.key, { unitName: u, conversionFactor: conversionFor(p, u), price: gia, unitPrice: gia, listPrice: gia })
    },
    [productById, groupId, suaDong]
  )

  /** ⚠ Dòng HÀNG ĐỔI không bỏ được — nó là hàng khách đã đưa lại, xem `InvoiceEditor.dropRow`. */
  const boDong = (r: EditorRow) => {
    if (r.isExchange) return
    setRows((c) => c.filter((x) => x.key !== r.key))
  }

  const themBan = useCallback(
    (productId: string) => {
      const p = productById(productId)
      if (!p) return
      seq.current += 1
      const row = makeAddedRow(p, sellableUnits(p)[0], groupId, seq.current)
      /* Tồn lấy từ danh mục POS (đơn vị cơ sở) — đủ để cảnh báo thiếu hàng. */
      const ton = stockByProduct[p.id]
      setRows((c) => [...c, ton == null ? row : { ...row, availableBase: ton, stockKnown: true }])
    },
    [productById, groupId, stockByProduct]
  )

  const themTra = useCallback(
    (productId: string) => {
      const p = productById(productId)
      if (!p) return
      const u = sellableUnits(p)[0]
      setTraMoi((c) => [
        ...c,
        {
          key: keyMoi(), productId: p.id, name: p.name, sku: p.sku ?? "", unit: u, qty: 1,
          price: unitPriceFor(p, u, groupId), vatRate: Number(p.vat_rate ?? 0), isExchange: false,
        },
      ])
    },
    [productById, groupId]
  )

  /* ------------------------------------------------------------------ */
  /* Ô TÌM HÀNG                                                          */
  /* ------------------------------------------------------------------ */

  const tuKhoa = usePosSearchTerm()
  const mucHang = useMemo(() => {
    const out: Array<{ id: string; title: string; subtitle: string; ton: number; gia: number }> = []
    for (const p of products) {
      if (!viMatchAllWords(tuKhoa, p.name, p.sku, p.barcode)) continue
      out.push({
        id: p.id, title: p.name,
        subtitle: [p.sku || "—", p.base_unit].filter(Boolean).join(" · "),
        ton: stockByProduct[p.id] ?? 0,
        gia: unitPriceFor(p, sellableUnits(p)[0], groupId),
      })
      if (out.length >= 60) break
    }
    return out
  }, [products, stockByProduct, tuKhoa, groupId])
  const veGoiY = useCallback(
    (p: { ton: number; gia: number }) => (
      <span className="shrink-0 text-right">
        <span className="n block text-[12.5px] font-bold text-[var(--pos-ink)]">{formatCurrency(p.gia)}</span>
        <span className={`n block text-[11px] font-semibold ${p.ton <= 0 ? "text-[var(--pos-danger)]" : "text-[var(--pos-muted)]"}`}>
          Tồn {p.ton.toLocaleString("vi-VN")}
        </span>
      </span>
    ),
    []
  )
  /* ⚠ HAI GIỎ, MỘT Ô TÌM — như màn đơn: `moThemTra` quyết mã rơi vào đâu. */
  const chonHang = useCallback(
    (it: { id: string }) => (moThemTra ? themTra(it.id) : themBan(it.id)),
    [moThemTra, themTra, themBan]
  )
  useRegisterPosProductSearch({
    items: mucHang,
    onPick: chonHang,
    disabled: dangTai || !!loi,
    placeholder: moThemTra ? "Tìm hàng KHÁCH TRẢ LẠI…" : "Tên hàng, mã hàng, mã vạch…",
    renderMeta: veGoiY,
  })

  /* ------------------------------------------------------------------ */
  /* GHI SỔ                                                              */
  /* ------------------------------------------------------------------ */

  const luu = useCallback(async () => {
    if (dangLuu || khoa || soDong === 0 || !orderId) return
    setDangLuu(true)
    try {
      const returnAdds = traMoi
        .filter((a) => a.qty > 0)
        .map((a) => ({
          productId: a.productId, unitName: a.unit, quantity: a.qty,
          unitPrice: a.price, vatRate: a.vatRate, isExchange: a.isExchange,
        }))
      /* ⚠ CHỈ GỬI DÒNG THẬT SỰ ĐỔI — gửi cả dòng không đổi là ghi đè `line_total` của chúng. */
      const returnEdits = traCu
        .filter((l) => l.suaDuoc && ((traSua[l.id] ?? l.qty) !== l.qty || (traDv[l.id] ?? l.unit) !== l.unit))
        .map((l) => ({
          lineId: l.id,
          quantity: traSua[l.id] ?? l.qty,
          ...((traDv[l.id] ?? l.unit) !== l.unit ? { unitName: traDv[l.id] } : {}),
        }))
      const r: PostInvoiceResult = invoiceId
        ? await reissueInvoice(createClient(), invoiceId, {
            lines: draft, notes: ghiChu.trim() || null, invoiceDate: ngay || null,
            paymentTerms: dieuKhoan, returnEdits, returnAdds,
          })
        : await postInvoice(createClient(), {
            orderId, lines: draft, notes: ghiChu.trim() || null, invoiceDate: ngay || null,
            paymentTerms: dieuKhoan, returnAdds, returnEdits,
          })
      /**
       * ⚠ XUẤT HÀNG MÀ ĐỔI NGƯỜI ĐƯỢC GÁN: `post_invoice` đứng tên người của
       *   ĐƠN, nên gán lại ngay sau khi có tờ. Hai lệnh, không một giao dịch
       *   — gán hỏng thì hóa đơn VẪN đã xuất, và phải nói ra như vậy để
       *   người dùng gán lại ở màn hóa đơn, đừng bấm xuất lần nữa.
       */
      if (!invoiceId && r.invoiceId && nguoi.ganId && nguoi.ganId !== ganCuaDon) {
        try {
          await assignDocSeller(createClient(), "invoice", r.invoiceId, nguoi.ganId)
        } catch (e) {
          toast({
            title: `Đã xuất ${r.invoiceCode ?? ""} nhưng chưa gán được người phụ trách`,
            description: `${errorMessage(e)} — gán lại ở màn hóa đơn, KHÔNG xuất lại.`,
            variant: "destructive",
          })
        }
      }
      setMocChuaLuu(chuKy)
      toast({
        title: invoiceId
          ? `Đã lập lại: ${invoiceCode ?? ""} → ${r.invoiceCode ?? ""}`
          : `Đã xuất hóa đơn ${r.invoiceCode ?? ""}`,
      })
      const w = invoiceWarnings(r)
      if (w) toast({ title: "Xuất thiếu hàng", description: w, variant: "destructive" })
      if (r.invoiceId) router.replace(`/pos/hoa-don/${r.invoiceId}`)
    } catch (e) {
      toast({
        title: invoiceId ? "Chưa lập lại được" : "Chưa xuất được",
        description: errorMessage(e),
        variant: "destructive",
      })
    } finally {
      setDangLuu(false)
    }
  }, [dangLuu, khoa, soDong, orderId, traMoi, traCu, traSua, traDv, invoiceId, draft, ghiChu, ngay, dieuKhoan, chuKy, invoiceCode, router, toast, nguoi.ganId, ganCuaDon])

  usePosKeys({
    F2: () => { setMoThemTra(false); focusPosPicker() },
    F3: () => { setMoThemTra(false); focusPosPicker() },
    F8: () => { setMoThemTra(true); focusPosPicker() },
    F9: () => { void luu() },
  })

  /* ------------------------------------------------------------------ */
  /* VẼ                                                                  */
  /* ------------------------------------------------------------------ */

  const tieuDe = sua ? "Sửa hóa đơn" : "Xuất hàng · lập hóa đơn"
  const nhan = [
    sua ? invoiceCode : null,
    orderCode ? `đơn ${orderCode}` : null,
    sua ? `lưu sẽ huỷ ${invoiceCode ?? "tờ này"} và lập ${invoiceCode ?? "HD"}-1` : "phần chưa xuất nằm lại trên đơn",
  ].filter(Boolean).join(" · ")

  return (
    <div className="flex min-h-0 flex-grow gap-4 p-4">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 shrink-0 items-end justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="whitespace-nowrap text-[22px] font-extrabold tracking-[-0.3px] text-[var(--pos-ink)]">
              {tieuDe}{" "}
              <span className="text-[15px] font-bold text-[var(--pos-muted)]">
                · <span className="n">{soDong}</span> dòng
              </span>
            </h1>
            <p className="mt-1 truncate text-[13px] font-semibold text-[var(--pos-muted)]">{nhan}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SubHeaderDate value={ngay} onChange={setNgay} label={sua ? "Ngày tờ mới" : "Ngày hóa đơn"} />
            <button
              type="button"
              onClick={() => { setMoThemTra(false); focusPosPicker() }}
              className="h-9 rounded-[10px] border-[1.5px] border-[var(--pos-edge)] bg-white px-3.5 text-[13px] font-bold text-[var(--pos-ink)] hover:border-[var(--pos-primary-border)]"
            >
              Thêm sản phẩm (F2)
            </button>
          </div>
        </div>

        {warnings.map((w) => <DocBanner key={w} tone="warn">{w}</DocBanner>)}
        {loi && <DocBanner tone="warn">Không nạp được — {loi}</DocBanner>}
        {khoa && (
          <DocBanner tone="warn">
            <strong>Chưa lập lại được.</strong> {khoa.message}{" "}
            <span className="n text-[11px] opacity-70">({khoa.code})</span>
          </DocBanner>
        )}
        {ghiChuDon && <DocBanner>Ghi chú đơn: {ghiChuDon}</DocBanner>}

        <LineTableFrame
          header={
            <LineTableHeader
              grid="order"
              cols={COT_BAN}
              cells={[
                { label: "#", align: "center" }, { label: "Sản phẩm / đơn vị" },
                { label: "Số lượng", align: "center" }, { label: "Đơn giá", align: "right" },
                { label: "Thành tiền", align: "right" }, { label: "" },
              ]}
            />
          }
          footer={
            <>
              {(vuotConLai.length > 0 || thieuHang.length > 0) && (
                <div className="shrink-0 bg-[var(--pos-warn-soft)] px-4 py-2 text-[11.5px] text-[var(--pos-warn)]">
                  {vuotConLai.length > 0 && `${vuotConLai.length} dòng xuất quá phần còn lại của đơn. `}
                  {thieuHang.length > 0 && `${thieuHang.length} dòng kho không đủ — sẽ xuất thiếu.`}
                </div>
              )}
              <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--pos-line-soft)] bg-[var(--pos-head)] px-3.5 py-2.5">
                <span className="whitespace-nowrap text-[12px] font-bold text-[var(--pos-muted)]">
                  F2 thêm hàng · F8 thêm hàng trả · F9 {sua ? "lập lại" : "xuất hàng"}
                </span>
                <span className="flex items-baseline gap-2.5 whitespace-nowrap text-[13px] font-bold text-[var(--pos-muted)]">
                  Tiền hàng
                  <span className="n text-[18px] font-extrabold text-[var(--pos-ink)]">{formatCurrency(tong.subtotal)}</span>
                </span>
              </div>
            </>
          }
        >
          {dangTai && <p className="px-4 py-10 text-center text-[13px] text-[var(--pos-muted)]">Đang tải…</p>}
          {!dangTai && !loi && rows.length === 0 && (
            <p className="px-8 py-14 text-center text-[13px] font-semibold text-[var(--pos-muted)]">
              Đơn không còn dòng nào để xuất. Bấm <b>Thêm sản phẩm (F2)</b> nếu cần thêm mã ngoài đơn.
            </p>
          )}
          {rows.map((r, i) => {
            const p = productById(r.productId)
            const thieu = r.qty > 0 && r.stockKnown ? shortageOf(r, r.qty) : 0
            const vuot = rowsOverOrdered([r]).length > 0
            const donVi = p ? sellableUnits(p) : [r.unitName]
            const thanhTien = Math.round(r.qty * r.price)
            return (
              <div
                key={r.key}
                data-testid="dong-hoa-don"
                className={`grid min-h-[64px] items-center border-b border-[var(--pos-line-soft)] px-4 py-2 ${
                  r.qty <= 0 ? "opacity-55" : ""
                }`}
                style={{ gridTemplateColumns: COT_BAN, gap: 10 }}
              >
                <div className="n text-center text-[13px] font-bold text-[var(--pos-dim)]">{i + 1}</div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold leading-tight text-[var(--pos-ink)]">
                    {r.productName}
                    {r.isExchange && (
                      <span className="ml-2 rounded-md bg-[var(--pos-warn-soft)] px-1.5 py-px text-[11px] font-extrabold text-[var(--pos-warn)]">
                        Hàng đổi
                      </span>
                    )}
                    {r.addedByHand && (
                      <span className="ml-2 rounded-md border border-[var(--pos-edge)] px-1.5 py-px text-[11px] font-bold text-[var(--pos-muted)]">
                        Thêm tay
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="flex shrink-0 gap-0.5 rounded-[8px] bg-[var(--pos-line-soft)] p-0.5">
                      {donVi.map((u) => {
                        const dang = u === r.unitName
                        return (
                          <button
                            key={u}
                            type="button"
                            aria-pressed={dang}
                            aria-label={`Đơn vị ${u} dòng ${i + 1}`}
                            onClick={() => doiDonVi(r, u)}
                            className={`h-7 min-w-[50px] rounded-[7px] px-2 text-[12px] font-extrabold ${
                              dang ? "bg-white text-[var(--pos-ink)] shadow-[0_1px_2px_rgba(24,28,30,.12)]" : "text-[var(--pos-muted)]"
                            }`}
                          >
                            {u}
                          </button>
                        )
                      })}
                    </span>
                    {r.sku && <span className="n shrink-0 text-[11px] font-semibold text-[var(--pos-dim)]">{r.sku}</span>}
                  </div>
                  <div className="mt-[3px] truncate text-[11px] text-[var(--pos-muted)]">
                    {r.orderLineId && (
                      <>
                        đặt {r.orderedQty} {r.orderUnit ?? r.unitName} · đã xuất {r.invoicedQty.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}{" "}
                        {r.orderUnit ?? r.unitName} ·{" "}
                      </>
                    )}
                    <span className={thieu > 0 ? "font-semibold text-[var(--pos-warn)]" : undefined}>
                      {r.stockKnown ? `tồn ${r.availableBase.toLocaleString("vi-VN")}` : "tồn chưa xác định"}
                    </span>
                    {vuot && <span className="font-semibold text-[var(--pos-warn)]"> · vượt phần còn lại</span>}
                    {thieu > 0 && <span className="font-semibold text-[var(--pos-warn)]"> · thiếu {thieu}</span>}
                    {r.note && <> · {r.note}</>}
                  </div>
                </div>
                <QtyStepper label={`số lượng dòng ${i + 1}`} value={r.qty} min={0} onChange={(v) => suaDong(r.key, { qty: Math.max(0, v) })} />
                <MoneyInput
                  showSuffix={false}
                  inputClassName="n h-[30px] w-full rounded-md border border-[var(--pos-edge)] px-1.5 text-right text-[13px] py-0 lg:h-[30px] focus-visible:ring-1 focus-visible:ring-offset-0"
                  aria-label={`Đơn giá dòng ${i + 1}`}
                  value={r.price}
                  onChange={(v) => suaDong(r.key, { price: Math.max(0, v) })}
                />
                <div className="n text-right text-[14px] font-extrabold text-[var(--pos-ink)]">{formatCurrency(thanhTien)}</div>
                <button
                  type="button"
                  aria-label={`Bỏ dòng ${i + 1}`}
                  disabled={r.isExchange}
                  title={r.isExchange ? "Hàng đổi của khách — sửa ở khối Hàng đổi trả" : "Bỏ dòng khỏi hóa đơn này (phần chưa xuất vẫn nằm trên đơn)"}
                  onClick={() => boDong(r)}
                  className="h-7 w-7 justify-self-center rounded-md text-[16px] leading-none text-[var(--pos-dim)] hover:bg-[var(--pos-danger-soft)] hover:text-[var(--pos-danger)] disabled:opacity-30"
                >
                  ×
                </button>
              </div>
            )
          })}
          {/*
            ⚠ HÀNG ĐỔI XUẤT THEO TỜ NÀY — CHỈ ĐỌC, dựng từ khối Hàng đổi trả
              bên dưới (một nguồn). Sửa số lượng / quy cách / xoá ở khối ấy là
              dòng ở đây đổi theo — chủ nhà báo lỗi 23/09/2026.
          */}
          {hangDoiXuat.map((d, i) => {
            const p = productById(d.productId)
            return (
              <div
                key={`doi${i}`}
                data-testid="dong-hang-doi"
                className="grid min-h-[48px] items-center border-b border-[var(--pos-line-soft)] bg-[var(--pos-warn-soft)]/30 px-4 py-1.5"
                style={{ gridTemplateColumns: COT_BAN, gap: 10 }}
              >
                <div className="n text-center text-[12px] font-bold text-[var(--pos-dim)]">↺</div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-[var(--pos-ink)]">
                    {p?.name ?? "Sản phẩm"}
                    <span className="ml-2 rounded-md bg-[var(--pos-warn-soft)] px-1.5 py-px text-[11px] font-extrabold text-[var(--pos-warn)]">
                      Hàng đổi
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--pos-muted)]">xuất kho cho khách · sửa ở khối Hàng đổi trả</div>
                </div>
                <div className="n text-center text-[14px] font-bold text-[var(--pos-ink)]">
                  {d.quantity} {d.unitName}
                </div>
                <div className="n text-right text-[13px] text-[var(--pos-dim)]">0</div>
                <div className="n text-right text-[13px] text-[var(--pos-dim)]">—</div>
                <span />
              </div>
            )
          })}
        </LineTableFrame>

        {/* ---------------- HÀNG ĐỔI TRẢ ---------------- */}
        <div
          data-testid="khoi-hang-tra"
          className={`shrink-0 overflow-hidden rounded-[14px] border bg-white ${
            traCu.length + traMoi.length > 0 ? "border-[var(--pos-warn-border)]" : "border-[var(--pos-line)]"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-extrabold text-[var(--pos-ink)]">Hàng đổi trả kèm hóa đơn</span>
              <span className="mt-0.5 block truncate text-[12px] font-semibold text-[var(--pos-muted)]">
                {traCu.length + traMoi.length === 0
                  ? "Không có"
                  : `${traCu.length + traMoi.length} dòng · trừ ${formatCurrency(truHangTra)}`}
              </span>
            </span>
            <button
              type="button"
              aria-pressed={moThemTra}
              onClick={() => { setMoThemTra((v) => !v); if (!moThemTra) focusPosPicker() }}
              className={`h-[34px] shrink-0 whitespace-nowrap rounded-[10px] border-[1.5px] px-3 text-[13px] font-bold ${
                moThemTra
                  ? "border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] text-[var(--pos-warn)]"
                  : "border-[var(--pos-edge)] bg-white text-[var(--pos-ink)]"
              }`}
            >
              {moThemTra ? "Xong thêm hàng trả" : "+ Thêm hàng trả (F8)"}
            </button>
          </div>
          {loiTra && (
            <p className="border-t border-[var(--pos-line-soft)] px-3.5 py-2 text-[12px] font-semibold text-[var(--pos-danger)]">
              Không đọc được hàng trả kèm đơn — {loiTra}. Phần này sẽ KHÔNG bị thay đổi khi lưu.
            </p>
          )}
          {traCu.length + traMoi.length > 0 && (
            <div className="border-t border-[var(--pos-line-soft)]">
              <div
                className="grid h-[34px] items-center border-b border-[var(--pos-line-soft)] bg-[var(--pos-head)] px-3.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--pos-muted)]"
                style={{ gridTemplateColumns: COT_TRA, gap: "0 10px" }}
              >
                <span>Sản phẩm / đơn vị</span><span className="text-center">Xử lý</span>
                <span className="text-center">Số lượng</span><span className="text-right">Đơn giá</span>
                <span className="text-right">Trừ đơn</span><span />
              </div>
              {traCu.map((l, i) => {
                const sl = soTraCu(l)
                return (
                  <div
                    key={l.id}
                    data-testid="dong-tra-cu"
                    className={`grid min-h-[54px] items-center border-b border-[var(--pos-line-faint)] px-3.5 py-2 ${sl <= 0 ? "opacity-55" : ""}`}
                    style={{ gridTemplateColumns: COT_TRA, gap: "0 10px" }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-bold text-[var(--pos-ink)]">{l.name}</span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                        {l.suaDuoc ? (
                          <ChipDonVi
                            ds={(() => { const p = productById(l.productId); return p ? sellableUnits(p) : [l.unit] })()}
                            dang={dvTraCu(l)}
                            nhan={`trả dòng ${i + 1}`}
                            onChon={(u) => setTraDv((d) => ({ ...d, [l.id]: u }))}
                          />
                        ) : (
                          <span className="n text-[11.5px] font-semibold text-[var(--pos-muted)]">{l.unit}</span>
                        )}
                        <span className="n truncate text-[11.5px] font-semibold text-[var(--pos-muted)]">
                          {l.sku}
                          {!l.suaDuoc && " · phiếu đã xử lý hoặc thuộc tờ khác — chỉ xem"}
                        </span>
                      </span>
                    </span>
                    <span className="justify-self-center text-[12px] font-extrabold text-[var(--pos-muted)]">
                      {l.isExchange ? "Đổi" : "Trả"}
                    </span>
                    <div className="justify-self-center">
                      {l.suaDuoc ? (
                        <QtyStepper
                          label={`số lượng trả dòng ${i + 1}`}
                          value={sl}
                          min={0}
                          onChange={(v) => setTraSua((s) => ({ ...s, [l.id]: Math.max(0, v) }))}
                        />
                      ) : (
                        <span className="n text-[14px] font-bold text-[var(--pos-ink)]">{sl}</span>
                      )}
                    </div>
                    <span className="n text-right text-[13px] text-[var(--pos-ink)]" aria-label={`Đơn giá trả dòng ${i + 1}`}>{formatCurrency(giaTraCu(l))}</span>
                    <span className="n text-right text-[13.5px] font-extrabold text-[var(--pos-warn)]">
                      {l.isExchange ? "—" : `− ${formatCurrency(tienTru(sl, giaTraCu(l), l.vatRate, false))}`}
                    </span>
                    {l.suaDuoc ? (
                      <button
                        type="button"
                        aria-label={`Bỏ dòng trả ${i + 1}`}
                        onClick={() => setTraSua((s) => ({ ...s, [l.id]: 0 }))}
                        className="h-7 w-7 rounded-md text-[16px] leading-none text-[var(--pos-dim)] hover:bg-[var(--pos-danger-soft)] hover:text-[var(--pos-danger)]"
                      >
                        ×
                      </button>
                    ) : <span />}
                  </div>
                )
              })}
              {traMoi.map((a, i) => {
                const doiA = (p: Partial<DongTraMoi>) =>
                  setTraMoi((c) => c.map((x) => (x.key === a.key ? { ...x, ...p } : x)))
                return (
                  <div
                    key={a.key}
                    data-testid="dong-tra-moi"
                    className="grid min-h-[54px] items-center border-b border-[var(--pos-line-faint)] bg-[var(--pos-warn-soft)]/40 px-3.5 py-2"
                    style={{ gridTemplateColumns: COT_TRA, gap: "0 10px" }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-bold text-[var(--pos-ink)]">{a.name}</span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                        <ChipDonVi
                          ds={(() => { const p = productById(a.productId); return p ? sellableUnits(p) : [a.unit] })()}
                          dang={a.unit}
                          nhan={`trả mới ${i + 1}`}
                          onChon={(u) => {
                            /* Dòng MỚI: giá tra bảng giá theo nhóm khách, như lúc thêm. */
                            const p = productById(a.productId)
                            doiA({ unit: u, price: p ? unitPriceFor(p, u, groupId) : a.price })
                          }}
                        />
                        <span className="n truncate text-[11.5px] font-semibold text-[var(--pos-muted)]">
                          {a.sku} · mới thêm
                        </span>
                      </span>
                    </span>
                    <span className="flex justify-self-center gap-0.5 rounded-[9px] bg-[var(--pos-line-soft)] p-[3px]">
                      {[{ doi: false, nhan: "Trả" }, { doi: true, nhan: "Đổi" }].map((o) => (
                        <button
                          key={o.nhan}
                          type="button"
                          aria-pressed={a.isExchange === o.doi}
                          onClick={() => doiA({ isExchange: o.doi })}
                          className={`h-[26px] min-w-[30px] rounded-[7px] px-1.5 text-[11.5px] font-extrabold ${
                            a.isExchange === o.doi ? "bg-white text-[var(--pos-ink)] shadow-[0_1px_2px_rgba(24,28,30,.12)]" : "text-[var(--pos-muted)]"
                          }`}
                        >
                          {o.nhan}
                        </button>
                      ))}
                    </span>
                    <div className="justify-self-center">
                      <QtyStepper label={`số lượng trả mới ${i + 1}`} value={a.qty} min={1} onChange={(v) => doiA({ qty: Math.max(1, v) })} />
                    </div>
                    <MoneyInput
                      showSuffix={false}
                      inputClassName="n h-[30px] w-full rounded-md border border-[var(--pos-edge)] px-1.5 text-right text-[13px] py-0 lg:h-[30px] focus-visible:ring-1 focus-visible:ring-offset-0"
                      aria-label={`Đơn giá trả mới ${i + 1}`}
                      value={a.price}
                      onChange={(v) => doiA({ price: Math.max(0, v) })}
                    />
                    <span className="n text-right text-[13.5px] font-extrabold text-[var(--pos-warn)]">
                      {a.isExchange ? "—" : `− ${formatCurrency(tienTru(a.qty, a.price, a.vatRate, false))}`}
                    </span>
                    <button
                      type="button"
                      aria-label={`Xoá dòng trả mới ${i + 1}`}
                      onClick={() => setTraMoi((c) => c.filter((x) => x.key !== a.key))}
                      className="h-7 w-7 rounded-md text-[16px] leading-none text-[var(--pos-dim)] hover:bg-[var(--pos-danger-soft)] hover:text-[var(--pos-danger)]"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---------------- cột phải ---------------- */}
      <div className="flex min-h-0 w-[400px] shrink-0 flex-col gap-3">
        {/* ⚠ Khách của đơn đi theo hóa đơn — RPC không nhận khách khác. */}
        <PartnerCard partner={khach} readOnly />
        {/*
          ⚠ XUẤT HÀNG: NGƯỜI TẠO LÀ NGƯỜI ĐANG XUẤT (`posted_by` = phiên này),
            NGƯỜI ĐƯỢC GÁN mặc định là người của đơn và đổi được — ghi xuống
            ngay sau khi xuất (xem `luu`). Sửa hóa đơn thì gán ngay.
        */}
        <DocPeople
          createdById={invoiceId ? nguoi.taoId : user?.id}
          assignedId={nguoi.ganId}
          busy={dangGan}
          onAssign={
            invoiceId
              ? async (id) => {
                  setDangGan(true)
                  try {
                    await assignDocSeller(createClient(), "invoice", invoiceId, id)
                    setNguoi((n) => ({ ...n, ganId: id }))
                    toast({ title: "Đã gán lại người phụ trách hóa đơn" })
                  } catch (e) {
                    toast({ title: "Chưa gán được", description: errorMessage(e), variant: "destructive" })
                  } finally {
                    setDangGan(false)
                  }
                }
              : (id) => setNguoi((n) => ({ ...n, ganId: id }))
          }
          note={invoiceId ? "Gán ngay — không cần lập lại hóa đơn." : "Ghi xuống khi bấm Xuất hàng."}
        />
        <PosProductSearchBox
          note={
            moThemTra
              ? { text: "Hàng trả", tone: "ok", action: { label: "Chuyển về bán", onClick: () => setMoThemTra(false) } }
              : undefined
          }
        />

        <div className="flex min-h-0 flex-grow flex-col overflow-y-auto rounded-xl border border-[var(--pos-line)] bg-white p-3.5">
          <MoneyRow label="Tiền hàng" value={tong.subtotal} />
          {/* ⚠ Ô thuế đẩy xuống TỪNG DÒNG — hóa đơn không có cột thuế cấp chứng từ. */}
          <div className="flex items-center gap-2 py-[5px]">
            <label htmlFor="hd-vat" className="flex-grow text-[13px] text-[var(--pos-muted)]">Thuế GTGT</label>
            <select
              id="hd-vat"
              value={vatChung ?? ""}
              onChange={(e) => {
                const v = Number(e.target.value) / 100
                setRows((c) => c.map((r) => ({ ...r, vatRate: v })))
              }}
              className="h-[30px] w-[84px] rounded-md border border-[var(--pos-edge)] bg-white px-1.5 text-[12.5px]"
            >
              {vatChung === null && <option value="">lệch dòng</option>}
              {[0, 5, 8, 10].map((v) => <option key={v} value={v}>{v}%</option>)}
            </select>
            <span className="n w-[90px] text-right text-[13.5px] text-[var(--pos-ink)]">{formatCurrency(tong.vat)}</span>
          </div>
          <TotalsHero label="Tổng cộng" value={tong.total} />
          {truHangTra > 0 && (
            <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(truHangTra)}`} tone="warn" />
          )}
          <div className="mt-1 border-t border-[var(--pos-line-soft)] pt-2">
            <MoneyRow label="Khách cần trả" value={khachTra} strong />
          </div>
          {sua && (receipts.length > 0 || receiptErr) && (
            <p className="mt-3 text-[11.5px] font-semibold text-[var(--pos-warn)]">
              {receiptErr
                ? `Không đọc được phiếu thu — ${receiptErr}. Màn đang coi như có tiền thu.`
                : `Đã thu ${formatCurrency(daThu)} qua ${receipts.map((r) => r.ref || "phiếu thu").join(", ")} — huỷ phiếu thu trước khi lập lại.`}
            </p>
          )}
          <div className="mt-3.5 flex items-center justify-between gap-2.5 border-t border-[var(--pos-line-soft)] pt-3">
            <span className="text-[13px] text-[var(--pos-muted)]">Điều khoản TT</span>
            <CompactSelect
              ariaLabel="Điều khoản thanh toán"
              value={dieuKhoan ?? "COD"}
              onChange={setDieuKhoan}
              /* ⚠ Giá trị lạ của đơn cũ vẫn hiện — đừng lặng lẽ đổi thành COD. */
              options={[
                ...(dieuKhoan && !PAYMENT_TERMS.some((t) => t.value === dieuKhoan)
                  ? [{ value: dieuKhoan, label: dieuKhoan }]
                  : []),
                ...PAYMENT_TERMS,
              ]}
              className="h-8 w-[190px] border-[var(--pos-edge)] bg-white text-[12.5px]"
            />
          </div>
          <input
            type="text"
            aria-label="Ghi chú hóa đơn"
            placeholder="Ghi chú hóa đơn…"
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
            className="mt-2 h-8 w-full rounded-[7px] border border-[var(--pos-edge)] px-2 text-[12.5px]"
          />
          <div className="flex-grow" />
          {sua && (
            <p className="mt-3 text-[11px] leading-snug text-[var(--pos-muted)]">
              {invoiceCode || "Hóa đơn này"} sẽ chuyển <strong className="text-[var(--pos-ink)]">Đã huỷ</strong>, kho
              hoàn về đúng lô rồi trừ lại theo số mới — trong cùng một giao dịch.
            </p>
          )}
        </div>

        <PanelActions>
          <PanelButton width={64} onClick={() => router.back()}>Huỷ</PanelButton>
          {sua && invoiceId && (
            <PanelButton
              width={84}
              title="Mở trang in hóa đơn hiện tại"
              onClick={() => { const h = posPrintHref("INV", invoiceId); if (h) window.open(h, "_blank") }}
            >
              In
            </PanelButton>
          )}
          <PanelButton
            variant="primary"
            disabled={!!khoa || soDong === 0 || dangLuu || dangTai || !!loi}
            onClick={() => void luu()}
            title={khoa ? khoa.message : soDong === 0 ? "Chưa có dòng nào có số lượng" : undefined}
          >
            {dangLuu ? "Đang ghi sổ…" : sua ? "Huỷ HĐ & lập lại (F9)" : "Xuất hàng & lập HĐ (F9)"}
          </PanelButton>
        </PanelActions>
      </div>
    </div>
  )
}
