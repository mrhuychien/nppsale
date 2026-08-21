import type { SupabaseClient } from "@supabase/supabase-js"
import type { ExpenseBucket } from "@/types"

export interface FinancePeriod {
  from: string // YYYY-MM-DD
  to: string   // YYYY-MM-DD
}

export interface PnlData {
  revenue: number
  cogs: number
  grossProfit: number
  expensesByBucket: Record<ExpenseBucket, number>
  totalExpenses: number
  operatingProfit: number
  netProfit: number
  orderCount: number
}

/**
 * Profit & Loss for a date range. Revenue = sum of delivered sales orders.
 * COGS = sum of absolute export quantity × unit_cost from posted
 * stock_entry_lines of type 'export' (same period). Expenses pulled from
 * `expenses` table grouped by category bucket.
 */
export async function fetchPnl(
  supabase: SupabaseClient,
  orgId: string,
  period: FinancePeriod
): Promise<PnlData> {
  // Cộng ở PHÍA DATABASE (migration 093). Trước đây hàm này tải cả bảng đơn
  // hàng, dòng xuất kho và chi phí về trình duyệt rồi cộng bằng JavaScript —
  // vừa chậm, vừa từng cho ra số THIẾU vì `db.max_rows` cắt bớt dòng.
  //
  // orgId không còn dùng để lọc: hàm SQL tự lọc theo `public.user_org_id()`.
  // Giữ tham số để không phải sửa mọi nơi gọi, và vì nó vẫn đúng ngữ nghĩa.
  void orgId
  const { data, error } = await supabase
    .rpc("finance_pnl", { p_from: period.from, p_to: period.to })
    .maybeSingle()
  if (error) console.error("[lib/finance] finance_pnl lỗi:", error.message)

  const r = (data || {}) as Partial<Record<string, number>>
  const num = (k: string) => Number(r[k] ?? 0)

  const revenue = num("revenue")
  const cogs = num("cogs")
  const orderCount = num("order_count")

  const expensesByBucket: Record<ExpenseBucket, number> = {
    cogs: num("exp_cogs"),
    operating: num("exp_operating"),
    hr: num("exp_hr"),
    financial: num("exp_financial"),
    tax: num("exp_tax"),
    other: num("exp_other"),
  }
  const totalExpenses = num("total_expenses")

  const grossProfit = revenue - cogs
  // Operating profit deducts operating + hr; other expenses roll into net profit
  const operatingExpenses = expensesByBucket.operating + expensesByBucket.hr
  const operatingProfit = grossProfit - operatingExpenses
  // Note: COGS-bucket expenses (stocktake shrinkage) are already included as
  // separate adjustments — adding them again would double-count. We keep them
  // visible in the breakdown but exclude from the net formula.
  const netProfit =
    operatingProfit -
    expensesByBucket.financial -
    expensesByBucket.tax -
    expensesByBucket.other

  return {
    revenue,
    cogs,
    grossProfit,
    expensesByBucket,
    totalExpenses,
    operatingProfit,
    netProfit,
    orderCount,
  }
}

export interface BalanceSheetData {
  asOf: string
  assets: {
    cash: number
    accountsReceivable: number
    inventory: number
    total: number
  }
  liabilities: {
    accountsPayable: number
    unpaidExpenses: number
    total: number
  }
  equity: {
    retainedEarnings: number
    total: number
  }
}

/**
 * Balance sheet as of a date. Very simplified — we model:
 *  - Cash = sum of received payments up to date − paid expenses − paid payables
 *  - AR   = open receivables amount - paid
 *  - Inventory = Σ batches.qty_on_hand × batches.unit_cost
 *  - AP   = open payables amount - paid
 *  - Unpaid expenses = sum of expenses not marked paid
 *  - Equity = assets - liabilities (plug)
 */
export async function fetchBalanceSheet(
  supabase: SupabaseClient,
  orgId: string,
  asOf: string
): Promise<BalanceSheetData> {
  // Cộng ở phía database (migration 093) — xem ghi chú ở fetchPnl.
  void orgId
  const { data, error } = await supabase
    .rpc("finance_balance_sheet", { p_as_of: asOf })
    .maybeSingle()
  if (error) console.error("[lib/finance] finance_balance_sheet lỗi:", error.message)

  const r = (data || {}) as Partial<Record<string, number>>
  const cash = Number(r.cash ?? 0)
  const accountsReceivable = Number(r.accounts_receivable ?? 0)
  const inventory = Number(r.inventory ?? 0)
  const accountsPayable = Number(r.accounts_payable ?? 0)
  const unpaidExpenses = Number(r.unpaid_expenses ?? 0)

  const assetsTotal = cash + accountsReceivable + inventory
  const liabilitiesTotal = accountsPayable + unpaidExpenses
  const retainedEarnings = assetsTotal - liabilitiesTotal

  return {
    asOf,
    assets: { cash, accountsReceivable, inventory, total: assetsTotal },
    liabilities: { accountsPayable, unpaidExpenses, total: liabilitiesTotal },
    equity: { retainedEarnings, total: retainedEarnings },
  }
}

export interface CashFlowData {
  period: FinancePeriod
  operating: {
    cashFromCustomers: number
    cashToSuppliers: number
    cashToExpenses: number
    net: number
  }
  investing: {
    net: number
  }
  financing: {
    net: number
  }
  netChange: number
}

/**
 * Cash flow (operating-only, simplified).
 * Cash in from customers = payments recorded in period.
 * Cash out to suppliers = payable_payments in period.
 * Cash out to expenses = paid expenses in period.
 * Investing and financing are zero unless more modules are added.
 */
export async function fetchCashFlow(
  supabase: SupabaseClient,
  orgId: string,
  period: FinancePeriod
): Promise<CashFlowData> {
  // Cộng ở phía database (migration 093) — xem ghi chú ở fetchPnl.
  void orgId
  const { data, error } = await supabase
    .rpc("finance_cash_flow", { p_from: period.from, p_to: period.to })
    .maybeSingle()
  if (error) console.error("[lib/finance] finance_cash_flow lỗi:", error.message)

  const r = (data || {}) as Partial<Record<string, number>>
  const cashFromCustomers = Number(r.cash_from_customers ?? 0)
  const cashToSuppliers = Number(r.cash_to_suppliers ?? 0)
  const cashToExpenses = Number(r.cash_to_expenses ?? 0)

  const operatingNet = cashFromCustomers - cashToSuppliers - cashToExpenses

  return {
    period,
    operating: {
      cashFromCustomers,
      cashToSuppliers,
      cashToExpenses,
      net: operatingNet,
    },
    investing: { net: 0 },
    financing: { net: 0 },
    netChange: operatingNet,
  }
}
