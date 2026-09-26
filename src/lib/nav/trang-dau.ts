/**
 * TRANG ĐẦU THEO VAI — chủ nhà 26/09/2026: "Khi đăng nhập vào hoặc gõ địa chỉ không
 * nppsale.vercel.app → với nhân viên đang tự chuyển vào trang dashboard. Sửa lại nhân viên tự
 * chuyển về trang home".
 *
 * Khối văn phòng (chủ, quản lý, kế toán) giữ như cũ: gõ địa chỉ gốc → Tổng quan, đăng nhập →
 * Đơn hàng. Nhân viên (bán hàng, kho…) luôn về Trang chủ `/home`.
 */
const KHOI_VAN_PHONG = new Set(["owner", "manager", "accountant"])

export function laNhanVien(role: string | null | undefined): boolean {
  return !KHOI_VAN_PHONG.has(role ?? "")
}

/** Gõ địa chỉ gốc `/`. Chưa biết vai → coi là nhân viên (không mở Tổng quan toàn NPP). */
export function trangGoc(role: string | null | undefined): string {
  return laNhanVien(role) ? "/home" : "/dashboard"
}

/** Vừa đăng nhập xong. */
export function trangSauDangNhap(role: string | null | undefined): string {
  return laNhanVien(role) ? "/home" : "/orders"
}
