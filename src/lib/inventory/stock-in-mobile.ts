/**
 * PHIẾU NHẬP KHO TRÊN ĐIỆN THOẠI — luật thuần của màn (chủ nhà 30/09/2026, thiết kế "phieu-nhap").
 *
 * Chỉ là nhãn / đếm / chặn nút. Luồng ghi (RPC `post_stock_import`, quy đổi, giá vốn) vẫn ở trang.
 */

export interface DongNhapMobile {
  product_id: string
  quantity: string
  batch_code: string
  expires_at: string
}

/** Số trong ô SL / tiền (chuỗi state) → số; rỗng, sai → 0. */
export function soCuaO(raw: string | null | undefined): number {
  const n = parseFloat(String(raw ?? "").replace(",", "."))
  return Number.isFinite(n) ? n : 0
}

/**
 * Giá trị đưa vào MoneyInput từ chuỗi đang giữ trong state.
 *
 * ⚠ ĐỪNG ĐƯA THẲNG CHUỖI CÓ PHẦN LẺ. Giá vốn gợi sẵn (`seedUnitCost`) có thể là "29629.6";
 * MoneyInput bỏ mọi ký tự không phải số nên sẽ đọc thành 296296 — gấp mười. Làm tròn tới đồng để
 * HIỂN THỊ; state vẫn giữ số gốc cho tới khi người dùng gõ lại.
 */
export function moneyDisplay(raw: string): number | "" {
  if (raw === "") return ""
  const n = parseFloat(raw)
  return Number.isFinite(n) ? Math.round(n) : ""
}

/** Chỉ các dòng đã chọn hàng — dòng trống tự thêm của trang không vẽ trên điện thoại. */
export function dongCoHang<T extends { product_id: string }>(lines: T[]): T[] {
  return lines.filter((l) => !!l.product_id)
}

/**
 * "N mặt hàng · N đơn vị" ở thanh đáy.
 *
 * ⚠ ĐƠN VỊ QUY VỀ ĐƠN VỊ CƠ SỞ (CLAUDE.md "Quy đổi đơn vị"): 2 thùng × 24 + 3 hộp = 51, không phải 5.
 * `heSo(l)` trả hệ số của đơn vị trên dòng (trang dùng `conversionFor`).
 */
export function tomTatThanhDay<T extends DongNhapMobile>(
  lines: T[],
  heSo: (l: T) => number
): { matHang: number; donViCoSo: number } {
  const co = dongCoHang(lines)
  let donViCoSo = 0
  for (const l of co) {
    const k = Number(heSo(l))
    donViCoSo += Math.max(0, soCuaO(l.quantity)) * (Number.isFinite(k) && k > 0 ? k : 1)
  }
  return { matHang: co.length, donViCoSo: Math.round(donViCoSo * 1000) / 1000 }
}

export const CHUA_CO_HANG = "Thêm ít nhất 1 mặt hàng"
export const SL_PHAI_DUONG = "Số lượng phải lớn hơn 0"

/**
 * Lý do nút chính bị khoá ("" = bấm được).
 *
 * ⚠ DÒNG SL 0 CHẶN NÚT, không lặng lẽ bỏ: `handleSubmit` lọc bỏ dòng SL ≤ 0, người dùng tưởng đã
 * nhập mà hàng không vào kho.
 */
export function lyDoKhoaNut(lines: DongNhapMobile[]): string {
  const co = dongCoHang(lines)
  if (co.length === 0) return CHUA_CO_HANG
  if (co.some((l) => !(soCuaO(l.quantity) > 0))) return SL_PHAI_DUONG
  return ""
}

/** "2026-09-30" → "30/09/2026" (chuỗi ngày của ô date, không qua Date để khỏi lệch múi giờ). */
function ngayVN(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** Dòng tóm tắt lô trên thẻ hàng: "Lô tự sinh · chưa có HSD" / "L01 · HSD 31/12/2027". */
export function tomTatLo(l: Pick<DongNhapMobile, "batch_code" | "expires_at">): string {
  const lo = l.batch_code.trim() || "Lô tự sinh"
  const hsd = l.expires_at ? `HSD ${ngayVN(l.expires_at)}` : "chưa có HSD"
  return `${lo} · ${hsd}`
}

/** Nút − / + của ô SL: bước 1, không xuống dưới 0, giữ phần lẻ gọn. */
export function buocSoLuong(raw: string, delta: number): string {
  const v = Math.max(0, soCuaO(raw) + delta)
  return String(Math.round(v * 1000) / 1000)
}

/** Ô SL gõ tay: chỉ giữ số và một dấu thập phân (dấu phẩy đổi thành chấm). */
export function locSoLuong(raw: string): string {
  const s = raw.replace(",", ".").replace(/[^\d.]/g, "")
  const i = s.indexOf(".")
  return i < 0 ? s : s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, "")
}
