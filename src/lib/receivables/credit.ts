/**
 * Số dư CÓ của khách — phần đã trả nhiều hơn phần phải trả.
 *
 * Từ Q11, `receivables.paid > amount` là HỢP LỆ: khách trả hàng sau khi
 * đã thanh toán đủ thì phần chênh là tiền của họ đang nằm ở nhà phân
 * phối. Trước Q11, `_wf2_recompute_receivable` chặn cứng tình huống đó
 * và phiếu trả kẹt vĩnh viễn.
 *
 * ⚠ TIỀN CỦA KHÁCH KHÔNG ĐƯỢC BIẾN MẤT KHỎI TẦM MẮT. Mọi phép cộng công
 * nợ trong kho đều kẹp `GREATEST(0, amount - paid)` và/hoặc lọc
 * `status <> 'paid'` — hai lớp che chồng lên nhau, nên dòng dư vừa bị
 * loại khỏi tập vừa bị kẹp phần âm về 0. Hệ quả: "Tổng công nợ" luôn
 * KHAI CAO hơn vị thế thật đúng bằng số dư có. Kẹp là đúng (không ai
 * muốn thấy số âm), nhưng phải NÓI RA phần bị kẹp — đó là việc của tệp
 * này.
 *
 * ⚠ MỘT CHỖ KHAI, MỌI MÀN DÙNG. Ba màn từng tự tính `amount - paid`
 * không kẹp và in ra số âm bằng màu đỏ — trông y hệt một khoản nợ khẩn
 * cấp, trong khi sự thật ngược lại.
 */

export interface ReceivableAmounts {
  amount?: number | null
  paid?: number | null
}

/** Còn phải đòi. Không bao giờ âm. */
export function remainingOf(r: ReceivableAmounts): number {
  return Math.max(0, Number(r.amount || 0) - Number(r.paid || 0))
}

/** Đang giữ hộ khách. Không bao giờ âm. */
export function creditOf(r: ReceivableAmounts): number {
  return Math.max(0, Number(r.paid || 0) - Number(r.amount || 0))
}

/** Tổng còn phải đòi của một tập dòng công nợ. */
export function totalRemaining(rows: ReceivableAmounts[]): number {
  return rows.reduce((s, r) => s + remainingOf(r), 0)
}

/** Tổng số dư có của một tập dòng công nợ. */
export function totalCredit(rows: ReceivableAmounts[]): number {
  return rows.reduce((s, r) => s + creditOf(r), 0)
}

/**
 * Vị thế RÒNG: còn đòi trừ đi phần đang giữ hộ. CÓ THỂ ÂM — và khi âm
 * thì nó nói đúng một điều: nhà phân phối đang nợ khách.
 *
 * ⚠ Đừng dùng số này ở chỗ cần "bao nhiêu tiền phải đi đòi" — dùng
 * `totalRemaining`. Nó dành cho chỗ trả lời "quan hệ tiền nong với khách
 * này đang đứng ở đâu".
 */
export function netPosition(rows: ReceivableAmounts[]): number {
  return totalRemaining(rows) - totalCredit(rows)
}

/** Dòng này đang dư chứ không nợ. */
export function isOverpaid(r: ReceivableAmounts): boolean {
  return creditOf(r) > 0
}
