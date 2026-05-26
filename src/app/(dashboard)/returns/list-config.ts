import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const RETURN_COLUMNS = [
  { key: "date", label: "Ngày" },
  { key: "orderCode", label: "Đơn gốc" },
  { key: "reason", label: "Lý do" },
  { key: "requester", label: "Người tạo" },
  { key: "creditNote", label: "Credit Note" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type ReturnColumnKey = (typeof RETURN_COLUMNS)[number]["key"]

export const DEFAULT_RETURN_COLUMNS: ReturnColumnKey[] = [
  "date",
  "orderCode",
  "reason",
  "requester",
  "creditNote",
  "status",
]

export const RETURN_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "reason", label: "Lọc theo lý do" },
] as const satisfies readonly ListViewOption<string>[]

export type ReturnFilterKey = (typeof RETURN_FILTERS)[number]["key"]

export const DEFAULT_RETURN_FILTERS: ReturnFilterKey[] = ["search", "reason"]
