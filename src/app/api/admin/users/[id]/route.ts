import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * DELETE /api/admin/users/:id - delete user (auth + profile cascade)
 * Requires authenticated owner role.
 * Cannot delete yourself.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const targetId = params.id

    const supabase = createServerSupabaseClient()
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) {
      return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
    }
    if (authUser.id === targetId) {
      return NextResponse.json(
        { error: "Không thể tự xóa tài khoản của mình" },
        { status: 400 }
      )
    }

    const { data: callerProfile } = await supabase
      .from("users")
      .select("role, org_id")
      .eq("id", authUser.id)
      .maybeSingle()
    if (!callerProfile || callerProfile.role !== "owner") {
      return NextResponse.json(
        { error: "Chỉ Chủ sở hữu mới được xóa người dùng" },
        { status: 403 }
      )
    }

    // Verify target is in same org
    const admin = createAdminClient()
    const { data: targetProfile } = await admin
      .from("users")
      .select("org_id")
      .eq("id", targetId)
      .maybeSingle()
    if (!targetProfile || targetProfile.org_id !== callerProfile.org_id) {
      return NextResponse.json(
        { error: "Không tìm thấy người dùng trong tổ chức" },
        { status: 404 }
      )
    }

    // Deleting auth.users cascades to public.users via FK (ON DELETE CASCADE)
    const { error: delErr } = await admin.auth.admin.deleteUser(targetId)
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
