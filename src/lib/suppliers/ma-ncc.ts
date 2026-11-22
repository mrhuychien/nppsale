/**
 * MÃ NHÀ CUNG CẤP TỰ ĐÁNH ("NCC-0001") — chủ nhà 22/11/2026 (ảnh màn tạo NCC trên điện thoại): *"Kiểm tra lại phần tạo nhà
 * cung cấp mới bị lỗi"* — "Dữ liệu này đã tồn tại — duplicate key value violates unique constraint
 * "suppliers_org_id_code_key" (mã 23505)".
 *
 * ⚠ ĐỪNG ĐÁNH MÃ BẰNG "SỐ NCC ĐANG CÓ + 1". Bản cũ đếm số NCC rồi cộng một: xoá một NCC (chủ NPP xoá được — mig 233), hay
 *   có mã nhập Excel / gõ tay lệch thứ tự, là số đếm rơi đúng vào một mã ĐÃ DÙNG — và vì số đếm không đổi, LẦN NÀO bấm "Tạo
 *   mới" cũng trùng đúng mã ấy: không tạo được NCC nào nữa nếu không tự gõ mã. Mã kế tiếp = số đuôi LỚN NHẤT trong các mã
 *   "NCC-<số>" đang có + 1, bỏ qua mã đã dùng; máy chủ vẫn báo trùng (NCC vừa tạo ở máy khác) thì đánh tiếp — `SupplierForm`.
 * ⚠ Mã do người dùng GÕ thì không tự đổi — trùng là báo rõ mã nào đã có (`cauTrungMaNcc`), không đẩy câu lỗi Postgres ra màn.
 */

export const DAU_MA_NCC = "NCC-"

/** Số đuôi của mã tự đánh: "NCC-0012" → 12 (không phân biệt hoa thường, bỏ khoảng trắng hai đầu); mã khác dạng → null. */
export function soDuoiMaNcc(code: string | null | undefined): number | null {
  const m = /^NCC-(\d+)$/i.exec((code ?? "").trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) ? n : null
}

/** "NCC-" + số, đủ 4 chữ số (số dài hơn giữ nguyên: NCC-10000). */
export function maNccTuSo(n: number): string {
  return `${DAU_MA_NCC}${String(n).padStart(4, "0")}`
}

/** Số đuôi lớn nhất trong các mã "NCC-<số>" (không có mã nào dạng ấy → 0). */
export function soLonNhatMaNcc(daCo: Iterable<string | null | undefined>): number {
  let lon = 0
  for (const c of Array.from(daCo)) {
    const n = soDuoiMaNcc(c)
    if (n !== null && n > lon) lon = n
  }
  return lon
}

/** Mã tự đánh kế tiếp: lớn nhất + 1; mã ấy đã có (so không phân biệt hoa thường) thì tăng tiếp. */
export function maNccTiepTheo(daCo: Iterable<string | null | undefined>): string {
  const ds = Array.from(daCo)
  const dung = new Set(ds.map((c) => (c ?? "").trim().toUpperCase()))
  let n = soLonNhatMaNcc(ds) + 1
  while (dung.has(maNccTuSo(n).toUpperCase())) n++
  return maNccTuSo(n)
}

/** Lỗi trùng mã NCC — 23505 trên ràng buộc `suppliers_org_id_code_key` (UNIQUE(org_id, code), mig 006). */
export function laTrungMaNcc(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { code?: unknown; message?: unknown; details?: unknown }
  if (e.code !== "23505") return false
  const chu = `${e.message ?? ""} ${e.details ?? ""}`
  return chu.includes("suppliers_org_id_code_key") || chu.includes("(org_id, code)")
}

/** Câu báo khi mã GÕ TAY trùng một NCC đã có. */
export function cauTrungMaNcc(code: string): string {
  return `Mã NCC “${code}” đã có — đổi mã khác, hoặc để trống ô Mã NCC để hệ thống tự đánh mã.`
}

/** Số lần đánh lại mã tự động khi máy chủ vẫn báo trùng (NCC vừa được tạo ở máy khác cùng lúc). */
export const SO_LAN_DANH_LAI_MA_NCC = 5
