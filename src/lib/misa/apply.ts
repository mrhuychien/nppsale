import type { MisaStatus } from "@/types"
import { checkAmounts, deriveState, invNoConflict, isPlaceholderInvNo, readSnapshot } from "./status"

/**
 * Dựng object `updates` cho một hoá đơn từ bản ghi MISA trả về.
 *
 * THUẦN — không chạm DB, không gọi mạng. Cả `refresh-status` (một hoá
 * đơn, người bấm) lẫn `/api/einvoice/sync` (vòng quét hàng loạt) đều đi
 * qua đây, nên hai đường không thể kết luận khác nhau về cùng một hoá
 * đơn. Trước đây chỉ có một đường và logic nằm thẳng trong route.
 */

/** Trạng thái hiện tại của hoá đơn trong sổ. */
export interface BookInvoice {
  id: string
  misa_ref_id: string | null
  misa_inv_no: string | null
  misa_status: MisaStatus | null
  misa_no_locked: boolean | null
  subtotal: number | null
  vat: number | null
  total: number | null
}

export interface ApplyResult {
  /** Các cột cần ghi. Luôn có ít nhất misa_last_checked_at. */
  updates: Record<string, unknown>
  /**
   * RefID của hoá đơn GỐC cần đánh dấu "đã bị thay thế".
   *
   * Đọc được OrgRefID mà không đánh dấu tờ gốc thì HAI hoá đơn cùng hiện
   * "đã ký" cho một lần bán → doanh thu và thuế đầu ra khai GẤP ĐÔI.
   */
  markOriginalReplaced: string | null
  /** Tóm tắt cho người gọi ghi log / trả về API. */
  summary: {
    invNo: string | null
    status: MisaStatus | null
    relation: string | null
    amountsCompared: string[]
    notes: string[]
  }
}

export function applyMisaSnapshot(
  raw: Record<string, unknown>,
  book: BookInvoice,
  opts: { orgUsesInvoiceCode: boolean; now: string }
): ApplyResult {
  const snap = readSnapshot(raw)
  const derived = deriveState({
    snap,
    orgUsesInvoiceCode: opts.orgUsesInvoiceCode,
    currentStatus: book.misa_status,
  })

  const notes: string[] = []
  if (derived.note) notes.push(derived.note)

  // Chỉ đưa vào `updates` những khoá THẬT SỰ có giá trị. MISA có lúc trả
  // thiếu TransactionID (hoá đơn "chờ cấp mã"); ghi `null` đè lên là XOÁ
  // TRẮNG mã tra cứu đang đúng ở lượt quét sau.
  const updates: Record<string, unknown> = {}
  let status: MisaStatus | null = derived.status

  // --- Số hoá đơn ------------------------------------------------------
  const hasRealInvNo = !isPlaceholderInvNo(snap.invNo)
  if (hasRealInvNo && snap.invNo) {
    if (book.misa_no_locked) {
      // Số do người GÁN TAY: misa_ref_id trên tờ đó thường trỏ về hoá đơn
      // ĐÃ CHẾT, ghi tiếp là đè số chết lên số người vừa gán — lặng lẽ,
      // mỗi lần quét. Không đè, nhưng cũng KHÔNG im lặng.
      if (invNoConflict(book.misa_inv_no, snap.invNo)) {
        notes.push(
          `Sổ ghi số ${book.misa_inv_no}, MISA cấp số ${snap.invNo} (khoá gán tay nên không ghi đè).`
        )
        status = "amount_mismatch"
      }
    } else {
      updates.misa_inv_no = snap.invNo
    }
  }

  if (snap.invSeries) updates.misa_inv_series = snap.invSeries
  if (snap.transactionId) updates.misa_lookup_code = snap.transactionId
  if (snap.invoiceCode) updates.misa_invoice_code = snap.invoiceCode
  if (snap.orgRefId) updates.misa_org_ref_id = snap.orgRefId
  if (derived.relation) updates.misa_relation = derived.relation

  // InvDate quyết định KỲ THUẾ và khác ngày ghi sổ. Cột là `date` nên chỉ
  // lấy phần ngày; chuỗi không parse được thì bỏ qua, không ghi rác.
  if (snap.invDate) {
    const d = isoDateOnly(snap.invDate)
    if (d) updates.misa_inv_date = d
  }

  // --- So tiền ---------------------------------------------------------
  const amounts = checkAmounts({
    snap,
    relation: derived.relation,
    book: { subtotal: book.subtotal, vat: book.vat, total: book.total },
  })
  if (amounts.note) notes.push(amounts.note)
  if (amounts.mismatch) {
    // Lệch tiền KHÔNG được ghi đè một trạng thái CUỐI. Hoá đơn đã bị huỷ
    // hoặc bị thay thế thì việc lệch tiền là hệ quả, không phải vấn đề
    // mới — dán 'amount_mismatch' lên đó là làm mất trạng thái quan trọng
    // hơn.
    if (status !== "cancelled" && status !== "replaced") status = "amount_mismatch"
  }

  if (status) updates.misa_status = status
  if (notes.length) updates.misa_note = notes.join("\n")
  // LUÔN cập nhật, kể cả khi chưa có số — nếu không, vòng quét lượt 2 sắp
  // theo cột này sẽ lấy đi lấy lại đúng những hoá đơn ấy và không bao giờ
  // tới được phần còn lại.
  updates.misa_last_checked_at = opts.now

  return {
    updates,
    // Chỉ đánh dấu tờ gốc khi tờ NÀY thật sự là bản thay thế. Hoá đơn
    // ĐIỀU CHỈNH cũng mang OrgRefID, mà bản gốc của nó VẪN CÒN hiệu lực —
    // suy từ mỗi sự có mặt của OrgRefID là khai thiếu doanh thu bản gốc.
    markOriginalReplaced:
      derived.relation === "replacement" && snap.orgRefId ? snap.orgRefId : null,
    summary: {
      invNo: hasRealInvNo ? snap.invNo : null,
      status,
      relation: derived.relation,
      amountsCompared: amounts.compared,
      notes,
    },
  }
}

/**
 * '2026-09-04T00:00:00' / '2026-09-04' → '2026-09-04'.
 * Chuỗi lạ → null (thà bỏ trống còn hơn ghi rác vào cột quyết định kỳ thuế).
 */
export function isoDateOnly(raw: string): string | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const month = Number(mo)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${mo}-${d}`
}
