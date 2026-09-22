/**
 * BẬC THUẾ BẤM VÒNG — 0% → 5% → 8% → 10% → 0%.
 *
 * Chủ nhà chốt 22/09/2026: "tạo 1 nút bấm như nút giảm giá, mặc định là
 * 0 bấm vào -> 5 -> 8 -> 10 -> 0".
 *
 * ⚠ DÙNG LẠI `VAT_RATES`, KHÔNG CHÉP BỐN CON SỐ RA ĐÂY. Bậc thuế còn
 *   dùng ở màn sản phẩm và sheet sửa dòng của màn đơn cũ; hai danh sách
 *   rời nhau là ngày nhà nước đổi bậc thì sửa một chỗ, quên chỗ kia.
 *
 * ⚠ THUẾ SUẤT NGOÀI BẬC THÌ VỀ 0, KHÔNG ÉP VỀ BẬC GẦN NHẤT. Một mặt
 *   hàng lỡ có 7% (nhập từ sổ cũ) mà bấm một cái thành 8% là ĐỔI TIỀN
 *   THUẾ của người ta bằng một phép đoán. Về 0 thì người dùng thấy ngay
 *   là mình vừa xoá, và bấm tiếp ba lần là có lại đủ bậc.
 */

import { VAT_RATES } from "@/lib/constants"

/** Thuế suất theo TỈ LỆ (0.08 = 8%). */
export function vatKeTiep(rate: number): number {
  const r = Number(rate) || 0
  const i = VAT_RATES.findIndex((v) => Math.abs(v.value - r) < 1e-9)
  if (i < 0) return 0
  return VAT_RATES[(i + 1) % VAT_RATES.length].value
}

/**
 * Thuế suất CHUNG của cả chứng từ, hoặc `null` khi các dòng lệch nhau.
 *
 * ⚠ `null` LÀ "MỖI DÒNG MỘT KIỂU", KHÁC HẲN 0. Nút thuế cấp chứng từ
 *   phải nói ra điều đó, nếu không người dùng nhìn thấy "0%" rồi tưởng
 *   cả đơn không thuế trong khi có dòng đang chịu 10%.
 *
 * ⚠ CHỨNG TỪ RỖNG TRẢ VỀ 0, không trả `null`. Chưa có dòng nào thì
 *   không có gì để mà lệch.
 */
export function vatChungCuaDong(lines: ReadonlyArray<{ vatRate?: number | null }>): number | null {
  if (lines.length === 0) return 0
  const dau = Number(lines[0].vatRate) || 0
  for (const l of lines) {
    if (Math.abs((Number(l.vatRate) || 0) - dau) > 1e-9) return null
  }
  return dau
}

/**
 * Bậc kế tiếp cho nút thuế CẤP CHỨNG TỪ.
 *
 * ⚠ ĐANG LỆCH NHAU THÌ BẤM MỘT CÁI VỀ 0, không nhảy sang 5%. Người bấm
 *   lúc ấy đang muốn "dẹp hết cho đồng nhất"; đưa thẳng sang 5% là ép
 *   một thuế suất lên những dòng họ chưa kịp nhìn.
 */
export function vatChungKeTiep(chung: number | null): number {
  return chung === null ? 0 : vatKeTiep(chung)
}
