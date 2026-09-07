/**
 * Kiểm phiên đăng nhập hỏng theo HAI KIỂU, và hai kiểu đó đòi cách xử lý
 * NGƯỢC NHAU:
 *
 *   TẠM THỜI  — mạng chập chờn, Supabase timeout, lỗi 5xx. Phiên có thể
 *               vẫn còn nguyên. Đuổi người dùng về /login lúc này là
 *               đăng xuất oan một người đang làm việc bình thường.
 *
 *   DỨT KHOÁT — Supabase trả lời rõ ràng là phiên KHÔNG còn
 *               (`refresh_token_not_found`…). Không có gì để chờ nữa.
 *               Giữ họ lại là giữ trên một trang không bao giờ có dữ liệu.
 *
 * Gộp hai thứ này làm một là lỗi đã đo được trên production: cookie
 * `sb-*-auth-token` vẫn còn (nên middleware "tin cookie"), nhưng refresh
 * token phía Supabase đã mất — người dùng được cho qua vào trang cần đăng
 * nhập MÀ KHÔNG có phiên, và cứ thế mỗi lần vào lại.
 */
export type AuthFailureKind = "transient" | "definitive"

/**
 * Mã lỗi Supabase Auth có nghĩa "phiên đã mất, đừng chờ nữa".
 * Nguồn: các `AuthApiError.code` của @supabase/auth-js.
 */
const DEFINITIVE_CODES = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_not_found",
  "bad_jwt",
])

type MaybeAuthError = {
  __isAuthError?: unknown
  code?: unknown
  status?: unknown
  name?: unknown
}

/**
 * Lỗi này là DỨT KHOÁT hay chỉ TẠM THỜI?
 *
 * Mặc định là "tạm thời": không chắc thì giữ phiên. Đăng xuất oan một
 * người đang bán hàng tệ hơn hẳn việc để họ bấm thêm một lần nữa.
 */
export function classifyAuthFailure(err: unknown): AuthFailureKind {
  if (!err || typeof err !== "object") return "transient"
  const e = err as MaybeAuthError

  const code = typeof e.code === "string" ? e.code : ""
  if (DEFINITIVE_CODES.has(code)) return "definitive"

  // Chỉ tin `status` khi đây thật sự là lỗi từ Supabase Auth. Một `status:
  // 401` bịa ra từ chỗ khác không đủ để đăng xuất người dùng.
  if (e.__isAuthError === true && (e.status === 401 || e.status === 403)) {
    return "definitive"
  }

  // Mọi thứ còn lại là tạm thời — và đó là chỗ AbortError của timeout 8s
  // trong middleware rơi vào (nó không mang `code` chuỗi nào cả). Từng có
  // một dòng bắt riêng `name === "AbortError"` ở đầu hàm; đo bằng cách phá
  // thì không test nào đỏ, vì nhánh mặc định này đã lo đúng việc đó rồi.
  return "transient"
}

/** Tên cookie phiên Supabase — cần xoá khi phiên đã mất dứt khoát. */
export function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token")
}
