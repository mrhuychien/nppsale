import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const DELIVERY_COLUMNS = [
  { key: "vehicle", label: "Xe" },
  { key: "orderCount", label: "Số đơn" },
  { key: "totalValue", label: "Tổng giá trị" },
  { key: "createdAt", label: "Tạo" },
  { key: "updatedAt", label: "Cập nhật cuối" },
] as const satisfies readonly ListViewOption<string>[]

export type DeliveryColumnKey = (typeof DELIVERY_COLUMNS)[number]["key"]

export const DEFAULT_DELIVERY_COLUMNS: DeliveryColumnKey[] = [
  "vehicle",
  "orderCount",
  "totalValue",
  "createdAt",
  "updatedAt",
]
