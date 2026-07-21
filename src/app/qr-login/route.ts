import { NextResponse, type NextRequest } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * GET /qr-login?t=<token> — điểm đến khi nhân viên quét mã QR.
 *
 * Luồng:
 *   1. Đọc token từ query.
 *   2. Đối chiếu token (service_role) → tìm user, kiểm is_active.
 *   3. Phát 1 magic-link OTP tức thời cho email của user rồi verify
 *      server-side để đặt cookie phiên → nhân viên vào thẳng app.
 *
 * Bảo mật: token đối chiếu hoàn toàn server-side. Sai/không active →
 * đẩy về /login kèm cờ lỗi, không tiết lộ chi tiết.
 */
// Rate-limit đơn giản theo IP (best-effort trên serverless: mỗi instance
// một bộ đếm). Token 32-byte ngẫu nhiên vốn không thể dò, đây là lớp
// phòng thủ bổ sung chống quét ồ ạt.
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 10
const hits = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = hits.get(ip)
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS })
    // Dọn bộ nhớ khi map phình to.
    if (hits.size > 5000) {
      hits.forEach((v, k) => {
        if (now > v.resetAt) hits.delete(k)
      })
    }
    return false
  }
  entry.count++
  return entry.count > RATE_MAX
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const token = req.nextUrl.searchParams.get("t")?.trim()

  const fail = (reason: string) => {
    const url = new URL("/login", origin)
    url.searchParams.set("qr", reason)
    return NextResponse.redirect(url)
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (rateLimited(ip)) return fail("invalid")

  if (!token || token.length < 16) return fail("invalid")

  try {
    const admin = createAdminClient()

    // Token nằm ở bảng riêng service_role-only (migration 088).
    const { data: tokenRow } = await admin
      .from("qr_login_tokens")
      .select("user_id, users!inner(is_active)")
      .eq("token", token)
      .maybeSingle()

    if (!tokenRow) return fail("invalid")
    const active = Array.isArray(tokenRow.users)
      ? (tokenRow.users[0] as { is_active: boolean } | undefined)?.is_active
      : (tokenRow.users as { is_active: boolean } | null)?.is_active
    if (!active) return fail("inactive")

    const { data: authRes, error: getErr } =
      await admin.auth.admin.getUserById(tokenRow.user_id)
    const email = authRes?.user?.email
    if (getErr || !email) return fail("invalid")

    // Phát magic-link OTP tức thời, lấy hashed_token để verify ngay.
    const { data: link, error: linkErr } =
      await admin.auth.admin.generateLink({ type: "magiclink", email })
    const hashed = link?.properties?.hashed_token
    if (linkErr || !hashed) return fail("server")

    // verifyOtp đặt cookie sb-*-auth-token vào response (Route Handler
    // cho phép ghi cookie). Sau đó redirect vào app.
    const supabase = createServerSupabaseClient()
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      token_hash: hashed,
      type: "magiclink",
    })
    if (verifyErr) {
      console.error("[qr-login] verifyOtp failed:", verifyErr.message)
      return fail("server")
    }

    return NextResponse.redirect(new URL("/orders", origin))
  } catch (err) {
    console.error("[qr-login] error:", err)
    return fail("server")
  }
}
