/**
 * LỌC NHIỀU TRẠNG THÁI MỘT LÚC ở dải chip trạng thái của các danh sách.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "phần lọc trạng thái ở các danh sách cho phép chọn nhiều
 *   trạng thái để lọc. VD hiện tất cả các trạng thái trừ Hủy".
 *
 * ⚠ GIÁ TRỊ VẪN LÀ MỘT CHUỖI — các khoá nối bằng dấu phẩy ("submitted,completed").
 *   Mỗi màn đã có cả chùm thứ bám vào một chuỗi trạng thái (đường dẫn sâu
 *   `?status=`, phụ thuộc của useEffect, đặt lại trang, đếm "đang lọc"); đổi
 *   sang mảng là sửa hết chúng và dễ sót một chỗ. `"all"` = không lọc.
 */

export const TAT_CA = "all"

/**
 * BỎ CHỌN HẾT — không chip nào sáng, danh sách rỗng.
 *
 * ⚠ CHỦ NHÀ 26/09/2026: "ấn 1 lần vào tất cả -> chọn tất cả, ấn thêm 1 lần vào tất cả thì
 *   bỏ chọn tất cả các trạng thái". Khác `"all"` (không lọc = hiện hết).
 */
export const KHONG_CHON = "none"
/** Trạng thái không có trong sổ — lọc theo nó là ra rỗng mà nơi gọi không phải sửa gì. */
const KHONG_KHOP = "__khong_chon__"

/** Các khoá đang chọn. `"all"` / `"none"` / rỗng → `[]`. */
export function tachTrangThai(v: string | null | undefined): string[] {
  if (!v || v === TAT_CA || v === KHONG_CHON) return []
  return v.split(",").map((s) => s.trim()).filter((s) => s && s !== TAT_CA)
}

/**
 * Bấm một chip. Chip khác → bật / tắt nó; tắt chip cuối cùng thì KHÔNG chip nào sáng.
 * Giữ THỨ TỰ của dải chip (`thuTu`) để chuỗi ổn định — cùng một lựa chọn luôn ra
 * cùng một chuỗi, không nháy lại truy vấn.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Khi ấn vào tất cả thì chọn hết các trạng thái luôn". "Tất cả"
 *   = MỌI chip cùng sáng; đang "Tất cả" mà bấm một chip là TẮT chip đó ("tất cả trừ
 *   Huỷ" chỉ còn một cú bấm). Bật lại đủ mọi chip thì về "Tất cả".
 */
export function bamTrangThai(hienTai: string, key: string, thuTu: readonly string[]): string {
  /* "Tất cả": đang sáng hết → bỏ chọn hết; còn lại → sáng hết (chủ nhà 26/09/2026). */
  if (key === TAT_CA) return hienTai === TAT_CA ? KHONG_CHON : TAT_CA
  const moiChip = thuTu.filter((k) => k !== TAT_CA)
  const dang = new Set(hienTai === TAT_CA ? moiChip : tachTrangThai(hienTai))
  if (dang.has(key)) dang.delete(key)
  else dang.add(key)
  if (dang.size === 0) return KHONG_CHON
  if (moiChip.length > 1 && dang.size === moiChip.length && moiChip.every((k) => dang.has(k))) return TAT_CA
  const xep = thuTu.filter((k) => dang.has(k))
  const le = Array.from(dang).filter((k) => !thuTu.includes(k))
  return [...xep, ...le].join(",")
}

/**
 * Trạng thái THẬT trong sổ ứng với lựa chọn — mỗi chip có thể là một NHÓM
 * (vd "Hoàn thành" = completed + closed). `null` = không lọc; bỏ chọn hết → một trạng
 * thái không tồn tại (danh sách rỗng).
 */
export function trangThaiCuaChon(
  v: string,
  nhom: Readonly<Record<string, readonly string[]>> = {}
): string[] | null {
  if (v === KHONG_CHON) return [KHONG_KHOP]
  const ds = tachTrangThai(v)
  if (ds.length === 0) return null
  const out: string[] = []
  for (const k of ds) for (const st of nhom[k] ?? [k]) if (!out.includes(st)) out.push(st)
  return out
}

/** Chip này có đang sáng không. "Tất cả" → MỌI chip cùng sáng (chủ nhà 25/09/2026). */
export function dangChon(v: string, key: string): boolean {
  if (v === KHONG_CHON) return false
  const ds = tachTrangThai(v)
  return ds.length === 0 ? true : ds.includes(key)
}
