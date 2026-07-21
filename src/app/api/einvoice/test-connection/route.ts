import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret, encryptSecret } from "@/lib/crypto"
import {
  extractTenantIds,
  getInvoiceTemplates,
  getTokenWithRawResponse,
} from "@/lib/misa/client"
import type { MisaConfig, MisaTemplate } from "@/lib/misa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/einvoice/test-connection
 * Body (optional): { username, password } để override khi user vừa nhập mà chưa lưu.
 *
 * Mục đích: user chỉ cần nhập MST + username + password, mọi thông tin
 * khác (CompanyID, OrganizationUnitID, UserID, IsInvoiceWithCode,
 * InvoiceTemplateID, InvSeries, InvTemplateNo, IsInheritFromOldTemplate)
 * lấy tự động từ MISA và lưu vào config.
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
    .select("api_base, tax_code, token_path, publish_path, username_enc, password_enc")
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

  // Bước 1: lấy token + trích CompanyID, OrgUnitID, UserID, IsInvoiceWithCode.
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

  // Bước 2: dùng IsInvoiceWithCode để chọn path đẩy HD, rồi gọi LAYMAU
  // để lấy danh sách mẫu HD active. Pick mẫu đầu tiên (active + IsPublished).
  const isCode = !!ids.isInvoiceWithCode
  misaConfig.isInvoiceWithCode = isCode
  let templates: MisaTemplate[] = []
  let templateError: string | null = null
  try {
    // TypeInvoice=0 theo example LAYMAU.
    templates = await getInvoiceTemplates(misaConfig, 0)
  } catch (e) {
    templateError = (e as Error).message
  }
  const activeTemplates = templates.filter((t) => !t.Inactive)
  const chosen = activeTemplates.find((t) => t.IsPublished !== false) || activeTemplates[0] || null

  // Bước 3: lưu tất cả vào config (ghi đè nếu đã có vì user chỉ có 1 mẫu).
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }
  if (ids.companyId) updates.misa_company_id = ids.companyId
  if (ids.orgUnitId) updates.misa_org_unit_id = ids.orgUnitId
  if (ids.userId) updates.misa_user_id = ids.userId
  if (ids.isInvoiceWithCode != null) {
    updates.misa_is_invoice_with_code = ids.isInvoiceWithCode
    updates.publish_path = isCode ? "/v3sainvoice/Code" : "/v3sainvoice"
  }
  if (chosen) {
    updates.misa_template_id = chosen.IPTemplateID
    updates.misa_inv_series = chosen.InvSeries
    updates.misa_inv_template_no = chosen.InvTemplateNo || "1"
    updates.invoice_type = chosen.InvoiceType || 1
    updates.is_inherit_from_old_template = !!chosen.IsInheritFromOldTemplate
  }
  if (body.username && body.username.trim()) updates.username_enc = encryptSecret(body.username.trim())
  if (body.password && body.password.trim()) updates.password_enc = encryptSecret(body.password.trim())
  await admin.from("company_einvoice_config").update(updates).eq("org_id", orgId)

  return NextResponse.json({
    success: true,
    tenant: ids,
    template: chosen
      ? {
          IPTemplateID: chosen.IPTemplateID,
          TemplateName: chosen.TemplateName,
          InvSeries: chosen.InvSeries,
          InvTemplateNo: chosen.InvTemplateNo,
          InvoiceType: chosen.InvoiceType,
        }
      : null,
    template_count: activeTemplates.length,
    template_error: templateError,
  })
}
