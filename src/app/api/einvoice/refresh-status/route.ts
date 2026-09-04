import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/crypto"
import { getInvoiceByRefId } from "@/lib/misa/client"
import { applyMisaSnapshot } from "@/lib/misa/apply"
import { markOriginalReplaced } from "@/lib/misa/mark-replaced"
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
  const { data: invoice, error: invoiceErr } = await admin
    .from("invoices")
    .select("id, misa_lookup_code, misa_ref_id, misa_inv_no, misa_no_locked, misa_status, subtotal, vat, total, org_id")
    .eq("id", body.invoiceId)
    .eq("org_id", profile.org_id)
    .maybeSingle()
  if (invoiceErr) {
    console.error("[api/einvoice/refresh-status] truy vấn hoá đơn lỗi:", invoiceErr.message)
    return NextResponse.json({ error: "Lỗi truy vấn hoá đơn" }, { status: 500 })
  }
  if (!invoice) return NextResponse.json({ error: "Không tìm thấy HD" }, { status: 404 })

  // MISA LAYTHONGTINHD tra theo RefID (GUID hoá đơn) = misa_ref_id.
  //
  // KHÔNG lùi về misa_lookup_code: đó là TransactionID, một mã khác hẳn —
  // hỏi MISA bằng nó là đoán, MISA trả rỗng, rồi người dùng nhận câu "MISA
  // không trả về dữ liệu HD." và đi soi nhầm chỗ. Chú thích cũ ở đây đã
  // viết đúng điều này trong khi dòng code ngay dưới làm ngược lại.
  const refId = invoice.misa_ref_id
  if (!refId) {
    // Hai ca khác hẳn nhau, cách xử lý khác nhau — không gộp làm một.
    if (invoice.misa_inv_no) {
      return NextResponse.json(
        {
          error:
            "Hoá đơn này đã MẤT RefID (dữ liệu cũ trước bản vá tách khoá) nên không " +
            "tra cứu lại được trên MISA. Cần gán tay RefID hoặc phát hành lại — xem " +
            "supabase/diagnostics/einvoice_lost_refid.sql.",
        },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: "HD chưa đẩy lên MISA — không có RefID để tra cứu." },
      { status: 400 }
    )
  }

  const { data: cfg, error: cfgErr } = await admin
    .from("company_einvoice_config")
    .select("api_base, tax_code, token_path, publish_path, username_enc, password_enc, misa_is_invoice_with_code")
    .eq("org_id", profile.org_id)
    .maybeSingle()
  if (cfgErr) {
    console.error("[api/einvoice/refresh-status] truy vấn cấu hình lỗi:", cfgErr.message)
    return NextResponse.json({ error: "Lỗi truy vấn cấu hình MISA" }, { status: 500 })
  }
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

  // Suy trạng thái + quan hệ bằng module dùng CHUNG với vòng quét
  // (src/lib/misa/apply.ts) — hai đường không được kết luận khác nhau về
  // cùng một hoá đơn.
  const applied = applyMisaSnapshot(
    misaInvoice,
    {
      id: invoice.id,
      misa_ref_id: invoice.misa_ref_id,
      misa_inv_no: invoice.misa_inv_no,
      misa_status: invoice.misa_status,
      misa_no_locked: invoice.misa_no_locked,
      subtotal: invoice.subtotal,
      vat: invoice.vat,
      total: invoice.total,
    },
    { orgUsesInvoiceCode: !!cfg.misa_is_invoice_with_code, now: new Date().toISOString() }
  )

  const { error: updErr } = await admin
    .from("invoices")
    .update(applied.updates)
    .eq("id", body.invoiceId)
  if (updErr) console.error("[einvoice/refresh-status] cập nhật thất bại:", updErr.message)

  // Tờ này là bản THAY THẾ → tờ gốc phải được đánh dấu hết hiệu lực.
  // Không làm thì hai hoá đơn cùng hiện "đã ký" cho một lần bán và doanh
  // thu / thuế đầu ra khai GẤP ĐÔI.
  let originalMarked: string | null = null
  if (applied.markOriginalReplaced) {
    originalMarked = await markOriginalReplaced(
      admin,
      profile.org_id as string,
      applied.markOriginalReplaced,
      invoice.id
    )
  }

  return NextResponse.json({
    success: true,
    misa: {
      InvNo: applied.summary.invNo,
      TransactionID: applied.updates.misa_lookup_code ?? null,
      PublishStatus: misaInvoice["PublishStatus"] ?? null,
      EInvoiceStatus: misaInvoice["EInvoiceStatus"] ?? null,
      relation: applied.summary.relation,
      status: applied.summary.status,
      notes: applied.summary.notes,
      original_marked_replaced: originalMarked,
    },
  })
}
