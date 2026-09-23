import {
  buildIndex, decideStatus, matchDate, matchOne,
  type BookRow, type SnapshotRow,
} from "@/lib/misa/reconcile"
import { docDuHoacNem } from "@/lib/supabase/aggregate"

/**
 * Khớp snapshot chưa chốt tay với hoá đơn trong sổ.
 *
 * Tách khỏi `route.ts` để chốt CHẠY được nó trên một Supabase giả — tệp
 * route của Next.js không được export thêm hàm.
 *
 * ⚠ ĐỌC ĐỦ, KHÔNG `.limit(20000)` / `.limit(30000)`. PostgREST có
 *   `db.max_rows = 1000`: `.limit()` lớn hơn trần vẫn chỉ nhận 1.000 dòng,
 *   200 OK, không lỗi. Bản cũ vì thế chỉ thấy 1.000 hoá đơn trong sổ, mọi
 *   snapshot của hoá đơn khác "không tìm thấy" — và vòng khớp GHI
 *   `invoice_id = null`, `match_status = 'misa_only'`, tức là CẮT LIÊN KẾT
 *   đã khớp đúng từ lượt trước. Mỗi lượt cron lại cắt thêm.
 *
 * ⚠ SỔ ĐỌC KHÔNG ĐỦ THÌ KHÔNG ĐƯỢC HẠ CẤP. "Không tìm thấy trong sổ" chỉ có
 *   nghĩa khi đã đọc HẾT sổ. Khi `truncated` (chạm trần) thì bỏ qua mọi
 *   snapshot không khớp được — không cắt liên kết, không gắn `misa_only` —
 *   và BÁO RA (`skippedUnlink`, `bookTruncated`).
 * ⚠ Cùng lý do: snapshot đang trỏ tới một hoá đơn KHÔNG nằm trong phần sổ
 *   vừa đọc (hoá đơn ghi sổ ngoài khung ngày) thì cũng không cắt — ta không
 *   có căn cứ nào để nói liên kết ấy sai.
 */
type Admin = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Trần sổ và trần snapshot — giữ đúng hai con số của bản cũ. */
export const BOOK_CAP = 20000
export const SNAP_CAP = 30000

type SnapRead = SnapshotRow & {
  id: string
  invoice_id: string | null
  is_deleted: boolean | null
  relation: string | null
  total_amount: number | null
}

export async function reconcileOrg(admin: Admin, orgId: string, from: string, to: string) {
  // ⚠ Thứ tự `id` duy nhất: các trang chạy SONG SONG.
  const bookRes = await docDuHoacNem<Record<string, unknown>>(
    (a, b) =>
      admin
        .from("invoices")
        .select(
          "id, misa_ref_id, misa_lookup_code, misa_inv_series, misa_inv_no, misa_inv_date, customer_tax_code, issued_at, subtotal, vat, total",
          { count: "exact" }
        )
        .eq("org_id", orgId)
        .gte("issued_at", `${from}T00:00:00+07:00`)
        .lte("issued_at", `${to}T23:59:59+07:00`)
        .order("id")
        .range(a, b),
    "Đọc sổ hoá đơn",
    BOOK_CAP
  )

  const book: BookRow[] = bookRes.rows.map((r) => ({
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
  const snapRes = await docDuHoacNem<SnapRead>(
    (a, b) =>
      admin
        .from("misa_invoice_snapshots")
        .select(
          "id, ref_id, transaction_id, inv_series, inv_no, inv_date, buyer_tax_code, total_amount, relation, is_deleted, invoice_id, match_method",
          { count: "exact" }
        )
        .eq("org_id", orgId)
        .gte("inv_date", from)
        .lte("inv_date", to)
        .or("match_method.is.null,match_method.neq.manual")
        .order("id")
        .range(a, b),
    "Đọc snapshot MISA",
    SNAP_CAP
  )

  let matched = 0
  let misaOnly = 0
  let needsReview = 0
  let skippedUnlink = 0
  const now = new Date().toISOString()

  for (const s of snapRes.rows) {
    const hit = matchOne(s, idx)
    // ⚠ KHÔNG HẠ CẤP KHI THIẾU CĂN CỨ — xem chú thích đầu tệp.
    if (!hit && (bookRes.truncated || (s.invoice_id && !bookById.has(s.invoice_id)))) {
      skippedUnlink++
      continue
    }
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

  return {
    matched,
    misaOnly,
    needsReview,
    skippedUnlink,
    bookTruncated: bookRes.truncated,
    snapTruncated: snapRes.truncated,
  }
}
