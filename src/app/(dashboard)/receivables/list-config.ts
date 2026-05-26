import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const RECEIVABLE_COLUMNS = [
  { key: "salesUser", label: "NV phụ trách" },
  { key: "amount", label: "Phải thu" },
  { key: "paid", label: "Đã thu" },
  { key: "remaining", label: "Còn lại" },
  { key: "dueDate", label: "Hạn" },
  { key: "status", label: "Trạng thái" },
  { key: "action", label: "Thao tác" },
] as const satisfies readonly ListViewOption<string>[]

export type ReceivableColumnKey = (typeof RECEIVABLE_COLUMNS)[number]["key"]

export const DEFAULT_RECEIVABLE_COLUMNS: ReceivableColumnKey[] = [
  "salesUser",
  "amount",
  "paid",
  "remaining",
  "dueDate",
  "status",
  "action",
]
