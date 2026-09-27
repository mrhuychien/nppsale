import type { ListViewOption } from "@/components/ui/list-view-toolbar"

/** Cột / bộ lọc của danh sách PHIẾU NHẬP HÀNG — khuôn danh sách chung (chủ nhà 27/09/2026). */
export const PURCHASE_RECEIPT_COLUMNS = [
  { key: "supplier", label: "Nhà cung cấp" },
  { key: "invoiceNumber", label: "Số HĐ" },
  { key: "date", label: "Ngày" },
  { key: "zone", label: "Kho" },
  { key: "total", label: "Cần trả NCC" },
  { key: "status", label: "Trạng thái" },
  { key: "notes", label: "Ghi chú" },
] as const satisfies readonly ListViewOption<string>[]

export type PurchaseReceiptColumnKey = (typeof PURCHASE_RECEIPT_COLUMNS)[number]["key"]

export const DEFAULT_PURCHASE_RECEIPT_COLUMNS: PurchaseReceiptColumnKey[] = ["supplier", "invoiceNumber", "date", "total", "status"]

export const PURCHASE_RECEIPT_FILTERS = [
  { key: "search", label: "Tìm phiếu nhập", required: true },
] as const satisfies readonly ListViewOption<string>[]

export const DEFAULT_PURCHASE_RECEIPT_FILTERS = ["search"] as ("search")[]

/** Hai kho theo CHECK warehouse_zone IN ('sale', 'date'). */
export const ZONE_LABEL: Record<string, string> = { sale: "Kho hàng bán", date: "Kho hàng date" }
