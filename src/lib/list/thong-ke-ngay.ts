import { fetchAllForAggregate } from "@/lib/supabase/aggregate"

/**
 * SỐ LIỆU ĐẦU NHÓM NGÀY ("N đơn · tổng tiền") của danh sách điện thoại — ĐẾM TRÊN MÁY CHỦ.
 *
 * ⚠ VÌ SAO (rà soát 03/10/2026): danh sách điện thoại tải 20 chứng từ / lần rồi nhóm theo ngày. Đầu nhóm cộng
 *   TRÊN CÁC DÒNG ĐÃ TẢI — ngày cuối cùng đang hiện bị cắt giữa chừng nên ghi "3 đơn · 1,2 tr" trong khi ngày ấy
 *   có 40 đơn. Nay đọc (`ngày`, `tiền`) của ĐÚNG những ngày đang hiện, CÙNG bộ lọc với danh sách, rồi cộng.
 *   Đọc hỏng / chạm trần → `null`, đầu nhóm quay về số của các dòng đã tải (không hiện số bịa).
 */

export type ThongKeNgay = Record<string, { count: number; total: number }>

/** Các khoá ngày (YYYY-MM-DD) đang hiện, theo thứ tự xuất hiện, không trùng. */
export function cacNgayDangHien<T>(rows: readonly T[], getDate: (r: T) => string | null | undefined): string[] {
  const out: string[] = []
  const co = new Set<string>()
  for (const r of rows) {
    const k = (getDate(r) || "").slice(0, 10)
    if (k && !co.has(k)) { co.add(k); out.push(k) }
  }
  return out
}

/** Cộng theo ngày. `getTotal` trả tiền của một dòng. */
export function congTheoNgay<T>(
  rows: readonly T[],
  getDate: (r: T) => string | null | undefined,
  getTotal: (r: T) => number
): ThongKeNgay {
  const m: ThongKeNgay = {}
  for (const r of rows) {
    const k = (getDate(r) || "").slice(0, 10)
    if (!k) continue
    const g = (m[k] ??= { count: 0, total: 0 })
    g.count++
    g.total += Number(getTotal(r)) || 0
  }
  return m
}

type Trang = PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>

/**
 * Đọc đủ các dòng của những ngày `days` rồi cộng theo ngày. `build(from, to)` dựng truy vấn đã gắn MỌI bộ lọc của
 * danh sách + `.in(cột ngày, days)` + `count: "exact"` + `.order("id")` + `.range(from, to)`.
 * `truTien` (tuỳ chọn) chỉnh tiền từng dòng sau khi đọc (vd hóa đơn: trừ hàng trả — tiền trên danh sách là số còn lại).
 */
export async function docThongKeNgay<T>(
  days: readonly string[],
  build: (from: number, to: number) => Trang,
  getDate: (r: T) => string | null | undefined,
  getTotal: (r: T) => number,
  truTien?: (rows: T[]) => Promise<(r: T) => number>
): Promise<ThongKeNgay | null> {
  if (days.length === 0) return {}
  const res = await fetchAllForAggregate<T>(build)
  if (res.error || res.truncated) return null
  let tien = getTotal
  if (truTien) {
    try {
      tien = await truTien(res.rows)
    } catch {
      return null
    }
  }
  return congTheoNgay(res.rows, getDate, tien)
}
