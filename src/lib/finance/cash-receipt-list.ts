/**
 * DANH SÁCH PHIẾU THU — nhãn, màu, và phần tóm tắt dòng phiếu cho khuôn danh sách chung.
 *
 * ⚠ CHỦ NHÀ 27/09/2026: "Làm danh sách Phiếu thu format giống Danh sách đơn hàng / Hóa đơn
 *   đi, giờ đang 1 mình 1 format." Phần tính ở đây là THUẦN (không gọi sổ) để kiểm được.
 *
 * ⚠ `cash_receipts` KHÔNG CÓ CỘT KHÁCH. Khách của một phiếu suy ra từ DÒNG phiếu: khoản công
 *   nợ (`receivable → customer`), rồi hóa đơn, rồi đơn (phiếu cũ của luồng chuyến giao chỉ gắn
 *   đơn). Nhãn chứng từ của khoản thu là MÃ HÓA ĐƠN (CLAUDE.md — công nợ theo hóa đơn), mã
 *   đơn chỉ là thông tin phụ.
 */
import type { OrderTone } from "@/lib/orders/status-tone"
import type { TruongTim } from "@/lib/search/field-search"
import { trangThaiCuaChon } from "@/lib/list/status-multi"

/**
 * ⚠ PHIẾU ĐÃ HUỶ KHÔNG VÀO TỔNG — trừ khi đang xem ĐÚNG mình "Đã hủy" (khi ấy "N phiếu · 0đ"
 *   là nói sai). Cùng luật `tongChungTu` của các màn chứng từ khác.
 */
export function boPhieuHuyKhoiTong(status: string): boolean {
  const chon = trangThaiCuaChon(status)
  return !(chon && chon.length === 1 && chon[0] === "voided")
}

export const CASH_RECEIPT_STATUS = ["pending", "received", "voided"] as const

export const CASH_RECEIPT_STATUS_LABEL: Record<string, string> = {
  pending: "Chờ xác nhận",
  received: "Đã nhận",
  voided: "Đã hủy",
}

export const CASH_RECEIPT_STATUS_VARIANT: Record<string, "warning" | "success" | "secondary"> = {
  pending: "warning",
  received: "success",
  voided: "secondary",
}

export const CASH_RECEIPT_SOURCE_LABEL: Record<string, string> = {
  standalone: "Phiếu độc lập",
  manual: "Nhập tay",
  delivery_settle: "Quyết toán chuyến",
}

/** Cùng bảng màu với đơn / hóa đơn: chờ = hổ phách, xong = xanh, huỷ = đỏ. */
const TONES: Record<string, Omit<OrderTone, "key" | "label">> = {
  pending: { bg: "#fff4e0", fg: "#8a5a00", accent: "#fdb022" },
  received: { bg: "#e3f5ec", fg: "#004e33", accent: "#22c55e" },
  voided: { bg: "#fdecec", fg: "#b00020", accent: "#ef5350" },
}

export function cashReceiptTone(status: string): OrderTone {
  const t = TONES[status] ?? TONES.pending
  return { key: status, label: CASH_RECEIPT_STATUS_LABEL[status] ?? status, ...t }
}

/**
 * Huy hiệu trên thẻ điện thoại — CHỈ khi còn việc / khác thường.
 * ⚠ `received` là trạng thái bình thường của gần như mọi phiếu; đeo huy hiệu xanh cho tất cả
 *   thì mắt không bắt được phiếu Chờ xác nhận hay Đã hủy (cùng luật với hóa đơn).
 */
export function cashReceiptBadge(status: string) {
  if (status === "received") return null
  const t = cashReceiptTone(status)
  return { label: t.label, bg: t.bg, fg: t.fg }
}

/** Một dòng phiếu thu như danh sách đọc về — xem `COT_DONG_PHIEU_THU`. */
export interface DongPhieuThuTom {
  receipt_id: string
  amount?: number | string | null
  invoice?: { id?: string | null; invoice_code?: string | null; customer?: { store_name?: string | null } | null } | null
  receivable?: { customer?: { store_name?: string | null } | null } | null
  order?: { order_code?: string | null; customer?: { store_name?: string | null } | null } | null
}

/**
 * Cột đọc dòng phiếu cho danh sách. Khách lấy từ khoản công nợ trước (luôn có `customer_id`),
 * rồi từ hóa đơn, rồi từ đơn.
 */
export const COT_DONG_PHIEU_THU =
  "receipt_id, amount, " +
  "invoice:sales_invoices(id, invoice_code, customer:customers(store_name)), " +
  "receivable:receivables(customer:customers(store_name)), " +
  "order:sales_orders(order_code, customer:customers(store_name))"

export interface TomTatPhieuThu {
  /** Các khách của phiếu, không trùng, theo thứ tự gặp. */
  khach: string[]
  /** Mã hóa đơn đã thu, không trùng. */
  hoaDon: string[]
  /** Mã đơn — chỉ để hiện phụ khi phiếu không gắn hóa đơn nào. */
  don: string[]
}

export function tomTatDongPhieuThu(dong: readonly DongPhieuThuTom[]): Record<string, TomTatPhieuThu> {
  const out: Record<string, TomTatPhieuThu> = {}
  const them = (ds: string[], v: string | null | undefined) => {
    const s = (v ?? "").trim()
    if (s && !ds.includes(s)) ds.push(s)
  }
  for (const d of dong) {
    const t = (out[d.receipt_id] ??= { khach: [], hoaDon: [], don: [] })
    them(
      t.khach,
      d.receivable?.customer?.store_name || d.invoice?.customer?.store_name || d.order?.customer?.store_name
    )
    them(t.hoaDon, d.invoice?.invoice_code)
    them(t.don, d.order?.order_code)
  }
  return out
}

/** "Tạp hoá A", "Tạp hoá A +2". Chưa đọc được dòng → `null` (nơi gọi hiện "—"). */
export function nhanNhieu(ds: readonly string[] | undefined): string | null {
  if (!ds || ds.length === 0) return null
  return ds.length === 1 ? ds[0] : `${ds[0]} +${ds.length - 1}`
}

/* ---------------------------------------------------------------------------
 * TÌM — ô tìm nhanh và tìm theo từng trường (`useFieldSearch`).
 *
 * ⚠ KHÁCH / HÓA ĐƠN KHÔNG NẰM TRÊN ĐẦU PHIẾU → tra theo chuỗi bảng: khách → khoản công nợ →
 *   dòng phiếu → mã phiếu; mã hóa đơn → dòng phiếu → mã phiếu. Mỗi bước giữ trần, chạm trần
 *   thì màn nói "kết quả đang thiếu".
 * ------------------------------------------------------------------------- */
const QUA_KHACH = {
  cotDich: "id",
  buoc: [
    { bang: "customers", cotTim: ["store_name", "owner_name", "phone"], layCot: "id", coOrg: true },
    { bang: "receivables", theoCot: "customer_id", layCot: "id" },
    { bang: "cash_receipt_lines", theoCot: "receivable_id", layCot: "receipt_id" },
  ],
}
const QUA_HOA_DON = {
  cotDich: "id",
  buoc: [
    { bang: "sales_invoices", cotTim: ["invoice_code"], layCot: "id", coOrg: true },
    { bang: "cash_receipt_lines", theoCot: "invoice_id", layCot: "receipt_id" },
  ],
}
const QUA_NGUOI_THU = {
  cotDich: "collected_by",
  buoc: [{ bang: "users", cotTim: ["full_name"], layCot: "id", coOrg: true }],
}

/** Ô tìm nhanh: mã phiếu, ghi chú, tên / SĐT khách, mã hóa đơn, người thu — ghép "HOẶC". */
export const TIM_NHANH_PHIEU_THU: readonly TruongTim[] = [
  { key: "q", nhan: "Tìm nhanh", cotRieng: ["receipt_code", "notes"], chuoi: [QUA_KHACH, QUA_HOA_DON, QUA_NGUOI_THU] },
]

/** Các trường của nút lọc trong ô tìm — ghép "VÀ". */
export const TRUONG_PHIEU_THU: readonly TruongTim[] = [
  { key: "ma", nhan: "Theo mã phiếu thu, mã hóa đơn", cotRieng: ["receipt_code"], chuoi: [QUA_HOA_DON] },
  { key: "khach", nhan: "Theo tên, số điện thoại khách hàng", chuoi: [QUA_KHACH] },
  { key: "nguoi", nhan: "Theo người thu", chuoi: [QUA_NGUOI_THU] },
]
