/**
 * GIẢM GIÁ ₫ / % — QUY TẮC SỐ CỦA MÀN POS.
 *
 * ⚠ SPEC CHỐT 21/09/2026 §5. Đây là phần DUY NHẤT của spec giao diện có
 * quy tắc về TIỀN, nên nó nằm ở hàm thuần có chốt kiểm thử, không nằm
 * rải trong component.
 *
 * BA LUẬT, VÀ CHÚNG KHÔNG GIỐNG NHAU:
 *
 *   1. ĐỔI ĐƠN VỊ THÌ SỐ TIỀN KHÔNG ĐỔI. Đang `5%` trên 670.000 =
 *      33.500; bấm `₫` thì ô nhập thành `33.500` và tiền y nguyên. Đổi
 *      đơn vị là đổi CÁCH NHẬP, không phải đổi khoản giảm.
 *
 *   2. ĐANG `%` MÀ ĐỔI SỐ LƯỢNG THÌ TIỀN GIẢM CHẠY THEO. 5% của 5 món
 *      khác 5% của 10 món — phần trăm bám vào tiền hàng của dòng.
 *
 *   3. ĐANG `₫` MÀ ĐỔI SỐ LƯỢNG THÌ TIỀN GIẢM ĐỨNG YÊN. Người dùng gõ
 *      "bớt 20.000" là bớt đúng 20.000, không phải 20.000 mỗi món.
 *
 * ⚠ KẸP VỀ [0, tiền hàng]. Giảm quá tiền hàng là dòng âm — hóa đơn có
 * dòng âm là thứ không ai đối chiếu được, và nó đi thẳng vào công nợ.
 * Giảm âm là "cộng thêm tiền" núp dưới ô giảm giá.
 */

/** `vnd` = số tiền tuyệt đối. `pct` = phần trăm của tiền hàng. */
export type DiscountUnit = "vnd" | "pct"

export interface DiscountInput {
  /** Con số người dùng đang gõ trong ô — nghĩa của nó do `unit` quyết định. */
  value: number
  unit: DiscountUnit
}

/** Tiền hàng của một dòng TRƯỚC khi giảm. */
export function lineGross(qty: number, price: number): number {
  return Math.max(0, Math.round(Number(qty) || 0) * (Number(price) || 0))
}

/**
 * Khoản giảm quy ra ĐỒNG.
 *
 * ⚠ LÀM TRÒN Ở ĐÂY, MỘT LẦN. `5%` của 134.500 là 6.725 — số lẻ đồng
 * trôi qua ba phép cộng khác nhau thì tổng đơn lệch vài đồng so với
 * tổng do máy chủ tính, và không ai lần ra được chỗ lệch.
 */
export function discountAmount(d: DiscountInput, gross: number): number {
  const g = Math.max(0, Number(gross) || 0)
  const v = Number(d.value) || 0
  if (v <= 0) return 0
  const raw = d.unit === "pct" ? (g * v) / 100 : v
  // ⚠ Không cho vượt tiền hàng, và không cho âm — xem đầu tệp.
  return Math.min(g, Math.max(0, Math.round(raw)))
}

/**
 * Đổi đơn vị mà GIỮ NGUYÊN số tiền đã giảm (luật 1).
 *
 * ⚠ TIỀN HÀNG BẰNG 0 THÌ KHÔNG QUY ĐƯỢC SANG `%`. Chia cho 0 ra
 * `Infinity`, và `Infinity%` gõ vào ô là một ô hỏng người dùng không
 * xoá được. Về 0 là lựa chọn duy nhất trung thực: không có tiền hàng
 * thì cũng không có gì để giảm.
 */
export function switchUnit(d: DiscountInput, gross: number): DiscountInput {
  const next: DiscountUnit = d.unit === "vnd" ? "pct" : "vnd"
  const g = Math.max(0, Number(gross) || 0)
  const tien = discountAmount(d, g)
  if (next === "vnd") return { value: tien, unit: "vnd" }
  if (g <= 0) return { value: 0, unit: "pct" }
  /* ⚠ GIỮ 4 CHỮ SỐ THẬP PHÂN, đừng làm tròn về số nguyên phần trăm.
     33.500 trên 670.000 đúng bằng 5%, nhưng 33.501 thì không — làm tròn
     về `5` là lặng lẽ đổi số tiền người dùng vừa gõ. */
  return { value: Math.round((tien / g) * 1_000_000) / 10_000, unit: "pct" }
}

/** Nhãn nút đơn vị. */
export function unitLabel(u: DiscountUnit): string {
  return u === "pct" ? "%" : "₫"
}

/**
 * Câu `aria-label` cho nút lật đơn vị.
 *
 * ⚠ NÚT NÀY CHỈ CÓ MỘT KÝ TỰ. Người đọc màn hình nghe "₫" thì không
 * biết đó là trạng thái hiện tại hay là việc nút sẽ làm — phải nói cả
 * hai. Spec §5 chốt nguyên văn kiểu câu này.
 */
export function unitAriaLabel(u: DiscountUnit, soDong: number): string {
  return u === "pct"
    ? `Đơn vị giảm dòng ${soDong} — đang là phần trăm, bấm để đổi sang đồng`
    : `Đơn vị giảm dòng ${soDong} — đang là đồng, bấm để đổi sang phần trăm`
}
