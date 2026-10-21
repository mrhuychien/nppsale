/**
 * NHÃN BẢNG GIÁ ở phụ đề màn đơn POS (`Tạo offline · … · bảng giá Đại lý`).
 *
 * ⚠ CHỮ "bảng giá" CHỈ MỘT LẦN. Bản cũ ghép `bảng giá ${tên}` với tên dự phòng "bảng giá chung" → khách chưa có nhóm
 *   hiện "bảng giá bảng giá chung" (chủ nhà 21/10/2026: "sửa luôn"). Tên nhóm tự mang chữ "Bảng giá …" cũng không lặp.
 * ⚠ Chưa chọn khách thì nói ra, không hứa "bảng giá chung": chọn khách xong giá có thể đổi.
 */
export function nhanBangGia(daChonKhach: boolean, tenNhom: string | null | undefined): string {
  if (!daChonKhach) return "bảng giá: chưa chọn khách"
  const ten = (tenNhom ?? "").trim()
  if (!ten) return "bảng giá chung"
  return /^bảng giá(\s|$)/i.test(ten) ? ten : `bảng giá ${ten}`
}
