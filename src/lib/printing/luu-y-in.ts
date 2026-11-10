/**
 * DÒNG "LƯU Ý" DƯỚI BẢNG HÀNG của hoá đơn bán / đơn đặt hàng — chủ nhà 10/11/2026: "thêm cho tao vào dưới bảng đơn
 * hàng/hóa đơn : Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ chuyển khoản vào số tài khoản của NPP: …".
 *
 * Câu là CÀI ĐẶT CỦA NPP (`organizations.settings.print_note`, Cài đặt → Cấu hình tổ chức, đọc qua `loadOrgHeader`) và in
 * NGUYÊN VĂN, nhãn đầu câu ("Lưu ý:") in đậm như mọi nhãn khác trên tờ ("Bằng chữ:", "Ghi chú hóa đơn:"). Trống → không in.
 *
 * ⚠ KHÔNG GHI SỐ TÀI KHOẢN VÀO MÃ / MIGRATION. Kho này dựng cho nhiều NPP (`schema_full.sql` cài mới cho NPP khác): tài
 *   khoản của NPP này lên tờ in của NPP khác là khách của họ chuyển tiền nhầm chỗ.
 */

/** Tách nhãn đầu câu để in đậm: "Lưu ý: Khách…" → { nhan: "Lưu ý:", than: "Khách…" }. Trống → null. */
export function tachNhanLuuY(text: string | null | undefined): { nhan: string | null; than: string } | null {
  const t = (text ?? "").trim()
  if (!t) return null
  /* Nhãn = ≤ 20 chữ không số / không "/" rồi ":" + khoảng trắng — "https://…" hay "8:30" không bị coi là nhãn. */
  const m = /^([^:/\n\d]{1,20}):(?=\s|$)\s*/.exec(t)
  return m ? { nhan: `${m[1].trim()}:`, than: t.slice(m[0].length) } : { nhan: null, than: t }
}
