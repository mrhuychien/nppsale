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
  const fromIso = `${period.from}T00:00:00Z`
  const toIso = `${period.to}T23:59:59Z`

  // Revenue: delivered orders within the period
  const { data: orders } = await supabase
    .from("sales_orders")
    .select("total, order_date, status, org_id")
    .eq("org_id", orgId)
    .eq("status", "delivered")
    .gte("order_date", period.from)
    .lte("order_date", period.to)
  const revenue = ((orders as Array<{ total: number }>) || []).reduce(
    (s, o) => s + Number(o.total || 0), 0
  )
  const orderCount = orders?.length ?? 0

  // COGS: export lines posted within the period
  const { data: exportEntries } = await supabase
    .from("stock_entries")
    .select("id, type, status, posted_at")
    .eq("org_id", orgId)
    .eq("type", "export")
    .eq("status", "posted")
    .gte("posted_at", fromIso)
    .lte("posted_at", toIso)
  const exportIds = ((exportEntries as Array<{ id: string }>) || []).map((e) => e.id)

  let cogs = 0
  if (exportIds.length > 0) {
    const { data: lines } = await supabase
      .from("stock_entry_lines")
      .select("quantity, unit_cost, entry_id")
      .in("entry_id", exportIds)
    for (const l of (lines as Array<{ quantity: number; unit_cost: number }>) || []) {
      cogs += Math.abs(Number(l.quantity)) * Number(l.unit_cost || 0)
    }
  }

  // Expenses grouped by bucket
  const { data: expenseRows } = await supabase
    .from("expenses")
    .select("amount, category:expense_categories(bucket)")
    .eq("org_id", orgId)
    .gte("expense_date", period.from)
    .lte("expense_date", period.to)

  const expensesByBucket: Record<ExpenseBucket, number> = {
    cogs: 0, operating: 0, hr: 0, financial: 0, tax: 0, other: 0,
  }
  let totalExpenses = 0
  type ExpRow = { amount: number; category?: { bucket?: ExpenseBucket } | null }
  for (const e of ((expenseRows as unknown) as ExpRow[]) || []) {
    const bucket = (e.category?.bucket || "other") as ExpenseBucket
    const amt = Number(e.amount || 0)
    expensesByBucket[bucket] = (expensesByBucket[bucket] || 0) + amt
    totalExpenses += amt
  }

  const grossProfit = revenue - cogs
  // Operating profit deducts operating + hr; other expenses roll into net profit
  const operatingExpenses =
    (expensesByBucket.operating || 0) + (expensesByBucket.hr || 0)
  const operatingProfit = grossProfit - operatingExpenses
  const financialExpenses = expensesByBucket.financial || 0
  const taxExpenses = expensesByBucket.tax || 0
  const otherExpenses = expensesByBucket.other || 0
  // Note: COGS-bucket expenses (stocktake shrinkage) are already included as
  // separate adjustments — adding them again would double-count. We keep them
  // visible in the breakdown but exclude from the net formula.
  const netProfit = operatingProfit - financialExpenses - taxExpenses - otherExpenses

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
  const asOfIso = `${asOf}T23:59:59Z`

  const [
    paymentsRes,
    receivablesRes,
    batchesRes,
    payablesRes,
    payablePaymentsRes,
    expensesRes,
  ] = await Promise.all([
    supabase
      .from("payments")
      .select("amount, collected_at, receivable:receivables!inner(org_id)")
      .eq("receivable.org_id", orgId)
      .lte("collected_at", asOfIso),
    supabase
      .from("receivables")
      .select("amount, paid")
      .eq("org_id", orgId)
      .neq("status", "paid"),
    supabase
      .from("batches")
      .select("qty_on_hand, unit_cost")
      .eq("org_id", orgId)
      .gt("qty_on_hand", 0),
    supabase
      .from("payables")
      .select("amount, paid")
      .eq("org_id", orgId)
      .neq("status", "paid"),
    supabase
      .from("payable_payments")
      .select("amount, paid_at, payable:payables!inner(org_id)")
      .eq("payable.org_id", orgId)
      .lte("paid_at", asOfIso),
    supabase
      .from("expenses")
      .select("amount, is_paid, paid_at, expense_date")
      .eq("org_id", orgId)
      .lte("expense_date", asOf),
  ])

  const cashIn = ((paymentsRes.data as Array<{ amount: number }>) || [])
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const paidPayables = ((payablePaymentsRes.data as Array<{ amount: number }>) || [])
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const paidExpenses = ((expensesRes.data as Array<{ amount: number; is_paid: boolean }>) || [])
    .filter((e) => e.is_paid)
    .reduce((s, e) => s + Number(e.amount || 0), 0)
  const cash = cashIn - paidPayables - paidExpenses

  const accountsReceivable = ((receivablesRes.data as Array<{ amount: number; paid: number }>) || [])
    .reduce((s, r) => s + Math.max(0, Number(r.amount) - Number(r.paid)), 0)

  const inventory = ((batchesRes.data as Array<{ qty_on_hand: number; unit_cost: number }>) || [])
    .reduce((s, b) => s + Number(b.qty_on_hand || 0) * Number(b.unit_cost || 0), 0)

  const accountsPayable = ((payablesRes.data as Array<{ amount: number; paid: number }>) || [])
    .reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.paid)), 0)

  const unpaidExpenses = ((expensesRes.data as Array<{ amount: number; is_paid: boolean }>) || [])
    .filter((e) => !e.is_paid)
    .reduce((s, e) => s + Number(e.amount || 0), 0)

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
  const fromIso = `${period.from}T00:00:00Z`
  const toIso = `${period.to}T23:59:59Z`

  const [paymentsRes, payablePaymentsRes, expensesRes] = await Promise.all([
    supabase
      .from("payments")
      .select("amount, collected_at, receivable:receivables!inner(org_id)")
      .eq("receivable.org_id", orgId)
      .gte("collected_at", fromIso)
      .lte("collected_at", toIso),
    supabase
      .from("payable_payments")
      .select("amount, paid_at, payable:payables!inner(org_id)")
      .eq("payable.org_id", orgId)
      .gte("paid_at", fromIso)
      .lte("paid_at", toIso),
    supabase
      .from("expenses")
      .select("amount, paid_at, is_paid")
      .eq("org_id", orgId)
      .eq("is_paid", true)
      .gte("paid_at", fromIso)
      .lte("paid_at", toIso),
  ])

  const cashFromCustomers = ((paymentsRes.data as Array<{ amount: number }>) || [])
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const cashToSuppliers = ((payablePaymentsRes.data as Array<{ amount: number }>) || [])
    .reduce((s, p) => s + Number(p.amount || 0), 0)
  const cashToExpenses = ((expensesRes.data as Array<{ amount: number }>) || [])
    .reduce((s, e) => s + Number(e.amount || 0), 0)

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
