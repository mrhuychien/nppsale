import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isValidPhone, syntheticEmailForPhone } from "@/lib/users/phone"

/**
 * POST /api/admin/users - create a new user (auth + profile)
 * Requires authenticated owner role.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const {
      email,
      password,
      full_name,
      role,
      phone,
      username,
      allow_price_edit,
      price_edit_max_increase_pct,
    } = body

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

    // Supabase Auth bắt buộc có email, nên khi không nhập thì sinh từ
    // chính số điện thoại: suy ra được, duy nhất theo SĐT, và nhân viên
    // không bao giờ phải biết tới nó. Đăng nhập vẫn gõ số điện thoại —
    // trang /login tra ngược qua RPC lookup_email_by_identifier.
    //
    // Sinh từ dạng CHUẨN HOÁ: nếu sinh từ chuỗi thô thì "0909 123 456" và
    // "0909123456" ra hai email khác nhau, trong khi chỉ mục SĐT chỉ cho
    // một — người thứ hai tạo sẽ hỏng giữa chừng.
    const authEmail =
      typeof email === "string" && email.includes("@")
        ? email.trim()
        : syntheticEmailForPhone(phone)

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
    const cleanUsername =
      typeof username === "string" ? username.trim() : ""
    const { error: profErr } = await admin.from("users").insert({
      id: created.user.id,
      org_id: callerProfile.org_id,
      full_name,
      role,
      // Lưu ĐÚNG những gì người nhập — để hiển thị và để bấm gọi. Việc
      // so khớp lúc đăng nhập đi qua normalize_phone() ở SQL.
      phone: String(phone).trim(),
      username: cleanUsername || null,
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
      const friendly = /idx_users_username_unique/i.test(msg)
        ? "Tên tài khoản đã được dùng. Chọn tên khác."
        : /idx_users_phone_unique/i.test(msg)
          ? "Số điện thoại đã được dùng. Chọn số khác."
          : `Tạo hồ sơ thất bại: ${msg}`
      return NextResponse.json({ error: friendly }, { status: 400 })
    }

    return NextResponse.json({ success: true, id: created.user.id })
  } catch (err) {
    console.error("[/api/admin/users] error:", err)
    const message = err instanceof Error ? err.message : "Lỗi không xác định"
    const hint = message.includes("SUPABASE_SERVICE_ROLE_KEY")
      ? "Vercel chưa có env var SUPABASE_SERVICE_ROLE_KEY. Thêm trong Vercel → Settings → Environment Variables."
      : undefined
    return NextResponse.json({ error: message, hint }, { status: 500 })
  }
}
