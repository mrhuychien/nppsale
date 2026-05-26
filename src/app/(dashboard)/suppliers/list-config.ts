import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const SUPPLIER_COLUMNS = [
  { key: "code", label: "Mã NCC" },
  { key: "category", label: "Danh mục" },
  { key: "contact", label: "Liên hệ" },
  { key: "phone", label: "SĐT" },
  { key: "status", label: "Trạng thái" },
  { key: "action", label: "Hành động" },
] as const satisfies readonly ListViewOption<string>[]

export type SupplierColumnKey = (typeof SUPPLIER_COLUMNS)[number]["key"]

export const DEFAULT_SUPPLIER_COLUMNS: SupplierColumnKey[] = [
  "code",
  "category",
  "contact",
  "phone",
  "status",
  "action",
]

export const SUPPLIER_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "category", label: "Lọc theo danh mục" },
  { key: "status", label: "Lọc theo trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type SupplierFilterKey = (typeof SUPPLIER_FILTERS)[number]["key"]

export const DEFAULT_SUPPLIER_FILTERS: SupplierFilterKey[] = ["search"]
