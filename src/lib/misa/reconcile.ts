import { normalizeInvNo, normalizeSeries } from "./normalize"
import { AMOUNT_TOLERANCE } from "./status"

/**
 * Khớp snapshot hoá đơn MISA với hoá đơn trong sổ — BỐN TẦNG.
 *
 * Thuần: không chạm DB, không gọi mạng. Nhận sẵn danh sách hoá đơn trong
 * sổ, trả về quyết định khớp.
 *
 * VÌ SAO PHẢI NHIỀU TẦNG
 * Hoá đơn ĐÃ CÓ SẴN trên MISA mang RefID do MISA quản lý, không phải GUID
 * app này sinh — nên tầng 1 KHÔNG BAO GIỜ trúng với dữ liệu cũ. Tầng 1
 * chỉ có nghĩa cho hoá đơn app đẩy lên sau khi luồng đẩy đã chạy. Đối
 * soát dữ liệu cũ sống bằng tầng 3 (ký hiệu + số) — đã đo trên 30 hoá đơn
 * thật: khoá (ký hiệu, số đã chuẩn hoá) là DUY NHẤT, nên tầng 3 đủ mạnh.
 *
 * ĐỘ TIN CẬY KHÔNG PHẢI TRANG TRÍ
 * Tầng 1–3 là khoá định danh: chắc chắn. Tầng 3b và 4 là SUY ĐOÁN và phải
 * được đánh dấu "cần review" — gán thẳng như tầng chắc chắn là để một
 * phỏng đoán đi vào sổ thuế mà không ai biết đó là phỏng đoán.
 */

export type MatchMethod =
  | "ref_id"
  | "transaction_id"
  | "inv_no"
  | "inv_no_loose"
  | "tax_date_amount"
export type MatchConfidence = "certain" | "review"

export interface BookRow {
  id: string
  misa_ref_id: string | null
  misa_lookup_code: string | null
  misa_inv_series: string | null
  misa_inv_no: string | null
  customer_tax_code: string | null
  /** Ngày dùng để khớp tầng 4, dạng yyyy-MM-dd. */
  match_date: string | null
  total: number | null
}

export interface SnapshotRow {
  ref_id: string | null
  transaction_id: string | null
  inv_series: string | null
  inv_no: string | null
  inv_date: string | null
  buyer_tax_code: string | null
  total_amount: number | null
}

export interface MatchResult {
  invoiceId: string
  method: MatchMethod
  confidence: MatchConfidence
  /** Vì sao chọn tờ này — hiện cho người review đọc. */
  note: string | null
}

function norm(v: string | null | undefined): string {
  return (v ?? "").trim()
}

/**
 * Ký hiệu bỏ CHỮ SỐ ĐẦU — chỉ dùng cho tầng khớp DỰ PHÒNG.
 *
 * Chữ số đầu là mẫu số (InvTemplateNo), có nơi ghi kèm ký hiệu có nơi
 * không, cùng một dải số. Nhưng '1C25MHG' và '2C25MHG' là HAI MẪU SỐ khác
 * nhau và bỏ chữ số đầu sẽ gộp chúng — nên tầng này luôn "cần review",
 * không bao giờ được coi là chắc chắn.
 */
function looseSeries(v: string | null | undefined): string {
  return normalizeSeries(v)
}

/** Ký hiệu chuẩn hoá NHƯNG GIỮ mẫu số — dùng cho tầng 3 (chắc chắn). */
function strictSeries(v: string | null | undefined): string {
  return norm(v).toUpperCase().replace(/\s+/g, "")
}

/**
 * Mã số thuế rút về gốc: bỏ đuôi chi nhánh ('0301175691-044' → '0301175691').
 *
 * CHỈ dùng ở vòng NGOÀI. Đã đo 4 đuôi chi nhánh khác nhau trong cùng một
 * mẫu dữ liệu — strip sớm là nhập nhằng giữa các chi nhánh của cùng doanh
 * nghiệp, mà chúng là những người mua KHÁC NHAU.
 */
export function baseTaxCode(v: string | null | undefined): string {
  return norm(v).replace(/\s+/g, "").split("-")[0]
}

export interface BookIndex {
  byRef: Map<string, string>
  byTxn: Map<string, string>
  byNo: Map<string, string>
  byLooseNo: Map<string, string[]>
  byTaxDateAmount: Map<string, string[]>
  /** Khoá tầng 4 nhưng dùng MST đủ chuỗi — thử trước, xem baseTaxCode. */
  byFullTaxDateAmount: Map<string, string[]>
}

const noKey = (series: string, no: string) => `${series}|${no}`

/**
 * Khoá tầng 4: (MST, ngày, tiền làm tròn theo TRỊ TUYỆT ĐỐI).
 *
 * abs() vì hoá đơn điều chỉnh giảm mang tiền ÂM trên MISA trong khi sổ
 * ghi dương — đã đo trên dữ liệu thật.
 */
const amtKey = (tax: string, date: string, total: number) =>
  `${tax}|${date}|${Math.round(Math.abs(total))}`

export function buildIndex(rows: BookRow[]): BookIndex {
  const byRef = new Map<string, string>()
  const byTxn = new Map<string, string>()
  const byNo = new Map<string, string>()
  const byLooseNo = new Map<string, string[]>()
  const byTaxDateAmount = new Map<string, string[]>()
  const byFullTaxDateAmount = new Map<string, string[]>()

  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const cur = m.get(k)
    if (cur) cur.push(v)
    else m.set(k, [v])
  }

  for (const r of rows) {
    if (r.misa_ref_id) {
      // setdefault: tờ ĐẦU TIÊN giữ khoá. Hai hoá đơn cùng RefID là dữ
      // liệu hỏng — ghi đè im lặng sẽ giấu mất chuyện đó.
      if (!byRef.has(norm(r.misa_ref_id))) byRef.set(norm(r.misa_ref_id), r.id)
    }
    if (r.misa_lookup_code && !byTxn.has(norm(r.misa_lookup_code))) {
      byTxn.set(norm(r.misa_lookup_code), r.id)
    }
    if (r.misa_inv_series && r.misa_inv_no) {
      const k = noKey(strictSeries(r.misa_inv_series), normalizeInvNo(r.misa_inv_no))
      if (!byNo.has(k)) byNo.set(k, r.id)
      push(byLooseNo, noKey(looseSeries(r.misa_inv_series), normalizeInvNo(r.misa_inv_no)), r.id)
    }
    if (r.match_date && r.total != null) {
      const full = norm(r.customer_tax_code).replace(/\s+/g, "")
      if (full) push(byFullTaxDateAmount, amtKey(full, r.match_date, r.total), r.id)
      const base = baseTaxCode(r.customer_tax_code)
      if (base) push(byTaxDateAmount, amtKey(base, r.match_date, r.total), r.id)
    }
  }

  return { byRef, byTxn, byNo, byLooseNo, byTaxDateAmount, byFullTaxDateAmount }
}

/** Cắt 10 ký tự đầu của chuỗi ngày — KHÔNG parse tự đoán. */
export function matchDate(raw: string | null | undefined): string | null {
  const m = norm(raw).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

export function matchOne(snap: SnapshotRow, idx: BookIndex): MatchResult | null {
  // --- Tầng 1: RefID — khoá app tự sinh, chắc chắn nhất ---------------
  const byRef = snap.ref_id ? idx.byRef.get(norm(snap.ref_id)) : undefined
  if (byRef) return { invoiceId: byRef, method: "ref_id", confidence: "certain", note: null }

  // --- Tầng 2: TransactionID — mã tra cứu, MISA cấp -------------------
  const byTxn = snap.transaction_id ? idx.byTxn.get(norm(snap.transaction_id)) : undefined
  if (byTxn) {
    return { invoiceId: byTxn, method: "transaction_id", confidence: "certain", note: null }
  }

  // --- Tầng 3: ký hiệu + số — khoá tự nhiên, đã đo là duy nhất --------
  if (snap.inv_series && snap.inv_no) {
    const strict = idx.byNo.get(noKey(strictSeries(snap.inv_series), normalizeInvNo(snap.inv_no)))
    if (strict) return { invoiceId: strict, method: "inv_no", confidence: "certain", note: null }

    // --- Tầng 3b: bỏ chữ số đầu ký hiệu — SUY ĐOÁN -------------------
    // Chỉ nhận khi đúng MỘT tờ trùng: '1C25MHG' và '2C25MHG' rút gọn về
    // cùng 'C25MHG' nên nhiều tờ trùng nghĩa là không phân biệt được.
    const loose = idx.byLooseNo.get(noKey(looseSeries(snap.inv_series), normalizeInvNo(snap.inv_no)))
    if (loose && loose.length === 1) {
      return {
        invoiceId: loose[0],
        method: "inv_no_loose",
        confidence: "review",
        note:
          `Khớp sau khi bỏ chữ số đầu của ký hiệu (MISA: ${snap.inv_series}). ` +
          `Xác nhận đúng mẫu số trước khi chốt.`,
      }
    }
  }

  // --- Tầng 4: MST + ngày + tiền — SUY ĐOÁN ---------------------------
  // Chỉ nhận khi DUY NHẤT một hoá đơn trùng cả ba vế. Nhiều hoá đơn cùng
  // MST/ngày/tiền là chuyện thường (giao nhiều đợt cho một khách trong
  // một ngày), đoán bừa ở đây là sai báo cáo thuế.
  const date = matchDate(snap.inv_date)
  if (date && snap.total_amount != null) {
    // Vòng trong: MST ĐỦ CHUỖI. Kể cả đuôi chi nhánh.
    const full = norm(snap.buyer_tax_code).replace(/\s+/g, "")
    if (full) {
      const cands = idx.byFullTaxDateAmount.get(amtKey(full, date, snap.total_amount))
      if (cands && cands.length === 1) {
        return {
          invoiceId: cands[0],
          method: "tax_date_amount",
          confidence: "review",
          note: `Suy đoán từ MST ${full} + ngày ${date} + tiền. Duy nhất một hoá đơn trùng.`,
        }
      }
      // Nhiều tờ trùng ở vòng trong thì DỪNG. Nới sang MST gốc chỉ làm
      // rổ ứng viên to thêm, không bao giờ làm nó về 1.
      if (cands && cands.length > 1) return null
    }

    // Vòng ngoài: rút MST về gốc, bỏ đuôi chi nhánh.
    const base = baseTaxCode(snap.buyer_tax_code)
    if (base) {
      const cands = idx.byTaxDateAmount.get(amtKey(base, date, snap.total_amount))
      if (cands && cands.length === 1) {
        return {
          invoiceId: cands[0],
          method: "tax_date_amount",
          confidence: "review",
          note:
            `Suy đoán từ MST gốc ${base} (đã bỏ đuôi chi nhánh) + ngày ${date} + tiền. ` +
            `Duy nhất một hoá đơn trùng — kiểm lại đúng chi nhánh trước khi chốt.`,
        }
      }
    }
  }

  return null
}

export interface SnapRecord {
  relation: string | null
  is_deleted: boolean | null
  total_amount: number | null
}

/**
 * Trạng thái đối soát. Vòng đời đọc từ CỜ THẬT của MISA, không suy đoán.
 *
 * Thứ tự quan trọng: đã huỷ và đã bị thay thế phải được kết luận TRƯỚC
 * khi hỏi "có khớp được hoá đơn nào không". Hoá đơn đã chết mà xếp vào rổ
 * "chỉ có trên MISA" là báo động giả — nó không phải hoá đơn ngoài sổ, nó
 * là hoá đơn hết hiệu lực.
 */
export function decideStatus(
  s: SnapRecord,
  hit: { invoiceId: string; confidence: string; note: string | null } | null,
  bookById: Map<string, BookRow>
): { match_status: string; match_note: string | null } {
  if (s.is_deleted) return { match_status: "cancelled", match_note: "MISA báo hoá đơn đã huỷ." }
  if (s.relation === "replaced") {
    return { match_status: "replaced", match_note: "Đã bị thay thế trên MISA — hết hiệu lực." }
  }
  if (!hit) {
    return {
      match_status: "misa_only",
      match_note: "Không tìm được hoá đơn tương ứng trong sổ — hoá đơn phát hành ngoài app.",
    }
  }
  if (hit.confidence === "review") {
    return { match_status: "needs_review", match_note: hit.note }
  }

  // Hoá đơn ĐIỀU CHỈNH mang số CHÊNH, không phải tổng — so với total của
  // hoá đơn gốc là chắc chắn ra "lệch tiền" giả.
  if (s.relation === "adjustment") {
    return {
      match_status: "matched",
      match_note: "Hoá đơn điều chỉnh mang số chênh — không so tiền với sổ.",
    }
  }

  const bookRow = bookById.get(hit.invoiceId)
  if (bookRow?.total != null && s.total_amount != null) {
    // abs() cả hai vế: hoá đơn giảm mang tiền âm bên MISA, dương trong sổ.
    if (Math.abs(Math.abs(s.total_amount) - Math.abs(bookRow.total)) > AMOUNT_TOLERANCE) {
      return {
        match_status: "amount_diff",
        match_note: `Lệch tiền — sổ ${bookRow.total}, MISA ${s.total_amount}.`,
      }
    }
  }
  return { match_status: "matched", match_note: null }
}
