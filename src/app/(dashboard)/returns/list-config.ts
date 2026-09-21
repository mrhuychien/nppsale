import type { ListViewOption } from "@/components/ui/list-view-toolbar"

export const RETURN_COLUMNS = [
  { key: "date", label: "Ngày" },
  { key: "orderCode", label: "Đơn gốc" },
  /**
   * ⚠ HÓA ĐƠN GỐC LÀ MỐC ĐỐI CHIẾU THẬT của khoản trừ (chủ nhà chốt
   * 21/09/2026). Trần số được phép trả lại đếm theo HÓA ĐƠN, không theo
   * đơn — mà một đơn giao nhiều đợt thì có nhiều hóa đơn. Chỉ có cột
   * "Đơn gốc" là người đối chiếu công nợ phải tự đoán đợt nào.
   */
  { key: "invoiceCode", label: "Hóa đơn gốc" },
  { key: "reason", label: "Lý do" },
  { key: "requester", label: "Người tạo" },
  { key: "creditNote", label: "Credit Note" },
  { key: "status", label: "Trạng thái" },
] as const satisfies readonly ListViewOption<string>[]

export type ReturnColumnKey = (typeof RETURN_COLUMNS)[number]["key"]

export const DEFAULT_RETURN_COLUMNS: ReturnColumnKey[] = [
  "date",
  "orderCode",
  "invoiceCode",
  "reason",
  "requester",
  "creditNote",
  "status",
]

export const RETURN_FILTERS = [
  { key: "search", label: "Tìm kiếm", required: true },
  { key: "reason", label: "Lọc theo lý do" },
] as const satisfies readonly ListViewOption<string>[]

export type ReturnFilterKey = (typeof RETURN_FILTERS)[number]["key"]

export const DEFAULT_RETURN_FILTERS: ReturnFilterKey[] = ["search", "reason"]
