import { NextResponse } from "next/server"
import { randomBytes, randomUUID } from "crypto"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { qrLoginUrl } from "@/lib/qr-login"

/**
 * POST /api/admin/users/qr — tạo tài khoản nhân viên đăng nhập bằng QR.
 *
 * Không cần email/mật khẩu: hệ thống tự sinh email tổng hợp + mật khẩu
 * ngẫu nhiên (nhân viên không dùng tới) và 1 token QR bí mật. Trả về
 * token + loginUrl để dựng mã QR phía client. Chỉ Chủ sở hữu được gọi.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      full_name,
      role,
      phone,
      username,
      email: providedEmail,
      allow_price_edit,
      price_edit_max_increase_pct,
    } = body

    if (!full_name || !role) {
      return NextResponse.json(
        { error: "Thiếu thông tin bắt buộc: full_name, role" },
        { status: 400 }
      )
    }

    // Xác thực người gọi là Chủ sở hữu.
    const supabase = createServerSupabaseClient()
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
    }
    const { data: callerProfile } = await supabase
      .from("users")
      .select("role, org_id")
      .eq("id", authUser.id)
      .maybeSingle()
    if (!callerProfile || callerProfile.role !== "owner") {
      return NextResponse.json(
        { error: "Chỉ Chủ sở hữu mới được tạo người dùng" },
        { status: 403 }
      )
    }

    // Email tổng hợp khi không nhập — chỉ dùng nội bộ cho Supabase Auth,
    // nhân viên không cần biết. email_confirm:true nên không gửi mail.
    const cleanUsername =
      typeof username === "string" ? username.trim() : ""
    const email =
      typeof providedEmail === "string" && providedEmail.includes("@")
        ? providedEmail.trim()
        : `qr.${randomUUID().slice(0, 12)}@nppsale.local`
    const password = randomBytes(18).toString("base64url") + "Aa1@"
    const qrToken = randomBytes(32).toString("base64url")

    const admin = createAdminClient()
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })
    if (authErr || !created.user) {
      return NextResponse.json(
        { error: authErr?.message || "Tạo tài khoản thất bại" },
        { status: 400 }
      )
    }

    const free = role === "owner" || role === "accountant"
    const { error: profErr } = await admin.from("users").insert({
      id: created.user.id,
      org_id: callerProfile.org_id,
      full_name,
      role,
      phone: phone || null,
      username: cleanUsername || null,
      is_active: true,
      qr_login_token: qrToken,
      qr_login_issued_at: new Date().toISOString(),
      allow_price_edit: free
        ? true
        : typeof allow_price_edit === "boolean"
          ? allow_price_edit
          : false,
      price_edit_max_increase_pct: Math.max(
        0,
        Math.min(100, Number(price_edit_max_increase_pct ?? 0))
      ),
    })
    if (profErr) {
      await admin.auth.admin.deleteUser(created.user.id)
      const msg = profErr.message || ""
      const friendly = /idx_users_username_unique/i.test(msg)
        ? "Tên tài khoản đã được dùng. Chọn tên khác."
        : /idx_users_phone_unique/i.test(msg)
          ? "Số điện thoại đã được dùng. Chọn số khác."
          : `Tạo hồ sơ thất bại: ${msg}`
      return NextResponse.json({ error: friendly }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      id: created.user.id,
      token: qrToken,
      loginUrl: qrLoginUrl(qrToken),
    })
  } catch (err) {
    console.error("[/api/admin/users/qr] error:", err)
    const message = err instanceof Error ? err.message : "Lỗi không xác định"
    const hint = message.includes("SUPABASE_SERVICE_ROLE_KEY")
      ? "Vercel chưa có env var SUPABASE_SERVICE_ROLE_KEY. Thêm trong Vercel → Settings → Environment Variables."
      : undefined
    return NextResponse.json({ error: message, hint }, { status: 500 })
  }
}
