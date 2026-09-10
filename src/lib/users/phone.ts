/**
 * Chuẩn hoá số điện thoại Việt Nam — dùng làm ĐỊNH DANH ĐĂNG NHẬP.
 *
 * VÌ SAO PHẢI CHUẨN HOÁ
 *   Cùng một người, cùng một số, nhập ra bốn kiểu khác nhau:
 *     0909123456   0909 123 456   +84909123456   0909.123.456
 *   Không quy về một dạng thì tài khoản tạo bằng kiểu này sẽ KHÔNG đăng
 *   nhập được bằng kiểu kia — và người dùng không hiểu vì sao "số đúng
 *   mà báo sai".
 *
 * QUY TẮC: chuẩn hoá KHI SO SÁNH, giữ nguyên KHI LƯU.
 *   `users.phone` lưu đúng những gì người nhập (để hiển thị, để gọi).
 *   Việc so khớp thì đi qua hàm này ở TS, và qua `public.normalize_phone()`
 *   ở SQL (migration 104) — hai bản phải cho cùng kết quả.
 *
 * ⚠ BỘ CA KIỂM DÙNG CHUNG nằm ở tests/fixtures/phone-cases.json. Sửa quy
 * tắc ở đây thì phải sửa cả hàm SQL, và bộ ca đó là chỗ đối chiếu.
 */

/** Miền email tổng hợp — nhân viên không bao giờ dùng tới. */
export const SYNTHETIC_EMAIL_DOMAIN = "nppsale.local"

/**
 * Quy số về một dạng duy nhất: chỉ chữ số, bắt đầu bằng `0`.
 * Trả chuỗi rỗng nếu không có chữ số nào.
 */
export function normalizePhone(raw: string | null | undefined): string {
  let d = (raw ?? "").replace(/\D/g, "")
  if (!d) return ""
  // Tiền tố quay số quốc tế: 0084909… → 84909…
  if (d.startsWith("00")) d = d.slice(2)
  // Mã quốc gia: 84909123456 → 0909123456
  if (d.startsWith("84") && d.length >= 11) return "0" + d.slice(2)
  if (d.startsWith("0")) return d
  // Thiếu số 0 đầu: 909123456 → 0909123456
  if (d.length === 9) return "0" + d
  return d
}

/**
 * Số có dùng làm định danh được không?
 *
 * CỐ Ý DỄ TÍNH: 9–11 chữ số sau khi chuẩn hoá. Di động VN là 10 số, cố
 * định 10–11. Siết chặt hơn nữa là rủi ro từ chối một số có thật — mà đây
 * chỉ là định danh nội bộ, không phải nơi kiểm chứng số thật.
 */
export function isValidPhone(raw: string | null | undefined): boolean {
  return /^0\d{8,10}$/.test(normalizePhone(raw))
}

/**
 * Email tổng hợp cho Supabase Auth.
 *
 * Supabase Auth bắt buộc có email. Nhân viên bán hàng phần lớn không có
 * email, nên hệ thống tự sinh một cái từ chính số điện thoại: định danh
 * duy nhất, suy ra được, và không bao giờ hiện ra cho người dùng.
 *
 * Vì `phone` là duy nhất (chỉ mục theo dạng chuẩn hoá) nên email này cũng
 * duy nhất theo.
 */
export function syntheticEmailForPhone(raw: string): string {
  const p = normalizePhone(raw)
  if (!p) throw new Error("Không sinh được email từ số điện thoại rỗng")
  return `${p}@${SYNTHETIC_EMAIL_DOMAIN}`
}

/** Email này do hệ thống sinh chứ không phải người dùng nhập? */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return (email ?? "").toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)
}
