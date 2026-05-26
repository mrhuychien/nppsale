import type { ListViewOption } from "@/components/ui/list-view-toolbar"

// Cột "Mã đơn", checkbox + ô action luôn hiện — không khai báo ở đây.
export const ORDER_COLUMNS = [
  { key: "customer", label: "Khách hàng" },
  { key: "salesUser", label: "NV bán hàng" },
  { key: "date", label: "Ngày đặt" },
  { key: "total", label: "Tổng tiền" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type OrderColumnKey = (typeof ORDER_COLUMNS)[number]["key"]

export const DEFAULT_ORDER_COLUMNS: OrderColumnKey[] = [
  "customer",
  "salesUser",
  "date",
  "total",
  "status",
]

export const ORDER_FILTERS = [
  { key: "search", label: "Tìm mã đơn", required: true },
  { key: "pipeline", label: "Pipeline 7 bước" },
  { key: "specialStatus", label: "Lọc trạng thái đặc biệt" },
  { key: "date", label: "Ngày đặt" },
  { key: "customer", label: "Khách hàng" },
  { key: "sales", label: "NV bán hàng" },
  { key: "amount", label: "Giá trị đơn" },
] as const satisfies readonly ListViewOption<string>[]

export type OrderFilterKey = (typeof ORDER_FILTERS)[number]["key"]

export const DEFAULT_ORDER_FILTERS: OrderFilterKey[] = [
  "search",
  "pipeline",
  "specialStatus",
]
