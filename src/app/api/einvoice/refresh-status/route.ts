import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/crypto"
import { getInvoiceByRefId } from "@/lib/misa/client"
import type { MisaConfig } from "@/lib/misa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/einvoice/refresh-status
 * Body: { invoiceId }
 *
 * Gọi LAYTHONGTINHD theo misa_lookup_code (hoặc refID đã đẩy lên) để
 * cập nhật trạng thái: InvNo (số HD MISA cấp), PublishStatus, TransactionID.
 */
export async function POST(req: Request) {
  try { return await handle(req) } catch (err) {
    console.error("[/api/einvoice/refresh-status] fatal:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

async function handle(req: Request) {
  const body = await req.json().catch(() => ({})) as { invoiceId?: string }
  if (!body.invoiceId) {
    return NextResponse.json({ error: "Thiếu invoiceId" }, { status: 400 })
  }

  const supa = createServerSupabaseClient()
  const { data: { user: authUser } } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
  const { data: profile } = await supa
    .from("users")
    .select("role, org_id")
    .eq("id", authUser.id)
    .maybeSingle()
  if (!profile || !["owner", "accountant", "manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: invoice } = await admin
    .from("invoices")
    .select("id, misa_lookup_code, misa_invoice_id, org_id")
    .eq("id", body.invoiceId)
    .eq("org_id", profile.org_id)
    .maybeSingle()
  if (!invoice) return NextResponse.json({ error: "Không tìm thấy HD" }, { status: 404 })

  // MISA WebAPI v2 dùng RefID = misa_lookup_code mà chúng ta gán lúc đẩy
  // (extractPublishResult trả RefID làm inv_no). Ưu tiên lookup_code, fallback inv_id.
  const refId = invoice.misa_lookup_code || invoice.misa_invoice_id
  if (!refId) {
    return NextResponse.json(
      { error: "HD chưa đẩy lên MISA — không có RefID để tra cứu." },
      { status: 400 }
    )
  }

  const { data: cfg } = await admin
    .from("company_einvoice_config")
    .select("*")
    .eq("org_id", profile.org_id)
    .maybeSingle()
  if (!cfg) return NextResponse.json({ error: "Chưa cấu hình MISA" }, { status: 400 })

  const misaConfig: MisaConfig = {
    apiBase: cfg.api_base,
    taxCode: cfg.tax_code || "",
    username: decryptSecret(cfg.username_enc),
    password: decryptSecret(cfg.password_enc),
    tokenPath: cfg.token_path || "/oauth",
    publishPath: cfg.publish_path || "/v3sainvoice",
    isInvoiceWithCode: !!cfg.misa_is_invoice_with_code,
  }

  let misaInvoice: Record<string, unknown> | null = null
  try {
    misaInvoice = await getInvoiceByRefId(misaConfig, refId)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
  if (!misaInvoice) {
    return NextResponse.json({ error: "MISA không trả về dữ liệu HD." }, { status: 404 })
  }

  // Update các trường có ý nghĩa cho user: InvNo, TransactionID, PublishStatus.
  const invNo = typeof misaInvoice["InvNo"] === "string" ? (misaInvoice["InvNo"] as string) : null
  const txnId = typeof misaInvoice["TransactionID"] === "string" ? (misaInvoice["TransactionID"] as string) : null
  const publishStatus = typeof misaInvoice["PublishStatus"] === "number" ? (misaInvoice["PublishStatus"] as number) : null
  // PublishStatus 0=chưa phát hành (nháp), >=1 = đã phát hành (MISA enum cụ thể có thể khác).
  let nextStatus: string | null = null
  if (publishStatus != null) {
    if (publishStatus >= 1) nextStatus = "signed"
    else nextStatus = "sent" // nháp đã đẩy lên, chưa ký
  }

  const updates: Record<string, unknown> = {}
  if (invNo && !invNo.startsWith("<")) updates.misa_invoice_id = invNo
  if (txnId) updates.misa_lookup_code = txnId
  if (nextStatus) updates.misa_status = nextStatus
  if (Object.keys(updates).length) {
    await admin.from("invoices").update(updates).eq("id", body.invoiceId)
  }

  return NextResponse.json({
    success: true,
    misa: {
      InvNo: invNo,
      TransactionID: txnId,
      PublishStatus: publishStatus,
    },
  })
}
