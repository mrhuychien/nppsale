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

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { MoneyInput } from "@/components/ui/money-input"
import { CompactSelect } from "@/components/ui/compact-select"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { PAYMENT_TERMS, RETURN_REASONS } from "@/lib/constants"
import { giamCuaChungTu, giamGiaDonConLai } from "@/lib/pos/invoice-discount"
import {
  invoiceTotals, loadInvoiceableLines, postInvoice, reissueInvoice,
  invoiceWarnings, shortageOf, type PostInvoiceResult,
} from "@/lib/orders/post-invoice"
import {
  seedForNew, seedForReissue, makeAddedRow, toDraft, toDraftCoGiam, rowsOverOrdered,
  type EditorRow, type ReissueSeedLine,
} from "@/lib/orders/invoice-editor"
import { reissueLock, reissuePaymentNote } from "@/lib/pos/invoice-edit"
import { dongHangDoi, giaTheoHeSo } from "@/lib/pos/invoice-exchange"
import { conversionFor, sellableUnits, unitPriceFor } from "@/lib/sell/pricing"
import { viMatchAllWords } from "@/lib/search"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosKeys } from "@/components/pos/pos-shell"
import { usePosDocLabel, usePosDocCount, usePosDirty } from "@/store/pos/tabs"
import { posPrintHref } from "@/lib/pos/tabs"
import { DocBanner, SubHeaderDate, homNay } from "@/components/pos/doc-sub-header"
import { LineTableFrame, LineTableHeader, QtyStepper, DiscountCell, VatChip, TrashButton, UnitCycleButton, LineDetailToggle, LineDetailPanel, LineDetailField, tomTatChiTiet } from "@/components/pos/line-table"
import { usePosSettings } from "@/store/pos/settings"
import { vatChungCuaDong, vatChungKeTiep } from "@/lib/pos/vat"
import { discountAmount, lineGross, switchUnit, type DiscountInput } from "@/lib/pos/discount"
import type { PosLine } from "@/lib/pos/types"
import { MoneyRow, TotalsHero, PanelActions, PanelButton, DocDiscountRow } from "@/components/pos/money-panel"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { PosProductSearchBox } from "@/components/pos/product-search-box"
import {
  focusPosPicker, useRegisterPosProductSearch, usePosSearchTerm,
} from "@/store/pos/product-search"
import { DocPeople } from "@/components/pos/doc-people"
import { inTaiCho, trangInHoaDon } from "@/lib/pos/print-window"
import { assignDocSeller } from "@/lib/pos/save"
import { useAuth } from "@/hooks/use-auth"

export interface InvoiceScreenProps {
  /** Xuất hàng: đơn cần lập hóa đơn. */
  orderId?: string | null
  /** Sửa hóa đơn: tờ đang sửa (sẽ bị huỷ và lập lại). */
  invoiceId?: string | null
}

/** Cột bảng hàng BÁN — cùng nhịp với màn đơn: # · Sản phẩm · SL · Đơn giá · Thành tiền · (xoá). */
/** Cột khối HÀNG ĐỔI TRẢ — Sản phẩm · Xử lý · SL · Đơn giá · Trừ đơn · (xoá). */
/* 24/09/2026: (xoá) · Sản phẩm · Xử lý · Đơn vị · Số lượng · Đơn giá · Trừ đơn */
const COT_TRA = "34px minmax(170px,1fr) 70px 76px 100px 108px 110px"

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
  /** Ghi chú / lý do TỪNG DÒNG của phiếu trả — phải đi đủ (chủ nhà 24/09/2026). */
  note: string
  reason: string | null
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
  note: string
  reason: string
}

interface Receipt { id: string; amount: number; ref: string | null }

/** Khoản trừ của một dòng — CÙNG công thức với máy chủ: round(qty × giá × (1 + thuế)). */
const tienTru = (qty: number, gia: number, vat: number, doi: boolean) =>
  doi ? 0 : Math.round(qty * gia * (1 + (vat || 0)))

let dem = 0
const keyMoi = () => `iv${++dem}`


export function InvoiceScreen({ orderId: orderIdProp = null, invoiceId = null }: InvoiceScreenProps) {
  const sua = !!invoiceId
  const router = useRouter()
  const { toast } = useToast()
  const { products, stockByProduct, warnings, productById, customerById } = usePosRefData()
  const { user } = useAuth()
  const { settings } = usePosSettings()

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
  /** Ghi chú / lý do đã sửa của dòng trả CÓ SẴN — theo `id` dòng (mig 183). */
  const [traGhi, setTraGhi] = useState<Record<string, { note?: string; reason?: string }>>({})
  /**
   * GIẢM GIÁ CẢ ĐƠN của tờ này (mig 183). Xuất hàng: mặc định phần giảm của
   * đơn CHƯA dùng ở tờ khác. Sửa hóa đơn: đúng khoản giảm tờ cũ đang mang.
   */
  const [giamDonNhap, setGiamDonNhap] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  /** Các lượt nạp đặt khoản giảm bằng ĐỒNG (số đã suy ra từ đơn / tờ cũ). */
  const setGiamDon = (v: number) => setGiamDonNhap({ value: Math.max(0, Math.round(v)), unit: "vnd" })
  /**
   * GIẢM GIÁ THEO DÒNG gõ trên màn này (theo `key` dòng) — ô "Giảm giá" như
   * màn đơn (chủ nhà 24/09/2026). Lưu thì quy về đơn giá (`toDraftCoGiam`).
   */
  const [giamDong, setGiamDong] = useState<Record<string, DiscountInput>>({})
  /** Dòng nào đang mở "chi tiết dòng" — theo `key`. */
  const [moChiTiet, setMoChiTiet] = useState<Set<string>>(new Set())
  const batChiTiet = (key: string) =>
    setMoChiTiet((m) => {
      const n = new Set(m)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const giamCuaDong = (key: string): DiscountInput => giamDong[key] ?? { value: 0, unit: settings.defaultDiscountUnit }
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
              .select("id, invoice_code, status, order_id, notes, payment_terms, posted_by, sales_user_id, subtotal")
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
            subtotal: number | null
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
          /* ⚠ KHOẢN GIẢM TỜ CŨ ĐANG MANG phải đi sang tờ lập lại — bỏ là khách bị ghi nợ thêm. */
          setGiamDon(
            giamCuaChungTu(
              seed.filter((x) => !x.isExchange).map((x) => ({ quantity: x.quantity, unitPrice: x.unitPrice })),
              hd.subtotal
            )
          )
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

        const [o, ds, rt, hdKhac] = await Promise.all([
          sb.from("sales_orders")
            .select("order_code, status, notes, payment_terms, sales_user_id, customer_id, subtotal, customer:customers(store_name, phone, address)")
            .eq("id", oid).maybeSingle(),
          loadInvoiceableLines(sb, oid),
          sb.from("returns")
            .select("id, status, invoice_id, lines:return_lines(id, product_id, unit_name, quantity, unit_price, vat_rate, is_exchange, note, reason, product:products(name, sku))")
            /* ⚠ Theo đơn VÀ theo tờ đang sửa — phiếu trả độc lập chỉ có `invoice_id`. */
            .or(invoiceId ? `order_id.eq.${oid},invoice_id.eq.${invoiceId}` : `order_id.eq.${oid}`)
            .neq("status", "cancelled"),
          /* Các tờ CÒN HIỆU LỰC khác của đơn — để biết phần giảm giá đơn đã dùng. */
          invoiceId
            ? Promise.resolve({ data: [], error: null })
            : sb.from("sales_invoices")
                .select("id, subtotal, lines:sales_invoice_lines(quantity, unit_price, is_exchange)")
                .eq("order_id", oid).eq("status", "posted"),
        ])
        if (huy) return
        if (o.error) throw o.error
        const don = o.data as unknown as {
          order_code: string; status: string; notes: string | null; payment_terms: string | null
          sales_user_id: string | null; customer_id: string; subtotal: number | null
          customer?: { store_name?: string | null; phone?: string | null; address?: string | null } | null
        } | null
        if (!don) throw new Error("Không tìm thấy đơn hàng, hoặc bạn không có quyền xem nó.")
        setOrderCode(don.order_code)
        if (!invoiceId) setDieuKhoan(don.payment_terms)
        setGhiChuDon((don.notes ?? "").trim() || null)
        if (!invoiceId) {
          /* ⚠ GHI CHÚ ĐƠN ĐI SANG HÓA ĐƠN (24/09/2026) — trước chỉ hiện một dải
             báo, tờ hóa đơn ghi rỗng. */
          setGhiChu((don.notes ?? "").trim())
          /* ⚠ GIẢM GIÁ ĐƠN còn lại cho tờ này. Đọc các tờ khác hỏng thì KHÔNG đoán
             — để 0 và nói ra, người xuất tự gõ. */
          if (hdKhac.error) {
            toast({
              title: "Chưa tính được giảm giá đơn còn lại",
              description: `Không đọc được các hóa đơn khác của đơn (${errorMessage(hdKhac.error)}). Ô Giảm giá đơn để 0 — gõ tay nếu đơn có giảm.`,
              variant: "destructive",
            })
          } else {
            type HK = { subtotal: number | null; lines?: Array<{ quantity: number; unit_price: number; is_exchange: boolean | null }> | null }
            setGiamDon(
              giamGiaDonConLai({
                dongDon: ds.filter((l) => l.orderLineId).map((l) => ({ quantity: l.orderedQty, unitPrice: l.unitPrice })),
                subtotalDon: don.subtotal,
                hoaDonKhac: ((hdKhac.data as unknown as HK[]) ?? []).map((h) => ({
                  subtotal: h.subtotal,
                  dong: (h.lines ?? []).filter((l) => !l.is_exchange).map((l) => ({ quantity: Number(l.quantity), unitPrice: Number(l.unit_price) })),
                })),
              })
            )
          }
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
            note?: string | null; reason?: string | null
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
                note: l.note ?? "",
                reason: l.reason ?? null,
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
  const draft = useMemo(() => [...toDraftCoGiam(rows, giamDong), ...hangDoiXuat], [rows, giamDong, hangDoiXuat])

  /**
   * ⚠ CỘT Y NHƯ MÀN ĐƠN, THEO CÙNG THIẾT LẬP HIỂN THỊ (chủ nhà 24/09/2026:
   *   "tạo / sửa hoá đơn thiếu nhiều trường trong dòng so với tạo / sửa đơn
   *   hàng"): # · Sản phẩm / đơn vị · Số lượng · Đơn giá · Giảm giá · VAT ·
   *   Thành tiền · (⋮ ×). Xem `cot` ở order-screen.
   */
  const cot = useMemo(() => {
    /* ⚠ Cùng khuôn màn đơn (24/09/2026): (xoá) · # · Sản phẩm · Đơn vị · Số lượng · Đơn giá · Thành tiền · (chi tiết). */
    const c: Array<{ w: string; label: string; align?: "left" | "center" | "right" }> = []
    c.push({ w: "34px", label: "" })
    if (settings.colIndex) c.push({ w: "28px", label: "#", align: "center" })
    c.push({ w: "minmax(170px,1fr)", label: "Sản phẩm" })
    c.push({ w: "76px", label: "Đơn vị", align: "center" })
    c.push({ w: "100px", label: "Số lượng", align: "center" })
    c.push({ w: "108px", label: "Đơn giá", align: "right" })
    c.push({ w: "120px", label: "Thành tiền", align: "right" })
    c.push({ w: "34px", label: "" })
    return { cols: c.map((x) => x.w).join(" "), cells: c.map((x) => ({ label: x.label, align: x.align })) }
  }, [settings.colIndex])
  /* Tiền hàng SAU giảm dòng, TRƯỚC giảm đơn — mốc để quy "Giảm giá đơn" % ra đồng. */
  const tienSauGiamDong = useMemo(() => invoiceTotals(draft).goods, [draft])
  const giamDon = discountAmount(giamDonNhap, tienSauGiamDong)
  const tong = useMemo(() => invoiceTotals(draft, giamDon), [draft, giamDon])
  /** Tổng tiền hàng (giá gõ trên dòng) và giảm giá dòng — hai dòng đầu panel, như màn đơn. */
  const tienHangGoc = rows.reduce((s2, r) => s2 + (r.qty > 0 ? lineGross(r.qty, r.price) : 0), 0)
  const giamDongTong = rows.reduce((s2, r) => {
    if (!(r.qty > 0)) return s2
    return s2 + discountAmount(giamDong[r.key] ?? { value: 0, unit: "vnd" }, lineGross(r.qty, r.price))
  }, 0)
  const truHangTra =
    traCu.reduce((s, l) => s + tienTru(soTraCu(l), giaTraCu(l), l.vatRate, l.isExchange), 0) +
    traMoi.reduce((s, a) => s + tienTru(a.qty, a.price, a.vatRate, a.isExchange), 0)
  const khachTra = Math.max(0, tong.total - truHangTra)
  const daThu = receipts.reduce((s, r) => s + r.amount, 0)
  const vuotConLai = rowsOverOrdered(rows)
  const thieuHang = rows.filter((r) => r.qty > 0 && r.stockKnown && shortageOf(r, r.qty) > 0)
  const soDong = rows.filter((r) => r.qty > 0).length
  /** Thuế suất chung của các dòng (phần trăm), `null` khi các dòng lệch nhau. */
  const vatChung = vatChungCuaDong(rows)

  const khoa = sua
    ? reissueLock({ paidAmount: daThu, receiptCount: receiptErr ? 1 : receipts.length, eInvoiceIssued })
    : null

  const chuKy = useMemo(
    () => JSON.stringify([
      rows.map((r) => [r.key, r.unitName, r.qty, r.price, r.note ?? ""]),
      traSua, traDv, traGhi, traMoi.map((a) => [a.productId, a.unit, a.qty, a.price, a.isExchange, a.note, a.reason]), ghiChu, ngay, dieuKhoan,
      rows.map((r) => r.vatRate), giamDonNhap, giamDong,
    ]),
    [rows, traSua, traDv, traGhi, traMoi, ghiChu, ngay, dieuKhoan, giamDonNhap, giamDong]
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
      setRows((c) => {
        /* ⚠ THUẾ LÀ CỦA CẢ TỜ (bỏ VAT từng dòng, 24/09/2026) — dòng thêm tay theo thuế các dòng đang có. */
        const chung = c.length > 0 ? vatChungCuaDong(c) : null
        const r2 = chung === null ? row : { ...row, vatRate: chung }
        return [...c, ton == null ? r2 : { ...r2, availableBase: ton, stockKnown: true }]
      })
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
          note: "", reason: RETURN_REASONS[0]?.value ?? "damaged",
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
          note: a.note.trim() || null, reason: a.reason || null,
        }))
      /* ⚠ CHỈ GỬI DÒNG THẬT SỰ ĐỔI — gửi cả dòng không đổi là ghi đè `line_total` của chúng. */
      const ghiMoi = (l: DongTraCu) => traGhi[l.id] ?? {}
      const doiGhi = (l: DongTraCu) =>
        (ghiMoi(l).note !== undefined && ghiMoi(l).note !== l.note) ||
        (ghiMoi(l).reason !== undefined && ghiMoi(l).reason !== (l.reason ?? ""))
      const returnEdits = traCu
        .filter((l) => l.suaDuoc && ((traSua[l.id] ?? l.qty) !== l.qty || (traDv[l.id] ?? l.unit) !== l.unit || doiGhi(l)))
        .map((l) => ({
          lineId: l.id,
          quantity: traSua[l.id] ?? l.qty,
          ...((traDv[l.id] ?? l.unit) !== l.unit ? { unitName: traDv[l.id] } : {}),
          ...(ghiMoi(l).note !== undefined && ghiMoi(l).note !== l.note ? { note: ghiMoi(l).note!.trim() } : {}),
          ...(ghiMoi(l).reason !== undefined && ghiMoi(l).reason !== (l.reason ?? "") ? { reason: ghiMoi(l).reason } : {}),
        }))
      const r: PostInvoiceResult = invoiceId
        ? await reissueInvoice(createClient(), invoiceId, {
            lines: draft, notes: ghiChu.trim() || null, invoiceDate: ngay || null,
            paymentTerms: dieuKhoan, returnEdits, returnAdds, discount: tong.discount,
          })
        : await postInvoice(createClient(), {
            orderId, lines: draft, notes: ghiChu.trim() || null, invoiceDate: ngay || null,
            paymentTerms: dieuKhoan, returnAdds, returnEdits, discount: tong.discount,
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
      if (r.invoiceId) {
        /* ⚠ IN TẠI CHỖ (chủ nhà 24/09/2026) — khung ẩn, chỉ bật hộp thoại in. */
        inTaiCho(trangInHoaDon(r.invoiceId))
        router.replace(`/pos/hoa-don/${r.invoiceId}`)
      }
    } catch (e) {
      toast({
        title: invoiceId ? "Chưa lập lại được" : "Chưa xuất được",
        description: errorMessage(e),
        variant: "destructive",
      })
    } finally {
      setDangLuu(false)
    }
  }, [dangLuu, khoa, soDong, orderId, traMoi, traCu, traSua, traDv, traGhi, invoiceId, draft, ghiChu, ngay, dieuKhoan, chuKy, invoiceCode, router, toast, nguoi.ganId, ganCuaDon, tong.discount])

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
        {/* Xuất hàng: ghi chú đơn đã chép vào ô ghi chú hóa đơn. Sửa: nhắc nếu lệch. */}
        {sua && ghiChuDon && ghiChuDon !== ghiChu.trim() && <DocBanner>Ghi chú đơn: {ghiChuDon}</DocBanner>}

        <LineTableFrame
          header={
            <LineTableHeader
              grid="order"
              cols={cot.cols}
              cells={cot.cells}
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
                  <span className="n text-[18px] font-extrabold text-[var(--pos-ink)]">{formatCurrency(tong.goods)}</span>
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
            const gDong = lineGross(r.qty, r.price)
            const giam = giamCuaDong(r.key)
            const thanhTien = gDong - discountAmount(giam, gDong)
            const moCT = moChiTiet.has(r.key)
            const tomTat = tomTatChiTiet({ discount: giam })
            return (
              <Fragment key={r.key}>
              <div
                data-testid="dong-hoa-don"
                className={`grid min-h-[64px] items-center border-b border-[var(--pos-line-soft)] px-4 py-2 ${
                  r.qty <= 0 ? "opacity-55" : ""
                }`}
                style={{ gridTemplateColumns: cot.cols, gap: 8 }}
              >
                {/* ⚠ THÙNG RÁC ĐẦU DÒNG (chủ nhà 24/09/2026) — bỏ dòng khỏi tờ này, phần chưa xuất vẫn nằm trên đơn. */}
                <TrashButton
                  label={`Xoá dòng ${i + 1}`}
                  disabled={r.isExchange}
                  title={r.isExchange ? "Hàng đổi của khách — sửa ở khối Hàng đổi trả" : "Bỏ dòng khỏi hóa đơn này (phần chưa xuất vẫn nằm trên đơn)"}
                  onClick={() => boDong(r)}
                />
                {settings.colIndex && <div className="n text-center text-[13px] font-bold text-[var(--pos-dim)]">{i + 1}</div>}
                <div className="min-w-0">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate text-[13px] font-bold leading-tight text-[var(--pos-ink)]">{r.productName}</span>
                    {r.sku && <span className="n shrink-0 text-[11px] font-semibold text-[var(--pos-dim)]">{r.sku}</span>}
                    {r.addedByHand && (
                      <span className="shrink-0 rounded-md border border-[var(--pos-edge)] px-1.5 py-px text-[11px] font-bold text-[var(--pos-muted)]">
                        Thêm tay
                      </span>
                    )}
                  </div>
                  {/*
                    ⚠ GHI CHÚ TỪNG DÒNG SỬA ĐƯỢC, như màn đơn (chủ nhà 24/09/2026:
                      "Mất ghi chú cho từng dòng"). Đi xuống `sales_invoice_lines.note`.
                  */}
                  <input
                    id={`hd-ghichu-${r.key}`}
                    aria-label={`Ghi chú dòng ${i + 1}`}
                    value={r.note ?? ""}
                    onChange={(e) => suaDong(r.key, { note: e.target.value })}
                    placeholder="Ghi chú dòng…"
                    className={`mt-1 h-[28px] w-full min-w-0 border-0 border-b border-dashed bg-transparent px-0.5 text-[12px] font-semibold text-[var(--pos-ink)] outline-none placeholder:text-[var(--pos-dim)] ${
                      r.note ? "border-[var(--pos-primary-border)]" : "border-[var(--pos-edge)]"
                    }`}
                  />
                  <div className="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-1 text-[11px] text-[var(--pos-muted)]">
                    {r.orderLineId && (
                      <span>
                        đặt {r.orderedQty} {r.orderUnit ?? r.unitName} · đã xuất {r.invoicedQty.toLocaleString("vi-VN", { maximumFractionDigits: 2 })}{" "}
                        {r.orderUnit ?? r.unitName} ·
                      </span>
                    )}
                    <span className={thieu > 0 ? "font-semibold text-[var(--pos-warn)]" : undefined}>
                      {r.stockKnown ? `tồn ${r.availableBase.toLocaleString("vi-VN")}` : "tồn chưa xác định"}
                    </span>
                    {vuot && <span className="font-semibold text-[var(--pos-warn)]"> · vượt phần còn lại</span>}
                    {thieu > 0 && <span className="font-semibold text-[var(--pos-warn)]"> · thiếu {thieu}</span>}
                    {tomTat && !moCT && (
                      <button
                        type="button"
                        onClick={() => batChiTiet(r.key)}
                        className="ml-1 rounded-md bg-[var(--pos-primary-faint)] px-1.5 py-px font-bold text-[var(--pos-primary-deep)]"
                      >
                        {tomTat}
                      </button>
                    )}
                  </div>
                </div>
                {/* ⚠ ĐƠN VỊ CẠNH SỐ LƯỢNG, BẤM LÀ NHẢY — mọi dòng, kể cả dòng lấy từ đơn (23/09/2026). */}
                <UnitCycleButton units={donVi} value={r.unitName} label={`dòng ${i + 1}`} onChange={(u) => doiDonVi(r, u)} />
                <QtyStepper label={`số lượng dòng ${i + 1}`} value={r.qty} min={0} onChange={(v) => suaDong(r.key, { qty: Math.max(0, v) })} />
                <MoneyInput
                  showSuffix={false}
                  inputClassName="n h-[30px] w-full rounded-md border border-[var(--pos-edge)] px-1.5 text-right text-[13px] py-0 lg:h-[30px] focus-visible:ring-1 focus-visible:ring-offset-0"
                  aria-label={`Đơn giá dòng ${i + 1}`}
                  value={r.price}
                  onChange={(v) => suaDong(r.key, { price: Math.max(0, v) })}
                />
                <div className="n text-right text-[14px] font-extrabold text-[var(--pos-ink)]">{formatCurrency(thanhTien)}</div>
                <LineDetailToggle index={i + 1} open={moCT} dot={!!tomTat} onToggle={() => batChiTiet(r.key)} />
              </div>
              {/* ⚠ CHI TIẾT DÒNG — giảm giá (đ / %). Không còn VAT từng dòng (24/09/2026). */}
              {moCT && (
                <LineDetailPanel testId="chi-tiet-dong">
                  <LineDetailField label="Giảm giá" width={190}>
                    <DiscountCell
                      line={{ qty: r.qty, price: r.price, discount: giam } as PosLine}
                      index={i + 1}
                      onChange={(d) => setGiamDong((m) => ({ ...m, [r.key]: d }))}
                    />
                  </LineDetailField>
                </LineDetailPanel>
              )}
              </Fragment>
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
                style={{ gridTemplateColumns: cot.cols, gap: 8 }}
              >
                <span />
                {settings.colIndex && <div className="n text-center text-[12px] font-bold text-[var(--pos-dim)]">↺</div>}
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-[var(--pos-ink)]">
                    {p?.name ?? "Sản phẩm"}
                    <span className="ml-2 rounded-md bg-[var(--pos-warn-soft)] px-1.5 py-px text-[11px] font-extrabold text-[var(--pos-warn)]">
                      Hàng đổi
                    </span>
                  </div>
                  <div className="text-[11px] text-[var(--pos-muted)]">xuất kho cho khách · sửa ở khối Hàng đổi trả</div>
                </div>
                <div data-testid="hang-doi-dv" className="n text-center text-[12.5px] font-bold text-[var(--pos-muted)]">{d.unitName}</div>
                <div data-testid="hang-doi-sl" className="n text-center text-[14px] font-bold text-[var(--pos-ink)]">{d.quantity}</div>
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
                <span /><span>Sản phẩm</span><span className="text-center">Xử lý</span>
                <span className="text-center">Đơn vị</span>
                <span className="text-center">Số lượng</span><span className="text-right">Đơn giá</span>
                <span className="text-right">Trừ đơn</span>
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
                    {l.suaDuoc ? (
                      <TrashButton label={`Bỏ dòng trả ${i + 1}`} onClick={() => setTraSua((s) => ({ ...s, [l.id]: 0 }))} />
                    ) : <span />}
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-bold text-[var(--pos-ink)]">{l.name}</span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="n truncate text-[11.5px] font-semibold text-[var(--pos-muted)]">
                          {l.sku}
                          {!l.suaDuoc && " · phiếu đã xử lý hoặc thuộc tờ khác — chỉ xem"}
                        </span>
                      </span>
                      {/* ⚠ Lý do + ghi chú TỪNG DÒNG của phiếu trả đi đủ (24/09/2026). */}
                      {l.suaDuoc ? (
                        <span className="mt-1 flex min-w-0 items-center gap-1.5">
                          {!l.isExchange && (
                            <CompactSelect
                              ariaLabel={`Lý do trả dòng ${i + 1}`}
                              value={traGhi[l.id]?.reason ?? l.reason ?? ""}
                              onChange={(v) => setTraGhi((g) => ({ ...g, [l.id]: { ...g[l.id], reason: v } }))}
                              emptyLabel="theo phiếu"
                              options={RETURN_REASONS}
                              className="h-[26px] w-[128px] shrink-0 border-[var(--pos-edge)] bg-white text-[11.5px]"
                            />
                          )}
                          <input
                            aria-label={`Ghi chú dòng trả ${i + 1}`}
                            value={traGhi[l.id]?.note ?? l.note}
                            onChange={(e) => setTraGhi((g) => ({ ...g, [l.id]: { ...g[l.id], note: e.target.value } }))}
                            placeholder="Ghi chú dòng trả…"
                            className="h-[26px] min-w-0 flex-1 border-0 border-b border-dashed border-[var(--pos-edge)] bg-transparent px-0.5 text-[12px] font-semibold text-[var(--pos-ink)] outline-none"
                          />
                        </span>
                      ) : (l.note || l.reason) ? (
                        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--pos-muted)]">
                          {[RETURN_REASONS.find((x) => x.value === l.reason)?.label, l.note].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="justify-self-center text-[12px] font-extrabold text-[var(--pos-muted)]">
                      {l.isExchange ? "Đổi" : "Trả"}
                    </span>
                    {/* ⚠ Quy cách dòng trả CÓ SẴN: máy chủ tự quy giá theo hệ số (mig 181) — ở đây chỉ gửi đơn vị. */}
                    <div className="justify-self-center">
                      {l.suaDuoc ? (
                        <UnitCycleButton
                          units={(() => { const p = productById(l.productId); return p ? sellableUnits(p) : [l.unit] })()}
                          value={dvTraCu(l)}
                          label={`trả dòng ${i + 1}`}
                          onChange={(u) => setTraDv((d) => ({ ...d, [l.id]: u }))}
                        />
                      ) : (
                        <span className="n text-[12.5px] font-bold text-[var(--pos-muted)]">{l.unit}</span>
                      )}
                    </div>
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
                    <TrashButton label={`Xoá dòng trả mới ${i + 1}`} onClick={() => setTraMoi((c) => c.filter((x) => x.key !== a.key))} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-bold text-[var(--pos-ink)]">{a.name}</span>
                      <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="n truncate text-[11.5px] font-semibold text-[var(--pos-muted)]">
                          {a.sku} · mới thêm
                        </span>
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-1.5">
                        {!a.isExchange && (
                          <CompactSelect
                            ariaLabel={`Lý do trả mới ${i + 1}`}
                            value={a.reason}
                            onChange={(v) => doiA({ reason: v })}
                            options={RETURN_REASONS}
                            className="h-[26px] w-[128px] shrink-0 border-[var(--pos-edge)] bg-white text-[11.5px]"
                          />
                        )}
                        <input
                          aria-label={`Ghi chú dòng trả mới ${i + 1}`}
                          value={a.note}
                          onChange={(e) => doiA({ note: e.target.value })}
                          placeholder="Ghi chú dòng trả…"
                          className="h-[26px] min-w-0 flex-1 border-0 border-b border-dashed border-[var(--pos-edge)] bg-transparent px-0.5 text-[12px] font-semibold text-[var(--pos-ink)] outline-none"
                        />
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
                      <UnitCycleButton
                        units={(() => { const p = productById(a.productId); return p ? sellableUnits(p) : [a.unit] })()}
                        value={a.unit}
                        label={`trả mới ${i + 1}`}
                        onChange={(u) => {
                          /* Dòng MỚI: giá tra bảng giá theo nhóm khách, như lúc thêm. */
                          const p = productById(a.productId)
                          doiA({ unit: u, price: p ? unitPriceFor(p, u, groupId) : a.price })
                        }}
                      />
                    </div>
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
          {/* ⚠ CÙNG KHỐI TIỀN VỚI MÀN ĐƠN (chủ nhà 24/09/2026) — xem order-screen. */}
          <MoneyRow label="Tổng tiền hàng" value={tienHangGoc} />
          <MoneyRow label="Giảm giá dòng" value={giamDongTong} tone="muted" />
          {/*
            ⚠ GIẢM GIÁ CẢ ĐƠN (mig 183) — đơn có thì hóa đơn phải có. Xuất hàng:
              mặc định phần giảm của đơn chưa dùng ở tờ khác; sửa được, đồng / %.
          */}
          <DocDiscountRow
            id="hd-giam"
            label="Giảm giá đơn"
            discount={giamDonNhap}
            amount={giamDon}
            onChange={(d) =>
              /* ⚠ Đổi đơn vị thì GIỮ số tiền — cùng luật với màn đơn. */
              setGiamDonNhap(d.unit === giamDonNhap.unit ? d : switchUnit(giamDonNhap, tienSauGiamDong))
            }
          />
          {/* ⚠ Nút đặt HÀNG LOẠT thuế cho mọi dòng — thuế chỉ có một nguồn là từng dòng. */}
          <div className="flex items-center justify-between gap-2.5 py-[5px]">
            <span className="flex items-center gap-2">
              <span className="text-[13px] text-[var(--pos-muted)]">Thuế GTGT</span>
              <span className="w-[74px]">
                <VatChip
                  rate={vatChung ?? 0}
                  mixed={vatChung === null}
                  ariaLabel="Thuế GTGT cả hóa đơn"
                  onNext={() => {
                    const moi = vatChungKeTiep(vatChung)
                    setRows((c) => c.map((r) => ({ ...r, vatRate: moi })))
                  }}
                />
              </span>
            </span>
            <span className="n text-[13.5px] text-[var(--pos-ink)]">{formatCurrency(tong.vat)}</span>
          </div>
          <TotalsHero label="Tổng cộng" value={tong.total} />
          {truHangTra > 0 && (
            <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(truHangTra)}`} tone="warn" />
          )}
          <div className="mt-1 border-t border-[var(--pos-line-soft)] pt-2">
            <MoneyRow label="Khách cần trả" value={khachTra} strong />
          </div>
          {/* ⚠ Tiền đã thu KHÔNG còn chặn lập lại — nó đi sang tờ mới (mig 184). */}
          {sua && (receiptErr || reissuePaymentNote({ paidAmount: daThu, receiptRefs: receipts.map((r) => r.ref) })) && (
            <p data-testid="ghi-chu-tien-thu" className="mt-3 text-[11.5px] font-semibold text-[var(--pos-primary-deep)]">
              {receiptErr
                ? `Không đọc được phiếu thu — ${receiptErr}. Lập lại vẫn chạy: phiếu thu (nếu có) tự gắn sang hóa đơn mới.`
                : reissuePaymentNote({ paidAmount: daThu, receiptRefs: receipts.map((r) => r.ref) })}
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
              title="In hóa đơn hiện tại"
              onClick={() => { const h = posPrintHref("INV", invoiceId); if (h) inTaiCho(h) }}
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
