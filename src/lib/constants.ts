export const ROLES = {
  OWNER: "owner",
  MANAGER: "manager",
  ACCOUNTANT: "accountant",
  SALES: "sales",
  WAREHOUSE: "warehouse",
  DRIVER: "driver",
} as const

export const ROLE_LABELS: Record<string, string> = {
  owner: "Chủ NPP",
  manager: "Quản lý bán hàng",
  accountant: "Kế toán",
  sales: "NV Bán hàng",
  warehouse: "NV Kho",
  driver: "Tài xế",
}

export const CHANNELS = [
  { value: "GT", label: "GT - Truyền thống" },
  { value: "MT", label: "MT - Hiện đại" },
  { value: "HORECA", label: "HORECA" },
] as const

export const PAYMENT_TERMS = [
  { value: "COD", label: "COD - Thanh toán khi giao" },
  { value: "NET7", label: "Công nợ 7 ngày" },
  { value: "NET15", label: "Công nợ 15 ngày" },
  { value: "NET30", label: "Công nợ 30 ngày" },
  { value: "NET45", label: "Công nợ 45 ngày" },
  { value: "NET60", label: "Công nợ 60 ngày" },
] as const

export const PAYMENT_METHODS = [
  { value: "cash", label: "Tiền mặt" },
  { value: "transfer", label: "Chuyển khoản" },
  { value: "ewallet", label: "Ví điện tử" },
] as const

export const ORDER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  confirmed: { label: "Đã duyệt", variant: "default" },
  picking: { label: "Đang lấy hàng", variant: "warning" },
  delivering: { label: "Đang giao", variant: "warning" },
  delivered: { label: "Đã giao", variant: "success" },
  cancelled: { label: "Đã hủy", variant: "danger" },
}

export const CUSTOMER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  active: { label: "Hoạt động", variant: "success" },
  suspended: { label: "Tạm ngưng", variant: "warning" },
  locked: { label: "Khóa", variant: "danger" },
}

export const DELIVERY_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  pending: { label: "Chờ giao", variant: "secondary" },
  in_transit: { label: "Đang giao", variant: "warning" },
  delivered: { label: "Đã giao", variant: "success" },
  partial: { label: "Giao 1 phần", variant: "warning" },
  failed: { label: "Thất bại", variant: "danger" },
}

export const PO_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  confirmed: { label: "Đã duyệt", variant: "default" },
  received: { label: "Đã nhập kho", variant: "success" },
  partial: { label: "Nhập 1 phần", variant: "warning" },
  cancelled: { label: "Đã hủy", variant: "danger" },
}

export const PURCHASE_INVOICE_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nháp", variant: "secondary" },
  completed: { label: "Hoàn thành", variant: "success" },
  cancelled: { label: "Đã huỷ", variant: "danger" },
  // legacy (trước mig 065) — vẫn map để không vỡ dữ liệu cũ
  confirmed: { label: "Hoàn thành", variant: "success" },
  paid: { label: "Hoàn thành", variant: "success" },
}

/**
 * Trạng thái thanh toán suy ra từ receivables.status. Hiển thị bên cạnh
 * trạng thái fulfillment để biết đơn đã thu tiền hay chưa.
 */
export const PAYMENT_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  open: { label: "Đơn nợ", variant: "danger" },
  partial: { label: "Trả 1 phần", variant: "warning" },
  paid: { label: "Đã trả tiền", variant: "success" },
  overdue: { label: "Quá hạn", variant: "destructive" },
}

export const RETURN_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  // Workflow duyệt đã bỏ — phiếu trả là bản ghi tra cứu (xử lý nhập
  // kho + trừ công nợ đã làm ngay ở bước Bàn giao lại). Các trạng
  // thái legacy map về nhãn trung tính.
  pending: { label: "Đã ghi nhận", variant: "secondary" },
  approved: { label: "Đã ghi nhận", variant: "success" },
  rejected: { label: "Đã huỷ", variant: "danger" },
  completed: { label: "Đã ghi nhận", variant: "success" },
}

export const RETURN_REASONS = [
  { value: "damaged", label: "Hàng hư hỏng" },
  { value: "wrong_item", label: "Sai hàng" },
  { value: "near_expiry", label: "Gần hết hạn" },
  { value: "expired", label: "Hết hạn sử dụng" },
  { value: "refused", label: "Khách từ chối nhận" },
] as const

export const PROMOTION_TYPES = [
  { value: "trade_discount", label: "Chiết khấu thương mại" },
  { value: "buy_x_get_y", label: "Mua X tặng Y" },
  { value: "payment_discount", label: "Chiết khấu thanh toán" },
  { value: "cumulative", label: "Lũy kế" },
  { value: "display", label: "Trưng bày" },
] as const

export const COMMISSION_TYPES = [
  { value: "percentage", label: "Phần trăm (%)" },
  { value: "fixed", label: "Cố định" },
  { value: "tiered", label: "Bậc lũy kế" },
] as const

export const STOCK_ENTRY_TYPES = [
  { value: "import", label: "Nhập kho" },
  { value: "export", label: "Xuất kho" },
  { value: "transfer", label: "Chuyển kho" },
  { value: "stocktake", label: "Kiểm kê" },
] as const

export const APPROVAL_THRESHOLDS = {
  AUTO_APPROVE: 20_000_000,
  MANAGER_APPROVE: 50_000_000,
} as const
