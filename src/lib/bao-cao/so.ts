/**
 * ĐỊNH DẠNG SỐ của Báo cáo tổng hợp (spec mục 1 "Quy ước chung").
 * - Bảng: tiền ghi ĐỦ, chia nhóm 3 số bằng dấu chấm, không phần lẻ, không chữ "đ".
 * - Thẻ chỉ số và biểu đồ: rút gọn — `923 tr`, `1,23 tỷ`.
 */

const NF = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 })

/** `1.234.000` — số âm có dấu trừ. */
export const soDu = (n: number) => NF.format(Math.round(n) || 0)

/** Bỏ số 0 thừa SAU dấu thập phân (1,20 → 1,2) — không đụng số nguyên (100 vẫn là 100). */
const thapPhan = (x: number, k: number) => {
  const t = x.toFixed(k)
  return (t.includes(".") ? t.replace(/\.?0+$/, "") : t).replace(".", ",")
}

/** `923 tr` · `1,23 tỷ` · `12,5 tr` · số nhỏ hơn 1 triệu ghi đủ. */
export function soGon(n: number): string {
  const a = Math.abs(n)
  const s = n < 0 ? "-" : ""
  if (a >= 1e9) return s + thapPhan(a / 1e9, a >= 1e10 ? 1 : 2) + " tỷ"
  if (a >= 1e6) return s + (a >= 1e8 ? String(Math.round(a / 1e6)) : thapPhan(a / 1e6, 1)) + " tr"
  return s + soDu(a)
}

/** `12,5%` */
export const phanTram = (x: number, k = 1) => (isFinite(x) ? thapPhan(x * 100, k) + "%" : "—")

export interface SoSanh {
  t: string
  /** "tot" xanh · "xau" đỏ · "trung" xám. */
  tone: "tot" | "xau" | "trung"
}

/**
 * Dòng so sánh dưới số lớn: `▲ 12% so với kỳ trước`.
 * `tangLaTot` = chiều tăng là tốt (doanh thu) hay xấu (hàng trả, chi phí).
 * `truoc == null` (tắt so sánh / không có kỳ trước) → không có dòng.
 */
export function soSanh(nay: number, truoc: number | null | undefined, tangLaTot: boolean): SoSanh | null {
  if (truoc == null) return null
  if (!truoc) return nay ? { t: "mới so với kỳ trước", tone: "trung" } : { t: "= kỳ trước", tone: "trung" }
  const ch = (nay - truoc) / Math.abs(truoc)
  if (Math.abs(ch) < 0.0005) return { t: "= kỳ trước", tone: "trung" }
  const len = ch > 0
  return {
    t: `${len ? "▲" : "▼"} ${phanTram(Math.abs(ch), Math.abs(ch) < 0.1 ? 1 : 0)} so với kỳ trước`,
    tone: len === tangLaTot ? "tot" : "xau",
  }
}

/** Điểm của đường xu hướng nhỏ trong thẻ (khung 100 × 30). Ít hơn 2 điểm → không vẽ. */
export function duongXuHuong(ds: number[]): string {
  if (ds.length < 2) return ""
  const mx = Math.max(...ds)
  const mn = Math.min(0, ...ds)
  const r = mx - mn || 1
  return ds.map((v, i) => `${((i / (ds.length - 1)) * 100).toFixed(1)},${(28 - ((v - mn) / r) * 26).toFixed(1)}`).join(" ")
}

/** Bỏ dấu, thường hoá — ô tìm "gõ không dấu cũng được". */
export const boDau = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase()
