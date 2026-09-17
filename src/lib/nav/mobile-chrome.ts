/**
 * Màn nào được có thanh nav dưới màn hình.
 *
 * ⚠ LỖI NGƯỜI DÙNG BÁO. Màn giỏ hàng có thanh hành động dính đáy của
 * riêng nó ("Lưu tạm" / "Đặt hàng"), mà thanh nav cũng dính đáy và nằm
 * TRÊN nó. Kết quả: hai nút quan trọng nhất của cả luồng bị che mất một
 * nửa, người dùng cuộn kiểu gì cũng không thấy — vì cả hai đều `fixed`,
 * cuộn không làm chúng nhúc nhích.
 *
 * Hai thanh dính đáy chồng nhau là lỗi BỐ CỤC, không phải lỗi đệm: thêm
 * padding chỉ đẩy nội dung, không đẩy được một khối `fixed`.
 *
 * CÁCH XỬ: màn nào đang trong một luồng dở dang và có hành động chính của
 * riêng nó thì KHÔNG hiện nav. Người dùng vẫn có nút quay lại ở góc trái,
 * và đỡ bấm nhầm sang tab khác lúc đang soạn đơn.
 */

/**
 * Các màn tự dựng thanh hành động dính đáy.
 *
 * ⚠ So theo tiền tố đường dẫn. Thêm màn mới có thanh dính đáy mà quên ghi
 * vào đây thì nút của nó bị che — phép kiểm trong `tests/` quét thư mục
 * route và bắt đúng chuyện đó.
 */
export const OWN_ACTION_BAR_ROUTES = [
  "/sell/cart",
  "/sell/terms",
  "/sell/returns",
  "/sell/scan",
] as const

export function showsBottomNav(pathname: string): boolean {
  return !OWN_ACTION_BAR_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/**
 * Màn tự dựng ĐẦU TRANG riêng trên điện thoại (nút lùi + mã đơn + huy hiệu
 * trạng thái, theo mẫu thiết kế "Chi tiết đơn"). Để app bar chuẩn chồng
 * lên là hai hàng tiêu đề cho một màn — đúng lỗi mà /home và /sell đã
 * tránh. Desktop vẫn có app bar: ở đó bố cục hai cột cần nó.
 */
export function hidesMobileAppBar(pathname: string): boolean {
  return /^\/orders\/[^/]+$/.test(pathname)
}
