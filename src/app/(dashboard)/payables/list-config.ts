import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const PAYABLE_COLUMNS = [
  { key: "invoiceNumber", label: "Chứng từ" },
  { key: "amount", label: "Số tiền" },
  { key: "paid", label: "Đã trả" },
  { key: "remaining", label: "Còn lại" },
  /* Tổng đang nợ NCC của dòng (mọi khoản chưa xong) — chủ nhà 08/11/2026. Người đã chỉnh cột vẫn thấy: `adoptNewKeys`. */
  { key: "duNo", label: "Dư nợ hiện tại" },
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
  "duNo",
  "dueDate",
  "aging",
  "status",
]
