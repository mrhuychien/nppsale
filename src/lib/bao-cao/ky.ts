/**
 * KỲ BÁO CÁO của "Báo cáo tổng hợp" (spec thietke/bao-cao-tong-hop-spec.md mục 2.3).
 *
 * Mọi ngày là chuỗi `YYYY-MM-DD` theo LỊCH VIỆT NAM — cùng kiểu với `sales_invoices.invoice_date`
 * (cột DATE). Không đi qua `Date` giờ máy: máy đặt giờ UTC là lệch một ngày lúc 0h–7h.
 *
 * ⚠ "Tháng này" là THÁNG LỊCH (01/09 – hôm nay), không phải 30 ngày gần nhất. Kỳ so sánh là kỳ
 *   liền trước CÙNG ĐỘ DÀI: tháng này 26 ngày so với 26 ngày đầu tháng trước.
 */

export type MaKy = "today" | "yesterday" | "week" | "lastweek" | "month" | "lastmonth" | "quarter" | "year" | "custom"

export const DS_KY: ReadonlyArray<readonly [MaKy, string]> = [
  ["today", "Hôm nay"],
  ["yesterday", "Hôm qua"],
  ["week", "Tuần này"],
  ["lastweek", "Tuần trước"],
  ["month", "Tháng này"],
  ["lastmonth", "Tháng trước"],
  ["quarter", "Quý này"],
  ["year", "Năm nay"],
  ["custom", "Tuỳ chỉnh"],
]

export const laMaKy = (x: string | null | undefined): x is MaKy => !!x && DS_KY.some(([k]) => k === x)
export const tenKy = (k: MaKy) => DS_KY.find(([x]) => x === k)?.[1] ?? "Tuỳ chỉnh"

export interface Ky {
  a: string
  b: string
  /** Kỳ so sánh liền trước, cùng độ dài; `null` = không có (Năm nay). */
  cmp: readonly [string, string] | null
}

const laNgay = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
export { laNgay }

const utc = (s: string) => {
  const [y, m, d] = s.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}
const raNgay = (t: number) => new Date(t).toISOString().slice(0, 10)

/** Cộng / trừ `n` ngày lịch. */
export const congNgay = (s: string, n: number) => raNgay(utc(s) + n * 86400000)
/** Số ngày từ `a` tới `b` (b − a). */
export const soNgay = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86400000)
/** Thứ trong tuần, 0 = Chủ nhật. */
export const thu = (s: string) => new Date(utc(s)).getUTCDay()
const dauTuan = (s: string) => congNgay(s, -((thu(s) + 6) % 7))
const dauThang = (s: string) => s.slice(0, 8) + "01"
const cuoiThang = (s: string) => congNgay(dauThang(congNgay(dauThang(s), 32)), -1)
const doDaiThang = (s: string) => soNgay(dauThang(s), cuoiThang(s)) + 1
const dauQuy = (s: string) => {
  const m = Number(s.slice(5, 7))
  return `${s.slice(0, 4)}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`
}

/** Hôm nay theo lịch VN. */
export function homNayVN(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(now)
}

/** Kỳ liền trước cùng độ dài. */
function kyTruoc(a: string, b: string): [string, string] {
  const len = soNgay(a, b) + 1
  return [congNgay(a, -len), congNgay(a, -1)]
}

export function kyTheoMa(ma: MaKy, homNay: string, ca?: string | null, cb?: string | null): Ky {
  const T = homNay
  switch (ma) {
    case "today":
      return { a: T, b: T, cmp: [congNgay(T, -1), congNgay(T, -1)] }
    case "yesterday": {
      const y = congNgay(T, -1)
      return { a: y, b: y, cmp: [congNgay(T, -2), congNgay(T, -2)] }
    }
    case "week": {
      const a = dauTuan(T)
      return { a, b: T, cmp: [congNgay(a, -7), congNgay(T, -7)] }
    }
    case "lastweek": {
      const a = congNgay(dauTuan(T), -7)
      return { a, b: congNgay(a, 6), cmp: [congNgay(a, -7), congNgay(a, -1)] }
    }
    case "month": {
      const a = dauThang(T)
      const len = soNgay(a, T) + 1
      const pa = dauThang(congNgay(a, -1))
      return { a, b: T, cmp: [pa, congNgay(pa, Math.min(len, doDaiThang(pa)) - 1)] }
    }
    case "lastmonth": {
      const a = dauThang(congNgay(dauThang(T), -1))
      const b = cuoiThang(a)
      const pa = dauThang(congNgay(a, -1))
      return { a, b, cmp: [pa, congNgay(pa, Math.min(doDaiThang(a), doDaiThang(pa)) - 1)] }
    }
    case "quarter": {
      const a = dauQuy(T)
      const len = soNgay(a, T) + 1
      const pa = dauQuy(congNgay(a, -1))
      return { a, b: T, cmp: [pa, congNgay(pa, len - 1)] }
    }
    case "year":
      return { a: T.slice(0, 4) + "-01-01", b: T, cmp: null }
    default: {
      let a = laNgay(ca) ? ca : dauThang(T)
      let b = laNgay(cb) ? cb : T
      if (a > b) [a, b] = [b, a]
      return { a, b, cmp: kyTruoc(a, b) }
    }
  }
}

/** "26/09" */
export const ngayThang = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
/** "26/09/2026" */
export const ngayDu = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
/** "01/09 – 26/09" hoặc "26/09" khi một ngày. */
export const nhanKhoang = (a: string, b: string) => (a === b ? ngayThang(a) : `${ngayThang(a)} – ${ngayThang(b)}`)

export const THU_VN = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]

export type DoHat = "day" | "week" | "month"

/** ≤ 31 ngày: theo ngày · ≤ 120 ngày: theo tuần · dài hơn: theo tháng. */
export function doHat(a: string, b: string): DoHat {
  const l = soNgay(a, b) + 1
  return l <= 31 ? "day" : l <= 120 ? "week" : "month"
}

export interface CotThoiGian {
  /** Khoá gom (ngày / đầu tuần / YYYY-MM). */
  k: string
  label: string
  sub: string
  r: [string, string]
}

/** Khoá gom của một ngày theo độ hạt. */
export function khoaThoiGian(g: DoHat, ngay: string): string {
  return g === "day" ? ngay : g === "week" ? dauTuan(ngay) : ngay.slice(0, 7)
}

/** Các cột thời gian phủ kín [a, b] — ngày không có số vẫn có cột (bằng 0). */
export function chiaThoiGian(a: string, b: string, g: DoHat): CotThoiGian[] {
  const out: CotThoiGian[] = []
  if (g === "day") {
    for (let d = a; d <= b; d = congNgay(d, 1)) out.push({ k: d, label: ngayThang(d), sub: THU_VN[thu(d)], r: [d, d] })
  } else if (g === "week") {
    let d = a
    while (d <= b) {
      const ws = dauTuan(d)
      const s = ws < a ? a : ws
      const e0 = congNgay(ws, 6)
      const e = e0 > b ? b : e0
      out.push({ k: ws, label: "Tuần " + ngayThang(s), sub: nhanKhoang(s, e), r: [s, e] })
      d = congNgay(e, 1)
    }
  } else {
    let d = dauThang(a)
    while (d <= b) {
      const s = d < a ? a : d
      const e0 = cuoiThang(d)
      const e = e0 > b ? b : e0
      out.push({ k: d.slice(0, 7), label: "Tháng " + Number(d.slice(5, 7)), sub: nhanKhoang(s, e), r: [s, e] })
      d = congNgay(e0, 1)
    }
  }
  return out
}
