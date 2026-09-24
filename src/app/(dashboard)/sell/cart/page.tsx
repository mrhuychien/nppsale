"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Search,
  ScanBarcode,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { useSellCart } from "@/hooks/use-sell-cart"
import { SellBottomBar } from "@/components/sell/bottom-bar"
import { useSellData } from "@/hooks/use-sell-data"
import { LineEditSheet, Stepper } from "@/components/sell/line-edit-sheet"
import {
  lineDiscountAmountOf, netPriceOf, priceViolation, switchUnit, unitLabel, vatChungCuaDong, vatChungKeTiep,
  type DiscountInput,
} from "@/lib/sell/cart"
import { returnPriceViolation } from "@/lib/sell/returns"
import { toStockLines, toStockReturnLines } from "@/lib/sell/stock"
import { hasOverstock, isReturnLineOverstock, isSaleLineOverstock } from "@/lib/orders/stock-check"
import { useCommittedStock } from "@/hooks/use-committed-stock"
import { availableMapFrom } from "@/lib/sell/committed"
import { unitPriceFor, stockInUnit } from "@/lib/sell/pricing"
import { userPriceRulesFrom } from "@/lib/pricing"
import { useAuth } from "@/hooks/use-auth"
import { hasPermission } from "@/lib/permissions"
import { canDeleteOrder, deleteOrder } from "@/lib/orders/delete"
import { errorMessage } from "@/lib/errors"
import { layMaChongLap, sinhMaChongLap, type MaChongLap } from "@/lib/sell/request-id"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn, formatCurrency, formatDate, formatInt, generateOrderCode } from "@/lib/utils"
import { PAYMENT_TERMS, vatLabel } from "@/lib/constants"
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
    return Math.max(0, cart.totals.grandTotal - Number(customer.credit_limit))
  }, [customer, cart.totals.grandTotal])

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
    <div className="flex min-h-screen flex-col bg-surface pb-[210px]">
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.push("/sell")}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-extrabold">
          {editing ? `Sửa ${editing.orderCode}` : "Đơn hàng"}{" "}
          <span className="text-[15px] font-bold text-on-surface-variant">
            · {cart.cart.length} mặt hàng
          </span>
        </h1>
      </div>

      <div className="flex shrink-0 gap-2 px-4 pb-2.5">
        <button
          type="button"
          onClick={() => router.push("/sell")}
          className="flex h-11 flex-1 items-center gap-2.5 rounded-xl bg-surface-container px-3 text-left text-base font-semibold text-on-surface-variant"
        >
          <Search className="h-[18px] w-[18px]" />
          <span className="flex-1 truncate">Tên, mã hàng, mã vạch…</span>
        </button>
        <button
          type="button"
          onClick={() => router.push("/sell/scan")}
          aria-label="Quét mã"
          className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-container text-on-surface"
        >
          <ScanBarcode className="h-[22px] w-[22px]" />
        </button>
      </div>

      <div className="grid content-start gap-2.5 px-3">
        <button
          type="button"
          onClick={() => router.push("/sell/customer")}
          className="flex items-center gap-3 rounded-2xl bg-surface-container-lowest p-3 text-left shadow-card"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-[15px] font-extrabold text-primary">
            {(customer?.store_name ?? "?").trim().charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-extrabold text-on-surface">
              {customer?.store_name ?? "Chọn khách hàng"}
            </span>
            <span className="mt-0.5 block truncate text-xs font-semibold text-on-surface-variant">
              {customer
                ? customer.credit_limit
                  ? `Hạn mức ${formatCurrency(customer.credit_limit)} · ${customer.group?.name ?? "Bảng giá chung"}`
                  : (customer.group?.name ?? "Bảng giá chung")
                : "Đơn nào cũng phải có khách"}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant" />
        </button>

        {/* ⚠ Nói TRƯỚC đơn đang ở đâu và sửa được tới đâu. Biết sau khi
            bấm Lưu là quá muộn — nhân viên đã hứa với khách là hàng ra
            trong hôm nay. */}
        {editing && (
          <div className="flex items-start gap-2 rounded-xl bg-primary/8 px-3 py-2.5 text-[13px] font-semibold leading-snug text-primary">
            <span className="min-w-0 flex-1">{editHint(editing.status)}</span>
            {canDeleteDraft && (
              <button
                type="button"
                onClick={() => setDeleteOpen(true)}
                className="tap flex shrink-0 items-center gap-1 rounded-lg px-2 font-extrabold text-error"
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
            {staleCount} dòng đang giữ giá của bảng giá cũ. Mở từng dòng để lấy giá mới của khách
            này.
          </div>
        )}

        {/* ⚠ CHƯA ĐỌC ĐƯỢC HÀNG ĐÃ ĐẶT THÌ NÓI RA TRƯỚC KHI NGƯỜI TA GỬI.
            Không có câu này thì phép chặn bên dưới đang so với một con số
            tồn CHƯA trừ phần các Phiếu tạm khác giữ, mà màn hình trông
            như mọi thứ đã được kiểm. */}
        {committedWarning && (
          <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            {committedWarning}
          </div>
        )}

        {/*
          ⚠ CHỈ CẢNH BÁO, KHÔNG CHẶN — VÀ ĐÃ LẬT BA LẦN, GHI LẠI CẢ BA ĐỂ
          KHÔNG AI LẬT MÙ LẦN THỨ TƯ.

          1. Bản đầu: chỉ cảnh báo. Lý do: số tồn trên máy có thể đã cũ
             vài giờ, chặn là mất đơn thật vì một số liệu không chắc.
          2. Chủ nhà chốt "số lượng đặt hoặc đổi ko được lớn hơn tồn kho
             − hàng đã đặt" → đổi thành CHẶN, với lý do phần "đã đặt" là
             lời hứa do chính công ty ghi ra nên đọc lại được.
          3. Chủ nhà chốt lại 20/09/2026: "cho nhân viên đặt hàng vượt số
             tồn và đặt, kèm cảnh báo (để tính được nhu cầu)" → về lại
             CẢNH BÁO.

          Lý do mới nặng hơn cả hai lý do cũ, và nó không phải về kho:
          một đơn bị chặn là một nhu cầu KHÔNG ĐƯỢC GHI LẠI. Nhà phân
          phối mất luôn con số "khách muốn mua bao nhiêu" — thứ duy nhất
          để biết phải nhập thêm bao nhiêu.

          ⚠ CẢNH BÁO PHẢI ĐI TỚI TẬN NGƯỜI XUẤT HÀNG, không dừng ở màn
          này. Nó đi tiếp: dòng tô đỏ ở giỏ → "Thiếu N đơn vị cơ sở" ở
          ngăn xem nhanh đơn → từng dòng ở màn Xuất hàng. NPP là người
          quyết cuối, và `post_stock_export` vẫn là chốt chặn thật.
        */}
        {hasOver && (
          <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
            Có mặt hàng vượt phần còn đặt được — tồn kho trừ đi hàng đã đặt ở
            các Phiếu tạm khác. <strong>Vẫn gửi đơn được</strong> để nhà phân
            phối biết nhu cầu thật; khi xuất hàng sẽ chỉ giao được phần có
            trong kho.
          </div>
        )}

        <div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-card">
          {cart.cart.length === 0 ? (
            <p className="p-7 text-center text-sm font-semibold text-on-surface-variant">
              {loading
                ? "Đang tải danh mục…"
                : "Chưa có sản phẩm. Gõ tên/mã hàng ở ô tìm kiếm hoặc quét mã để thêm."}
            </p>
          ) : (
            rows.map((r) => (
              <div
                key={`${r.line.productId}|${r.line.unit}`}
                className="flex flex-col gap-2 border-b border-outline-variant/30 p-3 last:border-0"
              >
                <div className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => setEditIdx(r.i)}
                  className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold leading-snug">
                      {r.product?.name ?? "Sản phẩm không còn trong danh mục"}{" "}
                      <span className="font-semibold text-on-surface-variant">({r.line.unit})</span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-xs font-semibold text-on-surface-variant">
                      <span>
                        {formatCurrency(netPriceOf(r.line))} × {r.line.qty}
                      </span>
                      {lineDiscountAmountOf(r.line) > 0 && (
                        <span className="rounded-md bg-primary/10 px-1.5 py-px font-bold text-primary">
                          Giảm {r.line.discount?.unit === "pct"
                            ? `${String(r.line.discount.value).replace(".", ",")}%`
                            : formatCurrency(lineDiscountAmountOf(r.line))}
                        </span>
                      )}
                      {r.over && (
                        <span className="font-extrabold text-error">Vượt phần còn đặt được ({r.stockText})</span>
                      )}
                      {r.priceBad && <span className="font-extrabold text-error">Giá ngoài hạn mức</span>}
                      {r.line.price !== r.line.listPrice && !r.priceBad && (
                        <span className="rounded-md bg-primary/10 px-1.5 py-px font-bold text-primary">
                          Giá sửa
                        </span>
                      )}
                      {/* Chủ nhà 24/09/2026: "Bỏ VAT từng dòng" — thuế nói MỘT lần ở
                          nút thuế cả đơn dưới thanh tổng, không lặp trên từng dòng. */}
                      {r.line.note && <span className="italic">“{r.line.note}”</span>}
                    </span>
                  </span>
                </button>
                {/* ⚠ NÚT XOÁ LUÔN CÓ MẶT, không nấp sau nút − ở số 1: muốn
                    bỏ một dòng đang để 8 thùng thì không phải bấm − bảy
                    lần mới thấy nó. */}
                <button
                  type="button"
                  onClick={() => cart.setQty(r.i, 0)}
                  aria-label={`Xoá ${r.product?.name ?? "dòng"}`}
                  className="tap grid h-11 w-11 shrink-0 place-items-center rounded-xl text-on-surface-variant active:bg-error/10 active:text-error"
                >
                  <Trash2 className="h-[18px] w-[18px]" />
                </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[17px] font-extrabold tabular-data">
                    {formatCurrency(r.line.qty * netPriceOf(r.line))}
                  </span>
                  <div className="w-[164px]">
                    <Stepper qty={r.line.qty} onChange={(q) => cart.setQty(r.i, q)} />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ⚠ GIẢM GIÁ CẢ ĐƠN — chủ nhà 24/09/2026: "làm đơn chưa có giảm giá tổng
            đơn". Như POS; khoá khi không có quyền sửa giá (cùng luật giảm dòng). */}
        {cart.cart.length > 0 && (
          <GiamGiaDon
            value={cart.docDiscount ?? { value: 0, unit: "vnd" }}
            base={cart.totals.subtotal + cart.totals.docDiscount}
            amount={cart.totals.docDiscount}
            disabled={!canEditPrice}
            onChange={cart.setDocDiscount}
          />
        )}

        {/*
          LẬP ĐƠN GIÚP NHÂN VIÊN — chủ nhà chốt 21/09/2026: "NPP tạo đơn
          xong chọn nhân viên -> thành đơn hàng của nhân viên".

          ⚠ CHỈ HIỆN CHO CHỦ NHÀ / QUẢN LÝ. Nhân viên bán hàng lập đơn
            của chính mình; cho họ chọn tên người khác là mở đường ghi
            doanh số sang tên đồng nghiệp.

          ⚠ ĐỨNG NGAY TRƯỚC KHỐI HÀNG TRẢ, TRÊN THANH LƯU. Đây là một
            quyết định về NGƯỜI, không phải về hàng — nhét lẫn vào bảng
            dòng hàng là nó chìm mất giữa lúc người ta đang gõ số lượng.

          ⚠ ĐỂ TRỐNG LÀ CHÍNH MÌNH, và nói ra chứ không để đoán. Một ô
            rỗng không nhãn là người dùng không biết đơn sẽ đứng tên ai.
        */}
        {canPickSeller && (
          <div className="rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
            <p className="text-sm font-extrabold">Đơn này của nhân viên nào</p>
            <p className="mb-2 mt-px text-xs font-semibold text-on-surface-variant">
              Để trống là đơn đứng tên bạn. Chọn nhân viên thì doanh số và hoa hồng
              tính cho người đó.
            </p>
            <SearchSelect
              id="cart-seller"
              options={sellerOptions}
              valueId={sellerId}
              onPick={(o) => setSellerId(o?.id ?? "")}
              placeholder="Gõ tên nhân viên…"
              emptyHint="Không tìm thấy nhân viên nào khớp."
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => router.push("/sell/returns")}
          className="flex min-h-14 items-center gap-2.5 rounded-2xl bg-surface-container-lowest px-3.5 text-left shadow-card"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">Hàng trả / đổi kèm đơn</span>
            <span className="mt-px block truncate text-xs font-semibold text-on-surface-variant">
              {cart.returnLines.length
                ? `${cart.returnLines.length} dòng · trừ ${formatCurrency(cart.returnCredit)}`
                : "Chưa có"}
            </span>
            {exchangeOver > 0 && (
              <span className="mt-0.5 block text-xs font-extrabold text-error">
                {exchangeOver} dòng đổi hàng vượt tồn kho
              </span>
            )}
            {returnPriceBad > 0 && (
              <span className="mt-0.5 block text-xs font-extrabold text-error">
                {returnPriceBad} dòng trả vượt trần giá
              </span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant" />
        </button>

        <div className="rounded-2xl bg-surface-container-lowest px-3 py-2 shadow-card">
          <input
            value={cart.notes}
            onChange={(e) => cart.setNotes(e.target.value)}
            placeholder="Ghi chú đơn (giao trước 10h, để hàng sau quầy…)"
            className="h-10 w-full border-0 bg-transparent text-sm font-semibold outline-none"
          />
        </div>

        <button
          type="button"
          onClick={() => router.push("/sell/terms")}
          className="flex min-h-14 items-center gap-2.5 rounded-2xl bg-surface-container-lowest px-3.5 text-left shadow-card"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold">Điều khoản &amp; giao hàng</span>
            <span className="mt-px block truncate text-xs font-semibold text-on-surface-variant">
              {termsSummary}
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant" />
        </button>
      </div>

      <SellBottomBar className="flex flex-col gap-2.5">
        {breakdownOpen && (
          <div className="flex flex-col gap-1.5 border-b border-outline-variant/40 pb-1.5 text-[13px] font-semibold text-on-surface-variant">
            {cart.totals.docDiscount > 0 && (
              <Row label="Tiền hàng" value={formatCurrency(cart.totals.subtotal + cart.totals.docDiscount)} />
            )}
            {cart.totals.docDiscount > 0 && (
              <Row label="Giảm giá đơn" value={`−${formatCurrency(cart.totals.docDiscount)}`} />
            )}
            <Row label="Tạm tính" value={formatCurrency(cart.totals.subtotal)} />
            {/* Chiết khấu dòng (so với giá bảng) — giảm giá đơn đã có dòng riêng ở trên. */}
            {cart.totals.discount - cart.totals.docDiscount > 0 && (
              <Row label="Chiết khấu" value={`−${formatCurrency(cart.totals.discount - cart.totals.docDiscount)}`} error />
            )}
            {/* ⚠ THUẾ CẢ ĐƠN — bấm vòng 0 → 5 → 8 → 10%, đặt cho mọi dòng (như
                POS). Các dòng đang lệch nhau thì nút nói "nhiều mức". */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                VAT
                <button
                  type="button"
                  aria-label="Thuế VAT cả đơn"
                  disabled={cart.cart.length === 0}
                  onClick={() => cart.setVatAll(vatChungKeTiep(vatChung))}
                  className="h-7 rounded-lg border-[1.5px] border-outline-variant px-2 text-xs font-extrabold text-primary disabled:opacity-40"
                >
                  {vatChung === null ? "nhiều mức" : vatLabel(vatChung)}
                </button>
              </span>
              <span className="tabular-data text-on-surface">{formatCurrency(cart.totals.vat)}</span>
            </div>
            {cart.totals.returnCredit > 0 && (
              <Row label="Trừ hàng trả" value={`−${formatCurrency(cart.totals.returnCredit)}`} />
            )}
            <button
              type="button"
              onClick={() => {
                cart.clear()
                // ⚠ Đang sửa đơn thì "Bỏ sửa" KHÔNG được xoá đơn — nó chỉ
                // buông giỏ ra. Đơn cũ vẫn nằm nguyên trên máy chủ.
                router.push(editing ? `/orders/${editing.orderId}` : "/sell")
              }}
              className="h-8 self-start text-[13px] font-extrabold text-error"
            >
              {editing ? "Bỏ sửa, giữ nguyên đơn cũ" : "Huỷ đơn"}
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setBreakdownOpen((v) => !v)}
          aria-expanded={breakdownOpen}
          className="flex min-h-8 w-full items-center justify-between"
        >
          <span className="flex items-center gap-2 text-[15px] font-extrabold">
            Tổng tiền
            <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full border-[1.5px] border-primary px-1 text-xs text-primary">
              {cart.cart.length}
            </span>
            {breakdownOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-on-surface-variant" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-on-surface-variant" />
            )}
          </span>
          <span className="text-[22px] font-extrabold tabular-data">
            {formatCurrency(cart.totals.grandTotal)}
          </span>
        </button>
        {/*
          ⚠ NÚT MỜ PHẢI NÓI VÌ SAO, VÀ TRÊN ĐIỆN THOẠI THÌ `title` KHÔNG
            HIỆN RA. Một cái nút xám không lời giải thích là người dùng
            bấm mãi không ăn rồi nghĩ máy hỏng.
        */}
        {donHo && (
          <p className="rounded-2xl bg-surface-container-low px-3.5 py-2.5 text-xs font-semibold text-on-surface-variant">
            Đơn này đứng tên nhân viên khác nên <b>không lưu nháp được</b> — nháp là sổ
            tay riêng của người đứng tên, bạn sẽ không mở lại được. Bấm <b>Gửi đơn</b>.
          </p>
        )}
        <div className="flex gap-2.5">
          {/* Phiếu tạm VẪN có "Lưu nháp" — đó là cách RÚT ĐƠN VỀ khi nhà
              phân phối chưa xuất hàng. Nút phụ ở đây là thoát khỏi phần
              sửa mà không đụng gì tới đơn. */}
          {editing?.status === "submitted" ? (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                cart.clear()
                router.replace(`/orders/${editing.orderId}`)
              }}
              className="h-13 flex-1 rounded-2xl border-[1.5px] border-outline-variant bg-surface-container-lowest py-3.5 text-base font-extrabold text-on-surface-variant disabled:opacity-40"
            >
              Bỏ sửa
            </button>
          ) : (
            <button
              type="button"
              disabled={
                submitting || !cart.customerId || hasPriceBad || returnPriceBad > 0 || donHo
              }
              onClick={() => submit(true)}
              title={
                donHo
                  ? "Đơn đứng tên nhân viên khác thì không lưu nháp được — bấm Gửi đơn."
                  : undefined
              }
              className="h-13 flex-1 rounded-2xl border-[1.5px] border-primary bg-surface-container-lowest py-3.5 text-base font-extrabold text-primary disabled:opacity-40"
            >
              Lưu nháp
            </button>
          )}
          <button
            type="button"
            disabled={
              submitting ||
              cart.cart.length === 0 ||
              !cart.customerId ||
              hasPriceBad ||
              returnPriceBad > 0
            }
            onClick={() => submit(false)}
            className="h-13 flex-[1.3] rounded-2xl bg-primary py-3.5 text-base font-extrabold text-on-primary disabled:opacity-40"
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
        lineDiscount
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

function Row({ label, value, error }: { label: string; value: string; error?: boolean }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className={cn("tabular-data", error ? "text-error" : "text-on-surface")}>{value}</span>
    </div>
  )
}

/** Ô giảm giá cả đơn (₫ / %). Lật đơn vị giữ nguyên số tiền — quy tắc POS. */
function GiamGiaDon({
  value, base, amount, disabled, onChange,
}: {
  value: DiscountInput
  /** Tiền hàng sau giảm dòng, trước giảm đơn — nền của phần trăm. */
  base: number
  amount: number
  disabled: boolean
  onChange: (d: DiscountInput) => void
}) {
  const pct = value.unit === "pct"
  const [pctText, setPctText] = useState(pct && value.value ? String(value.value) : "")
  return (
    <div className="mt-3 rounded-2xl bg-surface-container-lowest p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-sm font-extrabold">Giảm giá đơn</span>
        <input
          aria-label="Giảm giá đơn"
          disabled={disabled}
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
          className={cn(
            "h-11 w-32 rounded-xl border-[1.5px] px-3 text-right text-base font-extrabold tabular-data outline-none",
            amount > 0 ? "border-primary" : "border-outline-variant",
            disabled ? "bg-surface-container" : "bg-surface-container-lowest"
          )}
        />
        <button
          type="button"
          disabled={disabled}
          aria-label={pct ? "Đơn vị giảm đơn — đang là phần trăm, bấm để đổi sang đồng" : "Đơn vị giảm đơn — đang là đồng, bấm để đổi sang phần trăm"}
          onClick={() => {
            const moi = switchUnit(value, base)
            if (moi.unit === "pct") setPctText(moi.value === 0 ? "" : String(moi.value))
            onChange(moi)
          }}
          className={cn(
            "h-11 w-12 shrink-0 rounded-xl border-[1.5px] text-base font-extrabold",
            pct ? "border-primary bg-primary/10 text-primary" : "border-outline-variant text-on-surface-variant"
          )}
        >
          {unitLabel(value.unit)}
        </button>
      </div>
      {(disabled || amount > 0) && (
        <p className="mt-1.5 text-xs font-bold text-on-surface-variant">
          {disabled ? "Bạn không có quyền sửa giá nên không giảm giá đơn được." : `Giảm ${formatCurrency(amount)} trên tiền hàng ${formatCurrency(base)}`}
        </p>
      )}
    </div>
  )
}
