"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"
import { orderLinesToCart, type OrderLineRow } from "@/lib/sell/order-edit"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/hooks/use-toast"

/**
 * "Đặt lại đơn này": chép các dòng của một đơn cũ vào giỏ để tạo đơn MỚI.
 *
 * KHÁC VỚI SỬA ĐƠN (`/sell/edit/[id]`) ở hai chỗ, và cả hai đều cố ý:
 *   · Giỏ KHÔNG mang `editing` — lưu là tạo đơn mới, không ghi đè đơn cũ.
 *   · Giá lấy theo BẢNG GIÁ HÔM NAY của khách, không phải giá đã bán lần
 *     trước. Khách đặt lại là đặt với giá hiện hành; chép giá cũ sang là
 *     bán theo bảng giá tháng trước mà không ai để ý.
 *
 * Mặt hàng không còn trong danh mục thì BỎ và NÓI RA — không có giá hiện
 * hành để bán, và im lặng bỏ là đơn thiếu hàng mà nhân viên không biết.
 */
interface OrderHead {
  id: string
  order_code: string
  customer_id: string
  payment_terms: string | null
}

export default function SellReorderLoaderPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const cart = useSellCart()
  const { products, loading: dataLoading, customerById } = useSellData()

  const [error, setError] = useState<string | null>(null)
  const [head, setHead] = useState<OrderHead | null>(null)
  const [lines, setLines] = useState<OrderLineRow[] | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const openedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const supabase = createClient()
      const [headRes, lineRes] = await Promise.all([
        supabase
          .from("sales_orders")
          .select("id, order_code, customer_id, payment_terms")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("sales_order_lines")
          .select("product_id, unit_name, quantity, unit_price, conversion_factor, note")
          .eq("order_id", id)
          .order("product_id", { ascending: true })
          .order("unit_name", { ascending: true }),
      ])
      if (cancelled) return
      if (headRes.error) return setError(headRes.error.message)
      if (lineRes.error) return setError(lineRes.error.message)
      // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi — nói cả hai khả năng.
      if (!headRes.data) {
        return setError("Không mở được đơn này — đơn không tồn tại hoặc bạn không có quyền xem.")
      }
      setHead(headRes.data as OrderHead)
      setLines((lineRes.data as OrderLineRow[]) ?? [])
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  const open = useCallback(() => {
    if (!head || !lines || openedRef.current) return
    openedRef.current = true
    const customer = customerById(head.customer_id)
    const known = lines.filter((l) => products.some((p) => p.id === l.product_id))
    const missing = lines.length - known.length
    if (known.length === 0) {
      setError("Không mặt hàng nào của đơn này còn trong danh mục nên không đặt lại được.")
      return
    }
    // Giá hôm nay: `orderLinesToCart` tính `listPrice` theo bảng giá hiện
    // hành; ta gán luôn `price = listPrice` thay vì giữ giá đã bán.
    const rows = orderLinesToCart(known, products, customer?.group_id ?? null).map((r) => ({
      ...r,
      price: r.listPrice,
      note: "",
    }))
    if (missing > 0) {
      toast({
        title: `Bỏ ${missing} mặt hàng không còn trong danh mục`,
        description: "Các dòng còn lại đã vào giỏ theo giá hiện hành.",
      })
    }
    cart.loadForEdit({
      cart: rows,
      customerId: head.customer_id,
      notes: "",
      paymentTerms: head.payment_terms ?? "",
      expectedDelivery: "",
      returnReason: "damaged",
      returnLines: [],
      /**
       * ⚠ ĐẶT LẠI RA MỘT ĐƠN MỚI ĐỨNG TÊN NGƯỜI ĐANG BẤM, không kế thừa
       *   NVBH của đơn cũ. Rỗng = chính người đang lập. Chép tên người
       *   khác sang là ghi doanh số cho họ một đơn họ không hề bán; ai
       *   muốn thế thì chọn tay ở màn giỏ. Đây cũng đúng nếp cũ: trước
       *   lần sửa này ô ấy là state của màn giỏ, vào màn là rỗng.
       */
      sellerId: "",
      editing: null,
    })
    toast({ title: `Đã chép ${rows.length} dòng từ ${head.order_code} vào đơn mới` })
    router.replace("/sell/cart")
  }, [head, lines, products, customerById, cart, router])

  // Giỏ đang có hàng chưa gửi thì phải hỏi trước — chép đè là mất công gõ.
  const clash = cart.ready && cart.cart.length > 0 && !confirmed

  useEffect(() => {
    if (!head || !lines || dataLoading || !cart.ready || clash || error) return
    open()
  }, [head, lines, dataLoading, cart.ready, clash, error, open])

  return (
    <div className="flex min-h-screen flex-col bg-surface pb-nav">
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
          {head ? `Đặt lại ${head.order_code}` : "Đặt lại đơn"}
        </h1>
      </div>

      <div className="grid content-start gap-2.5 px-3 pt-1">
        {error && (
          <div className="grid gap-2.5 rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
            <p className="text-[15px] font-bold leading-snug text-error">{error}</p>
            <button
              type="button"
              onClick={() => router.replace(`/orders/${id}`)}
              className="h-12 rounded-2xl bg-primary text-base font-extrabold text-on-primary"
            >
              Về chi tiết đơn
            </button>
          </div>
        )}

        {!error && clash && (
          <div className="grid gap-2.5 rounded-2xl bg-surface-container-lowest p-3.5 shadow-card">
            <p className="text-[15px] font-bold leading-snug">
              Giỏ đang có {cart.cart.length} mặt hàng chưa gửi
              {cart.editing ? ` của đơn ${cart.editing.orderCode}` : ""}. Đặt lại{" "}
              {head?.order_code ?? "đơn này"} sẽ thay toàn bộ giỏ hiện tại.
            </p>
            <button
              type="button"
              onClick={() => setConfirmed(true)}
              className="h-12 rounded-2xl bg-primary text-base font-extrabold text-on-primary"
            >
              Thay giỏ, đặt lại đơn này
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

        {!error && !clash && (
          <>
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-24 rounded-2xl" />
            <p className="pt-1 text-center text-sm font-semibold text-on-surface-variant">
              Đang chép đơn…
            </p>
          </>
        )}
      </div>
    </div>
  )
}
