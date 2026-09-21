/**
 * CỘNG TIỀN CHO MỘT CHỨNG TỪ POS.
 *
 * ⚠ SPEC CHỐT 21/09/2026 §6, và các con số dưới đây lấy thẳng từ bản
 * thiết kế để không phải đoán thứ tự trừ:
 *
 *     Tổng tiền hàng                    7.928.000
 *     Giảm giá dòng                        33.500
 *     Giảm giá đơn  [100.000][VND]        100.000
 *     Thu khác · VAT                            0
 *     Trừ hàng trả                        − 3.900
 *     Khách cần trả                     7.790.600
 *
 * 7.928.000 − 33.500 − 100.000 + 0 − 3.900 = 7.790.600.
 *
 * ⚠ "TỔNG TIỀN HÀNG" LÀ TIỀN GỘP, TRƯỚC MỌI KHOẢN GIẢM. Bản thiết kế
 * liệt kê "Giảm giá dòng" thành một dòng RIÊNG ngay dưới nó; nếu tổng
 * đã trừ sẵn giảm dòng thì dòng ấy bị trừ hai lần.
 *
 * ⚠ GIẢM GIÁ ĐƠN THEO `%` TÍNH TRÊN TIỀN GỘP, không phải trên số đã
 * trừ giảm dòng. Spec §6 ghi `Giảm giá đơn [5][%] → 396.400`, và
 * 7.928.000 × 5% = 396.400 đúng từng đồng (trên số đã trừ giảm dòng sẽ
 * ra 394.725). Đây là loại chi tiết chỉ lộ ra khi đối chiếu với kế
 * toán vài tuần sau.
 */

import { discountAmount, lineGross, type DiscountInput } from "@/lib/pos/discount"

export interface PosTotalLine {
  qty: number
  price: number
  discount: DiscountInput
}

export interface PosTotals {
  /** Σ (số lượng × đơn giá), chưa trừ gì. */
  gross: number
  /** Σ khoản giảm của từng dòng, quy ra đồng. */
  lineDiscount: number
  /** Khoản giảm cấp chứng từ, quy ra đồng. */
  docDiscount: number
  /** Thu khác / VAT — cộng thêm. */
  other: number
  /** Trừ hàng trả — chỉ dòng TRẢ, dòng ĐỔI không trừ tiền. */
  returnCredit: number
  /** Số khách (hoặc NCC) cần trả. Kẹp về 0. */
  due: number
}

export function lineAmount(l: PosTotalLine): number {
  const g = lineGross(l.qty, l.price)
  return g - discountAmount(l.discount, g)
}

export function posTotals(i: {
  lines: readonly PosTotalLine[]
  docDiscount?: DiscountInput
  other?: number
  returnCredit?: number
}): PosTotals {
  let gross = 0
  let lineDiscount = 0
  for (const l of i.lines) {
    const g = lineGross(l.qty, l.price)
    gross += g
    lineDiscount += discountAmount(l.discount, g)
  }
  // ⚠ Trên TIỀN GỘP — xem đầu tệp.
  const docDiscount = i.docDiscount ? discountAmount(i.docDiscount, gross) : 0
  const other = Number(i.other) || 0
  const returnCredit = Math.max(0, Number(i.returnCredit) || 0)
  /**
   * ⚠ KẸP VỀ 0, GIỐNG `netDueOnInvoice` CỦA PHẦN NGHIỆP VỤ. Hàng trả
   * lớn hơn đơn mới là chuyện có thật; hiện số âm ở ô "Khách cần trả"
   * là mời người thu ngân đi trả tiền cho khách ngay tại quầy.
   */
  const due = Math.max(0, gross - lineDiscount - docDiscount + other - returnCredit)
  return { gross, lineDiscount, docDiscount, other, returnCredit, due }
}

/**
 * Ba chip mệnh giá gợi ý dưới ô "Khách thanh toán".
 *
 * ⚠ CHIP ĐẦU LUÔN LÀ ĐÚNG SỐ PHẢI TRẢ. Người bán bấm nó nhiều nhất;
 * bắt họ tìm giữa ba số tròn là thêm một nhịp cho việc hay làm nhất.
 *
 * ⚠ KHÔNG GỢI Ý SỐ NHỎ HƠN SỐ PHẢI TRẢ. Chip là để đưa tiền, không
 * phải để trả thiếu — và một chip trả thiếu bấm nhầm là một khoản nợ
 * không ai định tạo.
 */
export function cashSuggestions(due: number): number[] {
  const d = Math.max(0, Math.round(Number(due) || 0))
  if (d <= 0) return []
  const out = [d]
  for (const buoc of [10_000, 50_000, 100_000, 500_000, 1_000_000]) {
    const tron = Math.ceil(d / buoc) * buoc
    if (tron > d && !out.includes(tron)) out.push(tron)
    if (out.length >= 3) break
  }
  return out.slice(0, 3)
}
