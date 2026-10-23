import type { User } from "@/types"

/**
 * HỒ SƠ NGƯỜI ĐĂNG NHẬP — một bộ cột cho cả hai nơi đọc: máy chủ (layout gửi kèm trang) và trình
 * duyệt (`AuthProvider`, khi trang không mang theo hồ sơ).
 *
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm". Đo bản build production (điện thoại, 4G, CPU x4):
 *   mỗi lần mở trang cứng, trang đợi JS chạy xong rồi mới hỏi hồ sơ — một vòng mạng nữa — rồi mới hỏi
 *   dữ liệu của chính nó; màn Đơn hàng của NVBH còn hỏi danh sách HAI lần (lần đầu chưa biết vai). Máy
 *   chủ vốn đã đọc `users` để dựng menu, nên đọc đủ hồ sơ luôn ở đó và gửi kèm trang (`NapHoSo`).
 */
export const COT_HO_SO =
  "id, org_id, full_name, role, phone, is_active, created_at, allow_price_edit, price_edit_max_increase_pct"

/**
 * ⚠ QUYỀN GIẢM GIÁ (mig 185) ĐỌC RIÊNG. Ghép vào câu chính thì sổ chưa chạy mig 185 là 42703 và KHÔNG
 *   AI đăng nhập được; đọc riêng thì hỏng chỉ là quyền giảm giá tắt — đúng mặc định.
 */
export const COT_GIAM_GIA = "allow_discount, discount_max_type, discount_max_value"

interface KetQuaDoc<T> {
  data: T | null
  error: { message: string } | null
}

/** Ghép hai câu đọc hồ sơ. Câu chính hỏng / không có dòng → không có hồ sơ; câu giảm giá hỏng → bỏ phần ấy. */
export function gopHoSo(chinh: KetQuaDoc<unknown>, giamGia: KetQuaDoc<unknown>): User | null {
  if (chinh.error || !chinh.data) return null
  const gg = giamGia.error || !giamGia.data ? {} : (giamGia.data as Partial<User>)
  return { ...(chinh.data as User), ...gg }
}

/**
 * Hồ sơ máy chủ gửi kèm dùng được cho sự kiện phiên này không.
 *
 * ⚠ ĐÚNG NGƯỜI MỚI DÙNG. Trang dựng cho người A mà phiên trên máy đã là người B (đăng xuất / đăng nhập
 *   lại trong cùng tab) thì phải đọc lại — hồ sơ của A mà gán cho B là lộ quyền.
 * ⚠ `USER_UPDATED` luôn đọc lại: người dùng vừa đổi thông tin, bản gửi kèm đã cũ.
 */
export function hoSoGuiKemDung(hs: User | null | undefined, uid: string, event: string): User | null {
  if (!hs || hs.id !== uid) return null
  if (event === "USER_UPDATED") return null
  return hs
}
