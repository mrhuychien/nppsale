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

/** Các khoá đang chọn. `"all"` / rỗng → `[]` (không lọc). */
export function tachTrangThai(v: string | null | undefined): string[] {
  if (!v || v === TAT_CA) return []
  return v.split(",").map((s) => s.trim()).filter((s) => s && s !== TAT_CA)
}

/**
 * Bấm một chip. "Tất cả" → bỏ hết. Chip khác → bật / tắt nó; tắt chip cuối cùng
 * thì về "Tất cả". Giữ THỨ TỰ của dải chip (`thuTu`) để chuỗi ổn định — cùng
 * một lựa chọn luôn ra cùng một chuỗi, không nháy lại truy vấn.
 */
export function bamTrangThai(hienTai: string, key: string, thuTu: readonly string[]): string {
  if (key === TAT_CA) return TAT_CA
  const dang = new Set(tachTrangThai(hienTai))
  if (dang.has(key)) dang.delete(key)
  else dang.add(key)
  if (dang.size === 0) return TAT_CA
  const xep = thuTu.filter((k) => dang.has(k))
  const le = Array.from(dang).filter((k) => !thuTu.includes(k))
  return [...xep, ...le].join(",")
}

/**
 * Trạng thái THẬT trong sổ ứng với lựa chọn — mỗi chip có thể là một NHÓM
 * (vd "Hoàn thành" = completed + closed). `null` = không lọc.
 */
export function trangThaiCuaChon(
  v: string,
  nhom: Readonly<Record<string, readonly string[]>> = {}
): string[] | null {
  const ds = tachTrangThai(v)
  if (ds.length === 0) return null
  const out: string[] = []
  for (const k of ds) for (const st of nhom[k] ?? [k]) if (!out.includes(st)) out.push(st)
  return out
}

/** Chip này có đang sáng không. */
export function dangChon(v: string, key: string): boolean {
  const ds = tachTrangThai(v)
  return key === TAT_CA ? ds.length === 0 : ds.includes(key)
}
