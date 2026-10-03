/**
 * LỌC KHÁCH THEO NHÂN VIÊN PHỤ TRÁCH — chạy trên MÁY CHỦ.
 *
 * ⚠ CHỦ NHÀ 03/10/2026: "danh sách khách hàng sao lọc theo nhân viên ra danh sách không đúng, bị thiếu — nhân viên
 *   60 khách mà có 3 khách hiện". Bản cũ tải 20 khách / trang rồi mới lọc theo NV trong 20 khách ấy. Nay nhúng
 *   `customer_assignments` (NV CHÍNH, đang hoạt động — cùng nghĩa cột "Phụ trách"): có NV → `!inner` + lọc
 *   `user_id`; "Chưa phân công" → `!left` + phép loại `nv_chinh=is.null` (PostgREST anti-join).
 */
export const CHUA_PHAN_CONG = "_none"

/** Phần select thêm vào truy vấn `customers` khi đang lọc NV (rỗng = không lọc). */
export function chonNv(nvLoc: string | null): string {
  if (!nvLoc) return ""
  return nvLoc === CHUA_PHAN_CONG ? ", nv_chinh:customer_assignments!left(user_id)" : ", nv_chinh:customer_assignments!inner(user_id)"
}
