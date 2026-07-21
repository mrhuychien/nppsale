import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { encryptSecret } from "@/lib/crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function authOrgRole() {
  const supa = createServerSupabaseClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { error: "Chưa đăng nhập", status: 401 as const }
  const { data: profile } = await supa
    .from("users")
    .select("role, org_id")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile || !["owner", "accountant"].includes(profile.role)) {
    return { error: "Chỉ Chủ NPP hoặc Kế toán mới được cấu hình hoá đơn điện tử", status: 403 as const }
  }
  return { orgId: profile.org_id as string }
}

/** GET — trả cấu hình (KHÔNG trả mật khẩu/username thô, chỉ cờ đã đặt). */
export async function GET() {
  const a = await authOrgRole()
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status })
  const admin = createAdminClient()
  const { data } = await admin
    .from("company_einvoice_config")
    .select("id, org_id, provider, api_base, tax_code, seller_name, seller_address, misa_company_id, misa_org_unit_id, misa_template_id, misa_user_id, misa_inv_series, misa_inv_template_no, username_enc, password_enc, sandbox, is_active, token_path, publish_path, misa_app_id, sign_type, invoice_type, is_inherit_from_old_template, misa_is_invoice_with_code, created_at, updated_at")
    .eq("org_id", a.orgId)
    .maybeSingle()
  if (!data) return NextResponse.json({ config: null })
  const { username_enc, password_enc, ...rest } = data
  return NextResponse.json({
    config: {
      ...rest,
      has_username: !!username_enc,
      has_password: !!password_enc,
    },
  })
}

/** POST — upsert cấu hình. username/password để trống = giữ nguyên. */
export async function POST(req: Request) {
  const a = await authOrgRole()
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Body không hợp lệ" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("company_einvoice_config")
    .select("id, username_enc, password_enc")
    .eq("org_id", a.orgId)
    .maybeSingle()

  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string).trim() : undefined)

  const invoiceTypeRaw = body["invoice_type"]
  const invoiceType =
    typeof invoiceTypeRaw === "number"
      ? invoiceTypeRaw
      : typeof invoiceTypeRaw === "string" && invoiceTypeRaw.trim()
      ? parseInt(invoiceTypeRaw, 10)
      : 1
  const row: Record<string, unknown> = {
    org_id: a.orgId,
    provider: "misa",
    api_base: str("api_base") || "https://testapp.meinvoice.vn/api/v2",
    token_path: str("token_path") || "/oauth",
    publish_path: str("publish_path") || "/v3sainvoice",
    tax_code: str("tax_code") || null,
    seller_name: str("seller_name") || null,
    seller_address: str("seller_address") || null,
    misa_company_id: str("misa_company_id") || null,
    misa_org_unit_id: str("misa_org_unit_id") || null,
    misa_template_id: str("misa_template_id") || null,
    misa_user_id: str("misa_user_id") || null,
    misa_inv_series: str("misa_inv_series") || null,
    misa_inv_template_no: str("misa_inv_template_no") || "1",
    invoice_type: Number.isFinite(invoiceType) && invoiceType >= 1 ? invoiceType : 1,
    is_inherit_from_old_template:
      body.is_inherit_from_old_template === undefined ? false : !!body.is_inherit_from_old_template,
    sandbox: body.sandbox === undefined ? true : !!body.sandbox,
    is_active: body.is_active === undefined ? true : !!body.is_active,
    updated_at: new Date().toISOString(),
  }

  // Chỉ ghi đè credential khi người dùng nhập mới.
  const username = str("username")
  const password = str("password")
  try {
    if (username) row.username_enc = encryptSecret(username)
    else if (existing) row.username_enc = existing.username_enc
    if (password) row.password_enc = encryptSecret(password)
    else if (existing) row.password_enc = existing.password_enc
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  const q = existing
    ? admin.from("company_einvoice_config").update(row).eq("org_id", a.orgId)
    : admin.from("company_einvoice_config").insert(row)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
