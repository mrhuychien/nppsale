import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/crypto"
import { getInvoiceByRefId } from "@/lib/misa/client"
import { sameInvNo } from "@/lib/misa/normalize"
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
    .select("id, misa_lookup_code, misa_ref_id, misa_inv_no, misa_no_locked, org_id")
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

  // Chỉ đưa vào `updates` những khoá THẬT SỰ có giá trị. MISA có lúc trả
  // thiếu TransactionID (hoá đơn đang chờ cấp mã); ghi `null` vào đó là xoá
  // trắng mã tra cứu đang đúng ở lượt sau.
  const updates: Record<string, unknown> = {}
  // "<Chưa cấp số>" là chỗ MISA giữ chỗ, không phải số hoá đơn.
  if (invNo && !invNo.startsWith("<")) {
    // Số do người GÁN TAY thì không đè: misa_ref_id trên hoá đơn đó thường
    // trỏ về tờ ĐÃ CHẾT, ghi tiếp là đè số chết lên số người vừa gán.
    if (invoice.misa_no_locked) {
      // So bằng bản CHUẨN HOÁ: '00012345' và '12345' là cùng một số. Báo
      // lệch ở đó là cảnh báo giả, mà rổ cảnh báo đầy báo động giả thì
      // không ai nhìn cả cảnh báo thật.
      if (invoice.misa_inv_no && !sameInvNo(invoice.misa_inv_no, invNo)) {
        // Không đè, nhưng cũng KHÔNG im lặng.
        updates.misa_note =
          `Sổ ghi số ${invoice.misa_inv_no}, MISA cấp số ${invNo} (khoá gán tay nên không ghi đè).`
        updates.misa_status = "amount_mismatch"
      }
    } else {
      updates.misa_inv_no = invNo
    }
  }
  if (txnId) updates.misa_lookup_code = txnId
  if (nextStatus && !updates.misa_status) updates.misa_status = nextStatus
  updates.misa_last_checked_at = new Date().toISOString()
  if (Object.keys(updates).length) {
    const { error: updErr } = await admin.from("invoices").update(updates).eq("id", body.invoiceId)
      if (updErr) console.error("[einvoice/refresh-status] cập nhật thất bại:", updErr.message)
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
