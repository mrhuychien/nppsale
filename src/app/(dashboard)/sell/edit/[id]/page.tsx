"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeft, TriangleAlert } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { canEditOrder, whyCannotEdit } from "@/lib/orders/edit-permission"
import { hasPermission } from "@/lib/permissions"
import {
  isSellEditable, orderLinesToCart, editableReturnOf, returnLinesToCart,
  type OrderLineRow, type PendingReturnRow,
} from "@/lib/sell/order-edit"
import { Skeleton } from "@/components/ui/skeleton"
import { PosDesktopRedirect } from "@/components/sell/pos-desktop-redirect"
import { posEditOrderHref, manDuRong } from "@/lib/nav/pos-preview"
import { toast } from "@/hooks/use-toast"
import type { OrderStatus } from "@/types"

/**
 * Nạp một đơn đã lưu ngược vào giỏ rồi mở màn giỏ hàng.
 *
 * VÌ SAO LÀ MỘT MÀN RIÊNG CHỨ KHÔNG PHẢI THAM SỐ CỦA MÀN GIỎ
 *   Màn giỏ đã có đủ việc phải làm. Nhét thêm "nếu có ?orderId thì tải đơn
 *   về, trừ khi đã tải rồi" vào đó là thêm một trạng thái chỉ sai khi mạng
 *   chậm. Ở đây thì việc tải có màn riêng, có ô chờ, có chỗ báo lỗi, và
 *   khi xong thì `replace` — nút Back của điện thoại không quay lại đây.
 */

interface OrderHead {
  id: string
  order_code: string
  status: string
  customer_id: string
  payment_terms: string | null
  expected_delivery: string | null
  notes: string | null
  sales_user_id: string | null
}

export default function SellEditLoaderPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const cart = useSellCart()
  const { products, loading: dataLoading, customerById } = useSellData()

  const [error, setError] = useState<string | null>(null)
  const [head, setHead] = useState<OrderHead | null>(null)
  const [lines, setLines] = useState<OrderLineRow[] | null>(null)
  /**
   * Phiếu trả kèm đơn. `null` = đã đọc xong, không có phiếu nào nắm được;
   * `undefined` = chưa đọc / đọc hỏng, và khi đó lúc lưu phải ĐỨNG YÊN
   * chứ không được coi như đơn không có hàng trả.
   */
  const [heldReturn, setHeldReturn] = useState<PendingReturnRow | null | undefined>(undefined)
  // ⚠ Chỉ hỏi MỘT lần. Người dùng bấm "Thay giỏ" xong mà câu hỏi hiện lại
  // vì effect chạy lượt nữa thì họ kẹt trong vòng lặp.
  const [confirmed, setConfirmed] = useState(false)
  const openedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const [headRes, lineRes, retRes] = await Promise.all([
        supabase
          .from("sales_orders")
          .select(
            "id, order_code, status, customer_id, payment_terms, expected_delivery, notes, sales_user_id"
          )
          .eq("id", id)
          .maybeSingle(),
        /* ⚠ `vat_rate` là cột của mig 183 — máy chưa chạy thì đọc lại không có nó. */
        (async () => {
          const doc = (cot: string) =>
            supabase
              .from("sales_order_lines")
              .select(cot)
              .eq("order_id", id)
              // Bảng dòng đơn KHÔNG ghi lại thứ tự nhập, nên xếp theo một khoá
              // cố định. Không xếp gì thì mỗi lần mở lại đơn, các dòng có thể
              // đảo chỗ — nhìn như đơn vừa bị ai sửa.
              .order("product_id", { ascending: true })
              .order("unit_name", { ascending: true })
          const COT = "product_id, unit_name, quantity, unit_price, conversion_factor, note"
          const r = await doc(`${COT}, vat_rate`)
          return r.error ? doc(COT) : r
        })(),
        /**
         * ⚠ LẤY CẢ PHIẾU KHÔNG NẮM ĐƯỢC. Lọc sẵn `status = 'draft'` ở đây
         *   thì `editableReturnOf` không phân biệt nổi "đơn không có phiếu
         *   trả nào" với "đơn có phiếu trả nhưng đã gửi đi rồi" — hai
         *   chuyện phải nói khác nhau cho người sửa đơn.
         */
        supabase
          .from("returns")
          .select(
            "id, reason, notes, status, invoice_id, lines:return_lines(product_id, unit_name, quantity, unit_price, vat_rate, is_exchange, note, reason)"
          )
          .eq("order_id", id)
          .neq("status", "cancelled"),
      ])
      if (cancelled) return
      if (headRes.error) return setError(headRes.error.message)
      if (lineRes.error) return setError(lineRes.error.message)
      /**
       * ⚠ ĐỌC PHIẾU TRẢ HỎNG THÌ KHÔNG CHẶN CẢ MÀN, nhưng cũng KHÔNG im
       *   lặng. Để `heldReturn` ở `undefined` là lúc lưu sẽ không đụng gì
       *   tới phiếu trả — đơn vẫn sửa được, hàng trả vẫn còn nguyên.
       */
      if (retRes.error) {
        toast({
          title: "Chưa đọc được hàng trả kèm đơn",
          description:
            "Phần hàng trả / hàng đổi sẽ không hiện và cũng KHÔNG bị thay đổi khi bạn lưu. " +
            retRes.error.message,
          variant: "destructive",
        })
      } else {
        const rets = (retRes.data as unknown as PendingReturnRow[]) ?? []
        const held = editableReturnOf(rets)
        const holdable = rets.filter((r) => r.status === "draft" && !r.invoice_id)
        /**
         * ⚠ "KHÔNG NẮM ĐƯỢC CÁI NÀO" KHÁC "ĐƠN KHÔNG CÓ PHIẾU TRẢ". Đơn
         *   có hai phiếu nháp thì `editableReturnOf` trả `null`; để `null`
         *   chạy tiếp là lúc lưu màn này tạo PHIẾU THỨ BA. Chỉ `null` khi
         *   thật sự không có phiếu nháp nào.
         */
        setHeldReturn(held ?? (holdable.length === 0 ? null : undefined))
        if (holdable.length > 1) {
          toast({
            title: `Đơn có ${holdable.length} phiếu trả nháp`,
            description:
              "Màn bán hàng chỉ sửa được một phiếu, nên không nạp phiếu nào. Lưu đơn sẽ KHÔNG làm chúng đổi — sửa ở màn Trả hàng.",
            variant: "destructive",
          })
        }
        const blockedRet = rets.filter((r) => r.status !== "draft" || r.invoice_id)
        if (blockedRet.length > 0) {
          toast({
            title: `${blockedRet.length} phiếu trả không sửa được ở đây`,
            description:
              "Phiếu đã gửi hoặc đã gắn hóa đơn thì sửa ở màn Trả hàng. Lưu đơn không làm nó đổi.",
          })
        }
      }
      // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. "Không thấy đơn" và
      // "không được xem đơn" nhìn giống hệt nhau từ đây, nên nói cả hai.
      if (!headRes.data) {
        return setError("Không mở được đơn này — đơn không tồn tại hoặc bạn không có quyền xem.")
      }
      setHead(headRes.data as OrderHead)
      setLines((lineRes.data as unknown as OrderLineRow[]) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const open = useCallback(() => {
    if (!head || !lines || openedRef.current) return
    openedRef.current = true
    const customer = customerById(head.customer_id)
    /**
     * ⚠ MÁY TÍNH THÌ KHÔNG NẠP GIỎ, KHÔNG ĐẨY SANG `/sell/cart`. Chủ nhà báo
     *   23/09/2026: "Xem nhanh Đơn hàng → Bấm sửa đơn ko ra pos". Hai cú
     *   chuyển trang chạy đua: `PosDesktopRedirect` đi `/pos/…/sua`, rồi
     *   lệnh này đi `/sell/cart` SAU nó — và thắng, vì `/sell/cart` không
     *   có cửa chặn nào. Nhường hẳn cho cửa chặn.
     */
    if (manDuRong()) return
    const rows = orderLinesToCart(lines, products, customer?.group_id ?? null)

    // ⚠ Mặt hàng không còn trong danh mục thì KHÔNG có giá gốc để đối
    // chiếu — nhãn "Giá sửa" và chốt giá sàn im lặng bỏ qua dòng đó. Nói
    // ra, đừng để nhân viên tưởng mọi dòng đều đã được kiểm.
    const missing = lines.filter((l) => !products.some((p) => p.id === l.product_id)).length
    if (missing > 0) {
      toast({
        title: `${missing} mặt hàng không còn trong danh mục`,
        description: "Các dòng đó giữ nguyên giá đã lưu và không kiểm được theo bảng giá hiện tại.",
      })
    }

    cart.loadForEdit({
      cart: rows,
      customerId: head.customer_id,
      notes: head.notes ?? "",
      paymentTerms: head.payment_terms ?? "",
      expectedDelivery: head.expected_delivery ?? "",
      // ⚠ NẠP HÀNG TRẢ LÊN, ĐỪNG GIẤU. Trước đây chỗ này để rỗng để tránh
      //   tạo phiếu trả thứ hai lúc lưu; nhưng người sửa đơn thấy phần
      //   hàng trả trống rỗng nên tưởng nó mất, rồi nhập lại — đúng cái
      //   nhân đôi ấy. Nay `applyOrderEdit` ghi đè đúng phiếu này
      //   (`heldReturnId`), nên nạp lên là an toàn.
      returnReason: heldReturn?.reason || "damaged",
      returnLines: heldReturn ? returnLinesToCart(heldReturn) : [],
      /**
       * ⚠ Ô CHỌN NVBH PHẢI SẴN TÊN NGƯỜI ĐANG ĐỨNG ĐƠN, NẠP NGAY TỪ ĐÂY.
       *   Rỗng nghĩa là "đơn đứng tên người đang lập", nên mở đơn của
       *   nhân viên A ra mà ô rỗng thì chỉ cần bấm Lưu một cái là đơn
       *   nhảy sang tên NPP — doanh số và hoa hồng đi theo, không ai chọn
       *   gì cả. Nạp ở đây, một lần, lúc đơn vào giỏ.
       */
      sellerId: head.sales_user_id ?? "",
      editing: {
        orderId: head.id,
        orderCode: head.order_code,
        status: head.status === "submitted" ? "submitted" : "draft",
        salesUserId: head.sales_user_id ?? null,
        heldReturnId: heldReturn === undefined ? undefined : (heldReturn?.id ?? null),
      },
    })
    router.replace("/sell/cart")
  }, [head, lines, heldReturn, products, customerById, cart, router])

  const editCtx = user && head
    ? {
        role: user.role,
        userId: user.id,
        status: head.status as OrderStatus,
        salesUserId: head.sales_user_id ?? null,
        hasUpdatePermission: hasPermission(user.role, "orders", "update"),
      }
    : null
  const blocked =
    head && !isSellEditable(head.status)
      ? `Đơn đang ở trạng thái “${head.status}” — kho đã bắt đầu xử lý nên không sửa được bằng màn bán hàng.`
      : editCtx && !canEditOrder(editCtx)
        ? (whyCannotEdit(editCtx) ?? "Bạn không có quyền sửa đơn này.")
        : null

  // Giỏ đang có hàng chưa gửi của một đơn KHÁC thì phải hỏi trước.
  const clash =
    cart.ready &&
    cart.cart.length > 0 &&
    cart.editing?.orderId !== id &&
    !confirmed

  useEffect(() => {
    if (!head || !lines || dataLoading || !cart.ready || blocked || clash) return
    open()
  }, [head, lines, dataLoading, cart.ready, blocked, clash, open])

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-nav">
      {/* ⚠ Máy tính thì sửa đơn trên màn `/pos` — chủ nhà chốt
          22/09/2026 cho nhánh `newdesign`. Xem `@/lib/nav/pos-preview`. */}
      <PosDesktopRedirect to={posEditOrderHref(id)} />
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => router.push(`/orders/${id}`)}
          aria-label="Quay lại"
          className="tap grid h-11 w-11 place-items-center text-on-surface"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[22px] font-extrabold">
          {head ? `Sửa ${head.order_code}` : "Mở đơn để sửa"}
        </h1>
      </div>

      <div className="grid content-start gap-2.5 px-3 pt-1">
        {error && (
          <div className="rounded-xl bg-error/10 px-3 py-2.5 text-[13px] font-semibold leading-snug text-error">
            {error}
          </div>
        )}

        {blocked && (
          <div className="grid gap-2.5 rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
            <p className="flex items-start gap-2 text-[15px] font-bold leading-snug">
              <TriangleAlert className="mt-px h-5 w-5 shrink-0 text-[#8a5a00]" />
              {blocked}
            </p>
            <button
              type="button"
              onClick={() => router.replace(`/orders/${id}`)}
              className="h-12 rounded-2xl bg-primary text-base font-extrabold text-on-primary"
            >
              Xem chi tiết đơn
            </button>
          </div>
        )}

        {!blocked && clash && (
          <div className="grid gap-2.5 rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
            <p className="text-[15px] font-bold leading-snug">
              Giỏ đang có {cart.cart.length} mặt hàng chưa gửi
              {cart.editing ? ` của đơn ${cart.editing.orderCode}` : ""}. Mở{" "}
              {head?.order_code ?? "đơn này"} để sửa sẽ thay toàn bộ giỏ hiện tại.
            </p>
            <button
              type="button"
              onClick={() => setConfirmed(true)}
              className="h-12 rounded-2xl bg-primary text-base font-extrabold text-on-primary"
            >
              Thay giỏ, mở đơn này
            </button>
            <button
              type="button"
              onClick={() => router.replace("/sell/cart")}
              className="h-12 rounded-2xl border-[1.5px] border-primary text-base font-extrabold text-primary"
            >
              Giữ giỏ đang có
            </button>
          </div>
        )}

        {!error && !blocked && !clash && (
          <>
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <p className="pt-1 text-center text-sm font-semibold text-on-surface-variant">
              Đang mở đơn…
            </p>
          </>
        )}
      </div>
    </div>
  )
}
