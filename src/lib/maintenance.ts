/**
 * CHẾ ĐỘ BẢO TRÌ — đóng ứng dụng lại khi đang chạy migration.
 *
 * ⚠ VÌ SAO CẦN. Đợt v2b gỡ `complete_order` ở migration 124 rồi mới dựng
 * `post_invoice` ở 125. Giữa lúc đẩy migration và lúc mã mới lên sóng,
 * ứng dụng nói một đằng cơ sở dữ liệu một nẻo — dù đẩy theo thứ tự nào
 * cũng có một khoảng như vậy. Người dùng bấm vào đó sẽ nhận những lỗi
 * không ai giải thích nổi.
 *
 * ⚠ CÁI NÀY CHẶN ĐƯỢC GÌ, VÀ KHÔNG CHẶN ĐƯỢC GÌ — ĐỌC KỸ.
 *
 *   CHẶN: mọi lần tải trang mới, mọi lần chuyển màn, mọi lần bấm F5.
 *
 *   KHÔNG CHẶN: một tab ĐANG MỞ SẴN. Mã JavaScript trong tab đó đã tải
 *   xong và nói thẳng với Supabase qua PostgREST, không đi qua máy chủ
 *   Next.js — middleware không nhìn thấy những lệnh ấy. Muốn chắc thì
 *   vẫn phải nhắn nhân viên đóng ứng dụng, và chọn giờ vắng.
 *
 *   Bù lại: mỗi migration chạy trong MỘT giao dịch, nên một lệnh ghi chen
 *   vào giữa thì hoặc phải xếp hàng chờ, hoặc ném lỗi cho người bấm. Nó
 *   không làm hỏng sổ — chỉ làm người ta bối rối. Đó là lý do trang này
 *   tồn tại: giảm số người bối rối, không phải giữ toàn vẹn dữ liệu.
 */

/** Đường dẫn vẫn mở khi đang bảo trì. */
export const MAINTENANCE_ALLOWED_PREFIXES = [
  // Chính trang báo bảo trì — không cho qua thì nó tự chuyển hướng vào mình.
  "/maintenance",
  // ⚠ Trang chẩn đoán phải sống sót MỌI chế độ. Nó là chỗ duy nhất xem
  //   được cấu hình khi mọi thứ khác hỏng; khoá nó lại là tự bịt mắt
  //   mình đúng lúc cần nhìn nhất.
  "/debug",
] as const

/**
 * Cookie mở đường cho chủ nhà tự vào xem trong lúc đang đóng.
 *
 * ⚠ ĐÂY KHÔNG PHẢI MỘT LỚP BẢO MẬT, và đừng dùng nó như vậy. Nó chỉ để
 * người đang chạy migration tự kiểm trước khi mở cửa lại. Ai biết tên
 * cookie đều vào được — nhưng vào rồi thì vẫn phải đăng nhập và vẫn bị
 * RLS chặn như mọi người.
 */
export const MAINTENANCE_BYPASS_COOKIE = "npp_maintenance_bypass"

/**
 * Đang bảo trì hay không, đọc từ biến môi trường.
 *
 * ⚠ SO VỚI DANH SÁCH GIÁ TRỊ BẬT, không dùng `Boolean(value)`. Chuỗi
 * `"false"` và `"0"` đều là chuỗi KHÁC RỖNG nên `Boolean()` trả `true` —
 * đặt `MAINTENANCE_MODE=false` để tắt lại hoá ra bật, và không có cách
 * nào tắt ngoài việc xoá hẳn biến.
 */
export function isMaintenanceMode(
  value: string | undefined = process.env.MAINTENANCE_MODE
): boolean {
  const v = (value ?? "").trim().toLowerCase()
  return v === "1" || v === "true" || v === "on"
}

/** Đường dẫn này có được đi qua trong lúc bảo trì không. */
export function isMaintenanceAllowed(pathname: string): boolean {
  return MAINTENANCE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

/**
 * Quyết định cuối: có phải chặn yêu cầu này không.
 *
 * Tách khỏi middleware để thử phá được bằng test — middleware chạy ở
 * edge runtime, dựng `NextRequest` giả trong test là một mớ không đáng.
 */
export function shouldBlockForMaintenance(opts: {
  pathname: string
  hasBypassCookie: boolean
  envValue?: string
}): boolean {
  if (!isMaintenanceMode(opts.envValue)) return false
  if (opts.hasBypassCookie) return false
  return !isMaintenanceAllowed(opts.pathname)
}
