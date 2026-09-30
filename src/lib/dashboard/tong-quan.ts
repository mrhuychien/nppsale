/**
 * TỔNG QUAN — phần tính thuần cho màn điện thoại theo thiết kế "tongquan" (chủ nhà 30/09/2026:
 * "Làm lại các màn"). Số liệu gốc vẫn là ba RPC thuần của trang (`dashboard_summary`,
 * `dashboard_top_customers`, `dashboard_channel_revenue` — doanh thu HOÁ ĐƠN đã ghi sổ theo
 * `invoice_date`, trừ hàng trả theo `revenue_date`, mig 192). Ở đây chỉ chia kỳ, rút gọn, chia phần.
 */

import { vnDateKey } from "@/lib/orders/status-tone"

export type KyTongQuan = "today" | "week" | "month" | "quarter"

export const KY_TONG_QUAN: ReadonlyArray<{ value: KyTongQuan; label: string; ten: string }> = [
  { value: "today", label: "Hôm nay", ten: "hôm nay" },
  { value: "week", label: "Tuần này", ten: "tuần này" },
  { value: "month", label: "Tháng này", ten: "tháng này" },
  { value: "quarter", label: "Quý này", ten: "quý này" },
]

/**
 * Ngày đầu kỳ (YYYY-MM-DD) THEO GIỜ VIỆT NAM.
 *
 * ⚠ `invoice_date` là DATE — so bằng ngày giờ VN (CLAUDE.md). Bản cũ lấy
 *   `new Date(y, m, 1).toISOString()`: máy ở VN (UTC+7) ra "…-08-31T17:00Z" → đầu tháng 9 thành
 *   31/08, doanh thu "tháng này" ôm cả ngày cuối tháng trước; 0h–7h sáng thì "hôm nay" là hôm qua.
 */
export function dauKy(ky: KyTongQuan, now: Date = new Date()): string {
  const key = vnDateKey(now)
  const [y, m, d] = key.split("-").map(Number)
  if (ky === "today") return key
  if (ky === "month") return `${y}-${String(m).padStart(2, "0")}-01`
  if (ky === "quarter") {
    const qm = Math.floor((m - 1) / 3) * 3 + 1
    return `${y}-${String(qm).padStart(2, "0")}-01`
  }
  // Tuần bắt đầu thứ Hai.
  const t = new Date(Date.UTC(y, m - 1, d))
  const thu = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() - thu + 1)
  return t.toISOString().slice(0, 10)
}

/** Cộng `n` ngày vào một khoá ngày YYYY-MM-DD. */
export function congNgay(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/**
 * Tiền rút gọn cho số to của thẻ: "964,78 tr", "1,25 tỷ".
 * ⚠ Chỉ để ĐỌC NHANH — ngay dưới luôn có số đầy đủ `formatCurrency` để đối chiếu.
 *   Dưới một triệu thì in đủ (rút gọn "0,45 tr" khó đọc hơn "450.000đ").
 */
export function tienRutGon(amount: number): string {
  const n = Math.round(Number(amount) || 0)
  if (n < 0) return "-" + tienRutGon(-n)
  const fmt = (v: number) =>
    v.toFixed(2).replace(/\.?0+$/, "").replace(".", ",")
  if (n >= 1_000_000_000) return `${fmt(n / 1_000_000_000)} tỷ`
  if (n >= 1_000_000) return `${fmt(n / 1_000_000)} tr`
  return new Intl.NumberFormat("vi-VN").format(n) + "đ"
}

/** Trung bình mỗi đơn = doanh thu thuần / số đơn có hoá đơn trong kỳ; không có đơn → 0. */
export function trungBinhDon(doanhThu: number, soDon: number): number {
  return soDon > 0 ? doanhThu / soDon : 0
}

/** Dòng phụ của đầu xanh: "30/09 · Cập nhật 21:19" (giờ VN). */
export function nhanCapNhat(now: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month} · Cập nhật ${p.hour}:${p.minute}`
}

export interface PhanKenh {
  channel: string
  revenue: number
  /** Phần trăm (làm tròn) trên tổng phần DƯƠNG. */
  percent: number
  /** Độ rộng thanh xếp chồng (0–100, không làm tròn). */
  width: number
  gop?: boolean
}

/**
 * Chia doanh thu theo kênh cho thanh xếp chồng: `top` kênh lớn nhất + một ô "N kênh khác".
 *
 * ⚠ Doanh thu THUẦN của một kênh có thể ÂM (hàng trả nhiều hơn hàng đi trong kỳ). Phần trăm
 *   và độ rộng tính trên tổng phần DƯƠNG, kênh âm được 0% — không thì thanh vượt 100% và có ô
 *   rộng âm. Số tiền vẫn giữ nguyên dấu.
 */
export function chiaKenh(
  rows: ReadonlyArray<{ channel: string; revenue: number }>,
  top = 5,
): { items: PhanKenh[]; soKenh: number } {
  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue)
  const tongDuong = sorted.reduce((s, r) => s + Math.max(0, r.revenue), 0)
  const w = (v: number) => (tongDuong > 0 ? (Math.max(0, v) / tongDuong) * 100 : 0)
  const dau = sorted.slice(0, top)
  const con = sorted.slice(top)
  const items: PhanKenh[] = dau.map((r) => ({
    channel: r.channel,
    revenue: r.revenue,
    width: w(r.revenue),
    percent: Math.round(w(r.revenue)),
  }))
  if (con.length > 0) {
    const v = con.reduce((s, r) => s + r.revenue, 0)
    const cw = con.reduce((s, r) => s + w(r.revenue), 0)
    items.push({ channel: `${con.length} kênh khác`, revenue: v, width: cw, percent: Math.round(cw), gop: true })
  }
  return { items, soKenh: sorted.length }
}

/** Số việc ở khối "Cần xử lý" = số mục đang khác 0. */
export function demViecCanXuLy(x: { quaHan: number; tonThap: number; sapHetHan: number }): number {
  return [x.quaHan, x.tonThap, x.sapHetHan].filter((n) => n > 0).length
}
