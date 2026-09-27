import type { ListViewOption } from "@/components/ui/list-view-toolbar"

/**
 * CỘT VÀ BỘ LỌC CỦA DANH SÁCH PHIẾU THU — cùng khuôn với `sales-invoices/list-config.ts`
 * (chủ nhà 27/09/2026: "Làm danh sách Phiếu thu format giống Danh sách đơn hàng / Hóa đơn").
 *
 * ⚠ CÙNG TÊN KHOÁ VỚI HÓA ĐƠN Ở NHỮNG CỘT TRÙNG NGHĨA (`customer`, `date`, `createdBy`,
 *   `total`, `status`) — xem chú thích đầu tệp hóa đơn.
 */

// Cột "Số phiếu" và ô xem nhanh luôn hiện — không khai báo ở đây.
export const CASH_RECEIPT_COLUMNS = [
  { key: "customer", label: "Khách hàng" },
  /* Nhãn của khoản thu là MÃ HÓA ĐƠN (công nợ theo hóa đơn — CLAUDE.md). */
  { key: "invoices", label: "Hóa đơn" },
  { key: "collector", label: "Người thu" },
  { key: "createdBy", label: "Người tạo" },
  { key: "receiver", label: "Người nhận" },
  { key: "source", label: "Nguồn" },
  { key: "date", label: "Ngày thu" },
  { key: "submitted", label: "Đã nộp" },
  { key: "total", label: "Số tiền" },
  { key: "status", label: "Trạng thái" },
  { key: "notes", label: "Ghi chú" },
] as const satisfies readonly ListViewOption<string>[]

export type CashReceiptColumnKey = (typeof CASH_RECEIPT_COLUMNS)[number]["key"]

export const DEFAULT_CASH_RECEIPT_COLUMNS: CashReceiptColumnKey[] = [
  "customer",
  "invoices",
  "collector",
  "date",
  "total",
  "status",
]

export const CASH_RECEIPT_FILTERS = [
  { key: "search", label: "Tìm phiếu thu", required: true },
  { key: "date", label: "Ngày thu" },
  { key: "collector", label: "Người thu" },
  { key: "amount", label: "Số tiền" },
] as const satisfies readonly ListViewOption<string>[]

export type CashReceiptFilterKey = (typeof CASH_RECEIPT_FILTERS)[number]["key"]

export const DEFAULT_CASH_RECEIPT_FILTERS: CashReceiptFilterKey[] = ["search", "date"]
