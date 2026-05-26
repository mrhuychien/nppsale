import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const STOCK_ENTRY_COLUMNS = [
  { key: "type", label: "Loại" },
  { key: "status", label: "Trạng thái" },
  { key: "creator", label: "Người tạo" },
  { key: "notes", label: "Ghi chú" },
  { key: "date", label: "Ngày" },
] as const satisfies readonly ListViewOption<string>[]

export type StockEntryColumnKey = (typeof STOCK_ENTRY_COLUMNS)[number]["key"]

export const DEFAULT_STOCK_ENTRY_COLUMNS: StockEntryColumnKey[] = [
  "type",
  "status",
  "creator",
  "notes",
  "date",
]

export const STOCK_ENTRY_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "type", label: "Loại phiếu" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type StockEntryFilterKey = (typeof STOCK_ENTRY_FILTERS)[number]["key"]

export const DEFAULT_STOCK_ENTRY_FILTERS: StockEntryFilterKey[] = [
  "search",
  "type",
  "status",
]
