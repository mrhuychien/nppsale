/**
 * NHÁNH `newdesign` DÙNG MÀN `/pos` CHO VIỆC LẬP VÀ SỬA ĐƠN TRÊN MÁY
 * TÍNH.
 *
 * Chủ nhà chốt 22/09/2026: "ở branch này mày viết luôn tích hợp phần
 * này vào các thao tác đi, để test trên preview. VD: trên desktop ấn
 * tạo đơn -> dùng tạo đơn pos, sửa -> dùng sửa pos, main vẫn chạy
 * production bình thường".
 *
 * ⚠ ĐỔI Ở HAI CỬA, KHÔNG ĐỔI Ở SÁU CÁI NÚT. Nút "Tạo đơn" nằm ở sáu
 *   chỗ (trang chủ, menu trái, danh sách đơn, danh sách khách, hồ sơ
 *   khách, tuyến thăm) và nút "Sửa đơn" ở ba chỗ. Sửa từng nút là chắc
 *   chắn sót một — và cái sót ấy lại đưa người test về màn cũ, rồi họ
 *   kết luận "POS không chạy". Nên chặn ngay tại `/sell` và
 *   `/sell/edit/[id]`: mọi đường, kể cả dấu trang đã lưu, đều đi qua đó.
 *
 * ⚠ CHỈ MÁY TÍNH. Chủ nhà đã chốt từ đợt thiết kế: "Chỉ đổi trang
 *   desktop, trang mobile để nguyên". Màn `/pos` là bảng ba cột rộng
 *   1.400px — mở trên điện thoại là không dùng được.
 *
 * ⚠ NGƯỠNG TRÙNG VỚI `lg:` CỦA TAILWIND (1024px). Nút "Tạo đơn" ở danh
 *   sách đơn đang ẩn/hiện theo đúng ngưỡng ấy; lấy một ngưỡng khác là
 *   có một dải bề ngang mà nút thì hiện còn chuyển hướng thì không.
 *
 * ⚠ ĐÂY LÀ THỨ CỦA RIÊNG NHÁNH NÀY. `main` không có tệp này và vẫn
 *   chạy `/sell` như cũ — đó là điều chủ nhà yêu cầu.
 */

/** Ngưỡng `lg` của Tailwind. */
export const POS_MIN_WIDTH = 1024

/** Đơn mới trên màn POS. Xem `posHref` — đơn chưa lưu mang mã `moi`. */
export function posNewOrderHref(customerId?: string | null): string {
  const id = (customerId ?? "").trim()
  return id
    ? `/pos/don-hang/moi?customerId=${encodeURIComponent(id)}`
    : "/pos/don-hang/moi"
}

/** Sửa một đơn đã lưu trên màn POS. */
export function posEditOrderHref(orderId: string): string {
  return `/pos/don-hang/${encodeURIComponent(orderId)}/sua`
}

/**
 * Máy tính đủ rộng để dùng màn POS chưa?
 *
 * ⚠ TRẢ `false` KHI KHÔNG CÓ `window`. Hàm này chạy cả lúc render trên
 *   máy chủ; đoán "đủ rộng" ở đó là máy chủ dựng một cú chuyển hướng
 *   cho cả người dùng điện thoại.
 */
export function manDuRong(): boolean {
  if (typeof window === "undefined") return false
  return window.innerWidth >= POS_MIN_WIDTH
}
