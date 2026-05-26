import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const PROMOTION_COLUMNS = [
  { key: "type", label: "Loại" },
  { key: "priority", label: "Ưu tiên" },
  { key: "period", label: "Thời gian" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type PromotionColumnKey = (typeof PROMOTION_COLUMNS)[number]["key"]

export const DEFAULT_PROMOTION_COLUMNS: PromotionColumnKey[] = [
  "type",
  "priority",
  "period",
  "status",
]

export const PROMOTION_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "type", label: "Loại KM" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type PromotionFilterKey = (typeof PROMOTION_FILTERS)[number]["key"]

export const DEFAULT_PROMOTION_FILTERS: PromotionFilterKey[] = ["search"]
