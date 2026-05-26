import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const PAYABLE_COLUMNS = [
  { key: "invoiceNumber", label: "Mã HĐ" },
  { key: "amount", label: "Số tiền" },
  { key: "paid", label: "Đã trả" },
  { key: "remaining", label: "Còn lại" },
  { key: "dueDate", label: "Hạn trả" },
  { key: "aging", label: "Tuổi nợ" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type PayableColumnKey = (typeof PAYABLE_COLUMNS)[number]["key"]

export const DEFAULT_PAYABLE_COLUMNS: PayableColumnKey[] = [
  "invoiceNumber",
  "amount",
  "paid",
  "remaining",
  "dueDate",
  "aging",
  "status",
]
