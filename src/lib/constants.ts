export const ROLES = {
  OWNER: "owner",
  MANAGER: "manager",
  ACCOUNTANT: "accountant",
  SALES: "sales",
  WAREHOUSE: "warehouse",
  DRIVER: "driver",
} as const

export const ROLE_LABELS: Record<string, string> = {
  owner: "Chu NPP",
  manager: "Quan ly ban hang",
  accountant: "Ke toan",
  sales: "NV ban hang",
  warehouse: "NV kho",
  driver: "Tai xe",
}

export const CHANNELS = [
  { value: "GT", label: "GT - Truyen thong" },
  { value: "MT", label: "MT - Hien dai" },
  { value: "HORECA", label: "HORECA" },
] as const

export const PAYMENT_TERMS = [
  { value: "COD", label: "COD - Thanh toan khi giao" },
  { value: "NET7", label: "Cong no 7 ngay" },
  { value: "NET15", label: "Cong no 15 ngay" },
  { value: "NET30", label: "Cong no 30 ngay" },
  { value: "NET45", label: "Cong no 45 ngay" },
  { value: "NET60", label: "Cong no 60 ngay" },
] as const

export const PAYMENT_METHODS = [
  { value: "cash", label: "Tien mat" },
  { value: "transfer", label: "Chuyen khoan" },
  { value: "ewallet", label: "Vi dien tu" },
] as const

export const ORDER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  draft: { label: "Nhap", variant: "secondary" },
  confirmed: { label: "Da duyet", variant: "default" },
  picking: { label: "Dang lay hang", variant: "warning" },
  delivering: { label: "Dang giao", variant: "warning" },
  delivered: { label: "Da giao", variant: "success" },
  cancelled: { label: "Da huy", variant: "danger" },
}

export const CUSTOMER_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  active: { label: "Hoat dong", variant: "success" },
  suspended: { label: "Tam ngung", variant: "warning" },
  locked: { label: "Khoa", variant: "danger" },
}

export const DELIVERY_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  pending: { label: "Cho giao", variant: "secondary" },
  in_transit: { label: "Dang giao", variant: "warning" },
  delivered: { label: "Da giao", variant: "success" },
  partial: { label: "Giao 1 phan", variant: "warning" },
  failed: { label: "That bai", variant: "danger" },
}

export const RETURN_STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "danger" }> = {
  pending: { label: "Cho duyet", variant: "secondary" },
  approved: { label: "Da duyet", variant: "success" },
  rejected: { label: "Tu choi", variant: "danger" },
  completed: { label: "Hoan tat", variant: "default" },
}

export const RETURN_REASONS = [
  { value: "damaged", label: "Hang hu hong" },
  { value: "wrong_item", label: "Sai hang" },
  { value: "near_expiry", label: "Gan het han" },
  { value: "expired", label: "Het han su dung" },
  { value: "refused", label: "Khach tu choi nhan" },
] as const

export const PROMOTION_TYPES = [
  { value: "trade_discount", label: "Chiet khau thuong mai" },
  { value: "buy_x_get_y", label: "Mua X tang Y" },
  { value: "payment_discount", label: "Chiet khau thanh toan" },
  { value: "cumulative", label: "Luy ke" },
  { value: "display", label: "Trung bay" },
] as const

export const COMMISSION_TYPES = [
  { value: "percentage", label: "Phan tram (%)" },
  { value: "fixed", label: "Co dinh" },
  { value: "tiered", label: "Bac luy ke" },
] as const

export const STOCK_ENTRY_TYPES = [
  { value: "import", label: "Nhap kho" },
  { value: "export", label: "Xuat kho" },
  { value: "transfer", label: "Chuyen kho" },
  { value: "stocktake", label: "Kiem ke" },
] as const

export const APPROVAL_THRESHOLDS = {
  AUTO_APPROVE: 20_000_000,
  MANAGER_APPROVE: 50_000_000,
} as const
