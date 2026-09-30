import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { qrLoginUrl } from "@/lib/qr-login"

/**
 * GET — link đăng nhập QR của MỌI nhân viên cùng tổ chức (chỉ ai đã có mã). Owner-only.
 * Nút "Đăng nhập" cạnh tên ở danh sách nhân viên cần link sẵn để là thẻ <a> thật — iPhone chỉ
 * mở Safari (`x-safari-https://`) chắc chắn khi người dùng bấm thẳng vào link.
 */
export async function GET() {
  const supabase = createServerSupabaseClient()
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()
  if (!authUser) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
  const { data: caller, error: callerErr } = await supabase
    .from("users")
    .select("role, org_id")
    .eq("id", authUser.id)
    .maybeSingle()
  if (callerErr) console.error("[users/qr] truy vấn lỗi:", callerErr.message)
  if (!caller || caller.role !== "owner") {
    return NextResponse.json({ error: "Chỉ Chủ sở hữu mới được quản lý mã QR đăng nhập" }, { status: 403 })
  }
  const admin = createAdminClient()
  const { data: nv, error: nvErr } = await admin.from("users").select("id").eq("org_id", caller.org_id)
  if (nvErr) return NextResponse.json({ error: `Lỗi truy vấn người dùng: ${nvErr.message}` }, { status: 500 })
  const ids = (nv ?? []).map((u) => u.id as string)
  if (ids.length === 0) return NextResponse.json({ links: {} })
  const { data, error } = await admin.from("qr_login_tokens").select("user_id, token").in("user_id", ids)
  if (error) return NextResponse.json({ error: `Không đọc được mã QR: ${error.message}` }, { status: 500 })
  const links: Record<string, string> = {}
  for (const r of data ?? []) if (r.token) links[r.user_id as string] = qrLoginUrl(r.token as string)
  return NextResponse.json({ links })
}
