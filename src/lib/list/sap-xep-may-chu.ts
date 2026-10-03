/**
 * SẮP XẾP DANH SÁCH Ở MÁY CHỦ — dùng cho mọi màn phân trang ở máy chủ.
 *
 * ⚠ VÌ SAO: bảng cũ xếp trong bộ nhớ trên ĐÚNG những dòng nó nhận — mà màn phân trang chỉ
 *   đưa xuống một trang (20 dòng). Bấm "Còn lại ↓" ở Công nợ ra khoản lớn nhất của 20 dòng
 *   đang xem, không phải của cả sổ; người dùng tin đó là khoản nợ to nhất. Màn phân trang
 *   phải gửi `.order(cột)` xuống máy chủ, bảng chỉ vẽ mũi tên và báo lại khoá cột.
 *
 * ⚠ CỘT TÍNH RA (vd "Còn lại" = amount − paid, tên khách suy từ dòng phiếu) KHÔNG có trong
 *   bản đồ → tiêu đề không bấm được. Đừng thêm `sort` so sánh trong bộ nhớ cho cột ấy ở màn
 *   phân trang: nó lại xếp trên một trang.
 *
 * ⚠ CỘT CỦA BẢNG NHÚNG MỘT-MỘT (khách, NCC) xếp được bằng cú pháp PostgREST
 *   `bí_danh(cột)` — vd `customer(store_name)` khi select có `customer:customers(store_name)`.
 *   Chỉ dùng cho quan hệ MỘT (khoá ngoại trên bảng đang liệt kê); quan hệ nhiều thì PostgREST
 *   báo lỗi.
 */

export type ChieuSapXep = "asc" | "desc"

export interface DocSort<K extends string = string> {
  key: K
  dir: ChieuSapXep
}

/** Bấm lại đúng cột thì đổi chiều; bấm cột khác thì xếp tăng dần trên cột đó. */
export function doiSapXep<K extends string>(cur: DocSort<K> | null, key: K): DocSort<K> {
  return cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
}

/** Khoá cột trên giao diện → tên cột gửi PostgREST (`.order(...)`). */
export type BanDoSapXep<K extends string = string> = Partial<Record<K, string>>

interface CoOrder<Q> {
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => Q
}

/**
 * Gắn thứ tự người dùng chọn LÊN TRƯỚC thứ tự mặc định của màn.
 *
 * - Khoá không có trong bản đồ (hoặc chưa chọn) → chỉ thứ tự mặc định.
 * - Ô trống (`null`) luôn xuống CUỐI, cả hai chiều: "Hạn ↓" mà khoản không hạn nằm đầu là
 *   đọc sai.
 * - `macDinh` PHẢI kết thúc bằng một khoá duy nhất (`.order("id")`) — thiếu nó thì nhiều
 *   dòng cùng giá trị, ranh giới trang do máy chủ tự quyết: dòng lặp / sót giữa hai trang.
 */
export function apSapXep<Q extends CoOrder<Q>>(
  q: Q,
  sort: DocSort | null | undefined,
  banDo: BanDoSapXep,
  macDinh: (q: Q) => Q
): Q {
  const cot = sort ? banDo[sort.key] : undefined
  const x = cot ? q.order(cot, { ascending: sort!.dir === "asc", nullsFirst: false }) : q
  return macDinh(x)
}

/** Cột này xếp được ở máy chủ không — để bật / tắt nút trên tiêu đề. */
export function xepDuoc(banDo: BanDoSapXep, key: string): boolean {
  return !!banDo[key]
}

/* ───────────── Màn NẠP ĐỦ rồi chia trang tại chỗ (`usePhanTrangTaiCho`) ─────────────
 * ⚠ XẾP TRƯỚC KHI CẮT TRANG. Đưa `trang` (20 dòng) cho bảng tự xếp là xếp trên 20 dòng — cùng lỗi
 *   với màn phân trang ở máy chủ. Màn giữ `sort`, xếp CẢ danh sách đã lọc bằng bảng so sánh của
 *   màn, rồi mới chia trang; bảng chạy chế độ `onSortChange` (chỉ vẽ mũi tên). */

export type BangSoSanh<T> = Record<string, (a: T, b: T) => number>

/** Xếp cả danh sách theo `sort`; khoá không có trong bảng so sánh → giữ nguyên thứ tự. */
export function sapXepTaiCho<T>(rows: readonly T[], sort: DocSort | null | undefined, soSanh: BangSoSanh<T>): T[] {
  const cmp = sort ? soSanh[sort.key] : undefined
  if (!sort || !cmp) return rows as T[]
  const dir = sort.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => dir * cmp(a, b))
}

/* ───────────── Bản đồ cột của từng màn phân trang ở máy chủ ─────────────
 * Khoá = `key` của cột trên bảng. Cột không có ở đây thì tiêu đề không bấm được. */

/**
 * Công nợ phải thu (`receivables`). "Còn lại" KHÔNG có: là amount − paid tính ở trình duyệt,
 * sổ không có cột / view nào giữ sẵn.
 */
export const SAP_XEP_CONG_NO: BanDoSapXep = {
  customer: "customer(store_name)",
  amount: "amount",
  dueDate: "due_date",
}

/** Công nợ NCC (`payables`). "Còn lại" KHÔNG có — cùng lý do với công nợ phải thu. */
export const SAP_XEP_CONG_NO_NCC: BanDoSapXep = {
  supplier: "supplier(name)",
  amount: "amount",
  dueDate: "due_date",
}

/** Phiếu thu (`cash_receipts`). "Khách hàng" KHÔNG có — suy từ dòng phiếu, đầu phiếu không có cột. */
export const SAP_XEP_PHIEU_THU: BanDoSapXep = {
  date: "receipt_date",
  submitted: "submitted_amount",
  total: "expected_amount",
}

/**
 * Hoá đơn mua hàng (`stock_entries` loại nhập). "Còn nợ" KHÔNG có — nằm ở `payables`, đọc riêng
 * theo trang. "Ngày nhập" xếp theo `posted_at` (ô trống xuống cuối, rồi tới mặc định `created_at`).
 */
export const SAP_XEP_HD_MUA: BanDoSapXep = {
  supplier: "supplier(name)",
  date: "posted_at",
}

/** Hoá đơn điện tử (`invoices`) — tên khách chụp sẵn trên tờ (`customer_name`). */
export const SAP_XEP_HD_DIEN_TU: BanDoSapXep = {
  customer: "customer_name",
  amount: "total",
}

/** Nhà cung cấp (`suppliers`). */
export const SAP_XEP_NCC: BanDoSapXep = {
  name: "name",
}
