"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useSellCart } from "@/hooks/use-sell-cart"
import { useSellData } from "@/hooks/use-sell-data"

/**
 * Mở màn bán hàng kèm sẵn khách: `/sell?customerId=…`
 *
 * VÌ SAO CẦN
 *   Danh sách khách, hồ sơ khách và tuyến thăm đều có nút "Tạo đơn" cho
 *   ĐÚNG một khách. Trước đây chúng trỏ sang `/orders/new?customerId=…`.
 *   Chuyển các nút đó sang luồng bán hàng mà bỏ mất tham số thì nhân viên
 *   đang đứng trước cửa hàng lại phải đi tìm tên khách trong danh sách —
 *   một bước thừa đúng lúc bận nhất.
 *
 * ⚠ KHÔNG ĐƯỢC LẶNG LẼ ĐỔI KHÁCH CỦA GIỎ ĐANG CÓ HÀNG. Đổi khách là đổi
 * BẢNG GIÁ: mọi dòng trong giỏ lập tức tính theo giá của cửa hàng khác.
 * Nhân viên bấm nhầm một nút trên danh sách khách rồi quay lại giỏ thì
 * thấy đúng số hàng cũ nhưng sai số tiền, mà không có gì nói vì sao.
 */
function Body() {
  const params = useSearchParams()
  const wanted = params.get("customerId")
  const cart = useSellCart()
  const { customerById, loading } = useSellData()
  const [dismissed, setDismissed] = useState(false)

  const known = wanted ? customerById(wanted) : undefined
  const ready = cart.ready && !loading

  // Giỏ còn rỗng thì nhận luôn, không hỏi — không có gì để mất.
  useEffect(() => {
    if (!wanted || !ready || !known) return
    if (cart.customerId === wanted) return
    if (cart.cart.length === 0 && !cart.editing) cart.setCustomerId(wanted)
  }, [wanted, ready, known, cart])

  if (!wanted || !ready) return null

  // ⚠ Mã khách không còn trong danh mục thì NÓI RA. Im lặng bỏ qua là để
  // nhân viên tưởng đã chọn khách rồi, tới lúc bấm Đặt hàng mới biết chưa.
  if (!known) {
    return (
      <div className="mt-1.5 rounded-xl bg-[#fff7e6] px-3 py-2 text-[13px] font-semibold leading-snug text-[#7a4b00]">
        Không tìm thấy khách hàng của đường dẫn này. Chọn khách ở ô bên dưới.
      </div>
    )
  }

  if (cart.customerId === wanted || dismissed) return null

  const current = customerById(cart.customerId)
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-xl bg-[#fff7e6] px-3 py-2 text-[13px] font-semibold leading-snug text-[#7a4b00]">
      <span className="min-w-0 flex-1">
        Giỏ đang có {cart.cart.length} mặt hàng
        {current ? ` của ${current.store_name}` : ""}. Đổi sang{" "}
        <b>{known.store_name}</b> sẽ tính lại theo bảng giá của khách này.
      </span>
      <button
        type="button"
        onClick={() => cart.setCustomerId(wanted)}
        className="h-9 shrink-0 rounded-lg bg-primary px-3 font-extrabold text-on-primary"
      >
        Đổi khách
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="h-9 shrink-0 rounded-lg px-2 font-extrabold"
      >
        Giữ nguyên
      </button>
    </div>
  )
}

export function SellCustomerDeepLink() {
  // `useSearchParams` cần Suspense ở App Router, nếu không cả trang bị ép
  // render động và build cảnh báo.
  return (
    <Suspense fallback={null}>
      <Body />
    </Suspense>
  )
}
