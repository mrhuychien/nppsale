/**
 * Tổng đơn sau khi sửa "SL & đơn giá" ngay trên màn chi tiết đơn.
 *
 * ⚠ CÙNG CÔNG THỨC VỚI LÚC TẠO ĐƠN (`cartTotals`):
 *     tổng = tạm tính + VAT − khoản trừ hàng trả
 *   Bản cũ tính `subtotal − order.discount + order.vat`, sai ba chỗ:
 *     · làm MẤT khoản trừ hàng trả (vốn đã nằm trong `order.total`) — lưu
 *       lại mà không đổi gì là tổng TĂNG đúng bằng khoản trừ, và dòng
 *       "Trừ hàng trả" biến mất vì nó được suy ra từ chính khoảng hụt ấy;
 *     · giữ nguyên VAT cũ dù số lượng đã đổi;
 *     · trừ `discount` THÊM một lần, trong khi `line_total` đã là số sau
 *       chiết khấu.
 *
 * ⚠ VAT TÍNH LẠI THEO TỪNG DÒNG với thuế suất của đúng mặt hàng (kể cả
 *   mặt hàng vừa đổi / vừa thêm), làm tròn về đồng như `cartTotals`.
 */
export interface DongTinhTong {
  line_total: number
  vat_rate: number
}

export function tongSauSuaTaiCho(
  dong: readonly DongTinhTong[],
  khoanTruHangTra: number
): { subtotal: number; vat: number; total: number } {
  const subtotal = Math.round(dong.reduce((s, l) => s + (Number(l.line_total) || 0), 0))
  const vat = Math.round(dong.reduce((s, l) => s + (Number(l.line_total) || 0) * (Number(l.vat_rate) || 0), 0))
  const total = Math.max(0, subtotal + vat - Math.max(0, Math.round(khoanTruHangTra || 0)))
  return { subtotal, vat, total }
}
