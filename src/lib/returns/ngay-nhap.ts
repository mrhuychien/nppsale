/**
 * NGÀY NHẬP KHO CỦA PHIẾU TRẢ TỰ SINH — chủ nhà 28/09/2026: "Các phiếu trả tự sinh
 * tao muốn sửa ngày lúc nhập kho" (mig 211, `complete_return(id, kho, ngày)`).
 *
 * Cùng luật máy chủ: không sau hôm nay, không trước ngày hóa đơn. Ngày là chuỗi
 * `YYYY-MM-DD` theo giờ VN nên so chuỗi là đủ.
 */
export function loiNgayNhap(ngay: string, homNay: string, ngayHoaDon?: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return "Chọn ngày nhập kho"
  if (ngay > homNay) return "Ngày nhập kho không được sau hôm nay"
  if (ngayHoaDon && ngay < ngayHoaDon) return "Ngày nhập kho không được trước ngày hóa đơn"
  return null
}
