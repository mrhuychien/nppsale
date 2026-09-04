import { NextResponse } from "next/server"
import { createServerSupabaseClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/crypto"
import { getInvoiceByRefId } from "@/lib/misa/client"
import { readSnapshot, deriveState } from "@/lib/misa/status"
import { isoDateOnly } from "@/lib/misa/apply"
import { sameInvNo, sameSeries } from "@/lib/misa/normalize"
import type { MisaConfig } from "@/lib/misa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST /api/einvoice/reconcile-action
 *
 * Ba việc người làm tay trên màn hình đối soát:
 *   link    — nối snapshot với một hoá đơn trong sổ
 *   unlink  — gỡ nối, trả về cho vòng khớp tự động
 *   create  — dựng hoá đơn trong sổ từ một snapshot "chỉ có trên MISA"
 *
 * Khác các route cron: việc này do NGƯỜI bấm nên xác thực bằng phiên đăng
 * nhập, không phải CRON_SECRET. Vẫn dùng admin client để ghi (cần đọc
 * chéo bảng và giải mã cấu hình), nên phải TỰ kiểm quyền — RLS không đỡ
 * cho admin client.
 *
 * MỌI thao tác ở đây đặt `match_method = 'manual'`, thứ mà vòng khớp tự
 * động phải bỏ qua. Người chốt rồi thì máy không được sửa lại.
 */
export async function POST(req: Request) {
  try {
    return await handle(req)
  } catch (err) {
    console.error("[/api/einvoice/reconcile-action] fatal:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

type Body = { action?: "link" | "unlink" | "create"; snapshotId?: string; invoiceId?: string }

async function handle(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body
  if (!body.snapshotId) return NextResponse.json({ error: "Thiếu snapshotId" }, { status: 400 })

  const supa = createServerSupabaseClient()
  const {
    data: { user: authUser },
  } = await supa.auth.getUser()
  if (!authUser) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 })
  const { data: profile } = await supa
    .from("users")
    .select("id, role, org_id")
    .eq("id", authUser.id)
    .maybeSingle()
  if (!profile || !["owner", "accountant", "manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
  }
  const orgId = profile.org_id as string

  const admin = createAdminClient()
  const { data: snap, error: snapErr } = await admin
    .from("misa_invoice_snapshots")
    // Liệt kê cột thay vì '*': giảm payload và buộc kiểu hẹp lại.
    // Phải là MỘT chuỗi literal — Supabase suy kiểu từ chính chuỗi đó, nối
    // chuỗi bằng `+` làm nó mất kiểu và trả về GenericStringError.
    .select("id, org_id, ref_id, inv_series, inv_no, inv_date, buyer_name, buyer_tax_code, total_amount, relation, is_deleted, invoice_id, match_method")
    .eq("id", body.snapshotId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (snapErr) return NextResponse.json({ error: snapErr.message }, { status: 500 })
  if (!snap) return NextResponse.json({ error: "Không tìm thấy dòng đối soát" }, { status: 404 })

  if (body.action === "unlink") return unlink(admin, snap.id)
  if (body.action === "link") return link(admin, orgId, snap, body.invoiceId)
  if (body.action === "create") return createFromSnapshot(admin, orgId, snap)
  return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 })
}

type Admin = ReturnType<typeof createAdminClient>
type Snap = Record<string, unknown> & { id: string }

/** Gỡ nối — trả dòng này về cho vòng khớp tự động ở lượt sau. */
async function unlink(admin: Admin, snapshotId: string) {
  const { error } = await admin
    .from("misa_invoice_snapshots")
    .update({
      invoice_id: null,
      match_method: null,
      match_confidence: null,
      match_status: null,
      match_note: null,
      matched_at: null,
    })
    .eq("id", snapshotId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, action: "unlink" })
}

/**
 * Nối tay snapshot với một hoá đơn.
 *
 * Ba chốt chặn — đều là những chỗ nối sai sẽ làm sai báo cáo thuế:
 *  1. Hoá đơn phải cùng org (admin client bỏ qua RLS nên phải tự kiểm).
 *  2. Hoá đơn đó đã bị một snapshot KHÁC chiếm chưa. Hai hoá đơn MISA
 *     cùng trỏ một hoá đơn trong sổ là một lần bán bị kê hai lần.
 *  3. Số hoá đơn trong sổ có mâu thuẫn với số trên MISA không. Nối một tờ
 *     mang số khác hẳn là gán nhầm, và nó im lặng.
 */
async function link(admin: Admin, orgId: string, snap: Snap, invoiceId?: string) {
  if (!invoiceId) return NextResponse.json({ error: "Thiếu invoiceId" }, { status: 400 })

  const { data: inv, error: invErr } = await admin
    .from("invoices")
    .select("id, invoice_number, misa_inv_series, misa_inv_no, total")
    .eq("id", invoiceId)
    .eq("org_id", orgId)
    .maybeSingle()
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!inv) {
    return NextResponse.json(
      { error: "Không tìm thấy hoá đơn đó trong sổ của đơn vị này." },
      { status: 404 }
    )
  }

  const { data: taken } = await admin
    .from("misa_invoice_snapshots")
    .select("id, inv_series, inv_no")
    .eq("org_id", orgId)
    .eq("invoice_id", invoiceId)
    .neq("id", snap.id)
    .maybeSingle()
  if (taken) {
    return NextResponse.json(
      {
        error:
          `Hoá đơn này đã được nối với một hoá đơn MISA khác ` +
          `(${taken.inv_series || "?"} · ${taken.inv_no || "?"}). ` +
          `Gỡ nối bên đó trước — một lần bán không thể có hai hoá đơn hợp lệ.`,
      },
      { status: 409 }
    )
  }

  // Cảnh báo (không chặn): sổ đã ghi một số khác. Có thể đúng — hoá đơn
  // thay thế mang số mới — nên để người quyết, nhưng phải NÓI RA.
  const warnings: string[] = []
  const snapNo = snap.inv_no as string | null
  const snapSeries = snap.inv_series as string | null
  if (inv.misa_inv_no && snapNo && !sameInvNo(inv.misa_inv_no, snapNo)) {
    warnings.push(`Sổ đang ghi số ${inv.misa_inv_no}, MISA là ${snapNo}.`)
  }
  if (inv.misa_inv_series && snapSeries && !sameSeries(inv.misa_inv_series, snapSeries)) {
    warnings.push(`Sổ đang ghi ký hiệu ${inv.misa_inv_series}, MISA là ${snapSeries}.`)
  }

  const { error } = await admin
    .from("misa_invoice_snapshots")
    .update({
      invoice_id: invoiceId,
      match_method: "manual",
      match_confidence: "certain",
      match_status: warnings.length ? "needs_review" : "matched",
      match_note: warnings.length
        ? `Người nối tay. ${warnings.join(" ")}`
        : "Người nối tay.",
      matched_at: new Date().toISOString(),
    })
    .eq("id", snap.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, action: "link", warnings })
}

/**
 * Dựng hoá đơn trong sổ từ một snapshot "chỉ có trên MISA".
 *
 * HAI GIẢ ĐỊNH, nói rõ vì chúng là quyết định nghiệp vụ:
 *  1. KHÔNG gắn vào đơn hàng nào (`order_id` để trống). Máy không biết
 *     hoá đơn phát hành thẳng trên MISA thuộc đơn nào; đoán là gắn sai.
 *     Người gắn sau ở màn hình hoá đơn.
 *  2. Kỳ ghi nhận lấy theo NGÀY PHÁT HÀNH trên MISA (InvDate), không
 *     phải hôm nay. Đây là ngày quyết định kỳ thuế.
 *
 * Số tiền lấy từ endpoint CHI TIẾT chứ không phải từ snapshot: endpoint
 * danh sách không tách thuế (trả 0.0), dựng hoá đơn với thuế = 0 là ghi
 * sai sổ. Không lấy được chi tiết thì DỪNG, không dựng nửa vời.
 */
async function createFromSnapshot(admin: Admin, orgId: string, snap: Snap) {
  if (snap.invoice_id) {
    return NextResponse.json(
      { error: "Dòng này đã nối với một hoá đơn trong sổ rồi." },
      { status: 409 }
    )
  }
  const refId = snap.ref_id as string
  if (!refId) return NextResponse.json({ error: "Dòng này không có RefID." }, { status: 400 })

  const { data: cfg } = await admin
    .from("company_einvoice_config")
    .select("api_base, tax_code, token_path, username_enc, password_enc, misa_is_invoice_with_code")
    .eq("org_id", orgId)
    .maybeSingle()
  if (!cfg) return NextResponse.json({ error: "Chưa cấu hình MISA" }, { status: 400 })

  let misaConfig: MisaConfig
  try {
    misaConfig = {
      apiBase: cfg.api_base,
      taxCode: cfg.tax_code || "",
      username: decryptSecret(cfg.username_enc),
      password: decryptSecret(cfg.password_enc),
      tokenPath: cfg.token_path || "/oauth",
      isInvoiceWithCode: !!cfg.misa_is_invoice_with_code,
    }
  } catch (e) {
    return NextResponse.json({ error: `Giải mã cấu hình lỗi: ${(e as Error).message}` }, { status: 500 })
  }

  let raw: Record<string, unknown> | null = null
  try {
    raw = await getInvoiceByRefId(misaConfig, refId)
  } catch (e) {
    return NextResponse.json({ error: `Gọi MISA lỗi: ${(e as Error).message}` }, { status: 502 })
  }
  if (!raw) {
    return NextResponse.json(
      {
        error:
          "MISA không trả chi tiết hoá đơn này nên không lấy được tiền hàng và thuế. " +
          "KHÔNG dựng hoá đơn với số liệu thiếu — thử lại sau, hoặc lập tay.",
      },
      { status: 502 }
    )
  }

  const detail = readSnapshot(raw)
  if (detail.totalAmount == null) {
    return NextResponse.json(
      { error: "MISA không trả tổng tiền — không dựng hoá đơn thiếu số liệu." },
      { status: 502 }
    )
  }
  const derived = deriveState({
    snap: detail,
    orgUsesInvoiceCode: !!cfg.misa_is_invoice_with_code,
    currentStatus: null,
  })

  const invDate = detail.invDate ? isoDateOnly(detail.invDate) : (snap.inv_date as string | null)
  const { data: created, error: insErr } = await admin
    .from("invoices")
    .insert({
      org_id: orgId,
      // Giả định 1: chưa gắn đơn hàng.
      order_id: null,
      invoice_number: detail.invNo || (snap.inv_no as string | null),
      customer_name:
        (raw["AccountObjectName"] as string) || (snap.buyer_name as string) || "Khách lẻ",
      customer_address: (raw["AccountObjectAddress"] as string) || null,
      customer_tax_code:
        (raw["AccountObjectTaxCode"] as string) || (snap.buyer_tax_code as string) || null,
      subtotal: detail.totalWithoutVat ?? 0,
      vat: detail.totalVat ?? 0,
      total: detail.totalAmount,
      status: "issued",
      // Giả định 2: kỳ theo ngày phát hành trên MISA.
      issued_at: invDate ? `${invDate}T00:00:00+07:00` : new Date().toISOString(),
      misa_ref_id: refId,
      misa_inv_no: detail.invNo,
      misa_inv_series: detail.invSeries,
      misa_inv_date: invDate,
      misa_invoice_code: detail.invoiceCode,
      misa_lookup_code: detail.transactionId,
      misa_relation: derived.relation,
      misa_org_ref_id: detail.orgRefId,
      misa_status: derived.status ?? "signed",
      misa_last_checked_at: new Date().toISOString(),
      misa_note:
        "Hoá đơn dựng từ đối soát MISA (phát hành thẳng trên MISA, chưa gắn đơn hàng). " +
        "Kỳ ghi nhận lấy theo ngày phát hành trên MISA." +
        (derived.note ? ` ${derived.note}` : ""),
    })
    .select("id")
    .single()

  if (insErr) {
    // Chỉ mục duy nhất (org, ký hiệu, số) chặn hai hoá đơn cùng số — đó
    // là chốt chặn, không phải lỗi bất ngờ, nên nói cho người hiểu.
    const dup = insErr.message.includes("uq_invoices_misa_inv_no")
    return NextResponse.json(
      {
        error: dup
          ? `Sổ đã có một hoá đơn mang ký hiệu ${snap.inv_series} số ${snap.inv_no}. ` +
            `Dùng "Nối tay" với hoá đơn đó thay vì dựng tờ mới.`
          : insErr.message,
      },
      { status: dup ? 409 : 500 }
    )
  }

  const { error: linkErr } = await admin
    .from("misa_invoice_snapshots")
    .update({
      invoice_id: created.id,
      match_method: "manual",
      match_confidence: "certain",
      match_status: "matched",
      match_note: "Đã dựng hoá đơn trong sổ từ dòng này.",
      matched_at: new Date().toISOString(),
    })
    .eq("id", snap.id)
  if (linkErr) {
    // Hoá đơn ĐÃ tạo. Im lặng ở đây là để người bấm lần nữa và tạo trùng.
    return NextResponse.json(
      {
        success: false,
        invoice_id: created.id,
        error:
          "Đã dựng hoá đơn nhưng chưa cập nhật được dòng đối soát. " +
          "ĐỪNG bấm lại — mở hoá đơn vừa tạo và nối tay.",
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, action: "create", invoice_id: created.id })
}
