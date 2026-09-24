/**
 * Bộ lọc báo cáo cuối ngày — áp CÙNG MỘT LUẬT cho đơn tạo trong ngày và hóa đơn
 * đã xuất.
 *
 * ⚠ CHỦ NHÀ 24/09/2026: "sửa 2 lỗi biết chưa sửa". Bản cũ lọc theo những cột
 *   không được đọc về (`created_by`, `payment_terms`) hoặc không hề có trong sổ
 *   (`sales_method`) — chọn bộ lọc nào cũng ra RỖNG. Nay:
 *   · "Người tạo": đơn → `created_by` (mig 178); hóa đơn → `posted_by` (người lập).
 *   · "Hình thức thanh toán": so đúng mã `payment_terms` (COD / NET7 …).
 *   · "Phương thức bán hàng": BỎ — sổ không ghi thông tin này ở đâu cả.
 */
export type LocCuoiNgay = {
  khach: readonly string[]
  nhanVien: readonly string[]
  nguoiTao: string
  hinhThuc: string
}

export type ChungTuCuoiNgay = {
  customer_id: string
  sales_user_id?: string | null
  created_by?: string | null
  posted_by?: string | null
  payment_terms?: string | null
}

export function quaLocCuoiNgay(o: ChungTuCuoiNgay, loc: LocCuoiNgay): boolean {
  if (loc.khach.length && !loc.khach.includes(o.customer_id)) return false
  if (loc.nhanVien.length && !loc.nhanVien.includes(o.sales_user_id || "")) return false
  if (loc.nguoiTao && (o.created_by ?? o.posted_by ?? "") !== loc.nguoiTao) return false
  if (loc.hinhThuc && (o.payment_terms || "").toUpperCase() !== loc.hinhThuc.toUpperCase()) return false
  return true
}
