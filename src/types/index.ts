export type Role = "owner" | "manager" | "accountant" | "sales" | "warehouse" | "driver"
export type Channel = "GT" | "MT" | "HORECA"
export type CustomerStatus = "active" | "suspended" | "locked"
export type OrderStatus = "draft" | "confirmed" | "picking" | "delivering" | "delivered" | "cancelled"
export type StockEntryType = "import" | "export" | "transfer" | "stocktake"
export type PaymentMethod = "cash" | "transfer" | "ewallet"
export type ReceivableStatus = "open" | "partial" | "paid" | "overdue"
export type DeliveryStatus = "pending" | "in_transit" | "completed" | "cancelled"
export type DeliveryLineStatus = "pending" | "delivered" | "partial" | "failed"
export type PromotionType = "trade_discount" | "buy_x_get_y" | "payment_discount" | "cumulative" | "display"
export type InvoiceStatus = "draft" | "issued" | "cancelled"
export type MisaStatus = "pending" | "sent" | "signed" | "error"
export type ReturnReason = "damaged" | "wrong_item" | "near_expiry" | "expired" | "refused"
export type ReturnStatus = "pending" | "approved" | "rejected" | "completed"
export type CommissionType = "percentage" | "fixed" | "tiered"
export type AssignmentRole = "primary" | "secondary"
export type AttendanceStatus = "present" | "absent" | "half_day" | "leave" | "holiday"
export type PayrollStatus = "draft" | "confirmed" | "paid"

export interface Organization {
  id: string
  name: string
  slug: string
  settings: Record<string, unknown>
  created_at: string
}

export interface User {
  id: string
  org_id: string
  full_name: string
  role: Role
  phone: string | null
  is_active: boolean
  created_at: string
}

export interface CustomerGroup {
  id: string
  org_id: string
  name: string
  description: string | null
  created_at: string
}

export interface Customer {
  id: string
  org_id: string
  store_name: string
  owner_name: string
  phone: string
  address: string
  province: string | null
  district: string | null
  ward: string | null
  channel: Channel | null
  group_id: string | null
  credit_limit: number
  payment_terms: string
  status: CustomerStatus
  gps_lat: number | null
  gps_lng: number | null
  created_at: string
  // Billing fields for VAT invoice
  billing_name: string | null
  tax_code: string | null
  billing_address: string | null
  billing_email: string | null
  payment_method_label: string | null
  // Joined
  group?: CustomerGroup
  assignments?: CustomerAssignment[]
}

export interface CustomerAssignment {
  id: string
  customer_id: string
  user_id: string
  role: AssignmentRole
  assigned_at: string
  status: string
  // Joined
  user?: User
}

export interface Product {
  id: string
  org_id: string
  sku: string
  name: string
  category: string | null
  brand: string | null
  barcode: string | null
  base_unit: string
  vat_rate: number
  shelf_life_days: number | null
  status: string
  created_at: string
  // Joined
  units?: ProductUnit[]
  price_lists?: PriceList[]
}

export interface ProductUnit {
  id: string
  product_id: string
  unit_name: string
  conversion: number
}

export interface PriceList {
  id: string
  product_id: string
  group_id: string | null
  unit_name: string
  price: number
  effective_from: string | null
  effective_to: string | null
  // Joined
  group?: CustomerGroup
}

export interface Batch {
  id: string
  org_id: string
  product_id: string
  batch_code: string
  manufactured_at: string | null
  expires_at: string
  location: string | null
  qty_initial: number
  qty_on_hand: number
  status: string
  created_at: string
  // Joined
  product?: Product
}

export interface StockEntry {
  id: string
  org_id: string
  entry_code: string
  type: StockEntryType
  supplier_id: string | null
  created_by: string | null
  notes: string | null
  created_at: string
  // Joined
  lines?: StockEntryLine[]
  creator?: User
  supplier?: Supplier
}

export interface StockEntryLine {
  id: string
  entry_id: string
  product_id: string
  batch_id: string | null
  unit_name: string
  quantity: number
  notes: string | null
  // Joined
  product?: Product
  batch?: Batch
}

export interface SalesOrder {
  id: string
  org_id: string
  order_code: string
  customer_id: string
  sales_user_id: string
  order_date: string
  expected_delivery: string | null
  status: OrderStatus
  payment_terms: string | null
  subtotal: number
  discount: number
  vat: number
  total: number
  merged_into: string | null
  notes: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  // Joined
  customer?: Customer
  sales_user?: User
  lines?: SalesOrderLine[]
  approver?: User
}

export interface SalesOrderLine {
  id: string
  order_id: string
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
  batch_id: string | null
  // Joined
  product?: Product
}

export interface MergedOrder {
  id: string
  merged_order_id: string
  source_order_id: string
  created_at: string
}

export interface CommissionPolicy {
  id: string
  org_id: string
  name: string
  type: CommissionType
  tiers: Record<string, unknown>[] | null
  applies_to: string
  effective_from: string | null
  effective_to: string | null
  is_active: boolean
  created_at: string
}

export interface CommissionWallet {
  id: string
  user_id: string
  period: string
  earned: number
  paid: number
  balance: number
  // Joined
  user?: User
}

export interface Receivable {
  id: string
  org_id: string
  order_id: string | null
  customer_id: string
  sales_user_id: string | null
  amount: number
  paid: number
  due_date: string | null
  status: ReceivableStatus
  created_at: string
  // Joined
  customer?: Customer
  sales_user?: User
  order?: SalesOrder
  payments?: Payment[]
}

export interface Payment {
  id: string
  receivable_id: string
  collected_by: string
  amount: number
  method: PaymentMethod
  collected_at: string
  verified_by: string | null
  verified_at: string | null
  // Joined
  collector?: User
  verifier?: User
}

export interface Delivery {
  id: string
  org_id: string
  driver_id: string | null
  vehicle: string | null
  route_name: string | null
  status: DeliveryStatus
  warehouse_confirmed_by: string | null
  warehouse_confirmed_at: string | null
  driver_confirmed_by: string | null
  driver_confirmed_at: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  // Joined
  driver?: User
  lines?: DeliveryLine[]
  warehouse_confirmer?: User
  driver_confirmer?: User
}

export type DeliveryPaymentMethod = "cod_cash" | "cod_transfer" | "credit" | "partial"

export interface DeliveryLine {
  id: string
  delivery_id: string
  order_id: string
  status: DeliveryLineStatus
  pod_photo_url: string | null
  pod_signature: string | null
  delivered_at: string | null
  notes: string | null
  payment_method: DeliveryPaymentMethod | null
  amount_collected: number | null
  // Joined
  order?: SalesOrder
}

export interface OrderStatusHistory {
  id: string
  order_id: string
  from_status: string | null
  to_status: string
  changed_by: string
  changed_at: string
  // Joined
  changer?: User
}

export interface Promotion {
  id: string
  org_id: string
  name: string
  type: PromotionType
  rules: Record<string, unknown>
  priority: number
  target_groups: string[] | null
  starts_at: string | null
  ends_at: string | null
  is_active: boolean
  created_at: string
}

export interface Invoice {
  id: string
  org_id: string
  order_id: string | null
  invoice_number: string | null
  customer_name: string
  customer_address: string | null
  customer_tax_code: string | null
  subtotal: number
  vat: number
  total: number
  status: InvoiceStatus
  issued_at: string | null
  created_at: string
  // MISA meInvoice integration
  misa_invoice_id: string | null
  misa_invoice_url: string | null
  misa_status: MisaStatus | null
  misa_error: string | null
  misa_sent_at: string | null
  misa_signed_at: string | null
  // Joined
  order?: SalesOrder
}

export interface Supplier {
  id: string
  org_id: string
  name: string
  code: string
  category: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_code: string | null
  bank_account: string | null
  bank_name: string | null
  payment_terms: string
  rating: number
  notes: string | null
  is_verified: boolean
  is_active: boolean
  created_at: string
}

export interface Return {
  id: string
  org_id: string
  order_id: string | null
  customer_id: string
  requested_by: string
  reason: ReturnReason | null
  status: ReturnStatus
  approved_by: string | null
  credit_note_amount: number | null
  photo_url: string | null
  notes: string | null
  created_at: string
  // Joined
  customer?: Customer
  requester?: User
  approver?: User
  lines?: ReturnLine[]
  order?: SalesOrder
}

export interface ReturnLine {
  id: string
  return_id: string
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_total: number
  // Joined
  product?: Product
}

// Supplier Payables
export type PayableStatus = "open" | "partial" | "paid" | "overdue"
export type PayablePaymentMethod = "cash" | "transfer" | "offset"

export interface Payable {
  id: string
  org_id: string
  supplier_id: string
  stock_entry_id: string | null
  invoice_number: string | null
  amount: number
  paid: number
  due_date: string | null
  status: PayableStatus
  notes: string | null
  created_at: string
  // Joined
  supplier?: Supplier
  stock_entry?: StockEntry
}

export interface PayablePayment {
  id: string
  payable_id: string
  amount: number
  method: PayablePaymentMethod
  paid_by: string
  paid_at: string
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  // Joined
  payer?: User
  verifier?: User
}

// HR Module
export interface HrSalaryConfig {
  id: string
  org_id: string
  name: string
  base_salary: number
  gas_allowance: number
  phone_allowance: number
  working_days_per_month: number
  target_tiers: { min_percent: number; bonus: number; label: string }[]
  over_target_percent: number
  under_70_rule: string
  under_60_percent: number
  is_active: boolean
  created_at: string
}

export interface HrMonthlyBonus {
  id: string
  org_id: string
  period: string
  tiers: { min_revenue: number; bonus: number }[]
  notes: string | null
  created_at: string
}

export interface HrAttendance {
  id: string
  org_id: string
  user_id: string
  work_date: string
  status: AttendanceStatus
  check_in: string | null
  check_out: string | null
  notes: string | null
  created_at: string
}

export interface HrPayroll {
  id: string
  org_id: string
  user_id: string
  period: string
  working_days: number
  absent_days: number
  total_revenue: number
  target_amount: number
  target_percent: number
  base_salary: number
  gas_allowance: number
  phone_allowance: number
  target_bonus: number
  over_target_bonus: number
  monthly_revenue_bonus: number
  deductions: number
  total_salary: number
  breakdown: Record<string, unknown>
  status: PayrollStatus
  confirmed_by: string | null
  confirmed_at: string | null
  paid_at: string | null
  notes: string | null
  created_at: string
  // Joined
  user?: User
}
