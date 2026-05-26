import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const PURCHASE_RETURN_COLUMNS = [
  { key: "date", label: "Ngày" },
  { key: "supplier", label: "NCC" },
  { key: "warehouse", label: "Kho xuất" },
  { key: "total", label: "Tổng tiền" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type PurchaseReturnColumnKey = (typeof PURCHASE_RETURN_COLUMNS)[number]["key"]

export const DEFAULT_PURCHASE_RETURN_COLUMNS: PurchaseReturnColumnKey[] = [
  "date",
  "supplier",
  "warehouse",
  "total",
  "status",
]
