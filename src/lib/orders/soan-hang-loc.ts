/**
 * BỘ LỌC + DẤU "ĐÃ SOẠN" của màn Kho vận › Soạn hàng — chủ nhà 02/10/2026: "phần soạn đơn, thêm các bộ lọc
 * vào đơn. thêm đánh dấu đơn nào đã soạn vào" · "đã soạn chỉ xuất hiện ở màn soạn đơn thôi".
 * Dấu nằm ở `sales_invoices.soan_luc / soan_boi`, ghi qua RPC `danh_dau_soan_hang` (mig 224).
 */

export type TrangThaiSoan = "chua" | "da" | "tat"

export interface LocSoan {
  /** Ngày hoá đơn từ / đến (YYYY-MM-DD), rỗng = không chặn. */
  tu: string
  den: string
  /** Nhân viên bán (`sales_user_id`), rỗng = mọi người. */
  nv: string
  /** Tuyến (`sales_routes.id`), rỗng = mọi tuyến. */
  tuyen: string
  soan: TrangThaiSoan
}

/** Mặc định: hoá đơn CHƯA soạn — kho mở màn là thấy việc còn phải làm. */
export const LOC_SOAN_MAC_DINH: LocSoan = { tu: "", den: "", nv: "", tuyen: "", soan: "chua" }

export const NHAN_TRANG_THAI_SOAN: Record<TrangThaiSoan, string> = { chua: "Chưa soạn", da: "Đã soạn", tat: "Tất cả" }

/** Số bộ lọc đang khác mặc định (cho nút "Bỏ lọc"). */
export function soLocDangBat(l: LocSoan): number {
  const m = LOC_SOAN_MAC_DINH
  return (["tu", "den", "nv", "tuyen", "soan"] as const).filter((k) => l[k] !== m[k]).length
}

/** Cột đọc của hoá đơn. Lọc tuyến cần nhúng khách `!inner` (chỉ giữ HĐ có khách khớp tuyến). */
export function cotHoaDonSoan(l: LocSoan, coCotSoan: boolean): string {
  const khach = l.tuyen ? "customer:customers!inner(store_name, phone, channel)" : "customer:customers(store_name, phone, channel)"
  return [
    "id, invoice_code, invoice_date, status, total, sales_user_id",
    ...(coCotSoan ? ["soan_luc, soan_boi"] : []),
    khach,
    "order:sales_orders(order_code)",
  ].join(", ")
}

/** Phần dựng truy vấn mà bộ lọc cần — kiểu tối thiểu để test bằng bản ghi giả. */
export interface TruyVanLoc<T> {
  gte(cot: string, v: string): T
  lte(cot: string, v: string): T
  eq(cot: string, v: string): T
  in(cot: string, v: string[]): T
  is(cot: string, v: null): T
  not(cot: string, op: string, v: null): T
}

/** Giá trị `customers.channel` có thể có của một tuyến: id · mã · tên. */
export const khoaCuaTuyen = (r: { id: string; code?: string | null; name?: string | null } | undefined): string[] =>
  r ? Array.from(new Set([r.id, r.code, r.name].filter((x): x is string => !!x))) : []

/**
 * Áp bộ lọc lên truy vấn `sales_invoices`. `coCotSoan` = sổ đã chạy mig 224 (chưa thì bỏ qua lọc soạn).
 * `khoaTuyen`: các giá trị `customers.channel` của tuyến đang chọn — cột này lưu mã tuyến, sổ cũ có chỗ lưu
 * id hoặc tên (như `nap-danh-muc`), nên khớp cả ba.
 */
export function apLocSoan<T extends TruyVanLoc<T>>(q: T, l: LocSoan, coCotSoan: boolean, khoaTuyen: string[] = []): T {
  let x = q
  if (l.tu) x = x.gte("invoice_date", l.tu)
  if (l.den) x = x.lte("invoice_date", l.den)
  if (l.nv) x = x.eq("sales_user_id", l.nv)
  if (l.tuyen) x = x.in("customer.channel", khoaTuyen.length ? khoaTuyen : [l.tuyen])
  if (coCotSoan && l.soan === "chua") x = x.is("soan_luc", null)
  if (coCotSoan && l.soan === "da") x = x.not("soan_luc", "is", null)
  return x
}

/** Lỗi do sổ chưa có cột soạn (chưa chạy mig 224) — đọc lại không có cột ấy. */
export const thieuCotSoan = (msg: string | null | undefined) => /soan_luc|soan_boi/.test(String(msg ?? ""))

/** "08:15 02/10" theo giờ VN. */
function gioNgay(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  )
  return `${p.hour}:${p.minute} ${p.day}/${p.month}`
}

/** "Đã soạn 08:15 02/10 · Hoàng Văn Em". */
export function nhanDaSoan(soanLuc: string | null | undefined, nguoi?: string | null): string {
  if (!soanLuc) return ""
  return `Đã soạn ${gioNgay(soanLuc)}${nguoi ? ` · ${nguoi}` : ""}`
}

/** Vai được đánh dấu soạn hàng — đúng luật RPC `danh_dau_soan_hang` (mig 224). */
export const duocDanhDauSoan = (role: string | null | undefined) =>
  role === "owner" || role === "manager" || role === "warehouse" || role === "accountant"
