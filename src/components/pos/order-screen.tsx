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
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026 (ĐỢT 7): "phần tìm hàng hoá dùng
 * ProductPicker đã viết sẵn" và "các dòng trong đơn chỉ bố trí hình
 * thức khác đi thôi chứ vẫn phải giữ các chức năng của làm đơn hàng
 * cũ". Hai câu ấy đảo hai quyết định của đợt 1, và đảo có lý do:
 *
 *   · Ô tìm hàng nay là `ProductPicker` dùng chung. Bản đầu tự vẽ một
 *     `SearchDropdown` riêng cho POS và được ghi vào danh sách nợ của
 *     `tests/return-slip.test.ts` — đúng cái danh sách sinh ra để không
 *     ai tự vẽ ô tìm nữa. Nay hết nợ.
 *
 *     ⚠ VÀ ĐỢT 9 DỜI HẲN Ô ẤY LÊN HEADER. Đợt 7 đặt nó thành một thẻ
 *     riêng trên bảng hàng, thành ra màn có HAI chỗ thêm hàng: ô trên
 *     header (lúc đó là một cái nút kích `F3`) và thẻ này. Chủ nhà
 *     chốt bỏ cái dưới. Màn nay chỉ ĐĂNG KÝ danh mục + việc cần làm
 *     vào `useRegisterPosProductSearch`; khung vẽ ô tìm.
 *
 *   · BẢNG DÒNG HÀNG BỐ TRÍ KHÁC, CHỨC NĂNG GIỮ NGUYÊN. Bản đầu làm
 *     rơi mất năm thứ của màn đơn cũ, và cả năm đều đụng TIỀN:
 *       1. giá lấy `products.sell_price` thay vì `unitPriceFor` — bỏ
 *          qua BẢNG GIÁ THEO NHÓM KHÁCH. Khách sỉ bị tính giá lẻ.
 *       2. đổi đơn vị nhân/chia hệ số thay vì tra lại bảng giá.
 *       3. không có `listPrice` → `line_discount` của đơn luôn bằng
 *          khoản giảm gõ tay, bỏ qua phần người bán tự hạ giá.
 *       4. không có chốt chặn giá (`priceViolation`) → NVBH bán dưới
 *          giá bảng mà không gì cản.
 *       5. không có thuế theo DÒNG.
 *     Cả năm nay dùng đúng `@/lib/sell/pricing` và `@/lib/sell/cart` mà
 *     màn cũ đang dùng — không chép lại phép tính nào.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import Link from "next/link"
import { buildOrderPayload } from "@/lib/sell/create-order"
import { generateOrderCode } from "@/lib/utils"
import { cartTotals, priceViolation, ceilingFor } from "@/lib/sell/cart"
import { unitPriceFor, conversionFor, sellableUnits, stockInUnit } from "@/lib/sell/pricing"
import { userPriceRulesFrom } from "@/lib/pricing"
import { isSaleLineOverstock } from "@/lib/orders/stock-check"
import { toStockLines } from "@/lib/sell/stock"
import { viMatchAllWords } from "@/lib/search"
import { VAT_RATES, vatLabel } from "@/lib/constants"
import {
  useRegisterPosProductSearch, usePosSearchTerm, focusPosPicker,
} from "@/store/pos/product-search"
import { editableReturnOf, type PendingReturnRow } from "@/lib/sell/order-edit"
import { loadInvoiceableLines } from "@/lib/orders/post-invoice"
import { loadCustomerDebt, loadLastPrices, loadLotsByProduct, attachLineExtras } from "@/lib/pos/load"
import { savePosOrder, savePosInvoice, posLinesToCart, posLinesToReturnCart } from "@/lib/pos/save"
import { invoiceWarnings } from "@/lib/orders/post-invoice"
import { formatCurrency } from "@/lib/utils"
import { lineGross, switchUnit, type DiscountInput } from "@/lib/pos/discount"
import { posTotals, cashSuggestions } from "@/lib/pos/totals"
import { posPrintHref } from "@/lib/pos/tabs"
import type { PosBadge, PosLine, PosPayMethod } from "@/lib/pos/types"
import { usePosSettings } from "@/store/pos/settings"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosDocLabel, usePosDirty } from "@/store/pos/tabs"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocSubHeader, SubHeaderDate, SubHeaderSelect, DocBanner, homNay } from "@/components/pos/doc-sub-header"
import {
  LineTableFrame, LineTableHeader, POS_GRID, QtyStepper, DiscountCell,
  LineAmountCell, LineMenu, NegativeStockStrip,
} from "@/components/pos/line-table"
import {
  MoneyRow, DocDiscountRow, TotalsHero, PaymentButtons, CashChips,
  PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PosAddProductButton, PosProductSearchBox } from "@/components/pos/product-search-box"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
import type { SellProduct } from "@/lib/sell/ref-data"
import { ReturnExchangeTable } from "@/components/pos/return-exchange-table"

export interface OrderScreenProps {
  /** `lap` = đơn mới hoặc phiếu tạm. `sua` = đơn đã lưu, mở ra sửa. */
  mode: "lap" | "sua"
  /** `null` = đơn mới. Có mã thì nạp đơn ấy lên. */
  orderId?: string | null
}

let demDong = 0
const newKey = () => `d${++demDong}`

/**
 * Các bậc thuế cho ô chọn của dòng.
 *
 * ⚠ GIỮ ĐÚNG THUẾ SUẤT LẠ CỦA DÒNG. Sản phẩm khai 7% mà ép về bậc gần
 * nhất là lặng lẽ đổi số thuế người ta đã khai; mở ô ra không thấy bậc
 * nào sáng thì người dùng tưởng dòng chưa có thuế. Cùng luật với
 * `LineEditSheet` của màn đơn cũ.
 */
function vatChoices(current: number): Array<{ value: number; label: string }> {
  const cur = Number(current) || 0
  const base: Array<{ value: number; label: string }> = [...VAT_RATES]
  if (base.some((v) => Math.abs(v.value - cur) < 1e-9)) return base
  return [...base, { value: cur, label: vatLabel(cur) }].sort((a, b) => a.value - b.value)
}

export function OrderScreen({ mode, orderId = null }: OrderScreenProps) {
  const { settings, ready: settingsReady } = usePosSettings()
  const { user } = useAuth()
  const { products, customers, sellers, stockByProduct, loading, warnings, productById, customerById } =
    usePosRefData()
  const { toast } = useToast()
  const router = useRouter()

  const [lines, setLines] = useState<PosLine[]>([])
  const [retLines, setRetLines] = useState<PosLine[]>([])
  const [retReason, setRetReason] = useState("damaged")
  /**
   * Phiếu trả nháp kèm đơn mà màn đang nắm — ba giá trị, xem
   * `applyOrderEdit`: `string` ghi đè, `null` chưa có, `undefined`
   * KHÔNG BIẾT (đọc hỏng hoặc đơn có nhiều phiếu nháp) → lúc lưu đứng yên.
   */
  const [heldReturnId, setHeldReturnId] = useState<string | null | undefined>(orderId ? undefined : null)
  const [khach, setKhach] = useState<PosPartner | null>(null)
  const [docDiscount, setDocDiscount] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  const [traTien, setTraTien] = useState(0)
  const [pay, setPay] = useState<PosPayMethod>("no")
  const [ngayGiao, setNgayGiao] = useState("")
  const [dieuKhoan, setDieuKhoan] = useState("COD")
  const [nvbh, setNvbh] = useState("")
  const [thoiDiem] = useState(homNay)
  /* ⚠ TỪ KHOÁ TÌM HÀNG NẰM Ở KHUNG, không ở màn — ô nhập ở header. */
  const moTimHang = usePosSearchTerm()
  const [moTimKhach, setMoTimKhach] = useState(false)
  const [orderCode, setOrderCode] = useState<string | null>(null)
  const [orderStatus, setOrderStatus] = useState<"draft" | "submitted" | string>("draft")
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [dangLuu, setDangLuu] = useState(false)
  const [loiNap, setLoiNap] = useState<string | null>(null)
  /** Đã nạp xong đơn (đơn mới thì xong ngay) — mốc "chưa lưu" đặt sau đó. */
  const [daNap, setDaNap] = useState(!orderId)
  const [mocChuaLuu, setMocChuaLuu] = useState<string | null>(null)

  /**
   * ⚠ MÃ CHỐNG LẶP SINH MỘT LẦN CHO MỖI LẦN MỞ MÀN, không phải mỗi lần
   * bấm. `createOrderRecords` idempotent theo `client_request_id` — nhưng
   * bản đầu sinh mã mới ở mỗi cú bấm, nên bấm lần hai sau một lần rớt
   * mạng là một đơn thứ hai. Lưu xong (có `orderId`) thì mã này không
   * còn được dùng nữa vì đường lưu đổi sang `applyOrderEdit`.
   */
  const clientRequestId = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  )

  /**
   * ⚠ THIẾT LẬP ĐỌC TỪ `localStorage` SAU LẦN VẼ ĐẦU. Khởi tạo state
   * từ `settings` ở lần vẽ đầu là lấy MẶC ĐỊNH của hệ chứ không phải
   * lựa chọn người dùng đã lưu — họ chọn "%" làm đơn vị giảm mặc định
   * và mỗi lần mở màn vẫn thấy "₫". Áp một lần khi `ready`, và chỉ khi
   * người dùng chưa đụng gì (đơn mới, chưa có dòng).
   */
  useEffect(() => {
    if (!settingsReady || orderId) return
    setDocDiscount((d) => (d.value === 0 ? { value: 0, unit: settings.defaultDiscountUnit } : d))
    setPay(settings.defaultCreditAll ? "no" : "tien-mat")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsReady])

  /** Có dòng nào ĐÃ XUẤT một phần — quyết định banner và sàn stepper. */
  const partiallyIssued = useMemo(() => lines.some((l) => (Number(l.issued) || 0) > 0), [lines])

  /**
   * ⚠ NHÓM GIÁ CỦA KHÁCH QUYẾT ĐỊNH GIÁ BẢNG. Đây là thứ bản đầu bỏ
   * mất: `unitPriceFor` xét bảng giá riêng của nhóm TRƯỚC bảng giá
   * chung, nên khách sỉ và khách lẻ ra hai giá khác nhau cho cùng một
   * mã. Lấy `sell_price` phẳng là mọi khách một giá.
   */
  const groupId = customerById(khach?.id)?.group_id ?? null

  /**
   * ⚠ CHỐT CHẶN GIÁ CỦA NVBH — sàn là giá bảng, trần là +N%. Đây là
   * chốt duy nhất giữa một cú gõ nhầm và việc cho không hàng, và nó
   * phải đọc CÙNG một bộ quy tắc với màn đơn cũ.
   */
  const rules = userPriceRulesFrom(user)
  const isSales = user?.role === "sales"
  const canEditPrice = !isSales || rules.allow_price_edit
  const maxIncreasePct = Number(rules.price_edit_max_increase_pct ?? 0)

  /* Tab: tên theo mã thật, chip "chưa lưu" theo chữ ký state. */
  usePosDocLabel("SO", orderId, orderCode)
  const chuKy = useMemo(
    () =>
      JSON.stringify([
        lines.map((l) => [l.productId, l.unit, l.qty, l.price, l.discount, l.note ?? ""]),
        retLines.map((l) => [l.productId, l.unit, l.qty, l.price, l.isExchange]),
        khach?.id ?? null, docDiscount, dieuKhoan, ngayGiao, nvbh, retReason,
      ]),
    [lines, retLines, khach?.id, docDiscount, dieuKhoan, ngayGiao, nvbh, retReason]
  )
  /* ⚠ Mốc lấy ở lần vẽ đầu tiên SAU khi nạp xong — lúc ấy `chuKy` đã
     phản ánh đúng state đã nạp. Lấy sớm hơn là mốc rỗng, và mọi đơn
     đã lưu vừa mở ra đều mang chip "chưa lưu". */
  useEffect(() => {
    if (daNap && mocChuaLuu === null) setMocChuaLuu(chuKy)
  }, [daNap, chuKy, mocChuaLuu])
  usePosDirty(chuKy, mocChuaLuu)

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

  /**
   * SỐ LIỆU PHỤ CỦA TỪNG DÒNG — đúng bộ mà màn đơn cũ tính.
   *
   * ⚠ VƯỢT TỒN XÉT TRÊN TỔNG MỌI DÒNG CÙNG MẶT HÀNG. Hai dòng mỗi dòng
   * 6 thùng trên tồn 10 thì từng dòng đều "hợp lệ" — bản đầu so từng
   * dòng với tồn nên không dòng nào đỏ.
   *
   * ⚠ TỒN HIỆN THEO ĐƠN VỊ CỦA DÒNG. Bản đầu in tồn theo đơn vị CƠ SỞ
   * cạnh một dòng đang đặt theo thùng: "Tồn 240" bên cạnh "2 thùng".
   */
  const stockLines = useMemo(() => toStockLines(posLinesToCart(lines)), [lines])
  const rows = useMemo(
    () =>
      lines.map((l, i) => {
        const p = productById(l.productId)
        const giaBang = l.listPrice ?? 0
        const giaBangNay = p ? unitPriceFor(p, l.unit, groupId) : giaBang
        return {
          over: p ? isSaleLineOverstock(i, stockLines, products, stockByProduct) : false,
          tonTheoDonVi: p ? stockInUnit(p, l.unit, stockByProduct[l.productId] ?? 0) : null,
          /* ⚠ Đổi khách là đổi bảng giá. Dòng đã có giữ giá cũ, nên phải
             NÓI RA chỗ nào lệch chứ đừng lặng lẽ tính giá cũ. */
          lechBangGia: giaBangNay !== giaBang ? giaBangNay : null,
          xauGia: priceViolation(
            { price: l.price, listPrice: giaBang },
            { canEditPrice, maxIncreasePct }
          ),
          giaBang,
        }
      }),
    [lines, productById, groupId, stockLines, products, stockByProduct, canEditPrice, maxIncreasePct]
  )
  const coGiaXau = rows.some((r) => r.xauGia !== null)

  /**
   * CỘT CỦA BẢNG — dựng theo drawer thiết lập.
   *
   * ⚠ TẮT MỘT CỘT LÀ BỎ HẲN NÓ KHỎI LƯỚI, không phải vẽ một ô rỗng. Bản
   * đầu giữ nguyên `grid-template-columns` rồi để trống ô: tắt "Mã
   * hàng" xong vẫn thấy một khoảng 88px trống giữa bảng, và người dùng
   * tưởng thiết lập không ăn.
   *
   * ⚠ MỘT NGUỒN CHO CẢ ĐẦU BẢNG LẪN DÒNG. Hai danh sách cột rời nhau là
   * hai chỗ phải sửa, và lệch nhau một cột là cả bảng so le.
   */
  const cot = useMemo(() => {
    const c: Array<{ w: string; label: string; align?: "left" | "center" | "right" }> = []
    if (settings.colIndex) c.push({ w: "28px", label: "#" })
    if (settings.colSku) c.push({ w: "88px", label: "Mã hàng" })
    c.push({ w: "minmax(0,1fr)", label: "Tên hàng" })
    c.push({ w: "76px", label: "ĐVT" })
    c.push({ w: "96px", label: "Số lượng", align: "center" })
    c.push({ w: "100px", label: "Đơn giá", align: "right" })
    if (settings.colLineDiscount) c.push({ w: "92px", label: "Giảm", align: "right" })
    if (settings.colVat) c.push({ w: "66px", label: "VAT", align: "center" })
    c.push({ w: "116px", label: "Thành tiền", align: "right" })
    c.push({ w: "28px", label: "" })
    return {
      cols: c.map((x) => x.w).join(" "),
      cells: c.map((x) => ({ label: x.label, align: x.align })),
    }
  }, [settings.colIndex, settings.colSku, settings.colLineDiscount, settings.colVat])

  const addProduct = useCallback(
    (productId: string) => {
      const p = products.find((x) => x.id === productId)
      if (!p) return
      /**
       * ⚠ ĐƠN VỊ MẶC ĐỊNH LÀ ĐƠN VỊ CƠ SỞ, và `sellableUnits` là chỗ
       * duy nhất trả lời câu ấy cho MỌI màn. Bản đầu lấy `units[0]` của
       * `product_units` — bảng đó có thể xếp "thùng" lên trước, và khi
       * ấy thêm một mã là thêm cả thùng thay vì một chai.
       */
      const tenDonVi = sellableUnits(p)
      const units = tenDonVi.map((u) => ({ unit_name: u, conversion: conversionFor(p, u) }))
      const donVi = tenDonVi[0]
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
        /* ⚠ GIÁ TRA TỪ BẢNG GIÁ THEO NHÓM KHÁCH — xem `groupId`. */
        const gia = unitPriceFor(p, donVi, groupId)
        const moi: PosLine = {
          key: newKey(),
          productId: p.id,
          sku: p.sku ?? "",
          name: p.name,
          unit: donVi,
          units: units.length ? units : [{ unit_name: p.base_unit, conversion: 1 }],
          qty: 1,
          price: gia,
          listPrice: gia,
          /* ⚠ Thuế suất của mặt hàng là TỈ LỆ (0,1), không phải phần trăm. */
          vatRate: Number(p.vat_rate) || 0,
          // ⚠ Đơn vị giảm lấy từ THIẾT LẬP, và chỉ ở lúc TẠO dòng.
          discount: { value: 0, unit: settings.defaultDiscountUnit },
          stock: stockByProduct[p.id] ?? null,
          ordered: null,
          issued: null,
        }
        return [...cu, moi]
      })
    },
    [products, settings.mergeDuplicateLines, settings.defaultDiscountUnit, stockByProduct, groupId]
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
        const [h, ds, hd, rt] = await Promise.all([
          sb.from("sales_orders")
            .select("id, order_code, status, customer_id, payment_terms, expected_delivery, notes, sales_user_id, customer:customers(store_name, phone, address, group_id)")
            .eq("id", orderId).maybeSingle(),
          loadInvoiceableLines(sb, orderId),
          sb.from("sales_invoices")
            .select("invoice_code").eq("order_id", orderId).eq("status", "posted")
            .order("created_at", { ascending: false }).limit(1),
          /**
           * ⚠ ĐỌC CẢ PHIẾU TRẢ KÈM ĐƠN — cùng câu với `/sell/edit`.
           * Không đọc là bảng hàng trả dưới đơn trống trơn, người sửa
           * tưởng mất và nhập lại → hai phiếu trả cho một đơn.
           */
          sb.from("returns")
            .select("id, reason, notes, status, invoice_id, lines:return_lines(product_id, unit_name, quantity, unit_price, vat_rate, is_exchange, note)")
            .eq("order_id", orderId)
            .neq("status", "cancelled"),
        ])
        if (huy) return
        const head = (h.data as unknown) as {
          order_code: string; status: string; customer_id: string
          payment_terms: string | null; expected_delivery: string | null
          notes: string | null; sales_user_id: string | null
          customer?: {
            store_name?: string | null; phone?: string | null
            address?: string | null; group_id?: string | null
          } | null
        } | null
        if (!head) { setLoiNap("Không tìm thấy đơn này."); return }
        setOrderCode(head.order_code)
        setOrderStatus(head.status)
        setDieuKhoan(head.payment_terms || "COD")
        setNgayGiao(head.expected_delivery || "")
        setNvbh(head.sales_user_id || "")
        /* ⚠ KHÁCH CỦA ĐƠN PHẢI LÊN CARD. Bản đầu quên: mở đơn đã lưu
           thì card ghi "+ Chọn khách hàng" và nút lưu từ chối vì "chưa
           chọn khách" — trên một đơn đã có khách. */
        setKhach({
          id: head.customer_id,
          name: head.customer?.store_name || "Khách lẻ",
          meta: [head.customer?.phone, head.customer?.address].filter(Boolean).join(" · "),
        })
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
              price: r.unitPrice,
              /* ⚠ GIÁ BẢNG TRA LẠI THEO KHÁCH CỦA ĐƠN. Đơn đã lưu chỉ
                 ghi `unit_price`; không tra lại thì mọi dòng trông như
                 đúng giá bảng và chốt chặn giá im lặng. */
              listPrice: (() => {
                const p = productById(r.productId)
                return p ? unitPriceFor(p, r.unitName, head.customer?.group_id ?? null) : r.unitPrice
              })(),
              vatRate: Number(productById(r.productId)?.vat_rate) || 0,
              discount: { value: 0, unit: "vnd" as const },
              stock: r.availableBase,
              ordered: r.orderedQty,
              /* ⚠ SÀN CỦA STEPPER — spec §7.1. */
              issued: r.invoicedQty,
              note: r.note ?? undefined,
            }))
        )

        /* Phiếu trả kèm đơn — cùng luật `editableReturnOf` với `/sell`. */
        if (rt.error) {
          setHeldReturnId(undefined)
          toast({
            title: "Chưa đọc được hàng trả kèm đơn",
            description: "Phần hàng trả sẽ không hiện và KHÔNG bị thay đổi khi lưu. " + errorMessage(rt.error),
            variant: "destructive",
          })
        } else {
          const rets = ((rt.data as unknown) as PendingReturnRow[]) ?? []
          const held = editableReturnOf(rets)
          const holdable = rets.filter((r) => r.status === "draft" && !r.invoice_id)
          setHeldReturnId(held ? held.id : holdable.length === 0 ? null : undefined)
          if (held) {
            setRetReason(held.reason || "damaged")
            setRetLines(
              held.lines.map((l) => ({
                key: newKey(),
                productId: l.product_id,
                sku: productById(l.product_id)?.sku ?? "",
                name: productById(l.product_id)?.name ?? "",
                unit: l.unit_name,
                units: [{ unit_name: l.unit_name, conversion: 1 }],
                qty: Number(l.quantity) || 0,
                price: Number(l.unit_price) || 0,
                discount: { value: 0, unit: "vnd" as const },
                isExchange: l.is_exchange === true,
                note: l.note ?? undefined,
              }))
            )
          }
          if (holdable.length > 1) {
            toast({
              title: `Đơn có ${holdable.length} phiếu trả nháp`,
              description: "Màn này chỉ sửa được một phiếu nên không nạp phiếu nào. Lưu đơn sẽ KHÔNG làm chúng đổi.",
              variant: "destructive",
            })
          }
        }
        setDaNap(true)
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
  /* ⚠ `F3` ĐƯA TIÊU ĐIỂM VỀ Ô TÌM TRÊN HEADER. `ProductPicker` tự xổ
     danh sách khi nhận tiêu điểm (`onFocus`), nên một lệnh focus là đủ. */
  usePosKeys({
    F3: focusPosPicker,
    F4: () => setMoTimKhach(true),
    F8: () => setRetLines((c) => [...c, emptyReturnLine(false)]),
    F9: () => setRetLines((c) => [...c, emptyReturnLine(true)]),
    /* ⚠ `ProductPicker` tự xử `Esc` của nó; ở đây chỉ đóng ô tìm khách. */
    Escape: () => setMoTimKhach(false),
  })

  /* --- dữ liệu cho hai dropdown --- */
  /**
   * Danh sách cho `ProductPicker` — component ấy nhận danh sách ĐÃ LỌC.
   *
   * ⚠ KHÔNG BỎ MÃ ĐÃ CÓ TRÊN ĐƠN. `searchAddable` của màn hóa đơn bỏ
   * chúng vì ở đó một mã chỉ được một dòng; ở đây cùng một mã đặt 3
   * thùng và 5 chai là hai dòng hợp lệ (xem `lineKey`), và thiết lập
   * "gộp dòng trùng" mới quyết định có gộp hay không.
   *
   * ⚠ CÓ TRẦN. Ô rỗng xổ cả 1.700 mã là dựng lại đúng danh sách phải
   * cuộn mà ô tìm sinh ra để thay thế — `ProductPicker` tự cắt ở
   * `PICKER_PEEK`, trần ở đây chỉ để phép lọc không quét vô ích.
   */
  const mucHang = useMemo(
    () => {
      const out: Array<SellProduct & { title: string; subtitle: string }> = []
      for (const p of products) {
        if (!viMatchAllWords(moTimHang, p.name, p.sku, p.barcode)) continue
        out.push({
          ...p,
          title: p.name,
          subtitle: [p.sku || "—", p.base_unit].filter(Boolean).join(" · "),
        })
        if (out.length >= 60) break
      }
      return out
    },
    [products, moTimHang]
  )

  /**
   * ⚠ GIÁ HIỆN Ở GỢI Ý LÀ GIÁ CỦA ĐÚNG KHÁCH ĐANG CHỌN. Hiện
   * `sell_price` phẳng là người lập đơn đọc một giá rồi thêm vào lại ra
   * giá khác — xem `groupId`.
   */
  const veGoiY = useCallback(
    (p: SellProduct) => {
      const ton = stockByProduct[p.id] ?? 0
      return (
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums">
            {formatCurrency(unitPriceFor(p, sellableUnits(p)[0], groupId))}
          </span>
          <span className={`block text-xs tabular-nums ${ton <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
            tồn {ton.toLocaleString("vi-VN")}
          </span>
        </span>
      )
    },
    [stockByProduct, groupId]
  )
  const chonHang = useCallback((p: SellProduct) => addProduct(p.id), [addProduct])

  /* ⚠ Ô TÌM HÀNG VẼ Ở KHUNG — màn chỉ đưa danh mục và việc cần làm lên.
     Xem `src/store/pos/product-search.tsx`. */
  useRegisterPosProductSearch({
    items: mucHang,
    onPick: chonHang,
    disabled: loading,
    placeholder: "Tên hàng, mã SKU hoặc mã vạch…",
    renderMeta: veGoiY,
  })

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
      /**
       * ⚠ GIÁ NGOÀI HẠN MỨC CHẶN LƯU. Đây là chốt chặn duy nhất giữa một
       * cú gõ nhầm và việc cho không hàng — màn đơn cũ chặn ở đây, và
       * bản đầu của màn này bỏ mất nó hoàn toàn.
       */
      if (coGiaXau) {
        toast({
          title: "Có dòng đặt giá ngoài hạn mức",
          description: canEditPrice
            ? `Không được thấp hơn giá bảng, và tối đa +${maxIncreasePct}%.`
            : "Bạn không có quyền sửa giá.",
          variant: "destructive",
        })
        return
      }
      /* ⚠ Dòng trả kèm đơn còn trống mặt hàng thì nói ra, đừng lặng lẽ bỏ. */
      const traBoDo = retLines.filter((l) => !l.productId).length
      if (traBoDo > 0) {
        toast({ title: `${traBoDo} dòng hàng trả chưa chọn mặt hàng`, description: "Chọn mặt hàng hoặc xoá dòng đó trước khi lưu.", variant: "destructive" })
        return
      }
      setDangLuu(true)
      try {
        const cart = posLinesToCart(lines)
        const payload = buildOrderPayload({
          clientRequestId: clientRequestId.current,
          orderCode: orderCode || generateOrderCode(),
          customerId: khach.id,
          customerName: khach.name,
          paymentTerms: dieuKhoan,
          expectedDelivery: ngayGiao || null,
          notes: "",
          cart,
          totals: cartTotals(cart),
          createdAt: new Date().toISOString(),
          /* ⚠ HÀNG TRẢ KÈM ĐƠN ĐI XUỐNG THẬT. Bản đầu gửi `[]` trong khi
             panel vẫn trừ "Trừ hàng trả" vào số khách cần trả — người
             dùng thấy một tổng mà sổ không ghi. */
          returnReason: retReason,
          returnLines: posLinesToReturnCart(retLines),
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
          heldReturnId,
          productName: (id) => productById(id)?.name,
        })
        setMocChuaLuu(chuKy)
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
    [user, khach, lines, retLines, retReason, heldReturnId, chuKy, orderCode, dieuKhoan, ngayGiao, nvbh, orderId, productById, coGiaXau, canEditPrice, maxIncreasePct, router, toast]
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
        <Link href={`/sales-invoices`} className="font-semibold text-[var(--pos-primary)] underline">
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
            {/* ⚠ Ngày đơn do máy chủ ghi lúc lưu — hiện, không mời sửa. */}
            <SubHeaderDate value={thoiDiem} label="Ngày lập" readOnly />
          </>
        }
      />

      <div className="flex min-h-0 flex-grow gap-4 p-4">
        {/*
          ---------------- cột trái ----------------
          ⚠ `min-w-0 flex-1`, KHÔNG PHẢI `w-[1012px]`. Bản đầu cứng 1012px
            theo artboard 1440; cộng panel phải 380 và lề là 1440 — trên
            màn 1366px (laptop phổ biến nhất ở đây) panel phải bị cắt
            mất 74px và khung `overflow-hidden` giấu luôn nút lưu. Lưới
            cột có `minmax(0,1fr)` ở cột tên nên co được.
        */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/*
            ⚠ NEO DROPDOWN TÌM HÀNG Ở ĐỈNH CỘT TRÁI. Bản đầu neo nó ở
              ĐÁY panel phải: dropdown mở XUỐNG từ mép dưới màn hình và
              bị khung `overflow-hidden` cắt sạch — bấm F3 chỉ thấy nền
              tối đi. Ở đây nó xổ đè lên bảng hàng, rộng bằng bảng.
          */}
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

          {/*
            ⚠ HÀNG NÀY KHÔNG PHẢI Ô TÌM THỨ HAI. Chủ nhà chốt *"bấm vào
              đó nhảy sang ô thêm sản phẩm bên phải"*: nút chỉ đưa tiêu
              điểm sang ô duy nhất ở cột phải. Nó có mặt vì ô tìm nay
              nằm ở cột kia — không có nó thì người mở đơn lần đầu không
              biết thêm hàng ở đâu, đúng lý do bản thiết kế vẽ nó.
          */}
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[13px] font-bold text-[var(--pos-muted)]">
              Dòng hàng <span className="n">· {lines.length}</span>
            </span>
            <div className="flex-grow" />
            <PosAddProductButton />
          </div>

          <LineTableFrame
            header={<LineTableHeader grid="order" cols={cot.cols} cells={cot.cells} />}
            footer={
              <>
                <NegativeStockStrip count={vuotTon} />
                {/*
                  ⚠ GIÁ SAI PHẢI CHẶN LƯU, không chỉ tô đỏ. Một vệt đỏ mà
                    vẫn gửi đơn được thì nó chỉ là trang trí — đúng lý do
                    màn đơn cũ ghi cho dòng hàng trả.
                */}
                {coGiaXau && (
                  <div className="shrink-0 bg-[var(--pos-danger-soft)] px-4 py-2 text-[11.5px] text-[var(--pos-danger)]">
                    Có dòng đặt giá ngoài hạn mức của bạn — sửa lại trước khi lưu.
                  </div>
                )}
              </>
            }
          >
            {lines.length === 0 && (
              /*
                ⚠ Ô RỖNG PHẢI CHỈ ĐƯỜNG, KHÔNG CHỈ BÁO RỖNG. Bản thiết kế
                  21/09/2026 dựng ba tầng: một câu nói trạng thái, một câu
                  nói LÀM GÌ TIẾP, và một nút làm hộ luôn. Bản trước chỉ có
                  tầng một và một dòng chữ xanh nhỏ — người mở đơn lần đầu
                  không biết ô tìm hàng nằm đâu trên màn.
              */
              <div className="px-8 py-[72px] text-center">
                <p className="text-[15px] font-bold text-[var(--pos-ink)]">
                  {loading ? "Đang tải danh mục hàng…" : "Đơn chưa có dòng hàng"}
                </p>
                {!loading && (
                  <>
                    <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] font-semibold leading-relaxed text-[var(--pos-muted)]">
                      Bấm ô tìm sản phẩm ở cột bên phải để xổ danh sách, hoặc quét mã vạch.
                      <br />
                      Nhấn Enter để thêm nhanh kết quả đầu tiên.
                    </p>
                    <button
                      type="button"
                      onClick={focusPosPicker}
                      className="mt-4 h-10 rounded-[10px] bg-[var(--pos-primary)] px-[18px] text-[14px] font-extrabold text-white"
                    >
                      Thêm hàng <span className="n text-[12px] opacity-75">F3</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {lines.map((l, i) => {
              /* ⚠ SÀN = SỐ ĐÃ XUẤT. Ràng buộc duy nhất của màn sửa. */
              const san = mode === "sua" ? Math.max(0, Number(l.issued) || 0) : 0
              const r = rows[i]
              return (
                <div
                  key={l.key}
                  className={`grid min-h-[70px] items-center border-b border-[var(--pos-line-soft)] px-4 py-2 ${
                    r?.over ? "bg-[var(--pos-danger-soft)]" : ""
                  }`}
                  style={{ gridTemplateColumns: cot.cols, gap: POS_GRID.order.gap }}
                >
                  {settings.colIndex && (
                    <div className="n text-[12px] text-[var(--pos-dim)]">{i + 1}</div>
                  )}
                  {settings.colSku && (
                    <div className="n truncate text-[11.5px] text-[var(--pos-muted)]">{l.sku}</div>
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold leading-tight text-[var(--pos-ink)]">
                      {l.name}
                    </div>
                    {settings.colStock && (
                      <div className="mt-[3px] truncate text-[11px] text-[var(--pos-muted)]">
                        {/*
                          ⚠ TỒN THEO ĐƠN VỊ CỦA DÒNG (`stockInUnit`), không
                            theo đơn vị cơ sở. "Tồn 240" cạnh "2 thùng" là
                            hai đơn vị khác nhau đứng cạnh nhau không nhãn.
                          ⚠ CHƯA ĐỌC ĐƯỢC THÌ NÓI THẾ, đừng ghi "Tồn 0" —
                            số 0 cho một lỗi đọc đọc như hàng đã hết.
                        */}
                        {r?.tonTheoDonVi == null ? (
                          <span className="text-[var(--pos-dim)]">tồn chưa xác định</span>
                        ) : (
                          <span className={r.over ? "font-semibold text-[var(--pos-danger)]" : r.tonTheoDonVi <= 0 ? "text-[var(--pos-warn)]" : undefined}>
                            Tồn {r.tonTheoDonVi.toLocaleString("vi-VN")} {l.unit}
                            {r.over ? " · vượt tồn" : ""}
                          </span>
                        )}
                        {san > 0 && (
                          <>
                            {" · "}
                            <span className="font-semibold text-[var(--pos-primary-deep)]">đã xuất {san}</span>
                            {` — không giảm dưới ${san}`}
                          </>
                        )}
                        {settings.showLastPrice && l.lastPrice != null && (
                          <>
                            {" · "}
                            <span className="text-[var(--pos-primary)]">
                              giá gần nhất {formatCurrency(l.lastPrice)}
                              {l.lastBuyCount ? ` · ${l.lastBuyCount} lần mua` : ""}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    {l.note != null && l.note !== "" && (
                      <input
                        className="mt-1 h-[21px] w-full rounded border border-[var(--pos-warn-border)] bg-[var(--pos-warn-soft)] px-1.5 text-[10px] text-[var(--pos-warn)]"
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
                       * ⚠ ĐỔI ĐƠN VỊ LÀ TRA LẠI BẢNG GIÁ, không nhân chia
                       * hệ số. Bản đầu làm `giá / hệ số cũ × hệ số mới` —
                       * đúng khi bảng giá tuyến tính, SAI ngay khi NPP đặt
                       * giá thùng rẻ hơn 12 lần giá chai (chuyện thường
                       * ngày của bán sỉ). `unitPriceFor` tra đúng dòng bảng
                       * giá của đơn vị ấy.
                       */
                      const u = e.target.value
                      const p = productById(l.productId)
                      const gia = p ? unitPriceFor(p, u, groupId) : l.price
                      patchLine(l.key, {
                        unit: u,
                        price: gia,
                        listPrice: gia,
                        units: p
                          ? sellableUnits(p).map((x) => ({ unit_name: x, conversion: conversionFor(p, x) }))
                          : l.units,
                      })
                    }}
                    className="h-[30px] w-full rounded-md border border-[var(--pos-edge)] bg-white px-1 text-[12px] text-[var(--pos-ink)]"
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
                  {/*
                    ⚠ Ô GIÁ MANG CẢ CHỐT CHẶN. Viền đỏ khi ngoài hạn mức,
                      và dòng chữ dưới nói ĐÚNG con số vừa chặn — "sai
                      giá" mà không nói giá bảng là bao nhiêu thì người
                      bán sửa mò.
                  */}
                  <div>
                    <input
                      className={`n h-[30px] w-full rounded-md border px-1.5 text-right text-[13px] ${
                        r?.xauGia
                          ? "border-[var(--pos-danger)] bg-[var(--pos-danger-soft)] text-[var(--pos-danger)]"
                          : "border-[var(--pos-edge)] text-[var(--pos-ink)]"
                      } disabled:bg-[var(--pos-head)] disabled:text-[var(--pos-dim)]`}
                      aria-label={`Đơn giá dòng ${i + 1}`}
                      inputMode="numeric"
                      disabled={!canEditPrice}
                      title={canEditPrice ? undefined : "Bạn không có quyền sửa giá"}
                      value={l.price === 0 ? "0" : String(l.price)}
                      onChange={(e) =>
                        patchLine(l.key, { price: Number(e.target.value.replace(/\D/g, "")) || 0 })
                      }
                    />
                    {r?.xauGia === "below_list" && (
                      <div className="mt-px text-right text-[9.5px] font-semibold text-[var(--pos-danger)]">
                        ≥ {formatCurrency(r.giaBang)}
                      </div>
                    )}
                    {r?.xauGia === "above_ceiling" && (
                      <div className="mt-px text-right text-[9.5px] font-semibold text-[var(--pos-danger)]">
                        ≤ {formatCurrency(ceilingFor(r.giaBang, maxIncreasePct))}
                      </div>
                    )}
                    {/* ⚠ Đổi khách là đổi bảng giá — nói ra chỗ lệch. */}
                    {!r?.xauGia && r?.lechBangGia != null && (
                      <button
                        type="button"
                        onClick={() => patchLine(l.key, { price: r.lechBangGia!, listPrice: r.lechBangGia! })}
                        title="Bảng giá của khách này khác — bấm để lấy giá mới"
                        className="mt-px block w-full text-right text-[9.5px] font-semibold text-[var(--pos-warn)]"
                      >
                        bảng giá mới {formatCurrency(r.lechBangGia)}
                      </button>
                    )}
                  </div>
                  {settings.colLineDiscount && (
                    <DiscountCell
                      line={l}
                      index={i + 1}
                      onChange={(d) => patchLine(l.key, { discount: d })}
                    />
                  )}
                  {/*
                    ⚠ THUẾ THEO DÒNG — người dùng đã báo một lần ở màn cũ:
                      "bấm vào chi tiết hàng trong đơn chưa có chỗ để tuỳ
                      chọn VAT". Cùng một mặt hàng có lúc xuất có hóa đơn,
                      có lúc không. Bật/tắt cột ở drawer thiết lập.
                  */}
                  {settings.colVat && (
                    <select
                      aria-label={`Thuế GTGT dòng ${i + 1}`}
                      value={String(l.vatRate ?? 0)}
                      onChange={(e) => patchLine(l.key, { vatRate: Number(e.target.value) })}
                      className="h-[30px] w-full rounded-md border border-[var(--pos-edge)] bg-white px-1 text-[12px] text-[var(--pos-ink)]"
                    >
                      {vatChoices(l.vatRate ?? 0).map((v) => (
                        <option key={v.value} value={v.value}>{v.label}</option>
                      ))}
                    </select>
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
              reason={retReason}
              onReason={setRetReason}
            />
          )}
          {/* ⚠ Không nắm được phiếu trả (nhiều phiếu nháp / đọc hỏng) thì nói ra. */}
          {mode === "sua" && heldReturnId === undefined && retLines.length === 0 && (
            <p className="shrink-0 text-[11px] text-[var(--pos-warn)]">
              Hàng trả kèm đơn không nạp được ở đây — lưu đơn sẽ không làm nó đổi. Sửa ở màn Trả hàng.
            </p>
          )}
        </div>

        {/* ---------------- panel phải ---------------- */}
        <div className="flex min-h-0 w-[420px] shrink-0 flex-col gap-3">
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

          <PosProductSearchBox />

          <div className="flex min-h-0 flex-grow flex-col rounded-xl border border-[var(--pos-line)] bg-white p-3.5">
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
            {/* ⚠ Chỉ vẽ khi có hàng trả — một dòng "− 0" thường trực là nhiễu. */}
            {totals.returnCredit > 0 && (
              <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(totals.returnCredit)}`} tone="warn" />
            )}

            <TotalsHero label="Khách cần trả" value={totals.due} />

            <div className="mt-3.5 flex items-center justify-between gap-2.5">
              <label htmlFor="pos-tra" className="text-[13px] text-[var(--pos-muted)]">
                Khách thanh toán
              </label>
              <input
                id="pos-tra"
                className="n h-[34px] w-[150px] rounded-[7px] border border-[var(--pos-edge)] px-2.5 text-right text-[14px] font-semibold text-[var(--pos-ink)]"
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

            <div className="mt-3.5 flex items-center justify-between border-t border-[var(--pos-line-soft)] pt-3">
              <span className="text-[13px] text-[var(--pos-muted)]">Tính vào công nợ</span>
              <span className="n text-[14px] font-bold text-[var(--pos-warn)]">
                {formatCurrency(Math.max(0, totals.due - traTien))}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[11.5px] text-[var(--pos-muted)]">Nợ sau đơn này</span>
              <span className="n text-[11.5px] text-[var(--pos-muted)]">
                {/* ⚠ CHƯA BIẾT NỢ HIỆN TẠI THÌ ĐỂ TRỐNG, đừng cộng từ 0 —
                    xem `docs/pos-todo.md`. */}
                {khach?.debt == null
                  ? "chưa xác định"
                  : formatCurrency(khach.debt + Math.max(0, totals.due - traTien))}
              </span>
            </div>

            <div className="mt-3.5 flex items-center justify-between gap-2.5 border-t border-[var(--pos-line-soft)] pt-3">
              <label htmlFor="pos-ngaygiao" className="text-[13px] text-[var(--pos-muted)]">
                Ngày giao dự kiến
              </label>
              <input
                id="pos-ngaygiao"
                type="date"
                className="n h-8 w-[150px] rounded-[7px] border border-[var(--pos-edge)] px-2.5 text-right text-[12.5px] text-[var(--pos-ink)]"
                value={ngayGiao}
                onChange={(e) => setNgayGiao(e.target.value)}
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2.5">
              <label htmlFor="pos-dk" className="text-[13px] text-[var(--pos-muted)]">
                Điều khoản TT
              </label>
              <select
                id="pos-dk"
                value={dieuKhoan}
                onChange={(e) => setDieuKhoan(e.target.value)}
                className="h-8 w-[150px] rounded-[7px] border border-[var(--pos-edge)] bg-white px-2 text-[12.5px] text-[var(--pos-ink)]"
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
                {/* ⚠ In qua mẫu in của phần đang chạy — xem `posPrintHref`. */}
                <PanelButton
                  width={62}
                  disabled={!orderId}
                  title={orderId ? "Mở trang in đơn hàng" : "Lưu tạm trước rồi mới in được"}
                  onClick={() => { const h = orderId && posPrintHref("SO", orderId); if (h) window.open(h, "_blank") }}
                >
                  In
                </PanelButton>
                <PanelButton width={104} disabled={dangLuu} onClick={() => luuDon(true)}>
                  {dangLuu ? "Đang lưu…" : "Lưu tạm"}
                </PanelButton>
              </>
            )}
            {/* ⚠ Nút chính GIỮ NGUYÊN ở cả hai bản — spec §7.1. */}
            <PanelButton
              variant="primary"
              disabled={lines.length === 0 || !khach || coGiaXau || dangLuu}
              onClick={() => luuDon(false)}
              title={
                lines.length === 0
                  ? "Chưa có mặt hàng nào trong đơn"
                  : !khach
                    ? "Chưa chọn khách hàng"
                    : coGiaXau
                      ? "Có dòng đặt giá ngoài hạn mức của bạn"
                      : /* ⚠ NÚT NÀY LÀM ĐÚNG HAI VIỆC TÊN NÓ NÓI: lưu đơn
                           rồi lập hóa đơn. Hai giao dịch riêng — xem
                           `luuDon`, nhánh bước 2 hỏng. */
                        "Lưu đơn rồi xuất hàng và lập hóa đơn"
              }
            >
              {dangLuu ? "Đang lưu…" : "Xuất hàng & lập HĐ"}
            </PanelButton>
          </PanelActions>
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
