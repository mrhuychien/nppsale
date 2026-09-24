"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, ChevronUp, Plus, Trash2, TriangleAlert, X } from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { SellBottomBar } from "@/components/sell/bottom-bar"
import { useSellData } from "@/hooks/use-sell-data"
import { LineEditSheet, Stepper } from "@/components/sell/line-edit-sheet"
import {
  kiemQuyenGiamGia, lineDiscountAmountOf, netPriceOf, priceViolation, switchUnit, vatChungCuaDong,
  type DiscountInput,
} from "@/lib/sell/cart"
import { returnPriceViolation } from "@/lib/sell/returns"
import { toStockLines, toStockReturnLines } from "@/lib/sell/stock"
import { hasOverstock, isReturnLineOverstock, isSaleLineOverstock } from "@/lib/orders/stock-check"
import { useCommittedStock } from "@/hooks/use-committed-stock"
import { availableMapFrom } from "@/lib/sell/committed"
import { unitPriceFor, stockInUnit } from "@/lib/sell/pricing"
import { kepGiamGia, nhanTranGiamGia, userDiscountRulesFrom, userPriceRulesFrom, type UserDiscountRules } from "@/lib/pricing"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { canDeleteOrder, deleteOrder } from "@/lib/orders/delete"
import { errorMessage } from "@/lib/errors"
import { layMaChongLap, sinhMaChongLap, type MaChongLap } from "@/lib/sell/request-id"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn, formatCurrency, formatDate, formatInt, generateOrderCode } from "@/lib/utils"
import { PAYMENT_TERMS, VAT_RATES } from "@/lib/constants"
import { loadDebtByCustomer } from "@/lib/sell/debt"
import { createClient } from "@/lib/supabase/client"
import { buildOrderPayload, grossBeforeDiscountOf } from "@/lib/sell/create-order"
import { loadApprovalContext, EMPTY_APPROVAL_CONTEXT } from "@/lib/sell/approval-context"
import { submitSellOrder } from "@/lib/sell/submit"
import { applyOrderEdit, decideEditStatus, editHint } from "@/lib/sell/order-edit"
import { SearchSelect } from "@/components/ui/search-select"
import { toast } from "@/hooks/use-toast"

export default function SellCartPage() {
  const router = useRouter()
  const { user } = useAuth()
  const cart = useSellCart()
  const { products, productById, customerById, stockByProduct, loading } = useSellData()
  /**
   * ⚠ MỌI PHÉP KIỂM Ở MÀN NÀY SO VỚI KHẢ DỤNG, KHÔNG SO VỚI TỒN.
   *
   * Chủ nhà chốt: "số lượng đặt hoặc đổi không được lớn hơn tồn kho −
   * hàng đã đặt (hàng này chưa trừ kho nhưng đã đặt trong các đơn
   * khác)". Kho chỉ bị trừ lúc Xuất hàng, nên `stockByProduct` vẫn đếm
   * cả phần ba Phiếu tạm khác đã hứa với ba khách khác.
   */
  const { committedByProduct, warning: committedWarning } = useCommittedStock()
  const availableByProduct = useMemo(
    () => availableMapFrom(stockByProduct, committedByProduct),
    [stockByProduct, committedByProduct]
  )
  /**
   * ⚠ KHÔNG ĐỌC `allow_oversell` Ở MÀN NÀY NỮA, và đó là chủ ý.
   *
   * Công tắc ấy (mig 086) trả lời câu "có được GHI SỔ một phiếu xuất làm
   * tồn âm không" — việc của `post_stock_export`. Màn này trả lời một
   * câu khác hẳn: "có được GHI LẠI một nhu cầu chưa có hàng không". Từ
   * 20/09/2026 câu trả lời luôn là CÓ (chủ nhà chốt: "cho nhân viên đặt
   * hàng vượt số tồn và đặt, kèm cảnh báo — để tính được nhu cầu").
   *
   * Trộn hai câu vào một công tắc là bật nó lên để cứu việc ghi nhu cầu
   * rồi vô tình cho phép cả việc xuất kho âm.
   */

  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const customer = customerById(cart.customerId) ?? null
  const groupId = customer?.group_id ?? null
  // Đang sửa một đơn đã lưu, hay đang soạn đơn mới.
  const editing = cart.editing

  /**
   * ⚠ NGƯỜI DÙNG BÁO: "NV bán hàng chưa xoá được đơn nháp. Phải có nút
   * xoá trong màn sửa đơn chứ?" Đang mở một nháp ra sửa mà muốn bỏ nó thì
   * phải thoát ra, tìm lại trong Đơn tạm, rồi mới xoá được — trong khi
   * database (mig 117) đã cho NVBH xoá nháp của chính mình. Nút nằm ngay
   * đây, gài đúng theo chính sách database qua `canDeleteOrder`.
   */
  const canDeleteDraft =
    !!editing &&
    editing.status === "draft" &&
    canDeleteOrder(
      user,
      { status: "draft", sales_user_id: editing.salesUserId ?? user?.id },
      !!user && hasPermission(user.role, "orders", "delete")
    )

  const deleteDraft = async () => {
    if (!editing || deleting) return
    setDeleting(true)
    try {
      await deleteOrder(createClient(), editing.orderId)
      // ⚠ Xoá xong phải BUÔNG giỏ. Giỏ còn mang mã đơn vừa xoá thì cú Lưu
      // kế tiếp ghi đè lên một đơn không còn tồn tại — lỗi khoá ngoại.
      cart.clear()
      toast({ title: `Đã xoá đơn nháp ${editing.orderCode}` })
      router.replace("/sell")
    } catch (err) {
      toast({ title: "Không xoá được đơn", description: errorMessage(err), variant: "destructive" })
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  // Quyền sửa giá theo từng người — NVBH phải được bật riêng.
  const rules = userPriceRulesFrom(user)
  /* ⚠ QUYỀN GIẢM GIÁ (mig 185): tắt thì ô giảm dòng / giảm đơn ẩn hẳn. */
  const quyenGiam = userDiscountRulesFrom(user)
  const isSales = user?.role === "sales"
  /**
   * NPP LẬP ĐƠN GIÚP NHÂN VIÊN (chủ nhà chốt 21/09/2026).
   *
   * ⚠ CHỈ CHỦ NHÀ / QUẢN LÝ THẤY Ô NÀY. Nhân viên bán hàng lập đơn của
   *   chính mình — cho họ chọn tên người khác là mở đường ghi doanh số
   *   sang tên đồng nghiệp. Giao diện chỉ là lớp đầu; trigger
   *   `trg_orders_guard_sales_user` (mig 153) mới là chỗ chặn thật, vì
   *   `sales_orders` ghi trực tiếp từ trình duyệt.
   */
  const canPickSeller = user?.role === "owner" || user?.role === "manager"
  /**
   * ⚠ TÊN NGƯỜI ĐỨNG ĐƠN NẰM TRONG GIỎ, KHÔNG NẰM TRONG MÀN NÀY — và đây
   *   là một lỗi chủ nhà đã báo: "chọn nhân viên xong, khi chọn thêm hàng
   *   hoặc chọn khách hàng xong quay lại thì mất tên nhân viên đã chọn".
   *
   *   `/sell`, `/sell/customer`, `/sell/returns`, `/sell/terms` là TRANG
   *   THẬT, không phải state đổi trong một trang. Rời màn giỏ là React
   *   tháo nó khỏi DOM và mọi `useState` ở đây về mặc định; chỉ
   *   `SellCartProvider` (nằm trên layout) mới sống qua được. Giỏ hàng,
   *   khách, ghi chú đều đã ở đó — ô này bị bỏ quên lại.
   *
   * ⚠ VÀ NÓ MẤT LẶNG LẼ. Ô rỗng nghĩa là "đơn đứng tên bạn", nên người
   *   dùng quay lại thấy một ô rỗng hợp lệ, bấm Lưu, đơn sang tên NPP.
   *   Không có gì đỏ lên để họ biết lựa chọn của mình đã bay.
   */
  const sellerId = cart.sellerId
  const setSellerId = cart.setSellerId
  const [sellers, setSellers] = useState<Array<{ id: string; full_name: string; role: string }>>([])

  useEffect(() => {
    if (!canPickSeller || !user?.org_id) return
    let cancelled = false
    createClient()
      .from("users")
      .select("id, full_name, role")
      .eq("org_id", user.org_id)
      /* ⚠ ĐÚNG BỘ VAI TRÒ MÀ TRIGGER CHO PHÉP — xem mig 153. Hiện ra
         một cái tên mà máy chủ sẽ từ chối là bẫy người dùng. */
      .in("role", ["sales", "manager", "owner"])
      .order("full_name")
      .then(({ data }) => {
        if (!cancelled) {
          setSellers((data as Array<{ id: string; full_name: string; role: string }>) || [])
        }
      })
    return () => { cancelled = true }
  }, [canPickSeller, user?.org_id])

  /**
   * ⚠ MỞ ĐƠN RA SỬA THÌ Ô NÀY PHẢI SẴN TÊN NGƯỜI ĐANG ĐỨNG ĐƠN — việc ấy
   *   nay làm ở `loadForEdit` (màn `/sell/edit/[id]`), một lần, lúc nạp
   *   đơn vào giỏ. Trước đây nó là một `useEffect` ở đây, và chính cái
   *   effect ấy là thứ phải canh "chỉ nạp một lần" bằng một `useRef`,
   *   nếu không thì mỗi lần vẽ lại là đè lên lựa chọn người dùng vừa đổi.
   *
   *   Ô rỗng có nghĩa "đơn đứng tên bạn". Để nó rỗng khi đang sửa đơn của
   *   một nhân viên là chỉ cần bấm Lưu một cái, đơn nhảy sang tên NPP —
   *   doanh số và hoa hồng đi theo, mà người sửa không hề chọn gì.
   */

  /**
   * ĐANG LÀM ĐƠN HỘ NGƯỜI KHÁC — không lưu nháp được.
   *
   * ⚠ LUẬT CỦA CƠ SỞ DỮ LIỆU, KHÔNG PHẢI QUY ƯỚC GIAO DIỆN.
   *   `sales_order_select` (mig 119) giấu mọi đơn NHÁP không đứng tên
   *   mình, và chủ nhà chốt 22/09/2026 giữ nguyên luật ấy. Lưu một tờ
   *   nháp đứng tên nhân viên là tự tay ném nó khỏi tầm nhìn của chính
   *   mình; tệ hơn, `INSERT … RETURNING` đọc lại hàng vừa ghi nên máy
   *   chủ ném thẳng 42501.
   *
   * ⚠ SO VỚI `user.id`, KHÔNG SO VỚI RỖNG: ô trống nghĩa là đơn đứng
   *   tên chính mình, và đơn ấy lưu nháp bình thường.
   */
  const donHo = canPickSeller && !!sellerId && sellerId !== user?.id

  const sellerOptions = useMemo(
    () =>
      sellers.map((u) => ({
        id: u.id,
        label: u.full_name || "(chưa đặt tên)",
        hint: u.id === user?.id ? "chính bạn" : u.role,
      })),
    [sellers, user?.id]
  )
  const canEditPrice = !isSales || rules.allow_price_edit
  const vatChung = useMemo(() => vatChungCuaDong(cart.cart), [cart.cart])
  /* Công nợ của khách (2b: "Nợ …") — cùng bộ nhớ đệm với màn Chọn khách. */
  const [noKhach, setNoKhach] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    let huy = false
    loadDebtByCustomer().then((m) => { if (!huy) setNoKhach(m) })
    return () => { huy = true }
  }, [])
  const debt = cart.customerId ? noKhach?.[cart.customerId] : undefined
  const maxIncreasePct = Number(rules.price_edit_max_increase_pct ?? 0)

  // Nhu cầu xuất kho gồm CẢ dòng bán lẫn dòng ĐỔI — xem `@/lib/sell/stock`.
  const stockLines = useMemo(() => toStockLines(cart.cart), [cart.cart])
  const stockReturns = useMemo(() => toStockReturnLines(cart.returnLines), [cart.returnLines])

  const rows = useMemo(
    () =>
      cart.cart.map((l, i) => {
        const p = productById(l.productId)
        const onHand = stockByProduct[l.productId] ?? 0
        const avail = availableByProduct[l.productId] ?? 0
        // ⚠ Vượt tồn xét trên TỔNG mọi dòng cùng sản phẩm. Hai dòng mỗi
        // dòng 6 thùng trên tồn 10 thì từng dòng đều "hợp lệ".
        const over = isSaleLineOverstock(i, stockLines, products, availableByProduct)
        const listNow = p ? unitPriceFor(p, l.unit, groupId) : l.listPrice
        return {
          i,
          line: l,
          product: p,
          over,
          onHand,
          /**
           * ⚠ NÓI CON SỐ VỪA DÙNG ĐỂ CHẶN, KHÔNG NÓI CON SỐ KHÁC. Tô đỏ
           * một dòng rồi ghi "tồn 2.838" bên cạnh là người bán ngồi đếm
           * mãi không hiểu sai ở đâu — thứ chặn họ là phần CÒN ĐẶT ĐƯỢC.
           * Khi chưa đọc được hàng đã đặt thì hai số bằng nhau và câu này
           * quay về đúng nghĩa cũ.
           */
          stockText: p
            ? committedByProduct && avail !== onHand
              ? `còn đặt được ${stockInUnit(p, l.unit, Math.max(0, avail))} ${l.unit} · tồn ${stockInUnit(p, l.unit, onHand)}`
              : `tồn ${stockInUnit(p, l.unit, onHand)} ${l.unit}`
            : "",
          // ⚠ Đổi khách là đổi bảng giá. Dòng đã có trong giỏ giữ giá cũ,
          // nên phải NÓI RA chỗ nào lệch chứ đừng lặng lẽ tính giá cũ.
          staleList: listNow !== l.listPrice,
          listNow,
          priceBad: priceViolation(l, { canEditPrice, maxIncreasePct }) !== null,
        }
      }),
    [cart.cart, stockLines, products, productById, stockByProduct, availableByProduct, committedByProduct, groupId, canEditPrice, maxIncreasePct]
  )

  /**
   * ⚠ VƯỢT TỒN KHÔNG CÒN CHẶN NVBH GỬI ĐƠN. Nhân viên đứng ở quầy đọc
   * một con số tồn có thể đã cũ vài giờ; chặn họ ghi đơn vì con số đó là
   * mất đơn thật vì một số liệu không chắc. Chốt chặn thật nằm ở
   * `complete_order`: lúc nhà phân phối bấm Xuất hàng, kho được khoá và
   * trừ trong cùng một giao dịch. Ở đây chỉ CẢNH BÁO.
   *
   * ⚠ Cảnh báo xét TỔNG, không phải "có dòng nào bị tô đỏ". Tồn 10, bán
   * 9, đổi 2 → từng dòng đều "gần đủ" mà tổng 11 > 10.
   */
  const hasOver = hasOverstock(stockLines, stockReturns, products, availableByProduct)
  /**
   * ⚠ Dòng ĐỔI vượt tồn phải hiện được Ở ĐÂY. Băng vàng chỉ nói "có mặt
   * hàng vượt tồn" mà không dòng bán nào tô đỏ thì người dùng soi mãi danh
   * sách hàng bán không hiểu sai ở đâu — hàng đổi nằm trong một màn khác.
   */
  const exchangeOver = useMemo(
    () =>
      stockReturns.filter((_, i) =>
        isReturnLineOverstock(i, stockReturns, stockLines, products, availableByProduct)
      ).length,
    [stockReturns, stockLines, products, availableByProduct]
  )

  const hasPriceBad = rows.some((r) => r.priceBad)

  /**
   * ⚠ GIÁ DÒNG TRẢ CAO HƠN GIÁ BẢNG LÀ MỘT ĐƯỜNG RÚT TIỀN: mua 100k, trả
   * lại 150k, và không quy tắc duyệt nào chạm tới vì đây không phải dòng
   * bán — `returnCredit` trừ thẳng vào số khách phải trả. Tô đỏ ở màn hàng
   * trả mà vẫn gửi đơn được thì vệt đỏ đó chỉ là trang trí.
   */
  const returnPriceBad = useMemo(
    () =>
      cart.returnLines.filter((r) => {
        const p = productById(r.productId)
        return (
          returnPriceViolation(r, p ? unitPriceFor(p, r.unit, groupId) : 0, {
            maxIncreasePct,
            free: rules.free,
          }) !== null
        )
      }).length,
    [cart.returnLines, productById, groupId, maxIncreasePct, rules.free]
  )
  const staleCount = rows.filter((r) => r.staleList).length

  const projectedOver = useMemo(() => {
    if (!customer || !customer.credit_limit) return 0
    // Chỉ cảnh báo phần VƯỢT, không hiện "vượt 0đ" cho đơn bình thường.
    // ⚠ Nợ SẴN CÓ (phiếu công nợ theo hóa đơn) + đơn này — như POS; bỏ nợ cũ
    //   là khách đang nợ sát hạn mức vẫn không bị cảnh báo.
    return Math.max(0, (debt ?? 0) + cart.totals.grandTotal - Number(customer.credit_limit))
  }, [customer, cart.totals.grandTotal, debt])

  const termsSummary = useMemo(() => {
    const t =
      PAYMENT_TERMS.find((x) => x.value === (cart.paymentTerms || customer?.payment_terms))?.label ??
      "Theo điều khoản của khách"
    const giao = cart.expectedDelivery
      ? `giao ${formatDate(cart.expectedDelivery)}`
      : "chưa chọn ngày giao"
    return `${t} · ${giao}`
  }, [cart.paymentTerms, cart.expectedDelivery, customer])


  /**
   * Gửi đơn.
   *
   * ⚠ KHOÁ NỐI SINH TRƯỚC KHI GỬI và không đổi nữa. Mạng chập chờn thì cú
   * gửi có thể lặp lại; `createOrderRecords` dựa vào khoá đó để lần thứ
   * hai không thành đơn thứ hai.
   */
  const maChongLap = useRef<MaChongLap | null>(null)
  const submit = async (asDraft: boolean) => {
    if (submitting || !cart.customerId || !user?.id || !user.org_id) return
    setSubmitting(true)
    try {
      const loiGiam = kiemQuyenGiamGia(cart.cart, cart.totals, quyenGiam, cart.docDiscountGoc ?? 0)
      if (loiGiam) throw new Error(loiGiam)
      const supabase = createClient()
      const online = typeof navigator === "undefined" || navigator.onLine
      // ⚠ SỬA ĐƠN KHÔNG XẾP ĐƯỢC VÀO HÀNG ĐỢI. Hàng đợi ngoại tuyến chỉ
      // biết TẠO đơn mới; gói một bản sửa vào đó là lát nữa có mạng sẽ ra
      // đơn thứ hai cho cùng số hàng. Nói thẳng là chưa lưu được.
      if (editing && !online) {
        throw new Error(
          "Mất mạng nên chưa lưu được thay đổi. Đơn cũ vẫn nguyên — thử lại khi có sóng."
        )
      }
      /**
       * Người đứng tên đơn, tính MỘT LẦN cho cả đường tạo lẫn đường sửa.
       *
       * ⚠ RỖNG Ở Ô CHỌN NGHĨA LÀ "CHÍNH TÔI" — nên phải quy ra mã người
       *   đang đăng nhập NGAY Ở ĐÂY, đừng để `null` đi tiếp. Đường tạo
       *   đơn có `createOrderRecords` đỡ cho (`|| ctx.userId`), nhưng
       *   đường sửa thì không: ở đó `null` phải có nghĩa "không đụng tới
       *   cột", nếu không mỗi lần NVBH sửa đơn của chính mình là xoá
       *   trắng tên người phụ trách.
       *
       * ⚠ KHÔNG CÓ QUYỀN CHỌN THÌ LÀ `null`, và đường sửa sẽ để nguyên
       *   cột. NVBH sửa đơn NPP giao cho mình thì đơn vẫn của mình; ghi
       *   đè bằng `user.id` ở đây cũng ra cùng kết quả, nhưng để nguyên
       *   thì không có gì để mà sai.
       */
      const nguoiDungTen = canPickSeller ? sellerId || user.id : null

      // Cùng nội dung → cùng mã: bấm lại sau một lần rớt mạng không ra đơn thứ hai.
      maChongLap.current = layMaChongLap(
        maChongLap.current,
        JSON.stringify([asDraft, cart.customerId, cart.cart, cart.returnLines, cart.returnReason, cart.notes,
          cart.paymentTerms, cart.expectedDelivery, nguoiDungTen, cart.docDiscount ?? null]),
        sinhMaChongLap
      )
      const payload = buildOrderPayload({
        clientRequestId: maChongLap.current.id,
        orderCode: editing?.orderCode || generateOrderCode(),
        customerId: cart.customerId,
        customerName: customer?.store_name ?? "",
        paymentTerms: cart.paymentTerms || customer?.payment_terms || "COD",
        expectedDelivery: cart.expectedDelivery || null,
        notes: cart.notes,
        cart: cart.cart,
        totals: cart.totals,
        createdAt: new Date().toISOString(),
        returnReason: cart.returnReason,
        returnLines: cart.returnLines,
        /* ⚠ RỖNG = CHÍNH NGƯỜI ĐANG LẬP. Đi trong TẢI TRỌNG chứ không
           trong `ctx`, để đơn xếp hàng lúc mất mạng vẫn giữ đúng người
           đứng tên khi mạng về — xem `OfflineOrderPayload`. */
        salesUserId: nguoiDungTen,
      })

      // Ngữ cảnh quy tắc chỉ cần khi THẬT SỰ gửi đi và đang có mạng.
      const ctx =
        online && !asDraft
          ? await loadApprovalContext(supabase, {
              orgId: user.org_id,
              customerId: cart.customerId,
              // ⚠ Nợ danh mục của NGƯỜI ĐỨNG TÊN ĐƠN, không phải người bấm —
              //   NPP lập đơn hộ NVBH A thì quy tắc phải soi công nợ của A.
              salesUserId: nguoiDungTen ?? user.id,
            })
          : EMPTY_APPROVAL_CONTEXT

      const decisionInput = {
        asDraft,
        orderTotal: cart.totals.grandTotal,
        subtotal: cart.totals.subtotal,
        grossBeforeDiscount: grossBeforeDiscountOf(cart.cart),
        customer: customer ? { id: customer.id, credit_limit: customer.credit_limit } : null,
        rules: ctx.rules,
        customerDebt: ctx.customerDebt,
        customerOverdue: ctx.customerOverdue,
        repPortfolioDebt: ctx.repPortfolioDebt,
        contextFailed: ctx.failed,
        role: user.role,
      }

      // ĐANG SỬA ĐƠN ĐÃ LƯU: ghi đè lên đơn đó, không tạo đơn mới.
      if (editing) {
        const { status, reason } = decideEditStatus({
          prevStatus: editing.status,
          decision: decisionInput,
        })
        await applyOrderEdit(supabase, {
          orderId: editing.orderId,
          payload,
          cart: cart.cart,
          status,
          reason,
          userId: user.id,
          orgId: user.org_id,
          // ⚠ ĐỌC THẲNG KHOÁ, ĐỪNG `?? null`. `undefined` ở đây nghĩa là
          //   "không biết đơn này có phiếu trả nào" và `applyOrderEdit`
          //   phải đứng yên; ép về `null` là nó tạo thêm một phiếu trả.
          heldReturnId: editing.heldReturnId,
          /* ⚠ RỖNG = KHÔNG ĐỤNG TỚI CỘT, không phải "xoá tên người phụ
             trách" — xem `salesUserId` trong `applyOrderEdit`. */
          salesUserId: nguoiDungTen,
          /* ⚠ Để câu báo lỗi gọi đúng TÊN mặt hàng thay vì một mã UUID —
             xem nhánh 23503 trong `applyOrderEdit`. */
          productName: (id) => productById(id)?.name,
        })
        cart.clear()
        router.replace(
          `/sell/done?code=${encodeURIComponent(editing.orderCode)}&status=${status}&edited=1` +
            (reason ? `&reason=${encodeURIComponent(reason)}` : "")
        )
        return
      }

      const out = await submitSellOrder(
        supabase,
        { payload, online, ...decisionInput },
        { userId: user.id, orgId: user.org_id }
      )

      const status = out.kind === "queued" ? "queued" : out.status
      const reason = out.kind === "queued" ? "" : out.reason
      cart.clear()
      router.replace(
        `/sell/done?code=${encodeURIComponent(out.orderCode)}&status=${status}` +
          (reason ? `&reason=${encodeURIComponent(reason)}` : "")
      )
    } catch (err) {
      /**
       * ⚠ IN NGUYÊN VĂN RA CONSOLE, NGOÀI CÂU HIỆN TRÊN MÀN.
       *
       * Chủ nhà báo 21/09/2026 hai lần liền rằng không lưu được đơn khi
       * thêm hàng trả, và tôi KHÔNG tái hiện được: đã chạy từng lệnh mà
       * `applyOrderEdit` gửi đi — xoá dòng, chèn dòng, sửa đầu đơn, tạo
       * phiếu trả, chèn dòng trả — trên Postgres 16 có bật RLS, tất cả
       * đều chạy.
       *
       * Toast chỉ hiện được một dòng và bị cắt; `details`/`hint` của
       * PostgREST thường là chỗ nói rõ ràng buộc nào vỡ. In cả object
       * ra console để lần sau chụp màn hình là đủ chẩn đoán, không phải
       * đoán tiếp.
       */
      console.error("[sell/cart] không lưu được đơn — nguyên văn:", err)
      toast({
        title: "Không gửi được đơn",
        description: errorMessage(err, "Lỗi không xác định"),
        variant: "destructive",
      })
      setSubmitting(false)
    }
  }

  const edit = editIdx != null ? cart.cart[editIdx] : null

  return (
    <div className="flex min-h-screen flex-col bg-surface-container-low pb-[190px]">
      {/* ---------- ĐẦU MÀN (2b): bỏ ô tìm khỏi màn đơn → nút "Thêm hàng" ---------- */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-container-lowest px-4 pb-3 pt-3.5">
        <button
          type="button"
          onClick={() => router.push("/sell")}
          aria-label="Quay lại"
          className="-ml-2 grid h-9 w-9 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[19px] font-bold">
          {editing ? `Sửa ${editing.orderCode}` : "Đơn hàng"}
        </h1>
        <button
          type="button"
          onClick={() => router.push("/sell")}
          className="flex h-9 items-center gap-1 rounded-[10px] bg-primary/10 px-3 text-[13px] font-semibold text-primary"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
          Thêm hàng
        </button>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 p-3">
        {/* Khách: tên + bảng giá + công nợ (2b). */}
        <button
          type="button"
          onClick={() => router.push("/sell/customer")}
          className="flex items-center gap-3 rounded-[14px] bg-surface-container-lowest p-3 text-left"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-primary/10 font-bold text-primary">
            {(customer?.store_name ?? "?").trim().charAt(0).toUpperCase()}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[15px] font-semibold text-on-surface">
              {customer?.store_name ?? "Chọn khách hàng"}
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              {customer
                ? [
                    customer.group?.name ?? "Bảng giá chung",
                    /* ⚠ Chưa đọc được công nợ thì không in "Nợ 0". */
                    debt === undefined ? null : `Nợ ${formatCurrency(debt)}`,
                    customer.credit_limit ? `HM ${formatCurrency(customer.credit_limit)}` : null,
                  ].filter(Boolean).join(" · ")
                : "Đơn nào cũng phải có khách"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        {/* ⚠ Nói TRƯỚC đơn đang ở đâu và sửa được tới đâu. */}
        {editing && (
          <div className="flex items-start gap-2 rounded-xl bg-primary/10 px-3 py-2.5 text-[13px] font-semibold leading-snug text-primary">
            <span className="min-w-0 flex-1">{editHint(editing.status)}</span>
            {canDeleteDraft && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 font-semibold text-error"
              >
                <Trash2 className="h-4 w-4" /> Xoá nháp
              </button>
            )}
          </div>
        )}

        {projectedOver > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            <TriangleAlert className="mt-px h-[18px] w-[18px] shrink-0" />
            <span>
              Đơn này đẩy khách <b>vượt hạn mức {formatCurrency(projectedOver)}</b>. Vẫn gửi được
              — cảnh báo sẽ đi kèm đơn cho nhà phân phối đọc.
            </span>
          </div>
        )}
        {staleCount > 0 && (
          <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            {staleCount} dòng đang giữ giá của bảng giá cũ. Mở từng dòng để lấy giá mới của khách này.
          </div>
        )}
        {/* ⚠ CHƯA ĐỌC ĐƯỢC HÀNG ĐÃ ĐẶT THÌ NÓI RA TRƯỚC KHI GỬI. */}
        {committedWarning && (
          <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            {committedWarning}
          </div>
        )}
        {/*
          ⚠ CHỈ CẢNH BÁO, KHÔNG CHẶN (chủ nhà chốt 20/09/2026: "cho nhân viên đặt
            hàng vượt số tồn và đặt, kèm cảnh báo (để tính được nhu cầu)"). Chốt
            chặn thật vẫn là `post_stock_export` lúc xuất hàng.
        */}
        {hasOver && (
          <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            Có mặt hàng vượt phần còn đặt được — tồn kho trừ đi hàng đã đặt ở các Phiếu tạm khác.{" "}
            <strong>Vẫn gửi đơn được</strong> để nhà phân phối biết nhu cầu thật; khi xuất hàng sẽ chỉ
            giao được phần có trong kho.
          </div>
        )}

        {/* ---------- DÒNG HÀNG (2b) ---------- */}
        <div className="flex flex-col rounded-[14px] bg-surface-container-lowest">
          {cart.cart.length === 0 ? (
            <p className="p-7 text-center text-sm text-muted-foreground">
              {loading ? "Đang tải danh mục…" : "Chưa có sản phẩm. Bấm “Thêm hàng” để chọn."}
            </p>
          ) : (
            rows.map((r) => (
              <div
                key={`${r.line.productId}|${r.line.unit}`}
                data-testid="dong-gio"
                className="flex flex-col gap-2.5 border-b border-border/60 p-3"
              >
                <div className="flex items-start gap-2">
                  {/* Chạm tên / giá là mở sheet sửa dòng (3a). */}
                  <button
                    type="button"
                    onClick={() => setEditIdx(r.i)}
                    className="flex min-w-0 flex-1 flex-col gap-1 text-left"
                  >
                    <span className="text-[14px] font-semibold leading-[1.35] text-on-surface">
                      {r.product?.name ?? "Sản phẩm không còn trong danh mục"}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                      <span className="whitespace-nowrap">
                        {formatCurrency(netPriceOf(r.line))} / {r.line.unit}
                      </span>
                      {lineDiscountAmountOf(r.line) > 0 && (
                        <span className="whitespace-nowrap rounded-[5px] bg-[#ecfdf3] px-1.5 py-px font-semibold text-[#067647]">
                          Giảm {r.line.discount?.unit === "pct"
                            ? `${String(r.line.discount.value).replace(".", ",")}%`
                            : formatCurrency(lineDiscountAmountOf(r.line))}
                        </span>
                      )}
                      {r.line.price !== r.line.listPrice && !r.priceBad && (
                        <span className="rounded-[5px] bg-primary/10 px-1.5 py-px font-semibold text-primary">Giá sửa</span>
                      )}
                      {r.priceBad && <span className="font-semibold text-error">Giá ngoài hạn mức</span>}
                      {r.over && <span className="font-semibold text-error">Vượt phần còn đặt được ({r.stockText})</span>}
                      {r.line.note && <span className="italic">“{r.line.note}”</span>}
                    </span>
                  </button>
                  {/* ⚠ NÚT XOÁ LUÔN CÓ MẶT — bỏ một dòng 8 thùng không phải bấm − bảy lần. */}
                  <button
                    type="button"
                    onClick={() => cart.setQty(r.i, 0)}
                    aria-label={`Xoá ${r.product?.name ?? "dòng"}`}
                    className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center text-muted-foreground"
                  >
                    <X className="h-4 w-4" strokeWidth={2.2} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  {/* ⚠ Nút − dừng ở 1 — xoá là nút riêng (xem `Stepper`). */}
                  <Stepper size="sm" qty={r.line.qty} unit={r.line.unit} onChange={(q) => cart.setQty(r.i, q)} />
                  <span className="text-[15px] font-bold tabular-data">
                    {formatCurrency(r.line.qty * netPriceOf(r.line))}
                  </span>
                </div>
              </div>
            ))
          )}
          {cart.cart.length > 0 && (
            <div className="flex justify-between p-3 text-[13px] text-muted-foreground">
              <span>Tạm tính</span>
              <span className="font-semibold tabular-data text-on-surface">
                {formatCurrency(cart.totals.subtotal + cart.totals.docDiscount)}
              </span>
            </div>
          )}
        </div>

        {/* ⚠ GIẢM GIÁ CẢ ĐƠN — chỉ khi có quyền giảm giá (mig 185), kẹp trần. */}
        {cart.cart.length > 0 && quyenGiam.allowed && (
          <GiamGiaDon
            value={cart.docDiscount ?? { value: 0, unit: "vnd" }}
            base={cart.totals.subtotal + cart.totals.docDiscount}
            amount={cart.totals.docDiscount}
            rules={quyenGiam}
            onChange={(d) => cart.setDocDiscount(kepGiamGia(d, cart.totals.subtotal + cart.totals.docDiscount, quyenGiam))}
          />
        )}

        {/* ---------- TUỲ CHỌN PHỤ GOM MỘT NHÓM (2b) ---------- */}
        <div className="flex flex-col rounded-[14px] bg-surface-container-lowest">
          <button
            type="button"
            onClick={() => router.push("/sell/returns")}
            className="flex items-center gap-2 border-b border-border/60 p-3 text-left"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-semibold">Hàng trả / đổi kèm đơn</span>
              <span className="truncate text-[12px] text-muted-foreground">
                {cart.returnLines.length ? `${cart.returnLines.length} dòng` : "Chưa có"}
              </span>
              {exchangeOver > 0 && (
                <span className="text-[12px] font-semibold text-error">{exchangeOver} dòng đổi hàng vượt tồn kho</span>
              )}
              {returnPriceBad > 0 && (
                <span className="text-[12px] font-semibold text-error">{returnPriceBad} dòng trả vượt trần giá</span>
              )}
            </span>
            {cart.returnCredit > 0 && (
              <span className="text-[14px] font-semibold tabular-data text-error">−{formatCurrency(cart.returnCredit)}</span>
            )}
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/sell/terms")}
            className="flex items-center gap-2 border-b border-border/60 p-3 text-left"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-semibold">Giao hàng &amp; thanh toán</span>
              <span className="truncate text-[12px] text-muted-foreground">{termsSummary}</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          {/*
            LẬP ĐƠN GIÚP NHÂN VIÊN (chủ nhà chốt 21/09/2026) — CHỈ chủ NPP / quản lý;
            để trống = chính mình ("Tôi (mặc định)" của bản thiết kế).
          */}
          {canPickSeller && (
            <div className="flex flex-col gap-1.5 border-b border-border/60 p-3">
              <span className="text-[14px] font-semibold">Nhân viên bán</span>
              <SearchSelect
                id="cart-seller"
                options={sellerOptions}
                valueId={sellerId}
                onPick={(o) => setSellerId(o?.id ?? "")}
                placeholder="Tôi (mặc định) — gõ tên để chọn nhân viên khác…"
                emptyHint="Không tìm thấy nhân viên nào khớp."
              />
              <span className="text-[11.5px] text-muted-foreground">Doanh số và hoa hồng tính cho người được chọn.</span>
            </div>
          )}
          <div className="flex flex-col gap-1.5 p-3">
            <span className="text-[14px] font-semibold">Ghi chú</span>
            <textarea
              value={cart.notes}
              onChange={(e) => cart.setNotes(e.target.value)}
              aria-label="Ghi chú đơn"
              placeholder="VD: giao trước 10h, để hàng sau quầy"
              rows={2}
              className="w-full resize-none rounded-[10px] border border-border px-2.5 py-2 text-[14px] outline-none"
            />
          </div>
        </div>
      </div>

      {/* ---------- TỔNG DƯỚI ĐÁY, BẤM LÀ MỞ CHI TIẾT THANH TOÁN (2b) ---------- */}
      {breakdownOpen && (
        <div aria-hidden onClick={() => setBreakdownOpen(false)} className="fixed inset-0 z-20 bg-on-surface/45" />
      )}
      <SellBottomBar className={cn("flex flex-col gap-3", breakdownOpen && "rounded-t-[20px]")}>
        {breakdownOpen && (
          <div className="flex flex-col gap-3 border-b border-border pb-3 text-[15px] text-on-surface-variant">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-muted-foreground">Chi tiết thanh toán</span>
              <button
                type="button"
                aria-label="Đóng chi tiết thanh toán"
                onClick={() => setBreakdownOpen(false)}
                className="grid h-7 w-7 place-items-center rounded-full bg-surface-container-low"
              >
                <X className="h-3 w-3" strokeWidth={2.6} />
              </button>
            </div>
            <Row label={`Tạm tính · ${cart.cart.length} mặt hàng`} value={formatCurrency(cart.totals.subtotal + cart.totals.docDiscount)} />
            {cart.totals.docDiscount > 0 && (
              <Row label="Giảm giá đơn" value={`−${formatCurrency(cart.totals.docDiscount)}`} tone="ok" />
            )}
            {/* Chiết khấu so với giá bảng (sửa giá / giảm dòng) — đã nằm trong tạm tính. */}
            {cart.totals.discount - cart.totals.docDiscount > 0 && (
              <Row label="Chiết khấu dòng (đã trừ)" value={formatCurrency(cart.totals.discount - cart.totals.docDiscount)} />
            )}
            {/* ⚠ THUẾ CẢ ĐƠN — đặt cho MỌI dòng (như POS); dòng lệch nhau thì không nút nào sáng. */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                VAT
                <span role="group" aria-label="Thuế VAT cả đơn" className="flex rounded-lg bg-surface-container-low p-0.5">
                  {VAT_RATES.map((v) => {
                    const on = vatChung !== null && Math.abs(vatChung - v.value) < 1e-9
                    return (
                      <button
                        key={v.value}
                        type="button"
                        aria-pressed={on}
                        disabled={cart.cart.length === 0}
                        onClick={() => cart.setVatAll(v.value)}
                        className={cn(
                          "h-[26px] rounded-md px-2 text-[12px]",
                          on ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "font-medium text-on-surface-variant"
                        )}
                      >
                        {v.label}
                      </button>
                    )
                  })}
                </span>
              </span>
              <span className="font-semibold tabular-data text-on-surface">+{formatCurrency(cart.totals.vat)}</span>
            </div>
            {cart.totals.returnCredit > 0 && (
              <Row label="Trừ hàng trả" value={`−${formatCurrency(cart.totals.returnCredit)}`} tone="bad" />
            )}
          </div>
        )}
        <button
          type="button"
          onClick={() => setBreakdownOpen((v) => !v)}
          aria-expanded={breakdownOpen}
          className="flex items-center justify-between text-left"
        >
          <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <span className="text-[18px] font-bold text-on-surface">Tổng tiền</span>
            <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full border-[1.5px] border-primary px-1 text-[12px] font-bold text-primary">
              {cart.cart.length}
            </span>
            <ChevronUp className={cn("h-4 w-4 text-on-surface-variant transition-transform", breakdownOpen && "rotate-180")} />
          </span>
          <span className="whitespace-nowrap text-[24px] font-bold tabular-data text-on-surface">
            {formatCurrency(cart.totals.grandTotal)}
          </span>
        </button>
        {/* ⚠ NÚT MỜ PHẢI NÓI VÌ SAO — trên điện thoại `title` không hiện. */}
        {donHo && (
          <p className="rounded-xl bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface-variant">
            Đơn này đứng tên nhân viên khác nên <b>không lưu nháp được</b> — nháp là sổ tay riêng của
            người đứng tên. Bấm <b>Gửi đơn</b>.
          </p>
        )}
        <div className="flex gap-2">
          {/* Phiếu tạm vẫn có "Lưu nháp" — đó là cách RÚT ĐƠN VỀ khi NPP chưa xuất hàng. */}
          {editing?.status === "submitted" ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                cart.clear()
                router.replace(`/orders/${editing.orderId}`)
              }}
              className="h-[50px] flex-1 rounded-xl border border-border bg-surface-container-lowest text-[15px] font-semibold text-on-surface-variant disabled:opacity-40"
            >
              Bỏ sửa
            </button>
          ) : (
            <button
              type="button"
              disabled={submitting || !cart.customerId || hasPriceBad || returnPriceBad > 0 || donHo}
              onClick={() => submit(true)}
              title={donHo ? "Đơn đứng tên nhân viên khác thì không lưu nháp được — bấm Gửi đơn." : undefined}
              className="h-[50px] flex-1 rounded-xl border border-border bg-surface-container-lowest text-[15px] font-semibold text-on-surface-variant disabled:opacity-40"
            >
              Lưu nháp
            </button>
          )}
          <button
            type="button"
            disabled={submitting || cart.cart.length === 0 || !cart.customerId || hasPriceBad || returnPriceBad > 0}
            onClick={() => submit(false)}
            className="h-[50px] flex-[2] rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
          >
            {submitting
              ? "Đang gửi…"
              : !cart.customerId
                ? "Chọn khách"
                : hasPriceBad
                  ? "Giá ngoài hạn mức"
                  : returnPriceBad > 0
                    ? "Giá hàng trả quá cao"
                    : editing
                      ? "Lưu thay đổi"
                      : "Gửi đơn"}
          </button>
        </div>
        {breakdownOpen && (
          <button
            type="button"
            onClick={() => {
              cart.clear()
              // ⚠ Đang sửa đơn thì KHÔNG xoá đơn — chỉ buông giỏ; đơn cũ nguyên trên máy chủ.
              router.push(editing ? `/orders/${editing.orderId}` : "/sell")
            }}
            className="h-9 text-[14px] font-semibold text-error"
          >
            {editing ? "Bỏ sửa, giữ nguyên đơn cũ" : "Huỷ đơn này"}
          </button>
        )}
      </SellBottomBar>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(o) => !deleting && setDeleteOpen(o)}
        title={`Xoá đơn nháp ${editing?.orderCode ?? ""}?`}
        description="Đơn nháp này sẽ bị xoá hẳn khỏi hệ thống, kể cả hàng trả kèm theo chưa hoàn thành. Không hoàn tác được."
        confirmLabel="Xoá đơn nháp"
        variant="destructive"
        loading={deleting}
        onConfirm={deleteDraft}
      />

      <LineEditSheet
        line={edit}
        product={edit ? productById(edit.productId) : undefined}
        groupId={groupId}
        canEditPrice={canEditPrice}
        maxIncreasePct={maxIncreasePct}
        lineDiscount={quyenGiam.allowed}
        discountRules={quyenGiam}
        baseOnHand={edit ? (stockByProduct[edit.productId] ?? 0) : 0}
        onPatch={(patch) => editIdx != null && cart.patchLine(editIdx, patch)}
        onRemove={() => {
          if (editIdx != null) cart.setQty(editIdx, 0)
          setEditIdx(null)
        }}
        onClose={() => setEditIdx(null)}
      />
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={cn("font-semibold tabular-data", tone === "ok" ? "text-[#067647]" : tone === "bad" ? "text-error" : "text-on-surface")}>
        {value}
      </span>
    </div>
  )
}

/**
 * Ô giảm giá cả đơn (2b) — ô nhập + cặp %/đ. Đổi cách nhập GIỮ nguyên số tiền
 * (quy tắc POS `switchUnit`). Nơi gọi kẹp theo trần quyền giảm giá.
 */
function GiamGiaDon({
  value, base, amount, rules, onChange,
}: {
  value: DiscountInput
  /** Tiền hàng sau giảm dòng, trước giảm đơn — nền của phần trăm. */
  base: number
  amount: number
  rules: UserDiscountRules
  onChange: (d: DiscountInput) => void
}) {
  const pct = value.unit === "pct"
  const tran = nhanTranGiamGia(rules)
  const [pctText, setPctText] = useState(pct && value.value ? String(value.value) : "")
  const doi = (u: "pct" | "vnd") => {
    if (u === value.unit) return
    const moi = switchUnit(value, base)
    if (moi.unit === "pct") setPctText(moi.value === 0 ? "" : String(moi.value))
    onChange(moi)
  }
  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-surface-container-lowest p-3">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold">Giảm giá đơn</span>
        {amount > 0 && <span className="text-[14px] font-semibold tabular-data text-[#067647]">−{formatCurrency(amount)}</span>}
      </div>
      <div className="flex gap-2">
        <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-[10px] border border-border px-3">
          <input
            aria-label="Giảm giá đơn"
            inputMode={pct ? "decimal" : "numeric"}
            placeholder="0"
            value={pct ? pctText : value.value === 0 ? "" : formatInt(value.value)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              if (pct) {
                const t = e.target.value.replace(",", ".").replace(/[^\d.]/g, "")
                setPctText(t)
                onChange({ value: Math.min(100, Number(t) || 0), unit: "pct" })
              } else {
                const d = e.target.value.replace(/\D/g, "")
                onChange({ value: d === "" ? 0 : parseInt(d, 10), unit: "vnd" })
              }
            }}
            className="w-full min-w-0 flex-1 border-0 bg-transparent text-right text-[16px] font-semibold tabular-data outline-none"
          />
          <span className="text-[13px] text-muted-foreground">{pct ? "%" : "đ"}</span>
        </div>
        <div role="group" aria-label="Cách giảm giá đơn" className="flex rounded-[10px] bg-surface-container-low p-[3px]">
          {(["pct", "vnd"] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={value.unit === u}
              aria-label={u === "pct" ? "Giảm đơn theo %" : "Giảm đơn theo đồng"}
              onClick={() => doi(u)}
              className={cn(
                "h-[38px] rounded-lg px-3.5 text-[14px]",
                value.unit === u ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "font-medium text-on-surface-variant"
              )}
            >
              {u === "pct" ? "%" : "đ"}
            </button>
          ))}
        </div>
      </div>
      {tran && <p className="text-[12px] text-muted-foreground">{tran}</p>}
    </div>
  )
}
