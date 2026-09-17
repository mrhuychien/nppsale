/**
 * MỘT đường vào duy nhất cho việc "tạo đơn hàng mới".
 *
 * VÌ SAO GOM VỀ MỘT HẰNG SỐ
 *   Nút "Tạo đơn" nằm ở SÁU chỗ: trang chủ, menu bên trái, danh sách đơn,
 *   danh sách khách, hồ sơ khách và tuyến thăm. Mỗi chỗ tự viết đường dẫn
 *   thì đổi luồng một lần là phải nhớ sáu chỗ, và chỗ nào quên sẽ đưa
 *   người dùng vào một màn nhập hàng KHÁC — hai cách làm cho cùng một việc,
 *   đúng thứ mà luồng bán hàng mới sinh ra để dọn.
 *
 * ⚠ Màn `/orders/new` vẫn còn và vẫn chạy (bản đầy đủ cho máy tính, và các
 * đường dẫn cũ đã lưu vẫn mở được), nhưng KHÔNG còn nút nào trỏ tới nó.
 */
export const NEW_ORDER_HREF = "/sell"

/**
 * Đường dẫn tạo đơn, kèm sẵn khách nếu biết.
 *
 * ⚠ Mã khách phải được mã hoá. Đường dẫn dựng bằng nối chuỗi thô là chỗ
 * một ký tự `&` hay `#` trong dữ liệu làm hỏng cả tham số phía sau.
 */
export function newOrderHref(customerId?: string | null): string {
  const id = (customerId ?? "").trim()
  return id ? `${NEW_ORDER_HREF}?customerId=${encodeURIComponent(id)}` : NEW_ORDER_HREF
}
