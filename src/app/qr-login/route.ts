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
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin
  const token = req.nextUrl.searchParams.get("t")?.trim()

  const fail = (reason: string) => {
    const url = new URL("/login", origin)
    url.searchParams.set("qr", reason)
    return NextResponse.redirect(url)
  }

  if (!token || token.length < 16) return fail("invalid")

  try {
    const admin = createAdminClient()

    const { data: profile } = await admin
      .from("users")
      .select("id, is_active")
      .eq("qr_login_token", token)
      .maybeSingle()

    if (!profile) return fail("invalid")
    if (!profile.is_active) return fail("inactive")

    const { data: authRes, error: getErr } =
      await admin.auth.admin.getUserById(profile.id)
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
