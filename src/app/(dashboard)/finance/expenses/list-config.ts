import type { ListViewOption } from "@/components/ui/list-view-toolbar"

/** Cột / bộ lọc của danh sách CHI PHÍ — khuôn danh sách chung (chủ nhà 27/09/2026). */
export const EXPENSE_COLUMNS = [
  { key: "category", label: "Danh mục" },
  { key: "bucket", label: "Phân loại" },
  { key: "description", label: "Mô tả" },
  { key: "reference", label: "Mã tham chiếu" },
  { key: "method", label: "Hình thức" },
  { key: "total", label: "Số tiền" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type ExpenseColumnKey = (typeof EXPENSE_COLUMNS)[number]["key"]

export const DEFAULT_EXPENSE_COLUMNS: ExpenseColumnKey[] = ["category", "bucket", "description", "total", "status"]

export const EXPENSE_FILTERS = [
  { key: "search", label: "Tìm chi phí", required: true },
  { key: "category", label: "Danh mục" },
  { key: "date", label: "Khoảng ngày" },
] as const satisfies readonly ListViewOption<string>[]

export type ExpenseFilterKey = (typeof EXPENSE_FILTERS)[number]["key"]

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilterKey[] = ["search", "category", "date"]
