import { redirect } from "next/navigation"
import { newOrderHref } from "@/lib/nav/new-order"

/**
 * Màn tạo đơn cũ đã bị xoá — đường dẫn này chỉ còn là một cú chuyển hướng.
 *
 * VÌ SAO KHÔNG XOÁ LUÔN CẢ ĐƯỜNG DẪN
 *   `/orders/new` đã sống trong app một thời gian dài: nó nằm trong dấu
 *   trang của người dùng, trong tin nhắn hướng dẫn nhau, và trong lịch sử
 *   trình duyệt của mọi máy đang dùng. Để nó trả 404 thì người mở lên
 *   không kết luận "màn này đổi chỗ" mà kết luận "app hỏng", rồi nhắn hỏi.
 *   Một dòng chuyển hướng rẻ hơn nhiều so với chuyện đó.
 *
 * ⚠ Giữ nguyên `customerId`. Đường tắt "tạo đơn cho khách này" từng trỏ
 * vào đây; mất tham số là bắt nhân viên đang đứng trước cửa hàng đi tìm
 * lại tên khách trong danh sách.
 */
export default function NewOrderRedirect({
  searchParams,
}: {
  searchParams: { customerId?: string }
}) {
  redirect(newOrderHref(searchParams.customerId))
}
