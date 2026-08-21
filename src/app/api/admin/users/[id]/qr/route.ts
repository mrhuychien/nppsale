import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { qrLoginUrl } from "@/lib/qr-login"

/** Xác thực người gọi là Chủ sở hữu và target cùng org. Trả về admin
 *  client + org_id, hoặc 1 NextResponse lỗi. */
async function authorizeOwner(targetId: string) {
  const supabase = createServerSupabaseClient()
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()
  if (!authUser) {
    return { error: NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 }) }
  }
  const { data: caller, error: callerErr } = await supabase
    .from("users")
    .select("role, org_id")
    .eq("id", authUser.id)
    .maybeSingle()
  if (callerErr) console.error("[id/qr] truy vấn lỗi:", callerErr.message)
  if (!caller || caller.role !== "owner") {
    return {
      error: NextResponse.json(
        { error: "Chỉ Chủ sở hữu mới được quản lý mã QR đăng nhập" },
        { status: 403 }
      ),
    }
  }
  const admin = createAdminClient()
  const { data: target, error: targetErr } = await admin
    .from("users")
    .select("id, org_id, full_name, is_active")
    .eq("id", targetId)
    .maybeSingle()
  // Truy vấn hỏng cũng cho target = null, tức là sẽ trả 404 "không tìm thấy"
  // trong khi người dùng vẫn tồn tại. Tách riêng để còn lần ra được.
  if (targetErr) {
    console.error("[api/admin/users/qr] truy vấn người dùng lỗi:", targetErr.message)
    return {
      error: NextResponse.json({ error: "Lỗi truy vấn người dùng" }, { status: 500 }),
    }
  }
  if (!target || target.org_id !== caller.org_id) {
    return {
      error: NextResponse.json(
        { error: "Không tìm thấy người dùng trong tổ chức" },
        { status: 404 }
      ),
    }
  }
  return { admin, target }
}

/** GET — lấy token QR hiện tại (nếu có). Owner-only. */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeOwner(params.id)
  if (auth.error) return auth.error
  const { admin, target } = auth
  const { data } = await admin
    .from("qr_login_tokens")
    .select("token, issued_at")
    .eq("user_id", params.id)
    .maybeSingle()
  const token = data?.token || null
  return NextResponse.json({
    token,
    loginUrl: token ? qrLoginUrl(token) : null,
    issuedAt: data?.issued_at || null,
    isActive: target.is_active ?? true,
  })
}

/** POST — phát/xoay token QR. QR cũ hết hiệu lực ngay. Owner-only. */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeOwner(params.id)
  if (auth.error) return auth.error
  const { admin } = auth
  const token = randomBytes(32).toString("base64url")
  const issuedAt = new Date().toISOString()
  const { error } = await admin
    .from("qr_login_tokens")
    .upsert({ user_id: params.id, token, issued_at: issuedAt })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({
    token,
    loginUrl: qrLoginUrl(token),
    issuedAt,
  })
}

/** DELETE — thu hồi QR (xoá token). Owner-only. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const auth = await authorizeOwner(params.id)
  if (auth.error) return auth.error
  const { admin } = auth
  const { error } = await admin
    .from("qr_login_tokens")
    .delete()
    .eq("user_id", params.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
