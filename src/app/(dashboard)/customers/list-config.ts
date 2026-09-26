import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const CUSTOMER_COLUMNS = [
  { key: "owner", label: "Chủ cửa hàng" },
  { key: "phone", label: "SĐT" },
  { key: "channel", label: "Tuyến/Kênh" },
  { key: "managers", label: "Phụ trách" },
  { key: "lastVisit", label: "Ghé thăm" },
  { key: "lastOrder", label: "Đơn gần nhất" },
  { key: "debt", label: "Công nợ" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type CustomerColumnKey = (typeof CUSTOMER_COLUMNS)[number]["key"]

export const DEFAULT_CUSTOMER_COLUMNS: CustomerColumnKey[] = [
  "owner",
  "phone",
  "channel",
  "managers",
  "lastVisit",
  "lastOrder",
  "debt",
  "status",
]

export const CUSTOMER_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "status", label: "Trạng thái" },
  { key: "channel", label: "Tuyến/Kênh" },
  { key: "sales", label: "Nhân viên phụ trách" },
  { key: "route", label: "Tuyến giao" },
] as const satisfies readonly ListViewOption<string>[]

export type CustomerFilterKey = (typeof CUSTOMER_FILTERS)[number]["key"]

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilterKey[] = ["search"]

/**
 * Cột ô tìm khách hỏi máy chủ (kèm `tim_kd` bỏ dấu). Chủ nhà 26/09/2026: "thêm cả địa chỉ" —
 * `tim_kd` cũng có địa chỉ / phường / quận / tỉnh từ mig 203.
 */
export const COT_TIM_KHACH = ["store_name", "owner_name", "phone", "address", "ward", "district", "province"]
