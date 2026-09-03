/**
 * Chuẩn hoá số / ký hiệu hoá đơn ĐỂ SO SÁNH.
 *
 * Nguyên tắc: **chuẩn hoá khi so, giữ nguyên khi lưu.** Cột
 * `misa_inv_no` / `misa_inv_series` luôn lưu đúng chuỗi MISA trả về —
 * chỉ phép so mới đi qua các hàm dưới đây. Lưu bản đã chuẩn hoá là làm
 * hỏng dữ liệu gốc để phục vụ một phép so.
 *
 * Vì sao cần: cùng một dải số, MISA và người nhập tay dùng lẫn hai dạng.
 * So thẳng chuỗi thì '00000123' khác '123' và '1C25MHG' khác 'C25MHG' —
 * hai hoá đơn giống hệt nhau bị coi là khác nhau, im lặng.
 */

/**
 * Số hoá đơn: bỏ khoảng trắng và số 0 ở đầu.
 * '00000123' → '123' · ' 123 ' → '123' · '0' → '0'
 *
 * Không bỏ hết số 0 khi chuỗi toàn số 0 — '000' phải ra '0', không phải ''.
 */
export function normalizeInvNo(raw: string | null | undefined): string {
  if (raw == null) return ""
  const trimmed = String(raw).trim()
  if (!trimmed) return ""
  const stripped = trimmed.replace(/^0+/, "")
  return stripped === "" ? "0" : stripped
}

/**
 * Ký hiệu hoá đơn: bỏ khoảng trắng, viết hoa, bỏ CHỮ SỐ ĐẦU.
 * '1C25MHG' → 'C25MHG' · 'c25mhg' → 'C25MHG'
 *
 * Chữ số đầu là "mẫu số" (InvTemplateNo), có file ghi kèm ký hiệu có file
 * không — cùng một dải số. Chỉ bỏ ở ĐẦU: các chữ số bên trong ('C25MHG'
 * có '25' là năm) là một phần của ký hiệu.
 */
export function normalizeSeries(raw: string | null | undefined): string {
  if (raw == null) return ""
  return String(raw).trim().toUpperCase().replace(/^\d+/, "")
}

/** Hai số hoá đơn có phải một không (đã chuẩn hoá). */
export function sameInvNo(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeInvNo(a)
  const nb = normalizeInvNo(b)
  // Chuỗi rỗng không "bằng" bất cứ gì, kể cả rỗng khác: không có số thì
  // không kết luận được là trùng.
  if (!na || !nb) return false
  return na === nb
}

/** Hai ký hiệu có phải một không (đã chuẩn hoá). */
export function sameSeries(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeSeries(a)
  const nb = normalizeSeries(b)
  if (!na || !nb) return false
  return na === nb
}
