/**
 * SỐ LƯỢNG GỘP NHIỀU MẶT HÀNG — GIỮ THEO TỪNG ĐƠN VỊ CƠ SỞ.
 *
 * ⚠ CHỦ NHÀ 24/09/2026 (Báo cáo > Nhân viên > Hàng bán theo nhân viên, dòng
 *   tổng "SL người bán: 7 | 8.224"): SL từng dòng đã quy về đơn vị cơ sở,
 *   nhưng dòng tổng của nhân viên / khách / cả bảng vẫn cộng hộp + chai + gói
 *   thành một số — vô nghĩa.
 *
 * Luật: SL cộng qua NHIỀU mặt hàng thì giữ `{ đơn vị cơ sở: SL }` và hiện
 *   "640 hộp · 120 chai · 55 gói". Không hiện tổng lẫn đơn vị.
 *   Dòng một mặt hàng vẫn là "SL + đơn vị" (map chỉ có một khoá).
 *
 * ⚠ NGOẠI LỆ — CHỦ NHÀ 03/11/2026 (Báo cáo Nhân viên › Hàng bán theo nhân viên): "cột số lượng bán tổng hợp số lượng và
 *   ghi 'đơn vị' ko cần diễn giải chi tiết ở phần tổng hợp". Phần TỔNG HỢP của màn ấy (dòng nhân viên, dòng tổng, dòng
 *   "(Tổng hợp)" của Excel) hiện MỘT số — Σ SL đã quy về đơn vị cơ sở (`tongSoSL` / `hienTongSL`) — và cột Đơn vị ghi
 *   `DON_VI_TONG`. Chi tiết từng nhân viên (mặt hàng × đơn vị tính) giữ nguyên; các màn khác vẫn theo luật trên.
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

/** `a − b` theo từng đơn vị (map mới) — vd SL thực bán = SL bán − SL trả, không cộng lẫn đơn vị. */
export function truSL(a: SLTheoDonVi | null | undefined, b: SLTheoDonVi | null | undefined): SLTheoDonVi {
  const out: SLTheoDonVi = {}
  for (const [u, q] of Object.entries(a || {})) congSL(out, u, q)
  for (const [u, q] of Object.entries(b || {})) congSL(out, u, -q)
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

/** Chữ ở cột "Đơn vị" khi SL là tổng nhiều đơn vị cơ sở (phần tổng hợp của Hàng bán theo nhân viên — xem đầu tệp). */
export const DON_VI_TONG = "đơn vị"

/**
 * MỘT số = Σ mọi đơn vị cơ sở của map (vd { hộp: 640, chai: 12 } → 652). Chỉ dùng ở phần tổng hợp của Hàng bán theo nhân
 * viên (chủ nhà 03/11/2026), cạnh chữ `DON_VI_TONG`. Làm tròn 6 chữ số lẻ — bỏ sai số cộng số thực (0,1 + 0,2) trong Excel.
 */
export function tongSoSL(map: SLTheoDonVi | null | undefined): number {
  let s = 0
  for (const q of Object.values(map || {})) if (Number.isFinite(q)) s += q
  return Math.round(s * 1e6) / 1e6
}

/** `tongSoSL` định dạng vi-VN ("1.652") — chữ đơn vị ở cột riêng (`DON_VI_TONG`). */
export function hienTongSL(map: SLTheoDonVi | null | undefined, fmt: (n: number) => string = soVN): string {
  return fmt(tongSoSL(map))
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
