import type { ListViewOption } from "@/components/ui/list-view-toolbar"

// Cột bảng có thể bật/tắt. Cột "Tên sản phẩm" + ô action mặc định
// luôn hiện (không khai báo ở đây).
// ⚠ Không còn cột / bộ lọc "Danh mục" (= Nhóm hàng, `products.category`): chủ nhà 03/10/2026
//   "Bỏ luôn trường nhóm hàng" — hàng nhóm theo NCC. Lựa chọn cũ đã lưu tự rơi (useListViewPrefs).
export const PRODUCT_COLUMNS = [
  { key: "sku", label: "SKU" },
  { key: "supplier", label: "Nhà cung cấp" },
  { key: "unit", label: "ĐVT" },
  { key: "price", label: "Giá bán" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type ProductColumnKey = (typeof PRODUCT_COLUMNS)[number]["key"]

export const DEFAULT_PRODUCT_COLUMNS: ProductColumnKey[] = [
  "sku",
  "supplier",
  "unit",
  "price",
  "status",
]

// Bộ lọc khả dụng. "search" required → luôn render.
export const PRODUCT_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "supplier", label: "Lọc theo nhà cung cấp" },
  { key: "status", label: "Lọc theo trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type ProductFilterKey = (typeof PRODUCT_FILTERS)[number]["key"]

export const DEFAULT_PRODUCT_FILTERS: ProductFilterKey[] = ["search"]
