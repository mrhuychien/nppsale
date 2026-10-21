/**
 * THẺ ĐỐI TÁC Ở POS (khách hàng / NCC) — luật thuần cho modal "xem đủ + sửa thông tin" (chủ nhà 21/10/2026: "Phần
 * tạo đơn POS : phần Khách hàng / NCC khi ấn vào hiện modal xem thông tin đầy đủ và sửa các thông tin").
 *
 * Sửa xong ở modal thì ba chỗ phải theo cùng lúc, không đợi tải lại trang:
 *   · thẻ đối tác của chứng từ đang mở (tên, dòng phụ) — `doiTacSauSua`;
 *   · danh mục POS (ô tìm khách / NCC, `customerById`) — `gopTheoId`. Nhóm khách đổi là BẢNG GIÁ đổi: màn đơn đọc
 *     `customerById(...).group_id`, nên danh mục không theo là giá vẫn tính theo nhóm cũ; hạn mức cũng vậy.
 */
import type { PosPartner } from "@/components/pos/partner-card"

const noi = (...xs: Array<string | null | undefined>) => xs.map((x) => (x ?? "").trim()).filter(Boolean).join(" · ")

/** Dòng phụ thẻ khách: `SĐT · địa chỉ` (như ô tìm khách của POS). */
export const metaKhach = (c: { phone?: string | null; address?: string | null }): string => noi(c.phone, c.address)

/** Dòng phụ thẻ NCC: `mã · SĐT · địa chỉ` (như ô tìm NCC của POS). */
export const metaNcc = (s: { code?: string | null; phone?: string | null; address?: string | null }): string =>
  noi(s.code, s.phone, s.address)

/**
 * Gộp bản đã sửa vào danh mục theo `id`. Không có trong danh mục (khách Tạm ngưng / Khoá — danh mục chỉ nạp khách đang
 * hoạt động) thì giữ nguyên danh mục, KHÔNG chèn thêm: danh mục là "những gì chọn được", không phải "những gì đã mở".
 */
export function gopTheoId<T extends { id: string }>(ds: T[], moi: Partial<T> & { id: string }): T[] {
  const i = ds.findIndex((x) => x.id === moi.id)
  if (i < 0) return ds
  const out = ds.slice()
  out[i] = { ...ds[i], ...moi }
  return out
}

/**
 * Thẻ đối tác sau khi sửa: đổi tên + dòng phụ, GIỮ công nợ đã đọc (sửa hồ sơ không đổi nợ). Thẻ đã đổi sang đối tác
 * khác trong lúc modal mở thì để nguyên — bản sửa ấy không phải của thẻ này.
 */
export function doiTacSauSua(the: PosPartner | null, id: string, ten: string, meta: string): PosPartner | null {
  if (!the || the.id !== id) return the
  return { ...the, name: ten.trim() || the.name, meta }
}
