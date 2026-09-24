/**
 * SỐ LƯỢNG GỘP NHIỀU MẶT HÀNG — GIỮ THEO TỪNG ĐƠN VỊ CƠ SỞ.
 *
 * ⚠ CHỦ NHÀ 24/09/2026 (Báo cáo > Nhân viên > Hàng bán theo nhân viên, dòng
 *   tổng "SL người bán: 7 | 8.224"): SL từng dòng đã quy về đơn vị cơ sở,
 *   nhưng dòng tổng của nhân viên / khách / cả bảng vẫn cộng hộp + chai + gói
 *   thành một số — vô nghĩa.
 *
 * Luật: SL cộng qua NHIỀU mặt hàng thì giữ `{ đơn vị cơ sở: SL }` và hiện
 *   "640 hộp · 120 chai · 55 gói". Không bao giờ hiện tổng lẫn đơn vị.
 *   Dòng một mặt hàng vẫn là "SL + đơn vị" (map chỉ có một khoá).
 */

/** `{ đơn vị cơ sở: SL đã quy về đơn vị đó }`. */
export type SLTheoDonVi = Record<string, number>

/** Cộng `qty` (đã quy về đơn vị cơ sở `unit`) vào map — sửa tại chỗ, trả lại map. */
export function congSL(map: SLTheoDonVi, unit: string | null | undefined, qty: number): SLTheoDonVi {
  const q = Number(qty) || 0
  if (q === 0) return map
  const k = (unit || "").trim()
  map[k] = (map[k] || 0) + q
  return map
}

/** Gộp hai map thành map mới (không sửa đầu vào). */
export function gopSL(a: SLTheoDonVi | null | undefined, b: SLTheoDonVi | null | undefined): SLTheoDonVi {
  const out: SLTheoDonVi = {}
  for (const [u, q] of Object.entries(a || {})) congSL(out, u, q)
  for (const [u, q] of Object.entries(b || {})) congSL(out, u, q)
  return out
}

const soVN = (n: number) => n.toLocaleString("vi-VN")

/**
 * "640 hộp · 120 chai · 55 gói" — SL giảm dần (bằng nhau thì theo tên đơn vị).
 * Một đơn vị → "640 hộp"; trống / toàn 0 → "0".
 */
export function hienSLTheoDonVi(map: SLTheoDonVi | null | undefined, fmt: (n: number) => string = soVN): string {
  const ds = Object.entries(map || {})
    .filter(([, q]) => Number.isFinite(q) && q !== 0)
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], "vi"))
  if (ds.length === 0) return "0"
  return ds.map(([u, q]) => (u ? `${fmt(q)} ${u}` : fmt(q))).join(" · ")
}

/** Gộp map của nhiều dòng (dòng tổng). `pick` chọn map trên mỗi dòng. */
export function tongSLTheoDonVi<T>(
  rows: ReadonlyArray<T>,
  pick: (r: T) => SLTheoDonVi | null | undefined = (r) => (r as unknown as { qtyTheoDv?: SLTheoDonVi }).qtyTheoDv
): SLTheoDonVi {
  const out: SLTheoDonVi = {}
  for (const r of rows) for (const [u, q] of Object.entries(pick(r) || {})) congSL(out, u, q)
  return out
}
