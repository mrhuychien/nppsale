/**
 * SỬA HÓA ĐƠN ĐÃ GHI SỔ — quy tắc của màn 7 (spec §6, §7.2).
 *
 * ⚠ BẢN THIẾT KẾ NÓI SAI MỘT CHỖ, VÀ SPEC CHO PHÉP SỬA CÂU CHỮ.
 * Artboard 7 để nhãn "ĐÃ THU — GIỮ NGUYÊN QUA LẬP LẠI". Cơ chế đang
 * chạy KHÔNG như vậy: `reissue_invoice` gọi `cancel_invoice`, và
 * `cancel_invoice` **TỪ CHỐI THẲNG** khi hóa đơn đã có tiền thu:
 *
 *     IF EXISTS (SELECT 1 FROM receivables r
 *                WHERE r.invoice_id = … AND COALESCE(r.paid,0) > 0)
 *        OR EXISTS (SELECT 1 FROM cash_receipt_lines crl … )
 *     THEN RAISE EXCEPTION 'LOCKED_HAS_PAYMENT: hóa đơn đã có tiền thu,
 *                           huỷ phiếu thu trước'
 *
 * Nên tiền đã thu không "giữ nguyên qua lập lại" — nó CHẶN hẳn việc
 * lập lại cho tới khi phiếu thu bị huỷ. Spec §7.2 chốt: *"Nội dung
 * banner mô tả cơ chế đang có… Chỉnh lại câu chữ cho khớp hành vi thật
 * nếu khác."* Đây là chỗ phải chỉnh.
 *
 * ⚠ CHẶN SỚM Ở GIAO DIỆN, CHẶN THẬT Ở MÁY CHỦ. Cùng lối spec §8 dùng
 * cho lô hàng: nút mờ + nói rõ lý do, nhưng phép chặn thật vẫn nằm
 * trong RPC. Để người dùng bấm rồi nhận `LOCKED_HAS_PAYMENT` là bắt
 * họ đọc một mã lỗi để đoán ra việc cần làm.
 */

import { discountAmount, type DiscountInput } from "@/lib/pos/discount"
import { posTotals, type PosTotalLine } from "@/lib/pos/totals"

/* ==================================================================
 * KHOÁ — vì sao chưa lập lại được
 * ================================================================== */

export type ReissueLockCode = "LOCKED_HAS_PAYMENT" | "LOCKED_EINVOICE"

export interface ReissueLock {
  /** Đúng mã máy chủ sẽ ném ra — để hai bên lần ra nhau được. */
  code: ReissueLockCode
  /** Câu người dùng đọc, nói cả lý do lẫn việc cần làm. */
  message: string
}

export interface ReissueLockInput {
  /** Tổng tiền đã thu của hóa đơn này. */
  paidAmount: number
  /** Số phiếu thu còn hiệu lực đang gắn vào hóa đơn. */
  receiptCount: number
  /** Đã phát hành hóa đơn điện tử. */
  eInvoiceIssued: boolean
}

/**
 * Hóa đơn này có lập lại được không — `null` = được.
 *
 * ⚠ HÓA ĐƠN ĐIỆN TỬ KIỂM TRƯỚC. Hai khoá có thể cùng bật; nói khoá
 * nặng hơn trước là người dùng khỏi huỷ phiếu thu xong mới biết vẫn
 * không lập lại được. `cancel_invoice` kiểm tiền thu trước, nhưng thứ
 * tự CÂU CHỮ trên màn phục vụ người đọc chứ không phải máy chủ.
 */
export function reissueLock(i: ReissueLockInput): ReissueLock | null {
  if (i.eInvoiceIssued) {
    return {
      code: "LOCKED_EINVOICE",
      message:
        "Hóa đơn này đã phát hành hóa đơn điện tử nên không lập lại được. " +
        "Muốn sửa thì phải điều chỉnh/thay thế tờ điện tử theo đúng quy định thuế.",
    }
  }
  const coTien = Number(i.paidAmount) > 0 || Number(i.receiptCount) > 0
  if (coTien) {
    return {
      code: "LOCKED_HAS_PAYMENT",
      message:
        "Hóa đơn đã có tiền thu nên chưa lập lại được. Huỷ phiếu thu đang gắn " +
        "rồi quay lại — tiền sẽ ghi lại vào tờ hóa đơn mới.",
    }
  }
  return null
}

/* ==================================================================
 * TIỀN
 * ================================================================== */

export interface InvoiceEditTotals {
  /** Σ (số lượng × đơn giá), chưa trừ gì. */
  goods: number
  lineDiscount: number
  docDiscount: number
  vat: number
  other: number
  /** Tổng cộng của tờ hóa đơn. */
  total: number
  /** Còn lại hóa đơn = tổng − đã thu. Kẹp về 0. */
  remaining: number
  /** Công nợ ròng = còn lại − trừ hàng trả. Kẹp về 0. */
  netDebt: number
}

/**
 * Cộng tiền màn 7 — đo đúng bản thiết kế:
 *
 *     Tiền hàng                       2.568.000
 *     Giảm giá đơn   5 %                128.400
 *     Thuế GTGT      0 %                      0
 *     Thu khác                                0
 *     Tổng cộng                       2.439.600
 *     ĐÃ THU · Chuyển khoản           1.500.000
 *     Còn lại hóa đơn                   939.600
 *     Trừ hàng trả · PT-0031          − 528.000
 *     Công nợ ròng                      411.600
 *
 * ⚠ TỔNG HÓA ĐƠN KHÔNG TRỪ HÀNG TRẢ — giống hệt màn 2 và giống hệt
 * `_wf2b_recompute_receivable`. Tờ hóa đơn là chứng từ của lô hàng ĐÃ
 * GIAO; hàng trả là việc xảy ra sau đó. Khoản trừ nằm ở bậc CÔNG NỢ.
 *
 * ⚠ THUẾ TÍNH TRÊN SỐ ĐÃ TRỪ GIẢM GIÁ. Thuế trên số chưa giảm là thu
 * thuế phần tiền không ai trả.
 */
export function invoiceEditTotals(i: {
  lines: readonly PosTotalLine[]
  docDiscount?: DiscountInput
  /** Thuế suất, đơn vị phần trăm: `8` nghĩa là 8%. */
  vatRate?: number
  other?: number
  /** Tổng tiền đã thu của hóa đơn. */
  paid?: number
  /** Khoản trừ hàng trả ĐÃ tính vào công nợ. */
  returnCredit?: number
}): InvoiceEditTotals {
  // ⚠ DÙNG LẠI MỘT PHÉP CỘNG DUY NHẤT của POS. Dựng phép thứ hai cạnh
  //   nó là hai con số cho cùng một tờ, và chúng sẽ lệch đúng vào hôm
  //   có người sửa một bên.
  const t = posTotals({ lines: i.lines, docDiscount: i.docDiscount, other: 0, returnCredit: 0 })
  const sauGiam = Math.max(0, t.gross - t.lineDiscount - t.docDiscount)
  const vat = Math.round((sauGiam * Math.max(0, Number(i.vatRate) || 0)) / 100)
  const other = Number(i.other) || 0
  const total = sauGiam + vat + other
  const paid = Math.max(0, Number(i.paid) || 0)
  const remaining = Math.max(0, total - paid)
  const returnCredit = Math.max(0, Number(i.returnCredit) || 0)
  return {
    goods: t.gross,
    lineDiscount: t.lineDiscount,
    docDiscount: t.docDiscount,
    vat,
    other,
    total,
    remaining,
    // ⚠ Kẹp về 0 giống `netDueOnInvoice` — hiện số âm là nói khác sổ.
    netDebt: Math.max(0, remaining - returnCredit),
  }
}

/**
 * Giảm giá đơn quy ra đồng, cho nơi chỉ cần con số ấy.
 *
 * ⚠ CÙNG MỘT NỀN VỚI `invoiceEditTotals` (tiền gộp). Tính trên một nền
 * khác là ô bên cạnh hiện một số, tổng cộng lại dùng số khác.
 */
export function docDiscountAmount(lines: readonly PosTotalLine[], d: DiscountInput): number {
  const t = posTotals({ lines })
  return discountAmount(d, t.gross)
}
