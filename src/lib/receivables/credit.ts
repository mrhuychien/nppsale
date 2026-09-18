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

import { agingLabel, daysOverdueOf } from "@/lib/utils"

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

/**
 * TRẠNG THÁI MỘT DÒNG CÔNG NỢ — thứ hiện trên huy hiệu.
 *
 * Chủ nhà báo: "trạng thái công nợ hiển thị chưa chính xác tuổi nợ".
 *
 * ⚠ ĐÚNG VẬY, VÀ NGUYÊN NHÂN LÀ MỘT HUY HIỆU MANG HAI NGUỒN. Bản cũ lấy
 * MÀU theo tuổi nợ (`getAgingStatus(due_date)`) nhưng lấy CHỮ từ cột
 * `receivables.status`. Cột ấy là trạng thái THANH TOÁN do RPC ghi
 * (open / partial / paid / overdue) và KHÔNG có ai tính lại mỗi ngày —
 * nên hai dòng cùng một hạn hiện hai chữ khác nhau, và cả hai đều là chữ
 * tiếng Anh giữa một màn tiếng Việt.
 *
 * ⚠ ĐÃ THU ĐỦ THÌ TUỔI NỢ VÔ NGHĨA. Một dòng trả xong từ lâu mà vẫn ghi
 * "Quá hạn 90 ngày" là đẩy nhân viên đi đòi một khoản không còn.
 *
 * ⚠ DƯ CÓ KHÔNG PHẢI NỢ. Nhà phân phối đang giữ tiền của khách; gắn nhãn
 * quá hạn lên nó là báo động nhầm chiều.
 */
export function receivableStateLabel(
  r: ReceivableAmounts & { due_date?: string | null }
): string {
  if (creditOf(r) > 0) return "Dư có"
  if (remainingOf(r) <= 0) return "Đã thu đủ"
  return agingLabel(daysOverdueOf(r.due_date))
}

export function receivableStateVariant(
  r: ReceivableAmounts & { due_date?: string | null }
): "success" | "warning" | "danger" | "default" {
  if (creditOf(r) > 0 || remainingOf(r) <= 0) return "success"
  const d = daysOverdueOf(r.due_date)
  if (d <= 0) return "default"
  if (d <= 30) return "warning"
  return "danger"
}
