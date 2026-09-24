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

import { inTaiCho } from "@/lib/pos/print-window"
import { posNewInvoiceHref } from "@/lib/nav/pos-preview"
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MoneyInput } from "@/components/ui/money-input"
import { CompactSelect } from "@/components/ui/compact-select"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { errorMessage } from "@/lib/errors"
import { useAuth } from "@/hooks/use-auth"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { RETURN_REASONS } from "@/lib/constants"
import { useToast } from "@/hooks/use-toast"
import { buildOrderPayload } from "@/lib/sell/create-order"
import { generateOrderCode } from "@/lib/utils"
import { cartTotals, priceViolation, ceilingFor } from "@/lib/sell/cart"
import { unitPriceFor, conversionFor, sellableUnits, stockInUnit } from "@/lib/sell/pricing"
import { userPriceRulesFrom } from "@/lib/pricing"
import { isSaleLineOverstock } from "@/lib/orders/stock-check"
import { toStockLines } from "@/lib/sell/stock"
import { viMatchAllWords } from "@/lib/search"
import {
  useRegisterPosProductSearch, usePosSearchTerm, focusPosPicker,
} from "@/store/pos/product-search"
import { editableReturnOf, type PendingReturnRow } from "@/lib/sell/order-edit"
import { loadInvoiceableLines } from "@/lib/orders/post-invoice"
import { loadCustomerDebt, loadLastPrices, loadLotsByProduct, attachLineExtras } from "@/lib/pos/load"
import { savePosOrder, posLinesToCart, posLinesToReturnCart } from "@/lib/pos/save"
import { vatChungCuaDong, vatChungKeTiep } from "@/lib/pos/vat"
import { formatCurrency } from "@/lib/utils"
import { lineGross, switchUnit, type DiscountInput } from "@/lib/pos/discount"
import { doiDonViDong, doiDonViDongTra, donViHienThi } from "@/lib/pos/units"
import { posTotals } from "@/lib/pos/totals"
import type { PosBadge, PosLine } from "@/lib/pos/types"
import { usePosSettings } from "@/store/pos/settings"
import { usePosRefData } from "@/store/pos/ref-data"
import { usePosDocLabel, usePosDocCount, usePosDirty } from "@/store/pos/tabs"
import { usePosKeys } from "@/components/pos/pos-shell"
import { DocBanner } from "@/components/pos/doc-sub-header"
import {
  LineTableFrame, LineTableHeader, POS_GRID, QtyStepper, DiscountCell,
  TrashButton, UnitCycleButton, LineDetailToggle, LineDetailPanel, LineDetailField, tomTatChiTiet,
  LineAmountCell, NegativeStockStrip, VatChip,
} from "@/components/pos/line-table"
import {
  MoneyRow, DocDiscountRow, TotalsHero,
  PanelActions, PanelButton,
} from "@/components/pos/money-panel"
import { PosProductSearchBox } from "@/components/pos/product-search-box"
import { PartnerCard, type PosPartner } from "@/components/pos/partner-card"
import { SearchDropdown, type SearchItem } from "@/components/pos/search-dropdown"
import { DocPeople } from "@/components/pos/doc-people"
import { RelatedDocs } from "@/components/orders/related-docs"
import type { SellProduct } from "@/lib/sell/ref-data"

export interface OrderScreenProps {
  /** `lap` = đơn mới hoặc phiếu tạm. `sua` = đơn đã lưu, mở ra sửa. */
  mode: "lap" | "sua"
  /** `null` = đơn mới. Có mã thì nạp đơn ấy lên. */
  orderId?: string | null
}

let demDong = 0
const newKey = () => `d${++demDong}`


/**
 * Bề rộng cột của bảng HÀNG ĐỔI TRẢ — lấy nguyên từ bản thiết kế:
 *   minmax(170px,1fr) · 140 · 100 · 108 · 112 · 120 · 34
 *   Sản phẩm/đơn vị · Lý do · Số lượng · Đơn giá · Xử lý · Trừ đơn · (xoá)
 *
 * ⚠ KHÁC BẢNG BÁN. Bảng bán không có cột "Lý do" và "Xử lý"; dùng chung
 *   một bộ cột cho cả hai là một trong hai bảng lệch hẳn.
 */
/* 24/09/2026: thùng rác ra đầu dòng, đơn vị thành nút bấm-nhảy cạnh số lượng. */
const POS_RET_COLS = "34px minmax(170px,1fr) 140px 76px 100px 108px 112px 120px"

export function OrderScreen({ mode, orderId = null }: OrderScreenProps) {
  const thamSo = useSearchParams()
  const { settings, ready: settingsReady } = usePosSettings()
  const { user } = useAuth()
  const { groups } = useCustomerGroups()
  const { products, customers, stockByProduct, loading, warnings, productById, customerById } =
    usePosRefData()
  const { toast } = useToast()
  const router = useRouter()

  const [lines, setLines] = useState<PosLine[]>([])
  const [retLines, setRetLines] = useState<PosLine[]>([])
  const [retReason, setRetReason] = useState("damaged")
  /** Khối "Hàng đổi trả kèm đơn" đang mở hay đang thu gọn — bản vẽ có nút gập. */
  const [moKhoiTra, setMoKhoiTra] = useState(false)
  /** Dòng nào đang mở "chi tiết dòng" (giảm giá) — theo `key` dòng. */
  const [moChiTiet, setMoChiTiet] = useState<Set<string>>(new Set())
  const batChiTiet = (key: string) =>
    setMoChiTiet((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  /** Đang ở *chế độ thêm hàng trả*: mã chọn từ ô tìm rơi vào giỏ TRẢ. */
  const [moThemTra, setMoThemTra] = useState(false)
  /**
   * Phiếu trả nháp kèm đơn mà màn đang nắm — ba giá trị, xem
   * `applyOrderEdit`: `string` ghi đè, `null` chưa có, `undefined`
   * KHÔNG BIẾT (đọc hỏng hoặc đơn có nhiều phiếu nháp) → lúc lưu đứng yên.
   */
  const [heldReturnId, setHeldReturnId] = useState<string | null | undefined>(orderId ? undefined : null)
  const [khach, setKhach] = useState<PosPartner | null>(null)
  const [docDiscount, setDocDiscount] = useState<DiscountInput>({ value: 0, unit: "vnd" })
  const [ngayGiao, setNgayGiao] = useState("")
  const [dieuKhoan, setDieuKhoan] = useState("COD")
  const [nvbh, setNvbh] = useState("")
  /**
   * ⚠ ĐÚNG BỘ VAI TRÒ MÀ MÁY CHỦ CHO PHÉP — xem mig 153 và khối vẽ ô
   *   "Gán đơn cho NVBH" bên dưới. Để rộng hơn là vẽ ra một ô mà
   *   `WITH CHECK` của chính sách RLS sẽ từ chối bằng mã 42501, và
   *   người dùng không có cách nào đọc ra mình đã làm sai ở đâu.
   */
  const canPickSeller = user?.role === "owner" || user?.role === "manager"
  /**
   * ĐANG LÀM ĐƠN HỘ NGƯỜI KHÁC.
   *
   * ⚠ ĐƠN HỘ THÌ KHÔNG LƯU NHÁP ĐƯỢC, và đây là luật của cơ sở dữ liệu
   *   chứ không phải một quy ước giao diện. `sales_order_select` (mig
   *   119) giấu mọi đơn NHÁP không đứng tên mình — chủ nhà chốt
   *   22/09/2026 giữ nguyên luật ấy: "Tao vẫn muốn NPP ko thấy được đơn
   *   nháp của nhân viên."
   *
   *   Hệ quả: lưu một tờ nháp đứng tên nhân viên là tự tay ném nó ra
   *   khỏi tầm nhìn của chính mình. Tệ hơn, `INSERT … RETURNING` phải
   *   đọc lại hàng vừa ghi nên máy chủ ném thẳng 42501 — đúng lỗi chủ
   *   nhà gặp. Nút mờ đi là cách nói ra luật ấy TRƯỚC khi người ta bấm.
   *
   * ⚠ SO VỚI `user.id`, KHÔNG PHẢI SO VỚI RỖNG. Ô để trống nghĩa là đơn
   *   đứng tên chính mình, và đơn ấy lưu nháp bình thường. Chọn đúng
   *   tên mình cũng vậy.
   */
  const donHo = !!nvbh && nvbh !== user?.id
  /* ⚠ TỪ KHOÁ TÌM HÀNG NẰM Ở KHUNG, không ở màn — ô nhập ở header. */
  const moTimHang = usePosSearchTerm()
  const [moTimKhach, setMoTimKhach] = useState(false)
  const [orderCode, setOrderCode] = useState<string | null>(null)
  /** Người lập đơn — `sales_orders.created_by` (mig 178). `null` = chưa rõ. */
  const [nguoiTao, setNguoiTao] = useState<string | null>(null)
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

  /** Bậc thuế chung của mọi dòng, `null` khi chúng lệch nhau. */
  const vatChung = useMemo(() => vatChungCuaDong(lines), [lines])

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
    /**
     * ⚠ CỘT LẤY ĐÚNG BẢN THIẾT KẾ CHỦ NHÀ ĐƯA:
     *     34px · minmax(170px,1fr) · 100px · 108px · 128px · 74px · 120px · 60px
     *     #   · Sản phẩm / đơn vị · Số lượng · Đơn giá · Giảm giá · VAT · Thành tiền · (xoá)
     *
     * ⚠ CỘT CUỐI RỘNG HƠN BẢN VẼ (60px thay vì 34px) và đó là cố ý: bản
     *   vẽ ghi nó là cột "(xoá)" nhưng ở đây nó còn mang cả nút `⋮` với
     *   bốn thao tác khác. Hai nút không nhét vừa 34px.
     *
     * ⚠ MÃ HÀNG VÀ ĐƠN VỊ KHÔNG CÒN LÀ CỘT RIÊNG. Bản vẽ gộp cả hai vào
     *   ô "Sản phẩm / đơn vị": mã SKU nằm ở dòng phụ, còn đơn vị là một
     *   dải CHIP bấm được. Bản trước của tôi tách chúng thành hai cột
     *   88px và 76px — thành ra bảng chín cột, hẹp hơn hẳn ở cột tên, và
     *   khác bản vẽ.
     *
     * ⚠ HAI THIẾT LẬP `colSku` / `colStock` VẪN CÒN TÁC DỤNG, chỉ đổi
     *   chỗ: nay chúng bật/tắt dòng phụ TRONG ô tên, không bật/tắt một
     *   cột. Bỏ chúng đi là lấy mất một thứ chủ nhà đã chốt ở drawer
     *   thiết lập hiển thị.
     */
    /**
     * ⚠ CHỦ NHÀ CHỐT LẠI 24/09/2026: thùng rác ra ĐẦU dòng; đơn vị là nút
     *   bấm-nhảy CẠNH số lượng; Giảm giá và VAT rời khỏi dòng, vào "chi tiết
     *   dòng" mở bằng nút cuối dòng. Cột:
     *     (xoá) · # · Sản phẩm · Đơn vị · Số lượng · Đơn giá · Thành tiền · (chi tiết)
     */
    const c: Array<{ w: string; label: string; align?: "left" | "center" | "right" }> = []
    c.push({ w: "34px", label: "" })
    if (settings.colIndex) c.push({ w: "28px", label: "#", align: "center" })
    c.push({ w: "minmax(170px,1fr)", label: "Sản phẩm" })
    c.push({ w: "76px", label: "Đơn vị", align: "center" })
    c.push({ w: "100px", label: "Số lượng", align: "center" })
    c.push({ w: "108px", label: "Đơn giá", align: "right" })
    c.push({ w: "120px", label: "Thành tiền", align: "right" })
    c.push({ w: "34px", label: "" })
    return {
      cols: c.map((x) => x.w).join(" "),
      cells: c.map((x) => ({ label: x.label, align: x.align })),
    }
  }, [settings.colIndex])

  /**
   * ĐỔI ĐƠN VỊ CỦA MỘT DÒNG.
   *
   * ⚠ TRA LẠI BẢNG GIÁ, KHÔNG NHÂN CHIA HỆ SỐ. Nhân giá cũ với tỉ lệ
   *   quy đổi chỉ đúng khi bảng giá tuyến tính, và SAI ngay khi NPP đặt
   *   giá thùng rẻ hơn 12 lần giá chai — chuyện thường ngày của bán sỉ.
   *   `unitPriceFor` tra đúng dòng bảng giá của đơn vị ấy, theo nhóm
   *   khách đang chọn.
   */
  const doiDonVi = useCallback(
    (l: PosLine, u: string) => {
      patchLine(l.key, doiDonViDong(l, u, productById(l.productId), groupId))
    },
    [productById, groupId, patchLine]
  )

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
          /* ⚠ THUẾ LÀ CỦA CẢ ĐƠN (chủ nhà 24/09/2026: bỏ VAT từng dòng) — dòng mới
             theo thuế các dòng đang có; đơn còn trống thì lấy thuế mặt hàng (tỉ lệ 0,1). */
          vatRate: cu.length > 0 && vatChungCuaDong(cu) !== null ? (vatChungCuaDong(cu) as number) : Number(p.vat_rate) || 0,
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
  /**
   * ⚠ NGƯỜI TẠO ĐỌC RIÊNG, HỎNG THÌ BỎ QUA. Cột `created_by` do mig 178
   *   thêm; gộp vào câu nạp đơn là quên chạy migration một lần thì cả màn
   *   sửa đơn không mở được — chỉ vì một dòng chữ "Người tạo".
   */
  useEffect(() => {
    if (!orderId) return
    let huy = false
    createClient().from("sales_orders").select("created_by").eq("id", orderId).maybeSingle()
      .then(({ data }) => { if (!huy) setNguoiTao((data as { created_by?: string | null } | null)?.created_by ?? null) })
    return () => { huy = true }
  }, [orderId])

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
            .select("id, reason, notes, status, invoice_id, lines:return_lines(product_id, unit_name, quantity, unit_price, vat_rate, is_exchange, note, reason)")
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
              /* ⚠ THUẾ CỦA DÒNG ĐƠN (mig 183), không phải thuế danh mục —
                 đơn cũ chưa có thì RPC tự rơi về thuế mặt hàng. */
              vatRate: Number(r.vatRate) || 0,
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
                /* ⚠ `return_lines` không lưu hệ số — lúc vẽ lấy của danh mục
                   (`donViHienThi`), đừng đặt 1. Giá đã chốt trên phiếu: đổi
                   đơn vị thì đi theo hệ số (`doiDonViDongTra`). */
                units: [],
                qty: Number(l.quantity) || 0,
                price: Number(l.unit_price) || 0,
                discount: { value: 0, unit: "vnd" as const },
                isExchange: l.is_exchange === true,
                giaTheoHoaDon: true,
                note: l.note ?? undefined,
                /* ⚠ LÝ DO TỪNG DÒNG PHẢI NẠP (24/09/2026): lưu đơn là xoá rồi
                   chèn lại dòng trả — không nạp là xoá mất lý do đã chọn. */
                ...(l.reason ? { reason: l.reason } : {}),
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

  /**
   * KHÁCH ĐI KÈM ĐƯỜNG DẪN — `/pos/don-hang/moi?customerId=…`.
   *
   * ⚠ ĐƯỜNG TẮT "TẠO ĐƠN CHO KHÁCH NÀY" PHẢI GIỮ ĐƯỢC KHÁCH. Nút ấy ở
   *   hồ sơ khách, danh sách khách và tuyến thăm; mất tham số là bắt
   *   nhân viên đang đứng trước cửa hàng đi tìm lại tên khách trong một
   *   danh sách vài nghìn dòng. Chính vì thế màn `/sell` cũ mới mang
   *   theo `customerId`, và cú chuyển hướng sang POS phải mang tiếp.
   *
   * ⚠ CHỈ NẠP MỘT LẦN, VÀ CHỈ CHO ĐƠN MỚI. Nạp lại ở mỗi lần vẽ là
   *   người dùng đổi khách xong bị kéo ngược về khách cũ; nạp cho đơn
   *   đã lưu là đè lên khách thật của đơn ấy.
   *
   * ⚠ CHỜ DANH MỤC VỀ RỒI MỚI ĐẶT. Đặt lúc `customers` còn rỗng thì
   *   `customerById` trả rỗng, thẻ khách hiện một cái tên trống và
   *   bảng giá rơi về bảng chung — sai giá ngay từ dòng đầu tiên.
   */
  const daNapKhachTheoLink = useRef(false)
  useEffect(() => {
    if (daNapKhachTheoLink.current) return
    if (orderId || customers.length === 0) return
    const id = (thamSo.get("customerId") ?? "").trim()
    if (!id) return
    const kh = customerById(id)
    if (!kh) return
    daNapKhachTheoLink.current = true
    setKhach({
      id: kh.id,
      name: kh.store_name,
      meta: [kh.phone, kh.address].filter(Boolean).join(" · "),
    })
  }, [orderId, customers.length, customerById, thamSo])

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

  usePosDocCount(lines.length)

  /**
   * PHÍM TẮT — BỘ PHÍM CỦA BẢN THIẾT KẾ, không phải bộ cũ.
   *
   * Bản vẽ ghi ba chỗ: nút "Thêm sản phẩm (F2)", nút "Lưu nháp (F6)",
   * và dòng chân bảng "Enter thêm dòng · F6 lưu nháp · F9 gửi đơn".
   *
   * ⚠ `F9` ĐỔI NGHĨA, VÀ ĐÂY LÀ CHỖ NGUY. Trước đây nó thêm một dòng
   *   HÀNG ĐỔI; nay nó GỬI ĐƠN. Ai quen tay bấm F9 để thêm dòng sẽ gửi
   *   nhầm cả tờ đơn. Vì vậy nút gửi vẫn đi qua đúng `luuDon(false)`
   *   với đủ mọi phép chặn của nó (chưa có khách, giá ngoài hạn mức,
   *   đơn rỗng) — phím không được là một đường tắt bỏ qua phép chặn.
   *
   * ⚠ `F8` GIỮ NGUYÊN nghĩa "thêm dòng hàng trả" vì bản vẽ không nhắc
   *   tới nó, và khối hàng trả vẫn cần một đường bàn phím.
   *
   * ⚠ `F3` GIỮ LÀM BÍ DANH của `F2` — thói quen tay của người đang dùng.
   */
  /** Đơn đã gửi (không còn nháp) — bộ nút đổi thành In · Tạo hoá đơn · Lưu. */
  const daGui = !!orderId && orderStatus !== "draft"
  /** Có thay đổi trên màn chưa ghi xuống — xem `usePosDirty`. */
  const chuaLuuThayDoi = mocChuaLuu !== null && chuKy !== mocChuaLuu
  /** Không còn gì để xuất: đơn hoàn thành / đã đóng. */
  const daXuatHet = orderStatus === "completed" || orderStatus === "closed"

  usePosKeys({
    F2: focusPosPicker,
    F3: focusPosPicker,
    F4: () => setMoTimKhach(true),
    /* ⚠ PHÍM PHẢI THEO ĐÚNG ĐIỀU KIỆN CỦA NÚT. Nút mờ mà phím vẫn chạy
       thì cái mờ ấy chỉ là trang trí — xem `donHo`. */
    /* ⚠ Đơn ĐÃ GỬI không có "Lưu nháp" — F6 lúc ấy là kéo đơn về nháp. */
    F6: () => { if (!dangLuu && lines.length > 0 && !donHo && !daGui) void luuDon(true) },
    F8: () => setRetLines((c) => [...c, emptyReturnLine(false)]),
    F9: () => {
      if (dangLuu || lines.length === 0 || !khach || coGiaXau) return
      /* Đơn đã gửi: F9 = nút "Lưu", chỉ chạy khi có thay đổi. */
      if (daGui && !chuaLuuThayDoi) return
      void luuDon(false)
    },
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
  /**
   * CHỌN MỘT MÃ TỪ Ô TÌM — rơi vào GIỎ NÀO là do `moThemTra` quyết.
   *
   * ⚠ MÀN NÀY CÓ HAI GIỎ VÀ MỘT Ô TÌM, y như màn phiếu trả. Bản thiết
   *   kế dựng đúng cơ chế ấy: bấm "+ Thêm hàng trả" là vào *chế độ thêm
   *   hàng trả*, rồi tìm ở khung bên phải, kết quả rơi vào danh sách
   *   trả; bấm "Xong" thì về lại giỏ bán.
   *
   * ⚠ GÕ NHẦM GIỎ Ở ĐÂY LÀ LỆCH CHIỀU TIỀN: một món khách MUA bị ghi
   *   thành một món khách TRẢ, và tổng đơn tụt xuống mà không ai thấy
   *   vì số dòng vẫn đúng. Vì vậy chế độ đang bật phải HIỆN RA — dải
   *   xanh trên khối hàng trả, và `note` trên chính ô tìm.
   */
  const chonHang = useCallback(
    (p: SellProduct) => {
      if (!moThemTra) { addProduct(p.id); return }
      setRetLines((cu) => [
        ...cu,
        {
          ...emptyReturnLine(false),
          productId: p.id,
          name: p.name,
          sku: p.sku ?? "",
          unit: sellableUnits(p)[0],
          units: sellableUnits(p).map((x) => ({ unit_name: x, conversion: conversionFor(p, x) })),
          qty: 1,
          price: unitPriceFor(p, sellableUnits(p)[0], groupId),
          reason: retReason,
        },
      ])
    },
    [moThemTra, addProduct, groupId, retReason]
  )

  /* ⚠ Ô TÌM HÀNG VẼ Ở CỘT PHẢI — màn chỉ đưa danh mục và việc cần làm lên.
     Xem `src/store/pos/product-search.tsx`. */
  useRegisterPosProductSearch({
    items: mucHang,
    onPick: chonHang,
    disabled: loading,
    placeholder: moThemTra
      ? "Tìm hàng KHÁCH TRẢ LẠI…"
      : "Tên hàng, mã SKU hoặc mã vạch…",
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
   * SỐ TIỀN ĐƠN NÀY ĐƯA KHÁCH VƯỢT HẠN MỨC — `null` = không vượt, hoặc
   * chưa đủ dữ kiện để nói.
   *
   * ⚠ CHƯA ĐỌC ĐƯỢC NỢ HIỆN TẠI THÌ IM, ĐỪNG ĐOÁN. `khach.debt` rỗng
   *   nghĩa là chưa đọc được (xem `loadCustomerDebt` — nó trả `null`
   *   khi lỗi hoặc khi danh sách bị PostgREST cắt). Coi rỗng là 0 rồi
   *   kết luận "chưa vượt" là trấn an bằng một con số không có thật.
   *
   * ⚠ HẠN MỨC 0 NGHĨA LÀ KHÔNG ĐẶT, không phải "cấm nợ một đồng".
   */
  const vuotHanMuc: number | null = (() => {
    const hanMuc = Number(customerById(khach?.id)?.credit_limit ?? 0)
    if (!khach || hanMuc <= 0 || khach.debt == null) return null
    /* ⚠ ĐƠN CHƯA THU ĐỒNG NÀO. Màn này là màn ĐẶT HÀNG — tiền thu
       lúc lập hóa đơn, không phải ở đây (chủ nhà chốt 22/09/2026, gỡ
       hẳn khối thanh toán). Nên nợ sau đơn = nợ hiện tại + cả tờ đơn. */
    const sauDon = khach.debt + totals.due
    return sauDon > hanMuc ? sauDon - hanMuc : null
  })()

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
        /**
         * TIỀN GHI XUỐNG SỔ PHẢI LÀ ĐÚNG SỐ MÀN HÌNH VỪA HIỆN.
         *
         * ⚠ HAI PHÉP CỘNG TIỀN SONG SONG, VÀ BẢN TRƯỚC GỬI NHẦM CÁI KHÔNG
         *   BIẾT GÌ. Panel bên phải tính bằng `posTotals` — có trừ hàng
         *   trả, có trừ giảm giá đơn. Tải trọng thì dựng bằng
         *   `cartTotals(cart)` trần, mà `cart` CHỈ có dòng bán. Hậu quả
         *   đúng như chủ nhà báo 22/09/2026: đơn có hàng trả, panel ghi
         *   "Khách cần trả 78.000" nhưng sổ ghi `total = 328.000`, và
         *   màn chi tiết đơn không có dòng "Trừ hàng trả" nào — vì nó suy
         *   khoản trừ ra từ `subtotal + vat − total`, mà hiệu ấy bằng 0.
         *
         * ⚠ GIẢM GIÁ ĐƠN CŨNG RƠI Ở ĐÚNG CHỖ NÀY. `cartTotals` không có
         *   khái niệm giảm giá cấp chứng từ, nên ô "Giảm giá đơn" của
         *   panel là một lời hứa suông: gõ vào, thấy tổng tụt, lưu xong
         *   sổ không ghi đồng nào. Chủ nhà chưa báo, nhưng nó là CÙNG
         *   một dòng mã và cùng một kiểu sai.
         *
         * ⚠ VAT TÍNH TRÊN GIÁ DÒNG, TRƯỚC GIẢM GIÁ ĐƠN. Chia khoản giảm
         *   cấp chứng từ ngược về từng dòng để hạ chân thuế là một phép
         *   phân bổ có nhiều cách làm; khoản giảm đơn ở đây đối xử như
         *   một khoản trừ SAU thuế. Nói ra để không ai tưởng là sót.
         */
        const tongGoc = cartTotals(cart, totals.returnCredit)
        const subtotalSauGiamDon = Math.max(0, tongGoc.subtotal - totals.docDiscount)
        const tienDon = {
          ...tongGoc,
          subtotal: subtotalSauGiamDon,
          discount: tongGoc.discount + totals.docDiscount,
          grandTotal: Math.max(
            0,
            subtotalSauGiamDon + tongGoc.vat - tongGoc.returnCredit
          ),
        }
        const payload = buildOrderPayload({
          clientRequestId: clientRequestId.current,
          orderCode: orderCode || generateOrderCode(),
          customerId: khach.id,
          customerName: khach.name,
          paymentTerms: dieuKhoan,
          expectedDelivery: ngayGiao || null,
          notes: "",
          cart,
          totals: tienDon,
          createdAt: new Date().toISOString(),
          /* ⚠ HÀNG TRẢ KÈM ĐƠN ĐI XUỐNG THẬT. Bản đầu gửi `[]` trong khi
             panel vẫn trừ "Trừ hàng trả" vào số khách cần trả — người
             dùng thấy một tổng mà sổ không ghi. */
          /**
           * ⚠ LÝ DO CỦA CẢ PHIẾU LẤY TỪ DÒNG ĐẦU CÓ LÝ DO RIÊNG.
           *   `returns.reason` là cột NOT-NULL-ish có CHECK, và từ mig
           *   159 mỗi dòng đã có lý do của nó. Ghim cứng "damaged" như
           *   bản trước là mọi phiếu trả trong sổ đều mang một lý do
           *   chưa ai chọn — và đó chính là con số các báo cáo đọc.
           */
          returnReason:
            retLines.find((l) => !l.isExchange && l.reason)?.reason ?? retReason,
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
          /* ⚠ RỖNG = ĐƠN SẠCH, và phải là chuỗi rỗng chứ không phải
             `null` — xem `savePosOrder`. Đơn vượt hạn mức thì nói ra,
             vì đó là thứ NPP phải ngó trước khi xuất hàng. */
          approvalReason:
            vuotHanMuc != null
              ? `Vượt hạn mức công nợ ${formatCurrency(vuotHanMuc)} — cần quản lý duyệt`
              : "",
        })
        setMocChuaLuu(chuKy)
        if (asDraft) {
          toast({ title: orderId ? `Đã lưu thay đổi ${r.orderCode}` : `Đã lưu đơn ${r.orderCode}` })
          if (!orderId) router.replace(`/pos/don-hang/${r.orderId}`)
          return
        }

        /**
         * ⚠ GỬI ĐƠN DỪNG Ở ĐÂY — KHÔNG LẬP HÓA ĐƠN. Bản trước gọi tiếp
         *   `savePosInvoice` ngay sau khi ghi đơn, tức trừ kho và sinh
         *   công nợ tại màn đặt hàng. Chủ nhà chốt 22/09/2026 làm theo
         *   `/sell`: gửi đơn chỉ đưa đơn sang Phiếu tạm.
         *
         * ⚠ ĐỪNG NỐI LẠI. Ghi đơn và ghi hóa đơn là HAI giao dịch riêng
         *   của hệ đang chạy, không có lệnh nào gộp chúng — nối lại là
         *   dựng lại đúng cảnh "đơn đã lưu nhưng hóa đơn hỏng", một
         *   trạng thái nửa vời mà người dùng phải tự gỡ.
         */
        toast({ title: `Đã gửi đơn ${r.orderCode}`, description: "Đơn đang ở Phiếu tạm — xuất hàng ở màn Xuất hàng." })
        router.replace(`/pos/don-hang/${r.orderId}`)
      } catch (e) {
        /* ⚠ `errorMessage` — lỗi PostgREST là OBJECT THƯỜNG, không phải
           `Error`. `err instanceof Error ? … : "Lỗi không xác định"` nuốt
           sạch câu máy chủ vừa nói. */
        toast({ title: "Chưa lưu được", description: errorMessage(e), variant: "destructive" })
      } finally {
        setDangLuu(false)
      }
    },
    /* ⚠ `totals` VÀ `vuotHanMuc` PHẢI NẰM TRONG DANH SÁCH. Thiếu chúng
       là `luuDon` giữ bản `totals` của lần vẽ trước: thêm một dòng
       hàng trả rồi bấm F9 ngay là đơn ghi xuống bằng con số CŨ — sai
       tiền, và sai đúng kiểu không ai nhìn ra. */
    [user, khach, lines, retLines, retReason, heldReturnId, chuKy, orderCode, dieuKhoan, ngayGiao, nvbh, orderId, productById, coGiaXau, canEditPrice, maxIncreasePct, router, toast, totals.docDiscount, totals.returnCredit, vuotHanMuc]
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

  /**
   * PHỤ ĐỀ DƯỚI TIÊU ĐỀ — bản thiết kế ghi `{{ orderLabel }} · {{ priceListName }}`.
   *
   * ⚠ BẢNG GIÁ PHẢI HIỆN RA, vì đơn này tính tiền theo nó. Khách nhóm
   *   sỉ và khách lẻ ra hai giá khác nhau cho cùng một mã (xem
   *   `unitPriceFor`); người lập đơn phải đọc được mình đang ở bảng
   *   nào TRƯỚC khi gõ số, không phải sau khi khách thắc mắc.
   *
   * ⚠ CHƯA CHỌN KHÁCH THÌ NÓI "chưa chọn khách", không nói "Bảng giá
   *   chung". Giá lúc ấy đúng là giá chung, nhưng nó sẽ ĐỔI ngay khi
   *   chọn khách — hứa một bảng giá rồi đổi là tệ hơn im lặng.
   */
  const tenBangGia = !khach
    ? "chưa chọn khách"
    : groups.find((g) => g.id === groupId)?.name ?? "bảng giá chung"


  /* ⚠ `issuedCode` PHẢI CÒN TRONG CÂU NÀY. Nó là mã hóa đơn đã xuất
     của đơn đang sửa — thông tin duy nhất cho biết đơn này đã rời kho
     một lần rồi. Bỏ nó đi là người sửa đơn không biết mình đang sửa
     một tờ đã có hàng đi ra. */
  const nhanDon = [
    mode === "lap" ? "Tạo offline · chưa kiểm tồn" : orderCode || "Đơn mới",
    badgeThat?.label ? badgeThat.label.toLowerCase() : null,
    issuedCode ? `đã xuất ${issuedCode}` : null,
    `bảng giá ${tenBangGia}`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <>
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
            ⚠ KHỐI TIÊU ĐỀ NẰM TRONG CỘT TRÁI, KHÔNG PHẢI MỘT THANH
              NGANG CẢ MÀN. Bản thiết kế chủ nhà đưa vẽ đúng như vậy:
              `<h1>` 22px nằm trong `<section>` cột trái, cùng hàng với
              hai nút "Thêm sản phẩm (F2)" và "Xoá tất cả".

              Bản trước của tôi dùng `DocSubHeader` — một thanh 56px
              chạy hết bề ngang phía trên hai cột. Nó không sai về chức
              năng nhưng KHÁC bản vẽ, và chủ nhà đã chốt làm đúng bản vẽ.
              Bốn màn còn lại (không có trong bản vẽ) vẫn dùng
              `DocSubHeader`.
          */}
          <div className="flex min-w-0 shrink-0 items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="whitespace-nowrap text-[22px] font-extrabold tracking-[-0.3px] text-[var(--pos-ink)]">
                {mode === "sua" ? "Sửa đơn hàng" : "Đơn hàng"}{" "}
                <span className="text-[15px] font-bold text-[var(--pos-muted)]">
                  · <span className="n">{lines.length}</span> dòng
                </span>
              </h1>
              <p className="mt-1 truncate text-[13px] font-semibold text-[var(--pos-muted)]">
                {nhanDon}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* ⚠ Nút này KHÔNG phải ô tìm thứ hai — nó đưa tiêu điểm
                  sang ô duy nhất ở cột phải. Xem `product-search-box`. */}
              <button
                type="button"
                onClick={focusPosPicker}
                className="h-9 rounded-[10px] border-[1.5px] border-[var(--pos-edge)] bg-white px-3.5 text-[13px] font-bold text-[var(--pos-ink)] hover:border-[var(--pos-primary-border)]"
              >
                Thêm sản phẩm (F2)
              </button>
              {/*
                ⚠ XOÁ TẤT CẢ HỎI LẠI MỘT LẦN. Màn này không có bản nháp
                  — không gì được ghi xuống cho tới nút cuối — nên một cú
                  bấm nhầm là mất cả tờ đơn đã gõ tay.
              */}
              <button
                type="button"
                disabled={lines.length === 0}
                onClick={() => {
                  if (lines.length === 0) return
                  if (!window.confirm(`Xoá cả ${lines.length} dòng hàng khỏi đơn này?`)) return
                  setLines([])
                }}
                className={`h-9 rounded-[10px] px-3 text-[13px] font-extrabold ${
                  lines.length === 0
                    ? "cursor-not-allowed text-[var(--pos-dim)]"
                    : "text-[var(--pos-danger)] hover:bg-[var(--pos-danger-soft)]"
                }`}
              >
                Xoá tất cả
              </button>
            </div>
          </div>

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
                {/*
                  ⚠ CHÂN BẢNG CỦA BẢN THIẾT KẾ: một bên là gợi ý phím,
                    một bên là TIỀN HÀNG. Con số này lặp lại "Tạm tính"
                    ở cột phải, và đó là CHỦ Ý của bản vẽ — mắt người
                    đang gõ số lượng ở cột trái không phải chạy sang cột
                    kia để biết đơn đang bao nhiêu.
                */}
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--pos-line-soft)] bg-[var(--pos-head)] px-3.5 py-2.5">
                  <span className="whitespace-nowrap text-[12px] font-bold text-[var(--pos-muted)]">
                    Enter thêm dòng · F6 lưu nháp · F9 gửi đơn
                  </span>
                  <span className="flex items-baseline gap-2.5 whitespace-nowrap text-[13px] font-bold text-[var(--pos-muted)]">
                    Tiền hàng
                    <span className="n text-[18px] font-extrabold text-[var(--pos-ink)]">
                      {/* Tiền hàng = tổng dòng ĐÃ trừ giảm giá dòng, CHƯA trừ giảm giá cả đơn. */}
                      {formatCurrency(totals.gross - totals.lineDiscount)}
                    </span>
                  </span>
                </div>
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
                      Thêm hàng <span className="n text-[12px] opacity-75">F2</span>
                    </button>
                  </>
                )}
              </div>
            )}

            {lines.map((l, i) => {
              /* ⚠ SÀN = SỐ ĐÃ XUẤT. Ràng buộc duy nhất của màn sửa. */
              const san = mode === "sua" ? Math.max(0, Number(l.issued) || 0) : 0
              const r = rows[i]
              const moCT = moChiTiet.has(l.key)
              /* ⚠ KHÔNG CÒN VAT TỪNG DÒNG (chủ nhà 24/09/2026: "Bỏ VAT từng dòng cả ở
                 POS") — thuế đặt một lần ở khối tiền cho cả đơn. */
              const tomTat = tomTatChiTiet({ discount: l.discount })
              return (
                <Fragment key={l.key}>
                <div
                  data-testid="dong-don"
                  className={`grid min-h-[64px] items-center border-b border-[var(--pos-line-soft)] px-4 py-2 ${
                    r?.over ? "bg-[var(--pos-danger-soft)]" : ""
                  }`}
                  style={{ gridTemplateColumns: cot.cols, gap: POS_GRID.order.gap }}
                >
                  {/* ⚠ THÙNG RÁC ĐẦU DÒNG (chủ nhà 24/09/2026) — một cú bấm là xoá. */}
                  <TrashButton
                    label={`Xoá dòng ${i + 1}`}
                    onClick={() => setLines((c) => c.filter((x) => x.key !== l.key))}
                  />
                  {settings.colIndex && (
                    <div className="n text-center text-[13px] font-bold text-[var(--pos-dim)]">{i + 1}</div>
                  )}
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[13px] font-bold leading-tight text-[var(--pos-ink)]">{l.name}</span>
                      {settings.colSku && l.sku && (
                        <span className="n shrink-0 text-[11px] font-semibold text-[var(--pos-dim)]">{l.sku}</span>
                      )}
                    </div>
                    {/*
                      ⚠ GHI CHÚ TỪNG DÒNG HÀNG — chỗ duy nhất người bán ghi được
                        "giao chiều", "lấy lô mới"… đi theo ĐÚNG một mặt hàng.
                        Gạch chân nét đứt để nó chìm xuống.
                    */}
                    <input
                      aria-label={`Ghi chú dòng ${i + 1}`}
                      value={l.note ?? ""}
                      onChange={(e) => patchLine(l.key, { note: e.target.value })}
                      placeholder="Ghi chú dòng…"
                      className={`mt-1 h-[28px] w-full min-w-0 border-0 border-b border-dashed bg-transparent px-0.5 text-[12px] font-semibold text-[var(--pos-ink)] outline-none placeholder:text-[var(--pos-dim)] ${
                        l.note ? "border-[var(--pos-primary-border)]" : "border-[var(--pos-edge)]"
                      }`}
                    />
                    <div className="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-[var(--pos-muted)]">
                      {settings.colStock && (
                        /* ⚠ TỒN THEO ĐƠN VỊ CỦA DÒNG; chưa đọc được thì nói thế, đừng ghi "Tồn 0". */
                        r?.tonTheoDonVi == null ? (
                          <span className="text-[var(--pos-dim)]">tồn chưa xác định</span>
                        ) : (
                          <span className={r.over ? "font-semibold text-[var(--pos-danger)]" : r.tonTheoDonVi <= 0 ? "text-[var(--pos-warn)]" : undefined}>
                            Tồn {r.tonTheoDonVi.toLocaleString("vi-VN")} {l.unit}
                            {r.over ? " · vượt tồn" : ""}
                          </span>
                        )
                      )}
                      {san > 0 && (
                        <span>
                          <span className="font-semibold text-[var(--pos-primary-deep)]">đã xuất {san}</span>
                          {` — không giảm dưới ${san}`}
                        </span>
                      )}
                      {settings.showLastPrice && l.lastPrice != null && (
                        <span className="text-[var(--pos-primary)]">
                          giá gần nhất {formatCurrency(l.lastPrice)}
                          {l.lastBuyCount ? ` · ${l.lastBuyCount} lần mua` : ""}
                        </span>
                      )}
                      {/* Chi tiết đang gập mà có giá trị → hiện tóm tắt, bấm để mở. */}
                      {tomTat && !moCT && (
                        <button
                          type="button"
                          onClick={() => batChiTiet(l.key)}
                          className="rounded-md bg-[var(--pos-primary-faint)] px-1.5 py-px font-bold text-[var(--pos-primary-deep)]"
                        >
                          {tomTat}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* ⚠ ĐƠN VỊ CẠNH SỐ LƯỢNG, BẤM LÀ NHẢY — đổi đơn vị là tra lại bảng giá (`doiDonVi`). */}
                  <UnitCycleButton
                    units={donViHienThi(l, productById(l.productId)).map((u) => u.unit_name)}
                    value={l.unit}
                    label={`dòng ${i + 1}`}
                    onChange={(u) => doiDonVi(l, u)}
                  />
                  <QtyStepper
                    label={`số lượng dòng ${i + 1}`}
                    value={l.qty}
                    min={san}
                    onChange={(v) => patchLine(l.key, { qty: v })}
                  />
                  {/*
                    ⚠ Ô GIÁ MANG CẢ CHỐT CHẶN. Viền đỏ khi ngoài hạn mức, và dòng
                      chữ dưới nói ĐÚNG con số vừa chặn.
                  */}
                  <div>
                    <MoneyInput
                      showSuffix={false}
                      inputClassName={`n h-[30px] w-full rounded-md border px-1.5 text-right text-[13px] ${
                        r?.xauGia
                          ? "border-[var(--pos-danger)] bg-[var(--pos-danger-soft)] text-[var(--pos-danger)]"
                          : "border-[var(--pos-edge)] text-[var(--pos-ink)]"
                      } disabled:bg-[var(--pos-head)] disabled:text-[var(--pos-dim)] py-0 lg:h-[30px] focus-visible:ring-1 focus-visible:ring-offset-0`}
                      aria-label={`Đơn giá dòng ${i + 1}`}
                      disabled={!canEditPrice}
                      title={canEditPrice ? undefined : "Bạn không có quyền sửa giá"}
                      value={l.price}
                      onChange={(v) => patchLine(l.key, { price: v })}
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
                  <LineAmountCell line={l} />
                  <LineDetailToggle index={i + 1} open={moCT} dot={!!tomTat} onToggle={() => batChiTiet(l.key)} />
                </div>
                {/*
                  ⚠ CHI TIẾT DÒNG — GIẢM GIÁ (chủ nhà 24/09/2026: "cho vào chi tiết
                    dòng, bấm vào mới hiện lên trên dòng"). VAT không còn ở mức dòng.
                */}
                {moCT && (
                  <LineDetailPanel testId="chi-tiet-dong">
                    <LineDetailField label="Giảm giá" width={190}>
                      <DiscountCell line={l} index={i + 1} onChange={(d) => patchLine(l.key, { discount: d })} />
                    </LineDetailField>
                  </LineDetailPanel>
                )}
                </Fragment>
              )
            })}
          </LineTableFrame>

          {/*
            ====================================================
            HÀNG ĐỔI TRẢ KÈM ĐƠN — dựng theo đúng bản thiết kế.
            ====================================================

            ⚠ MỘT THẺ RIÊNG, THU GỌN ĐƯỢC. Bản vẽ để nó gập lại mặc
              định: phần lớn đơn KHÔNG có hàng trả, và một bảng rỗng
              chiếm chỗ dưới bảng bán là thứ mắt phải bỏ qua mỗi lần.

            ⚠ VIỀN ĐỔI MÀU KHI CÓ HÀNG TRẢ — `returnBlockBorder` của bản
              vẽ. Một tờ đơn có trừ tiền hàng trả phải nhìn ra được từ
              xa, vì nó là tờ dễ sai nhất.
          */}
          <div
            className={`shrink-0 overflow-hidden rounded-[14px] border bg-white ${
              retLines.length > 0 ? "border-[var(--pos-warn-border)]" : "border-[var(--pos-line)]"
            }`}
          >
            <div className="flex min-w-0 items-center gap-3 px-3.5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-extrabold text-[var(--pos-ink)]">
                  Hàng đổi trả kèm đơn
                </span>
                <span className="mt-0.5 block truncate text-[12px] font-semibold text-[var(--pos-muted)]">
                  {retLines.length === 0
                    ? "Không có"
                    : `${retLines.length} dòng · trừ ${formatCurrency(totals.returnCredit)}`}
                </span>
              </span>
              <button
                type="button"
                onClick={() => { setMoKhoiTra(true); setMoThemTra(true); focusPosPicker() }}
                className="h-[34px] shrink-0 whitespace-nowrap rounded-[10px] border-[1.5px] border-[var(--pos-edge)] bg-white px-3 text-[13px] font-bold text-[var(--pos-ink)]"
              >
                + Thêm hàng trả
              </button>
              <button
                type="button"
                onClick={() => setMoKhoiTra((v) => !v)}
                className="h-[34px] shrink-0 whitespace-nowrap px-2.5 text-[13px] font-extrabold text-[var(--pos-primary-deep)]"
              >
                {moKhoiTra ? "Thu gọn" : "Mở ra"}
              </button>
            </div>

            {moKhoiTra && (
              <div className="min-w-0 border-t border-[var(--pos-line-soft)]">
                {/*
                  ⚠ DẢI BÁO CHẾ ĐỘ ĐÃ DỜI SANG Ô TÌM Ở CỘT PHẢI — xem
                    `<PosProductSearchBox note=…>` bên dưới trong tệp
                    này. Ở đây từng có một dải xanh nói y hệt; giữ cả hai
                    là hai chỗ nói cùng một câu trên cùng một màn, và
                    chỗ nói ở cột trái thì người đang quét mã không nhìn.
                    Khối này vẫn tự nói được: viền đổi màu khi có hàng
                    trả, và chân khối ghi số dòng.
                */}
                {retLines.length === 0 ? (
                  <p className="px-3.5 py-[22px] text-center text-[13px] font-semibold text-[var(--pos-muted)]">
                    Chưa có hàng đổi trả. Bấm <b>+ Thêm hàng trả</b> rồi quét/tìm sản phẩm ở
                    khung bên phải.
                  </p>
                ) : (
                  <>
                    <div
                      className="grid h-[38px] items-center border-b border-[var(--pos-line-soft)] bg-[var(--pos-head)] px-3.5 text-[11px] font-extrabold uppercase tracking-[0.06em] text-[var(--pos-muted)]"
                      style={{ gridTemplateColumns: POS_RET_COLS, gap: "0 10px" }}
                    >
                      <span />
                      <span>Sản phẩm</span>
                      <span>Lý do</span>
                      <span className="text-center">Đơn vị</span>
                      <span className="text-center">Số lượng</span>
                      <span className="text-right">Đơn giá</span>
                      <span className="text-center">Xử lý</span>
                      <span className="text-right">Trừ đơn</span>
                      <span />
                    </div>

                    {retLines.map((l, i) => {
                      const tien = l.isExchange ? 0 : Math.round(l.qty * l.price)
                      const sua = (p: Partial<PosLine>) =>
                        setRetLines((c) => c.map((x) => (x.key === l.key ? { ...x, ...p } : x)))
                      return (
                        <div
                          key={l.key}
                          className="grid min-h-[70px] items-center border-b border-[var(--pos-line-faint)] px-3.5 py-2.5"
                          style={{ gridTemplateColumns: POS_RET_COLS, gap: "0 10px" }}
                        >
                          <TrashButton
                            label={`Bỏ dòng trả ${i + 1}`}
                            onClick={() => setRetLines((c) => c.filter((x) => x.key !== l.key))}
                          />
                          <span className="grid min-w-0 gap-1">
                            <span className="flex min-w-0 items-baseline gap-2">
                              <span className="truncate text-[14px] font-bold text-[var(--pos-ink)]">
                                {l.name || "— chưa chọn mã —"}
                              </span>
                              {l.sku && (
                                <span className="n shrink-0 text-[12px] font-semibold text-[var(--pos-muted)]">{l.sku}</span>
                              )}
                            </span>
                            <input
                              aria-label={`Ghi chú dòng trả ${i + 1}`}
                              value={l.note ?? ""}
                              onChange={(e) => sua({ note: e.target.value })}
                              placeholder="Ghi chú dòng trả…"
                              className="h-[30px] w-full min-w-0 border-0 border-b border-dashed border-[var(--pos-edge)] bg-transparent px-0.5 text-[12px] font-semibold text-[var(--pos-ink)] outline-none"
                            />
                          </span>

                          {/* ⚠ LÝ DO THEO TỪNG DÒNG — `return_lines.reason`, mig 159.
                              Sổ trước đây chỉ có lý do cho cả phiếu; vẽ ô này mà
                              lưu chung một chỗ là màn hình nói dối. */}
                          <CompactSelect
                            ariaLabel={`Lý do trả dòng ${i + 1}`}
                            value={l.reason ?? retReason}
                            onChange={(v) => sua({ reason: v })}
                            options={RETURN_REASONS}
                            className="h-[38px] min-w-0 rounded-[10px] border-[1.5px] border-[var(--pos-line)] bg-white px-2 text-[12px] font-bold text-[var(--pos-ink)]"
                          />

                          {/* ⚠ Đổi đơn vị là đổi giá — `doiDonViDongTra` (giá theo hệ số). */}
                          <div className="justify-self-center">
                            <UnitCycleButton
                              units={donViHienThi(l, productById(l.productId)).map((u) => u.unit_name)}
                              value={l.unit}
                              label={`dòng trả ${i + 1}`}
                              onChange={(u) => sua(doiDonViDongTra(l, u, productById(l.productId), groupId))}
                            />
                          </div>
                          <div className="justify-self-center">
                            <QtyStepper
                              label={`số lượng trả dòng ${i + 1}`}
                              value={l.qty}
                              onChange={(v) => sua({ qty: v })}
                            />
                          </div>

                          <MoneyInput
                            showSuffix={false}
                            className="w-[104px] justify-self-end"
                            inputClassName="n h-[38px] rounded-[10px] border-[1.5px] border-[var(--pos-line)] bg-white px-2 text-right text-[14px] font-bold text-[var(--pos-ink)] outline-none py-0 lg:h-[38px] focus-visible:ring-1 focus-visible:ring-offset-0"
                            aria-label={`Đơn giá trả dòng ${i + 1}`}
                            value={l.price}
                            onChange={(v) => sua({ price: v })}
                          />

                          {/* ⚠ TRẢ / ĐỔI LÀ HAI CHIỀU TIỀN KHÁC NHAU: dòng ĐỔI
                              không trừ đồng nào. Hai nút cạnh nhau, nút đang
                              chọn nổi lên — đọc được bằng mắt, không phải mở ra. */}
                          <span className="flex justify-self-center gap-0.5 rounded-[9px] bg-[var(--pos-line-soft)] p-[3px]">
                            {[
                              { doi: false, nhan: "Trả" },
                              { doi: true, nhan: "Đổi" },
                            ].map((o) => {
                              const dang = (l.isExchange === true) === o.doi
                              return (
                                <button
                                  key={o.nhan}
                                  type="button"
                                  aria-pressed={dang}
                                  onClick={() => sua({ isExchange: o.doi })}
                                  className={`h-[30px] min-w-[46px] rounded-[7px] px-2.5 text-[12px] font-extrabold ${
                                    dang
                                      ? "bg-white text-[var(--pos-ink)] shadow-[0_1px_2px_rgba(24,28,30,.12)]"
                                      : "text-[var(--pos-muted)]"
                                  }`}
                                >
                                  {o.nhan}
                                </button>
                              )
                            })}
                          </span>

                          <span
                            className={`n whitespace-nowrap text-right text-[15px] font-extrabold ${
                              l.isExchange ? "text-[var(--pos-dim)]" : "text-[var(--pos-warn)]"
                            }`}
                          >
                            {l.isExchange ? "—" : `− ${formatCurrency(tien)}`}
                          </span>


                        </div>
                      )
                    })}

                    <div className="flex min-w-0 items-center justify-between gap-3 bg-[var(--pos-head)] px-3.5 py-2.5">
                      <span className="text-[12px] font-bold text-[var(--pos-muted)]">
                        Dòng “Đổi” không trừ tiền · phiếu trả chờ quản lý duyệt
                      </span>
                      <span className="flex items-baseline gap-2.5 whitespace-nowrap text-[13px] font-bold text-[var(--pos-muted)]">
                        Trừ vào đơn
                        <span className="n text-[18px] font-extrabold text-[var(--pos-warn)]">
                          − {formatCurrency(totals.returnCredit)}
                        </span>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ⚠ Hóa đơn và phiếu trả của đơn này — chủ nhà 23/09/2026. Hàng trả
              đã có khối riêng ở trên nên tắt bảng hàng đổi trả của khối này. */}
          {orderId && <RelatedDocs orderId={orderId} pos hienHangTra={false} />}

        </div>

        {/*
          ---------------- panel phải ----------------
          ⚠ MỘT MẶT TRẮNG LIỀN, CHIA BẰNG VẠCH MẢNH — đúng bản thiết kế
            chủ nhà đưa: `<aside>` nền trắng, `border-left`, chia làm
            bốn hàng bằng `grid-template-rows`. Bản trước của tôi là bốn
            THẺ RỜI trôi trên nền xám, mỗi thẻ một viền bo — nhìn ra một
            màn khác hẳn.

          ⚠ BỐN HÀNG, HAI HÀNG GIỮA CO ĐƯỢC. Hàng khách và hàng tổng tiền
            giữ nguyên chiều cao; ô tìm và khối điều khoản chia nhau phần
            còn lại và tự cuộn. Thiếu `min-h-0` ở hai hàng giữa là chúng
            phình theo nội dung và đẩy hàng nút ra ngoài màn.
        */}
        <aside className="grid min-h-0 w-[420px] shrink-0 grid-rows-[max-content_max-content_minmax(0,1fr)_max-content] overflow-hidden border-l border-[var(--pos-line)] bg-white">
          <div className="grid min-w-0 gap-2.5 border-b border-[var(--pos-line-soft)] px-4 pb-3 pt-3.5">
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

          {/*
            ⚠ CẢNH BÁO VƯỢT HẠN MỨC — bản thiết kế vẽ một dải vàng ngay
              dưới thẻ khách. Nó phải nằm ở ĐÂY chứ không phải cạnh nút
              lưu: người lập đơn cần biết TRƯỚC khi gõ hết đơn, không
              phải lúc bấm gửi.
          */}
          {vuotHanMuc != null && (
            <div className="min-w-0 rounded-[10px] bg-[var(--pos-warn-soft)] px-3 py-2.5 text-[12px] font-bold leading-relaxed text-[var(--pos-warn)]">
              Đơn này đưa khách vượt hạn mức{" "}
              <b className="n">{formatCurrency(vuotHanMuc)}</b> — cần quản lý duyệt.
            </div>
          )}

          {/*
            ⚠ GÁN ĐƠN CHO NVBH NẰM Ở CỘT PHẢI, đúng bản thiết kế. Bản
              trước của tôi để nó thành một `<select>` nhỏ trên thanh
              ngang phía trên — chỗ ấy không có trong bản vẽ.

            ⚠ CHỈ CHỦ NHÀ / QUẢN LÝ THẤY Ô NÀY, và đây là một lỗi đã
              xảy ra thật: chủ nhà báo 22/09/2026 rằng gán đơn cho nhân
              viên thì máy chủ ném
              "new row violates row-level security policy for table
               sales_orders (mã 42501)".

              Máy chủ từ chối ĐÚNG. Chính sách `"Sales can update own
              open orders"` (mig 119) có `WITH CHECK (… sales_user_id =
              auth.uid() …)`, còn mig 153 đã chốt "chỉ chủ nhà hoặc
              quản lý mới lập đơn đứng tên nhân viên khác". Màn
              `/sell/cart` che ô này khỏi NVBH từ mig 153; màn `/pos`
              thì quên, nên nó vẽ cho mọi vai trò. Mời người ta bấm một
              cái nút mà máy chủ chắc chắn từ chối thì lỗi là của cái
              nút, không phải của người bấm.
          */}
          {/*
            ⚠ NGƯỜI TẠO · NGƯỜI ĐƯỢC GÁN (chủ nhà yêu cầu 23/09/2026). Ô gán
              chỉ hiện cho chủ / quản lý — cùng luật `canPickSeller` ở trên;
              người khác đọc được tên, không đổi được. Gán ở đây ghi xuống
              lúc bấm Lưu / Gửi đơn (trigger mig 153 canh).
          */}
          <DocPeople
            createdById={orderId ? nguoiTao : user?.id}
            assignedId={nvbh || (orderId ? null : user?.id)}
            onAssign={canPickSeller ? setNvbh : undefined}
            note="Ghi xuống khi bấm Lưu / Gửi đơn."
          />
          </div>

          {/*
            ⚠ DẤU HIỆU "ĐANG THÊM HÀNG TRẢ" PHẢI Ở NGAY Ô TÌM (chủ nhà
              chốt 22/09/2026). Bản trước để nó thành một dải xanh trong
              khối hàng trả ở CỘT TRÁI, còn ô tìm ở cột phải thì trắng
              trơn — mà lúc quét mã người ta nhìn vào ô tìm, không nhìn
              sang cột kia. Gõ nhầm giỏ ở đây là một món khách MUA bị
              ghi thành một món khách TRẢ: tổng đơn tụt xuống mà số dòng
              vẫn đúng, nên không có gì để mà nghi.

            ⚠ NÚT THOÁT ĐI KÈM DẤU HIỆU. Biết mình đang ở nhầm chế độ mà
              phải đi tìm chỗ tắt là vẫn còn mấy mã gõ nhầm nữa.
          */}
          <div className="border-b border-[var(--pos-line-soft)] px-4 py-3">
            <PosProductSearchBox
              note={
                moThemTra
                  ? {
                      text: "Hàng trả",
                      tone: "ok",
                      action: { label: "Chuyển về bán", onClick: () => setMoThemTra(false) },
                    }
                  : undefined
              }
            />
          </div>

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
            {/*
              THUẾ GTGT CẢ ĐƠN — chủ nhà chốt 22/09/2026: "Đơn tổng cũng
              thiếu VAT (làm tương tự)".

              ⚠ NÚT NÀY ĐẶT HÀNG LOẠT, KHÔNG PHẢI MỘT Ô THUẾ THỨ HAI.
                Thuế suất chỉ có MỘT nguồn: từng dòng. Nút này bấm một
                cái là đặt cùng bậc cho mọi dòng, còn con số bên phải
                luôn là TỔNG cộng từ các dòng. Dựng thêm một ô thuế cấp
                chứng từ độc lập là ngày nào đó cộng cả hai vào một tờ.

              ⚠ CÁC DÒNG LỆCH NHAU THÌ HIỆN "—", ĐỪNG HIỆN MỘT CON SỐ.
                Hiện "0%" trong khi có dòng đang chịu 10% là nói dối
                đúng chỗ người ta tin nhất.

              ⚠ VÀ DÒNG NÀY LUÔN VẼ, kể cả khi thuế bằng 0 — khác dòng
                "Trừ hàng trả". Thuế là thứ người lập đơn phải CHỦ ĐỘNG
                chọn; giấu đi khi bằng 0 là giấu luôn cái nút để chọn.
            */}
            <div className="flex items-center justify-between gap-2.5 py-[5px]">
              <span className="flex items-center gap-2">
                <span className="text-[13px] text-[var(--pos-muted)]">Thuế GTGT</span>
                <span className="w-[74px]">
                  <VatChip
                    rate={vatChung ?? 0}
                    mixed={vatChung === null}
                    ariaLabel="Thuế GTGT cả đơn"
                    onNext={() => {
                      const moi = vatChungKeTiep(vatChung)
                      setLines((c) => c.map((l) => ({ ...l, vatRate: moi })))
                    }}
                  />
                </span>
              </span>
              <span className="n text-[13.5px] text-[var(--pos-ink)]">
                {formatCurrency(totals.vat)}
              </span>
            </div>

            {/* ⚠ Chỉ vẽ khi có hàng trả — một dòng "− 0" thường trực là nhiễu. */}
            {totals.returnCredit > 0 && (
              <MoneyRow label="Trừ hàng trả" value={`− ${formatCurrency(totals.returnCredit)}`} tone="warn" />
            )}

            <TotalsHero label="Khách cần trả" value={totals.due} />

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

          {/*
            ⚠ ĐÚNG HAI NÚT, VÀ CHÚNG LÀM ĐÚNG VIỆC CỦA MÀN `/sell`.
              Chủ nhà chốt 22/09/2026: *"Hai nút ở cuối trang chuẩn theo
              màn làm đơn hiện tại (/sell) là Lưu nháp và Gửi đơn"*.

            ⚠ NÚT CHÍNH THÔI LẬP HÓA ĐƠN. Bản trước là "Xuất hàng & lập
              HĐ" — nó lưu đơn RỒI gọi tiếp `savePosInvoice`, tức trừ
              kho và sinh công nợ ngay tại màn ĐẶT HÀNG. `/sell` không
              làm thế: gửi đơn chỉ đưa đơn sang Phiếu tạm, xuất hàng là
              một cú bấm riêng ở màn khác, có người khác chịu trách
              nhiệm. Giữ hai việc trong một nút là chỗ dễ lỡ tay nhất
              của cả màn.

            ⚠ VÀ `F9` ĐI THEO. Dòng gợi ý chân bảng ghi "F9 gửi đơn";
              phím ấy gọi `luuDon(false)`, nay đúng là gửi đơn.
          */}
          {/*
            ⚠ CHỦ NHÀ CHỐT 24/09/2026: "Sau khi gửi đơn -> Các nút chuyển thành:
              In · Tạo hoá đơn · Lưu (trường hợp thay đổi sau khi tạo ngay trên
              màn hình đó)". Đơn còn NHÁP vẫn đúng hai nút Lưu nháp · Gửi đơn.
          */}
          {daGui ? (
            <PanelActions>
              <PanelButton
                width={70}
                disabled={!orderId}
                onClick={() => { if (orderId) inTaiCho(`/orders/${orderId}/print`) }}
                title="In đơn đặt hàng"
              >
                In
              </PanelButton>
              <PanelButton
                width={130}
                disabled={!orderId || dangLuu || daXuatHet || chuaLuuThayDoi || orderStatus === "cancelled"}
                onClick={() => { if (orderId) router.push(posNewInvoiceHref(orderId)) }}
                title={
                  chuaLuuThayDoi
                    ? "Đơn có thay đổi chưa lưu — bấm Lưu trước rồi mới tạo hóa đơn"
                    : daXuatHet
                      ? "Đơn đã xuất hết — không còn gì để lập hóa đơn"
                      : "Xuất hàng · lập hóa đơn cho phần còn lại của đơn"
                }
              >
                Tạo hoá đơn
              </PanelButton>
              <PanelButton
                variant="primary"
                disabled={!chuaLuuThayDoi || lines.length === 0 || !khach || coGiaXau || dangLuu}
                onClick={() => luuDon(false)}
                title={
                  !chuaLuuThayDoi
                    ? "Chưa có thay đổi nào để lưu"
                    : coGiaXau
                      ? "Có dòng đặt giá ngoài hạn mức của bạn"
                      : "Lưu thay đổi của đơn đã gửi"
                }
              >
                {dangLuu ? "Đang lưu…" : "Lưu (F9)"}
              </PanelButton>
            </PanelActions>
          ) : (
            <PanelActions>
            <PanelButton
              width={150}
              disabled={dangLuu || lines.length === 0 || donHo}
              onClick={() => luuDon(true)}
              title={
                donHo
                  ? "Đơn này đứng tên nhân viên khác nên không lưu nháp được — nháp là sổ tay riêng của người đứng tên, bạn sẽ không mở lại được. Bấm Gửi đơn."
                  : lines.length === 0
                    ? "Chưa có mặt hàng nào trong đơn"
                    : "Lưu lại để sửa tiếp, chưa gửi đi đâu"
              }
            >
              {dangLuu ? "Đang lưu…" : "Lưu nháp (F6)"}
            </PanelButton>
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
                      : "Gửi đơn sang Phiếu tạm — xuất hàng ở màn Xuất hàng"
              }
            >
              {dangLuu ? "Đang gửi…" : mode === "sua" ? "Lưu thay đổi" : "Gửi đơn (F9)"}
            </PanelButton>
          </PanelActions>
          )}
        </aside>
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
