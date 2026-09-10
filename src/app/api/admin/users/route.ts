import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isValidPhone, syntheticEmailForPhone } from "@/lib/users/phone"
import { qrLoginUrl } from "@/lib/qr-login"

/**
 * POST /api/admin/users — tạo nhân viên: tài khoản đăng nhập + hồ sơ + MÃ QR.
 *
 * VÌ SAO PHÁT QR NGAY Ở ĐÂY
 *   Trước đây có hai màn tạo người dùng: một bằng mật khẩu, một bằng QR.
 *   Người vận hành phải chọn trước "nhân viên này đăng nhập kiểu gì" — mà
 *   lúc mới tạo thì chưa ai biết. Chọn sai là phải xoá đi tạo lại.
 *
 *   Nay một đường: tạo xong có CẢ HAI. Nhân viên quét QR cho nhanh, hoặc
 *   gõ SĐT + mật khẩu khi mất điện thoại. Không phải quyết định gì trước.
 *
 * Chỉ Chủ sở hữu được gọi.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { password, full_name, role, phone, allow_price_edit, price_edit_max_increase_pct } = body

    // ⚠ SỐ ĐIỆN THOẠI là định danh chính, KHÔNG phải email. Nhân viên bán
    // hàng phần lớn không có email; bắt họ có một cái chỉ để đăng nhập là
    // dựng rào cản cho đúng nhóm dùng nhiều nhất.
    if (!phone || !password || !full_name || !role) {
      return NextResponse.json(
        { error: "Thiếu thông tin bắt buộc: số điện thoại, mật khẩu, họ tên, vai trò" },
        { status: 400 }
      )
    }
    if (!isValidPhone(phone)) {
      return NextResponse.json(
        { error: `Số điện thoại không hợp lệ: "${phone}". Ví dụ đúng: 0909123456` },
        { status: 400 }
      )
    }

    // Verify caller is an owner
    const supabase = createServerSupabaseClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
    }
    const { data: callerProfile, error: callerProfileErr } = await supabase
      .from("users")
      .select("role, org_id")
      .eq("id", authUser.id)
      .maybeSingle()
    if (callerProfileErr) console.error("[admin/users] truy vấn lỗi:", callerProfileErr.message)
    if (!callerProfile || callerProfile.role !== "owner") {
      return NextResponse.json(
        { error: "Chỉ Chủ sở hữu mới được tạo người dùng" },
        { status: 403 }
      )
    }

    // Supabase Auth bắt buộc có email, nên hệ thống sinh từ chính số điện
    // thoại: suy ra được, duy nhất theo SĐT, và nhân viên không bao giờ
    // phải biết tới nó. Đăng nhập vẫn gõ số điện thoại — trang /login tra
    // ngược qua RPC lookup_email_by_identifier.
    //
    // KHÔNG nhận email từ ngoài vào: một định danh là đủ. Nhận thêm email
    // là mở lại đúng câu hỏi vừa bỏ đi — "người này đăng nhập bằng gì?"
    const authEmail = syntheticEmailForPhone(phone)

    // Create auth user (skip email confirmation)
    const admin = createAdminClient()
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: authEmail,
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

    // Create public.users profile. Owner/accountant always have free
    // price-edit (handled in code via userPriceRulesFrom), but we
    // still persist the explicit flags for transparency.
    const free = role === "owner" || role === "accountant"
    const { error: profErr } = await admin.from("users").insert({
      id: created.user.id,
      org_id: callerProfile.org_id,
      full_name,
      role,
      // Lưu ĐÚNG những gì người nhập — để hiển thị và để bấm gọi. Việc
      // so khớp lúc đăng nhập đi qua normalize_phone() ở SQL.
      phone: String(phone).trim(),
      is_active: true,
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
      // Rollback: delete the auth user to avoid orphan
      await admin.auth.admin.deleteUser(created.user.id)
      const msg = profErr.message || ""
      const friendly = /idx_users_phone_unique/i.test(msg)
        ? "Số điện thoại đã được dùng cho tài khoản khác."
        : `Tạo hồ sơ thất bại: ${msg}`
      return NextResponse.json({ error: friendly }, { status: 400 })
    }

    // Mã QR đăng nhập. Bảng riêng, chỉ service_role đọc được (088).
    //
    // Hỏng ở đây thì XOÁ luôn tài khoản vừa tạo: để lại một nhân viên có
    // hồ sơ mà không có QR nghĩa là người vận hành tưởng đã xong, đưa máy
    // cho nhân viên quét, và không quét được — không có gì báo.
    const qrToken = randomBytes(32).toString("base64url")
    const { error: tokenErr } = await admin.from("qr_login_tokens").insert({
      user_id: created.user.id,
      token: qrToken,
    })
    if (tokenErr) {
      // Xoá auth user → cascade xoá hồ sơ, tránh tài khoản mồ côi.
      await admin.auth.admin.deleteUser(created.user.id)
      return NextResponse.json(
        { error: `Tạo được tài khoản nhưng không phát được mã QR: ${tokenErr.message}` },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      id: created.user.id,
      token: qrToken,
      loginUrl: qrLoginUrl(qrToken),
    })
  } catch (err) {
    console.error("[/api/admin/users] error:", err)
    const message = err instanceof Error ? err.message : "Lỗi không xác định"
    const hint = message.includes("SUPABASE_SERVICE_ROLE_KEY")
      ? "Vercel chưa có env var SUPABASE_SERVICE_ROLE_KEY. Thêm trong Vercel → Settings → Environment Variables."
      : undefined
    return NextResponse.json({ error: message, hint }, { status: 500 })
  }
}
