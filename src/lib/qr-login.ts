/**
 * QR login helpers — shared giữa client (dựng mã QR) và server (tạo/xoay
 * token, đối chiếu khi đăng nhập).
 *
 * URL app mặc định là production (https://nppsale.vercel.app) để mã QR in
 * ra luôn trỏ đúng dù được tạo từ preview/localhost. Có thể override bằng
 * env NEXT_PUBLIC_APP_URL.
 */
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL || "https://nppsale.vercel.app"
).replace(/\/+$/, "")

/** Đường dẫn nhân viên sẽ mở khi quét QR. */
export function qrLoginUrl(token: string, base?: string): string {
  const b = (base || APP_URL).replace(/\/+$/, "")
  return `${b}/qr-login?t=${encodeURIComponent(token)}`
}
