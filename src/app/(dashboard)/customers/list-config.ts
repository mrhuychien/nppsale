import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const CUSTOMER_COLUMNS = [
  { key: "owner", label: "Chủ cửa hàng" },
  { key: "phone", label: "SĐT" },
  /* Chủ nhà 26/09/2026: "cột hiển thị thêm địa chỉ, phường". */
  { key: "address", label: "Địa chỉ" },
  { key: "ward", label: "Phường/xã" },
  { key: "channel", label: "Tuyến/Kênh" },
  { key: "managers", label: "Phụ trách" },
  /* Chủ nhà 27/09/2026: bỏ hai cột "Đơn gần nhất" / "Lần ghé gần nhất" (đọc chậm). */
  { key: "debt", label: "Công nợ" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type CustomerColumnKey = (typeof CUSTOMER_COLUMNS)[number]["key"]

export const DEFAULT_CUSTOMER_COLUMNS: CustomerColumnKey[] = [
  "owner",
  "phone",
  "address",
  "ward",
  "channel",
  "managers",
  "debt",
  "status",
]

/**
 * ⚠ TUYẾN · PHƯỜNG · PHỤ TRÁCH LUÔN HIỆN, không bật / tắt (chủ nhà 04/10/2026: "Sao danh sách khách hàng mất 1 số
 *   bộ lọc tuyến, phường, Phụ trách rồi"). Bản cũ để chúng là bộ lọc TUỲ CHỌN, mặc định chỉ có ô tìm — lựa chọn đã
 *   lưu trên máy mất là ba ô biến mất. Nay vẽ thẳng trên màn (page.tsx), danh sách bật / tắt chỉ còn Trạng thái.
 *   ("Tuyến giao" cũ không có ô nào vẽ — đã bỏ.)
 */
export const CUSTOMER_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type CustomerFilterKey = (typeof CUSTOMER_FILTERS)[number]["key"]

export const DEFAULT_CUSTOMER_FILTERS: CustomerFilterKey[] = ["search"]

/**
 * Cột ô tìm khách hỏi máy chủ (kèm `tim_kd` bỏ dấu). Chủ nhà 26/09/2026: "thêm cả địa chỉ" —
 * `tim_kd` cũng có địa chỉ / phường / quận / tỉnh từ mig 203.
 */
export const COT_TIM_KHACH = ["store_name", "owner_name", "phone", "address", "ward", "district", "province"]
