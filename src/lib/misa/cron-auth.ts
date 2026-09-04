import { NextResponse } from "next/server"

/**
 * Hàng rào cho các route chạy bằng lịch (cron).
 *
 * Những route này dùng admin client (BỎ QUA RLS) và chạy khi không có ai
 * đăng nhập, nên header bí mật là hàng rào DUY NHẤT. Một chỗ cài đặt duy
 * nhất cho mọi route cron — hai bản sao là hai cơ hội để một bản bị nới
 * lỏng mà không ai để ý.
 *
 * Trả về `null` khi hợp lệ, hoặc thẳng response từ chối.
 */
export function requireCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    // KHÔNG có bí mật thì KHÔNG chạy. Để một route quyền admin mở toang
    // chỉ vì quên đặt biến môi trường là tệ hơn nhiều so với việc cron
    // báo lỗi và người vận hành phải đi xem.
    console.error("[cron-auth] thiếu CRON_SECRET — từ chối chạy")
    return NextResponse.json(
      { error: "Server chưa đặt CRON_SECRET — route chạy theo lịch bị tắt." },
      { status: 503 }
    )
  }
  const auth = req.headers.get("authorization") || ""
  const provided = auth.startsWith("Bearer ")
    ? auth.slice(7)
    : req.headers.get("x-cron-secret") || ""
  if (!timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 401 })
  }
  return null
}

/**
 * So chuỗi không phụ thuộc thời gian.
 *
 * `a === b` thoát ngay ở byte đầu khác nhau, nên thời gian trả lời rò rỉ
 * độ dài tiền tố đúng — đủ để dò ra bí mật từng ký tự.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
