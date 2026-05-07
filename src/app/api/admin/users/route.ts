import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

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
      allow_price_edit,
      price_edit_max_increase_pct,
    } = body

    if (!email || !password || !full_name || !role) {
      return NextResponse.json(
        { error: "Thiếu thông tin bắt buộc: email, password, full_name, role" },
        { status: 400 }
      )
    }

    // Verify caller is an owner
    const supabase = createServerSupabaseClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
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

    // Create auth user (skip email confirmation)
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

    // Create public.users profile. Owner/accountant always have free
    // price-edit (handled in code via userPriceRulesFrom), but we
    // still persist the explicit flags for transparency.
    const free = role === "owner" || role === "accountant"
    const { error: profErr } = await admin.from("users").insert({
      id: created.user.id,
      org_id: callerProfile.org_id,
      full_name,
      role,
      phone: phone || null,
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
      return NextResponse.json(
        { error: `Tạo hồ sơ thất bại: ${profErr.message}` },
        { status: 400 }
      )
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
