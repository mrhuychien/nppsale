import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const INVOICE_COLUMNS = [
  { key: "number", label: "Số HĐ" },
  { key: "amount", label: "Tổng tiền" },
  { key: "date", label: "Ngày" },
  { key: "status", label: "Trạng thái" },
  { key: "misa", label: "MISA" },
  { key: "lookup", label: "Tra cứu" },
] as const satisfies readonly ListViewOption<string>[]

export type InvoiceColumnKey = (typeof INVOICE_COLUMNS)[number]["key"]

export const DEFAULT_INVOICE_COLUMNS: InvoiceColumnKey[] = [
  "number",
  "amount",
  "date",
  "status",
  "misa",
  "lookup",
]

export const INVOICE_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "status", label: "Trạng thái HĐ" },
  { key: "misa", label: "Trạng thái MISA" },
] as const satisfies readonly ListViewOption<string>[]

export type InvoiceFilterKey = (typeof INVOICE_FILTERS)[number]["key"]

export const DEFAULT_INVOICE_FILTERS: InvoiceFilterKey[] = [
  "search",
  "status",
  "misa",
]
