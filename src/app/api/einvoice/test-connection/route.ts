import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import { extractTenantIds, getTokenWithRawResponse } from "@/lib/misa/client"
import type { MisaConfig } from "@/lib/misa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/einvoice/test-connection
 * Body (optional): { username, password } để override khi user vừa nhập mà chưa lưu.
 *
 * Mục đích: gọi /oauth thật để (a) verify credentials, (b) trích
 * CompanyID/OrganizationUnitID/UserID từ response và lưu vào config —
 * user không phải tự đi tìm.
 */
export async function POST(req: Request) {
  try {
    return await handle(req)
  } catch (err) {
    console.error("[/api/einvoice/test-connection] fatal:", err)
    const msg = err instanceof Error ? err.message : "Lỗi không xác định"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function handle(req: Request) {
  let body: { username?: string; password?: string } = {}
  try { body = await req.json() } catch { /* optional */ }

  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
  const { data: profile } = await supa
    .from("users")
    .select("role, org_id")
    .eq("id", authUser.id)
    .maybeSingle()
  if (!profile || !["owner", "accountant"].includes(profile.role)) {
    return NextResponse.json(
      { error: "Chỉ Chủ NPP hoặc Kế toán mới được test kết nối" },
      { status: 403 }
    )
  }
  const orgId = profile.org_id as string

  const admin = createAdminClient()
  const { data: cfg } = await admin
    .from("company_einvoice_config")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle()
  if (!cfg) {
    return NextResponse.json(
      { error: "Chưa có cấu hình. Lưu cấu hình MISA trước (api_base + MST + username/password)." },
      { status: 400 }
    )
  }

  const tokenPath = (cfg.token_path || "/oauth").trim()
  const username = (body.username && body.username.trim()) || decryptSecret(cfg.username_enc)
  const password = (body.password && body.password.trim()) || decryptSecret(cfg.password_enc)
  if (!username || !password) {
    return NextResponse.json(
      { error: "Thiếu username/password. Nhập rồi bấm test lại." },
      { status: 400 }
    )
  }

  const misaConfig: MisaConfig = {
    apiBase: cfg.api_base,
    taxCode: cfg.tax_code || "",
    username,
    password,
    tokenPath,
    publishPath: cfg.publish_path || "/v3sainvoice",
  }

  let result: Awaited<ReturnType<typeof getTokenWithRawResponse>>
  try {
    result = await getTokenWithRawResponse(misaConfig)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }

  const ids = extractTenantIds(result.raw)

  // Auto-fill các ID lấy được + (nếu user vừa nhập credentials) lưu lại.
  const updates: Record<string, unknown> = {}
  if (ids.companyId && !cfg.misa_company_id) updates.misa_company_id = ids.companyId
  if (ids.orgUnitId && !cfg.misa_org_unit_id) updates.misa_org_unit_id = ids.orgUnitId
  if (ids.userId && !cfg.misa_user_id) updates.misa_user_id = ids.userId
  if (body.username && body.username.trim()) updates.username_enc = encryptSecret(body.username.trim())
  if (body.password && body.password.trim()) updates.password_enc = encryptSecret(body.password.trim())
  if (Object.keys(updates).length) {
    updates.updated_at = new Date().toISOString()
    await admin.from("company_einvoice_config").update(updates).eq("org_id", orgId)
  }

  return NextResponse.json({
    success: true,
    auto_filled: {
      companyId: ids.companyId,
      orgUnitId: ids.orgUnitId,
      userId: ids.userId,
    },
    needs_manual: {
      invoice_template_id: !cfg.misa_template_id,
      inv_series: !cfg.misa_inv_series,
    },
  })
}
