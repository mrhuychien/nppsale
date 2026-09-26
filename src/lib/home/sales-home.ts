/**
 * TRANG CHỦ NHÂN VIÊN BÁN HÀNG — phần tính (không React).
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Làm lại trang chủ cho nhân viên bán hàng theo mẫu" (bản thiết kế
 *   "Chào Hiền · Doanh số của tôi · Hôm nay / Tuần / Tháng / Quý …").
 * ⚠ DOANH SỐ = HÓA ĐƠN ĐÃ GHI SỔ − HÀNG TRẢ (luật 24–25/09/2026): Σ `sales_invoices.total`
 *   theo `invoice_date` trừ Σ `returns.credit_note_amount` theo `revenue_date`. Không cộng
 *   tổng đơn hàng. Ngày là DATE theo lịch VN (`vnDateKey`), so bằng chuỗi YYYY-MM-DD.
 */
export type KyTrangChu = "today" | "week" | "month" | "quarter"

export const KY_TRANG_CHU: ReadonlyArray<{ key: KyTrangChu; nhan: string }> = [
  { key: "today", nhan: "Hôm nay" },
  { key: "week", nhan: "Tuần" },
  { key: "month", nhan: "Tháng" },
  { key: "quarter", nhan: "Quý" },
]

const d = (k: string) => new Date(`${k}T00:00:00Z`)
const k = (x: Date) => x.toISOString().slice(0, 10)
/** Cộng `n` ngày vào một ngày YYYY-MM-DD. */
export const congNgay = (key: string, n: number) => {
  const x = d(key)
  x.setUTCDate(x.getUTCDate() + n)
  return k(x)
}
const cachNgay = (a: string, b: string) => Math.round((d(b).getTime() - d(a).getTime()) / 86_400_000)
const soNgayThang = (key: string) => {
  const x = d(key)
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()
}

export interface KhoangKy {
  from: string
  to: string
  /** Số ngày CÒN LẠI sau hôm nay tới hết kỳ (26/09 trong tháng 30 ngày → 4). */
  conNgay: number
}

/** Kỳ chứa `homNay` (YYYY-MM-DD theo giờ VN). Tuần = Thứ 2 → Chủ nhật. */
export function khoangKy(ky: KyTrangChu, homNay: string): KhoangKy {
  const x = d(homNay)
  const y = x.getUTCFullYear()
  const m = x.getUTCMonth()
  let from = homNay
  let to = homNay
  if (ky === "week") {
    from = congNgay(homNay, -((x.getUTCDay() + 6) % 7))
    to = congNgay(from, 6)
  } else if (ky === "month") {
    from = k(new Date(Date.UTC(y, m, 1)))
    to = k(new Date(Date.UTC(y, m + 1, 0)))
  } else if (ky === "quarter") {
    const q = Math.floor(m / 3) * 3
    from = k(new Date(Date.UTC(y, q, 1)))
    to = k(new Date(Date.UTC(y, q + 3, 0)))
  }
  return { from, to, conNgay: cachNgay(homNay, to) }
}

/** Ngày sớm nhất cần đọc để tính được MỌI kỳ (tuần có thể lấn sang quý trước). */
export const ngayDauCanDoc = (homNay: string): string => {
  const a = khoangKy("week", homNay).from
  const b = khoangKy("quarter", homNay).from
  return a < b ? a : b
}

/**
 * Mục tiêu của kỳ, từ mục tiêu THÁNG (KPI doanh số của cấu hình lương).
 * Quý = 3 tháng; tuần / ngày chia theo số ngày của tháng hiện tại.
 */
export function mucTieuKy(mucTieuThang: number, ky: KyTrangChu, homNay: string): number {
  if (!(mucTieuThang > 0)) return 0
  const n = soNgayThang(homNay)
  if (ky === "month") return mucTieuThang
  if (ky === "quarter") return mucTieuThang * 3
  if (ky === "week") return Math.round((mucTieuThang * 7) / n)
  return Math.round(mucTieuThang / n)
}

export interface HoaDonTC { id: string; customer_id: string | null; invoice_date: string; total: number }
export interface TraTC { customer_id: string | null; revenue_date: string; credit_note_amount: number }

/**
 * Phiếu trả tính cho NVBH đang xem.
 *
 * ⚠ CHỦ NHÀ 26/09/2026: "doanh thu của nhân viên chưa trừ hàng trả lại". Phiếu đứng tên
 *   mình thì trừ; phiếu CHƯA ghi người (phiếu tự sinh trước mig 194) mà RLS vẫn cho mình
 *   đọc — tức gắn HĐ / đơn của mình hoặc mình lập — cũng trừ. Phiếu đứng tên người khác
 *   thì không.
 */
export function traCuaToi<T extends { sales_user_id: string | null }>(rows: readonly T[], uid: string): T[] {
  return rows.filter((r) => !r.sales_user_id || r.sales_user_id === uid)
}

const trongKy = (ngay: string, kk: { from: string; to: string }) => ngay >= kk.from && ngay <= kk.to

/** Doanh số thuần của kỳ: Σ HĐ − Σ hàng trả (có thể âm nếu trả nhiều hơn bán). */
export function doanhSoKy(hd: readonly HoaDonTC[], tra: readonly TraTC[], kk: { from: string; to: string }): number {
  let s = 0
  for (const h of hd) if (trongKy(h.invoice_date, kk)) s += Number(h.total || 0)
  for (const r of tra) if (trongKy(r.revenue_date, kk)) s -= Math.abs(Number(r.credit_note_amount || 0))
  return s
}

/** Doanh số thuần theo khách trong kỳ, lớn trước. */
export function theoKhach(hd: readonly HoaDonTC[], tra: readonly TraTC[], kk: { from: string; to: string }): Array<{ customerId: string; total: number }> {
  const m = new Map<string, number>()
  for (const h of hd) if (h.customer_id && trongKy(h.invoice_date, kk)) m.set(h.customer_id, (m.get(h.customer_id) ?? 0) + Number(h.total || 0))
  for (const r of tra) if (r.customer_id && trongKy(r.revenue_date, kk)) m.set(r.customer_id, (m.get(r.customer_id) ?? 0) - Math.abs(Number(r.credit_note_amount || 0)))
  return Array.from(m, ([customerId, total]) => ({ customerId, total })).sort((a, b) => b.total - a.total)
}

/** Gộp doanh số theo khách thành theo kênh (kênh của khách); khách không kênh → "Khác". */
export function theoKenh(
  khach: ReadonlyArray<{ customerId: string; total: number }>,
  kenhCua: (customerId: string) => string | null | undefined
): Array<{ kenh: string; total: number }> {
  const m = new Map<string, number>()
  for (const x of khach) {
    const kenh = kenhCua(x.customerId) || "Khác"
    m.set(kenh, (m.get(kenh) ?? 0) + x.total)
  }
  return Array.from(m, ([kenh, total]) => ({ kenh, total })).filter((x) => x.total > 0).sort((a, b) => b.total - a.total)
}

/** Tiền rút gọn theo triệu như mẫu: 80 tr · 19,7 tr · 4,9 tr · 850 k. */
export function tienGon(n: number): string {
  const a = Math.abs(n)
  const dau = n < 0 ? "−" : ""
  if (a >= 1_000_000_000) return `${dau}${soGon(a / 1_000_000_000)} tỷ`
  if (a >= 1_000_000) return `${dau}${soGon(a / 1_000_000)} tr`
  if (a >= 1_000) return `${dau}${Math.round(a / 1_000)} k`
  return `${dau}${Math.round(a)}đ`
}
const soGon = (x: number) => (Math.round(x * 10) / 10).toLocaleString("vi-VN", { maximumFractionDigits: x >= 100 ? 0 : x >= 10 ? 1 : 2 }).replace(/,(\d)0$/, ",$1")

/** Dòng "Còn 4 ngày · cần thêm 19,7 tr, khoảng 4,9 tr/ngày." — null khi chưa có mục tiêu. */
export function loiNhacMucTieu(doanhSo: number, mucTieu: number, conNgay: number): string | null {
  if (!(mucTieu > 0)) return null
  const thieu = mucTieu - doanhSo
  if (thieu <= 0) return "Đã đạt mục tiêu kỳ này."
  if (conNgay <= 0) return `Hôm nay là ngày cuối · cần thêm ${tienGon(thieu)}.`
  return `Còn ${conNgay} ngày · cần thêm ${tienGon(thieu)}, khoảng ${tienGon(thieu / conNgay)}/ngày.`
}

const THU = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"]
/** "Thứ Bảy, 26/09". */
export function nhanNgay(homNay: string): string {
  const x = d(homNay)
  return `${THU[x.getUTCDay()]}, ${homNay.slice(8, 10)}/${homNay.slice(5, 7)}`
}
/** `pjp_routes.day_of_week`: 0 = Thứ 2 … 6 = Chủ nhật (màn /sales/pjp). */
export const ngayTuyen = (homNay: string): number => (d(homNay).getUTCDay() + 6) % 7
/** Nhãn tuyến hôm nay như mẫu: T2 … T7, CN. */
export const nhanTuyen = (homNay: string): string => {
  const i = ngayTuyen(homNay)
  return i === 6 ? "CN" : `T${i + 2}`
}
