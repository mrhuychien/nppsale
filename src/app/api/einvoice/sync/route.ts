import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/crypto"
import { getInvoiceByRefId } from "@/lib/misa/client"
import { applyMisaSnapshot, type BookInvoice } from "@/lib/misa/apply"
import { markOriginalReplaced } from "@/lib/misa/mark-replaced"
import { requireCronSecret } from "@/lib/misa/cron-auth"
import type { MisaConfig } from "@/lib/misa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Vercel Hobby giới hạn 60s; quét 2×200 tờ có thể lâu hơn thế nên chia
// theo lô và luôn trả về những gì đã làm được.
export const maxDuration = 300

/**
 * POST /api/einvoice/sync — vòng quét trạng thái hoá đơn MISA.
 *
 * VÌ SAO CẦN: `refresh-status` nhận MỘT invoiceId và phải có người bấm.
 * Hoá đơn được ký trên MISA lúc 22h sẽ đứng ở 'sent' cho tới khi ai đó mở
 * đúng tờ đó ra.
 *
 * XÁC THỰC BẰNG CRON_SECRET, KHÔNG dùng phiên người dùng: cron chạy khi
 * không có ai đăng nhập. Route này dùng admin client (bỏ qua RLS) nên
 * header bí mật là hàng rào DUY NHẤT — thiếu biến môi trường thì từ chối
 * hẳn, không mở cửa.
 */
export async function POST(req: Request) {
  try {
    return await handle(req)
  } catch (err) {
    console.error("[/api/einvoice/sync] fatal:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

/**
 * Vercel Cron chỉ gọi được bằng GET, và tự gắn header
 * `Authorization: Bearer $CRON_SECRET` khi biến môi trường đó tồn tại —
 * đúng cái `handle()` đang kiểm. Cùng một hàm, không có đường tắt nào bỏ
 * qua xác thực.
 */
export async function GET(req: Request) {
  try {
    return await handle(req)
  } catch (err) {
    console.error("[/api/einvoice/sync] fatal:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

/** Mỗi lượt tối đa bao nhiêu tờ — hàm serverless có trần thời gian. */
const PASS_LIMIT = 200
/** Chỉ quét hoá đơn trong 60 ngày gần đây. */
const WINDOW_DAYS = 60

async function handle(req: Request) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const admin = createAdminClient()
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString()

  // Cấu hình MISA theo từng org — mỗi org một tài khoản, một MST.
  const { data: configs, error: cfgErr } = await admin
    .from("company_einvoice_config")
    .select(
      "org_id, is_active, api_base, tax_code, token_path, publish_path, username_enc, password_enc, misa_is_invoice_with_code"
    )
    .eq("is_active", true)
  if (cfgErr) {
    return NextResponse.json({ error: `Lỗi đọc cấu hình: ${cfgErr.message}` }, { status: 500 })
  }

  const report = {
    orgs: 0,
    checked: 0,
    updated: 0,
    originals_marked_replaced: 0,
    errors: [] as Array<{ org_id?: string; invoice_id?: string; message: string }>,
  }

  for (const cfg of configs || []) {
    report.orgs++
    let misaConfig: MisaConfig
    try {
      misaConfig = {
        apiBase: cfg.api_base,
        taxCode: cfg.tax_code || "",
        username: decryptSecret(cfg.username_enc),
        password: decryptSecret(cfg.password_enc),
        tokenPath: cfg.token_path || "/oauth",
        publishPath: cfg.publish_path || "/v3sainvoice",
        isInvoiceWithCode: !!cfg.misa_is_invoice_with_code,
      }
    } catch (e) {
      // Sai EINVOICE_ENC_KEY chẳng hạn. Một org hỏng không được kéo theo
      // các org còn lại.
      report.errors.push({ org_id: cfg.org_id, message: `Giải mã cấu hình lỗi: ${(e as Error).message}` })
      continue
    }

    const cols =
      "id, misa_ref_id, misa_inv_no, misa_status, misa_no_locked, subtotal, vat, total"

    // === LƯỢT 1 — chưa có số: hỏi xem MISA cấp chưa ===================
    const { data: pass1, error: e1 } = await admin
      .from("invoices")
      .select(cols)
      .eq("org_id", cfg.org_id)
      .not("misa_ref_id", "is", null)
      .is("misa_inv_no", null)
      .gte("issued_at", since)
      .order("misa_last_checked_at", { ascending: true, nullsFirst: true })
      .limit(PASS_LIMIT)
    if (e1) report.errors.push({ org_id: cfg.org_id, message: `Lượt 1 lỗi: ${e1.message}` })

    // === LƯỢT 2 — ĐÃ có số nhưng chưa ở trạng thái cuối ===============
    //
    // ⚠ Thiếu lượt này thì hoá đơn bị huỷ hoặc BỊ THAY THẾ trên MISA *sau
    // khi đã cấp số* không bao giờ bị phát hiện: bộ lọc lượt 1 loại chúng
    // ra (chúng đã có misa_inv_no), nên hai nhánh xử lý 'cancelled' và
    // 'replaced' trở thành CODE CHẾT. Sổ vẫn ghi một hoá đơn hợp lệ trong
    // khi bên MISA nó đã bị huỷ.
    //
    // misa_no_locked = false: hoá đơn người GÁN TAY số thì misa_ref_id
    // trên đó trỏ về tờ ĐÃ CHẾT — quét tiếp là ghi số chết đè lên số người
    // vừa gán, lặng lẽ, mỗi lần chạy.
    const { data: pass2, error: e2 } = await admin
      .from("invoices")
      .select(cols)
      .eq("org_id", cfg.org_id)
      .not("misa_ref_id", "is", null)
      .not("misa_inv_no", "is", null)
      .not("misa_status", "in", "(cancelled,replaced)")
      .eq("misa_no_locked", false)
      .gte("issued_at", since)
      .order("misa_last_checked_at", { ascending: true, nullsFirst: true })
      .limit(PASS_LIMIT)
    if (e2) report.errors.push({ org_id: cfg.org_id, message: `Lượt 2 lỗi: ${e2.message}` })

    const queue = [...(pass1 || []), ...(pass2 || [])] as BookInvoice[]

    for (const inv of queue) {
      if (!inv.misa_ref_id) continue
      report.checked++
      try {
        const raw = await getInvoiceByRefId(misaConfig, inv.misa_ref_id)

        if (!raw) {
          // MISA không trả gì. ĐỪNG hạ một trạng thái đang đúng — có thể
          // chỉ là lỗi tạm. Chỉ ghi nhận là đã hỏi.
          await admin
            .from("invoices")
            .update({ misa_last_checked_at: new Date().toISOString() })
            .eq("id", inv.id)
          continue
        }

        const applied = applyMisaSnapshot(raw, inv, {
          orgUsesInvoiceCode: !!cfg.misa_is_invoice_with_code,
          now: new Date().toISOString(),
        })

        const { error: updErr } = await admin
          .from("invoices")
          .update(applied.updates)
          .eq("id", inv.id)
        if (updErr) {
          report.errors.push({ org_id: cfg.org_id, invoice_id: inv.id, message: updErr.message })
          continue
        }
        report.updated++

        if (applied.markOriginalReplaced) {
          const marked = await markOriginalReplaced(
            admin,
            cfg.org_id,
            applied.markOriginalReplaced,
            inv.id
          )
          if (marked) report.originals_marked_replaced++
        }

        // Ghi log những tờ có chuyện đáng nói — không log tờ bình thường,
        // nếu không einvoice_logs thành bãi rác và không ai đọc nữa.
        if (applied.summary.notes.length) {
          await admin.from("einvoice_logs").insert({
            org_id: cfg.org_id,
            invoice_id: inv.id,
            request_payload: { source: "sync", ref_id: inv.misa_ref_id },
            response_payload: raw as Record<string, unknown>,
            status: "success",
            error_message: applied.summary.notes.join("\n"),
            misa_inv_no: applied.summary.invNo,
          })
        }
      } catch (e) {
        // ⚠ Lỗi MỘT hoá đơn không được kéo theo cả lượt: gom lại, chạy
        // tiếp. Ném ra ở đây là 199 tờ còn lại không bao giờ được hỏi.
        report.errors.push({
          org_id: cfg.org_id,
          invoice_id: inv.id,
          message: (e as Error).message,
        })
      }
    }
  }

  return NextResponse.json({ success: true, ...report })
}
