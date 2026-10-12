import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { errorMessage } from "@/lib/errors"
import {
  CUSTOMER_PHOTO_BUCKET,
  MANAGE_PHOTO_ROLES,
  parseOrgPhotoPath,
  photoStoragePath,
} from "@/lib/customers/photos"

/** Một lần gọi xoá tối đa bấy nhiêu file — màn chỉ gửi 1–2 (ảnh vừa xoá / ảnh bị thay). */
const MAX_PATHS = 10

/**
 * POST /api/customers/photo-cleanup  { paths: string[] } — XOÁ FILE ảnh điểm bán đã bị xoá / bị thay.
 * Chủ nhà 12/10/2026: "phần cập nhật ảnh kèm định vị cho điểm bán. chưa sửa, cập nhật lại, xoá ảnh + vị trí cũ".
 *
 * ⚠ VÌ SAO QUA MÁY CHỦ: xoá file (`storage.remove`) cần quyền SELECT trên `storage.objects`, mà mig 207 đã bỏ
 *   policy SELECT của kho công khai (cảnh báo Supabase "bucket cho liệt kê mọi ảnh của mọi đơn vị"). Trình duyệt gọi
 *   `remove` thì 0 file bị xoá, KHÔNG báo lỗi — ảnh "đã xoá" vẫn mở được bằng URL công khai. Ở đây dùng khoá máy
 *   chủ, nhưng chỉ xoá file:
 *     · người gọi đăng nhập, vai trò được quản lý ảnh (`MANAGE_PHOTO_ROLES`);
 *     · đúng khuôn `<org của người gọi>/<khách>/<tên>.jpg` (`parseOrgPhotoPath`) — không `..`, không đơn vị khác;
 *     · KHÔNG còn dòng `customer_photos` nào trỏ tới — file đang dùng thì bỏ qua (`skipped`).
 */
export async function POST(req: Request) {
  try {
    const supabase = createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })

    const { data: me, error: meErr } = await supabase
      .from("users")
      .select("role, org_id")
      .eq("id", user.id)
      .maybeSingle()
    if (meErr) {
      console.error("[api/customers/photo-cleanup] đọc người dùng lỗi:", meErr.message)
      return NextResponse.json({ error: "Lỗi đọc người dùng" }, { status: 500 })
    }
    const orgId = (me?.org_id as string | null) ?? null
    if (!orgId || !MANAGE_PHOTO_ROLES.includes(String(me?.role))) {
      return NextResponse.json({ error: "Không có quyền xoá ảnh điểm bán" }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as { paths?: unknown } | null
    const asked = (Array.isArray(body?.paths) ? body.paths : [])
      .filter((p): p is string => typeof p === "string")
      .slice(0, MAX_PATHS)
    const own = asked
      .map((path) => ({ path, file: parseOrgPhotoPath(path, orgId) }))
      .filter((x): x is { path: string; file: { customerId: string } } => x.file !== null)
    if (own.length === 0) return NextResponse.json({ removed: [], skipped: asked })

    const admin = createAdminClient()
    const customerIds = Array.from(new Set(own.map((x) => x.file.customerId)))
    const { data: rows, error: refErr } = await admin
      .from("customer_photos")
      .select("photo_url")
      .eq("org_id", orgId)
      .in("customer_id", customerIds)
    if (refErr) {
      console.error("[api/customers/photo-cleanup] tra ảnh đang dùng lỗi:", refErr.message)
      return NextResponse.json({ error: "Lỗi tra ảnh đang dùng" }, { status: 500 })
    }
    const inUse = new Set(
      ((rows as Array<{ photo_url: string | null }> | null) ?? []).map((r) => photoStoragePath(r.photo_url))
    )
    const removed = own.map((x) => x.path).filter((p) => !inUse.has(p))
    if (removed.length > 0) {
      const { error: rmErr } = await admin.storage.from(CUSTOMER_PHOTO_BUCKET).remove(removed)
      if (rmErr) {
        console.error("[api/customers/photo-cleanup] xoá file lỗi:", rmErr.message)
        return NextResponse.json({ error: "Lỗi xoá file ảnh" }, { status: 500 })
      }
    }
    return NextResponse.json({ removed, skipped: asked.filter((p) => !removed.includes(p)) })
  } catch (e) {
    console.error("[api/customers/photo-cleanup] lỗi:", errorMessage(e))
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 })
  }
}
