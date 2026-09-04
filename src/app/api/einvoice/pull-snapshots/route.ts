import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { decryptSecret } from "@/lib/crypto"
import { listInvoices } from "@/lib/misa/client"
import { readRelation, readSnapshot } from "@/lib/misa/status"
import {
  buildIndex, decideStatus, matchDate, matchOne,
  type BookRow, type SnapshotRow,
} from "@/lib/misa/reconcile"
import { isoDateOnly } from "@/lib/misa/apply"
import { requireCronSecret } from "@/lib/misa/cron-auth"
import type { MisaConfig } from "@/lib/misa/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * POST/GET /api/einvoice/pull-snapshots?days=60
 *
 * Kéo DANH SÁCH hoá đơn từ MISA về bảng misa_invoice_snapshots, rồi khớp
 * bốn tầng với hoá đơn trong sổ.
 *
 * VÌ SAO TÁCH KHỎI /sync: /sync đi từ SỔ ra (hỏi MISA về những tờ mình đã
 * đẩy) nên không bao giờ thấy hoá đơn phát hành THẲNG trên web MISA. Route
 * này đi ngược lại — từ MISA về sổ — và đó là cách duy nhất phát hiện hoá
 * đơn ngoài sổ.
 */
export async function POST(req: Request) { return wrap(req) }
export async function GET(req: Request) { return wrap(req) }

async function wrap(req: Request) {
  try {
    return await handle(req)
  } catch (err) {
    console.error("[/api/einvoice/pull-snapshots] fatal:", err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

/** Số bản ghi mỗi trang. */
const PAGE_SIZE = 100
/**
 * Trần số trang. Đo thật ở một nhà phân phối cùng quy mô: ~12.000 hoá
 * đơn/năm, nên 300 trang × 100 = 30.000 đủ cho một lượt kéo cả năm. Chạm
 * trần thì BÁO RA (xem `hit_page_cap`) chứ không im lặng kéo thiếu.
 */
const MAX_PAGES = 300
const DEFAULT_DAYS = 60

async function handle(req: Request) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const url = new URL(req.url)
  const days = Math.min(Math.max(Number(url.searchParams.get("days")) || DEFAULT_DAYS, 1), 400)
  const toDate = new Date()
  const fromDate = new Date(toDate.getTime() - days * 86400_000)
  const from = toDate10(fromDate)
  const to = toDate10(toDate)

  const admin = createAdminClient()
  const { data: configs, error: cfgErr } = await admin
    .from("company_einvoice_config")
    .select(
      "org_id, api_base, tax_code, token_path, username_enc, password_enc, misa_is_invoice_with_code"
    )
    .eq("is_active", true)
  if (cfgErr) {
    return NextResponse.json({ error: `Lỗi đọc cấu hình: ${cfgErr.message}` }, { status: 500 })
  }

  const report = {
    from,
    to,
    orgs: 0,
    pulled: 0,
    matched: 0,
    misa_only: 0,
    needs_review: 0,
    hit_page_cap: false,
    short_pull: [] as Array<{ org_id: string; expected: number; got: number }>,
    errors: [] as Array<{ org_id?: string; message: string }>,
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
        isInvoiceWithCode: !!cfg.misa_is_invoice_with_code,
      }
    } catch (e) {
      report.errors.push({ org_id: cfg.org_id, message: `Giải mã cấu hình lỗi: ${(e as Error).message}` })
      continue
    }

    // --- Kéo về, phân trang ------------------------------------------
    const rows: Array<Record<string, unknown>> = []
    let recordsTotal: number | null = null
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await listInvoices(misaConfig, {
          fromDate: from,
          toDate: to,
          start: page * PAGE_SIZE,
          length: PAGE_SIZE,
        })
        if (recordsTotal == null) recordsTotal = res.recordsTotal
        // ⚠ DỪNG THEO MẢNG RỖNG, không theo recordsTotal. Response mang
        // dữ liệu có thể trả recordsTotal = 0 (đã đo) — lấy nó làm điều
        // kiện dừng là dừng ngay trang đầu và kéo thiếu toàn bộ, im lặng.
        if (!res.rows.length) break
        rows.push(...res.rows)
        if (res.rows.length < PAGE_SIZE) break
        if (page === MAX_PAGES - 1) report.hit_page_cap = true
      }
    } catch (e) {
      report.errors.push({ org_id: cfg.org_id, message: `Kéo danh sách lỗi: ${(e as Error).message}` })
      continue
    }

    // Chốt chặn "kéo thiếu": recordsTotal của endpoint này CÓ giá trị
    // thật. Kéo được ít hơn hẳn là báo đỏ, không phải chuyện bỏ qua.
    if (recordsTotal != null && recordsTotal > rows.length) {
      report.short_pull.push({ org_id: cfg.org_id, expected: recordsTotal, got: rows.length })
    }

    // --- Ghi snapshot -------------------------------------------------
    const snaps = rows
      .map((raw) => toSnapshotRow(cfg.org_id, raw))
      .filter((s): s is NonNullable<ReturnType<typeof toSnapshotRow>> => s !== null)

    if (snaps.length) {
      // UPSERT theo (org_id, ref_id): kéo lại nhiều lần không nhân bản.
      // KHÔNG đụng invoice_id / match_* ở đây — việc khớp làm ở bước sau,
      // và chốt tay của người phải sống sót qua mọi lượt kéo.
      const { error: upErr } = await admin
        .from("misa_invoice_snapshots")
        .upsert(snaps, { onConflict: "org_id,ref_id" })
      if (upErr) {
        report.errors.push({ org_id: cfg.org_id, message: `Ghi snapshot lỗi: ${upErr.message}` })
        continue
      }
      report.pulled += snaps.length
    }

    // --- Khớp bốn tầng ------------------------------------------------
    try {
      const stats = await reconcileOrg(admin, cfg.org_id, from, to)
      report.matched += stats.matched
      report.misa_only += stats.misaOnly
      report.needs_review += stats.needsReview
    } catch (e) {
      report.errors.push({ org_id: cfg.org_id, message: `Đối soát lỗi: ${(e as Error).message}` })
    }
  }

  return NextResponse.json({ success: true, ...report })
}

function toDate10(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Bóc một bản ghi MISA thành dòng snapshot. Thiếu RefID thì bỏ — không có khoá. */
function toSnapshotRow(orgId: string, raw: Record<string, unknown>) {
  const snap = readSnapshot(raw)
  const refId = typeof raw["RefID"] === "string" ? raw["RefID"].trim() : ""
  if (!refId) return null
  return {
    org_id: orgId,
    ref_id: refId,
    inv_series: snap.invSeries,
    // Số hoá đơn giữ NGUYÊN VĂN (thường 8 chữ số); bản chuẩn hoá do cột
    // sinh trong DB lo.
    inv_no: snap.invNo && !snap.invNo.startsWith("<") ? snap.invNo : null,
    inv_date: snap.invDate ? isoDateOnly(snap.invDate) : null,
    transaction_id: snap.transactionId,
    invoice_code: snap.invoiceCode,
    buyer_tax_code: typeof raw["AccountObjectTaxCode"] === "string" ? raw["AccountObjectTaxCode"] : null,
    buyer_name: typeof raw["AccountObjectName"] === "string" ? raw["AccountObjectName"] : null,
    total_amount: snap.totalAmount,
    // Endpoint DANH SÁCH không tách thuế (trả 0.0 cho mọi dòng). Ghi null
    // thay vì 0 — 0 ở đây nghĩa là "không có số", ghi 0 vào cột tiền là
    // nói dối rằng thuế bằng không.
    amount_before_vat: snap.totalWithoutVat || null,
    vat_amount: snap.totalVat || null,
    publish_status: snap.publishStatus,
    einvoice_status: snap.eInvoiceStatus,
    relation: readRelation(snap.eInvoiceStatus),
    is_deleted: snap.cancelled,
    org_ref_id: snap.orgRefId,
    raw: raw as Record<string, unknown>,
    pulled_at: new Date().toISOString(),
  }
}

/** Khớp snapshot chưa chốt tay với hoá đơn trong sổ. */
async function reconcileOrg(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string,
  from: string,
  to: string
) {
  const { data: bookRows, error: bookErr } = await admin
    .from("invoices")
    .select(
      "id, misa_ref_id, misa_lookup_code, misa_inv_series, misa_inv_no, misa_inv_date, customer_tax_code, issued_at, subtotal, vat, total"
    )
    .eq("org_id", orgId)
    .gte("issued_at", `${from}T00:00:00+07:00`)
    .lte("issued_at", `${to}T23:59:59+07:00`)
    .limit(20000)
  if (bookErr) throw new Error(bookErr.message)

  const book: BookRow[] = (bookRows || []).map((r) => ({
    id: r.id as string,
    misa_ref_id: r.misa_ref_id as string | null,
    misa_lookup_code: r.misa_lookup_code as string | null,
    misa_inv_series: r.misa_inv_series as string | null,
    misa_inv_no: r.misa_inv_no as string | null,
    customer_tax_code: r.customer_tax_code as string | null,
    // Ngày phát hành MISA đúng hơn ngày ghi sổ cho việc khớp; không có
    // thì lùi về issued_at.
    match_date: (r.misa_inv_date as string | null) || matchDate(r.issued_at as string | null),
    total: r.total as number | null,
  }))
  const idx = buildIndex(book)
  const bookById = new Map(book.map((b) => [b.id, b]))

  // `match_method = 'manual'` là người đã chốt tay — vòng khớp tự động
  // KHÔNG được đụng vào, kể cả khi nó nghĩ mình tìm được tờ khác.
  const { data: snaps, error: snapErr } = await admin
    .from("misa_invoice_snapshots")
    .select(
      "id, ref_id, transaction_id, inv_series, inv_no, inv_date, buyer_tax_code, total_amount, relation, is_deleted, invoice_id, match_method"
    )
    .eq("org_id", orgId)
    .gte("inv_date", from)
    .lte("inv_date", to)
    .or("match_method.is.null,match_method.neq.manual")
    .limit(30000)
  if (snapErr) throw new Error(snapErr.message)

  let matched = 0
  let misaOnly = 0
  let needsReview = 0
  const now = new Date().toISOString()

  for (const s of snaps || []) {
    const hit = matchOne(s as SnapshotRow, idx)
    const status = decideStatus(s, hit, bookById)
    if (status.match_status === "misa_only") misaOnly++
    else if (status.match_status === "needs_review") needsReview++
    else if (status.match_status === "matched" || status.match_status === "amount_diff") matched++

    const { error: updErr } = await admin
      .from("misa_invoice_snapshots")
      .update({
        invoice_id: hit?.invoiceId ?? null,
        match_method: hit?.method ?? null,
        match_confidence: hit?.confidence ?? null,
        matched_at: now,
        ...status,
      })
      .eq("id", s.id)
    if (updErr) console.error("[pull-snapshots] cập nhật khớp lỗi:", updErr.message)
  }

  return { matched, misaOnly, needsReview }
}
