import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
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
  const ordersRes = await fetchAllForAggregate<{ total: number }>((from, to) =>
    supabase
      .from("sales_orders")
      .select("total, order_date, status, org_id", { count: "exact" })
      .eq("org_id", orgId)
      .eq("status", "delivered")
      .gte("order_date", period.from)
      .lte("order_date", period.to)
      .range(from, to)
  )
  if (ordersRes.error) console.error("[lib/finance] truy vấn lỗi:", ordersRes.error)
  const revenue = ordersRes.rows.reduce((s, o) => s + Number(o.total || 0), 0)
  const orderCount = ordersRes.rows.length

  // COGS: export lines posted within the period
  const exportRes = await fetchAllForAggregate<{ id: string }>((from, to) =>
    supabase
      .from("stock_entries")
      .select("id, type, status, posted_at", { count: "exact" })
      .eq("org_id", orgId)
      .eq("type", "export")
      .eq("status", "posted")
      .gte("posted_at", fromIso)
      .lte("posted_at", toIso)
      .range(from, to)
  )
  if (exportRes.error) console.error("[lib/finance] truy vấn lỗi:", exportRes.error)
  const exportIds = exportRes.rows.map((e) => e.id)

  let cogs = 0
  if (exportIds.length > 0) {
    const linesRes = await fetchAllForAggregate<{ quantity: number; unit_cost: number }>(
      (from, to) =>
        supabase
          .from("stock_entry_lines")
          .select("quantity, unit_cost, entry_id", { count: "exact" })
          .in("entry_id", exportIds)
          .range(from, to)
    )
    if (linesRes.error) console.error("[lib/finance] truy vấn lỗi:", linesRes.error)
    for (const l of linesRes.rows) {
      cogs += Math.abs(Number(l.quantity)) * Number(l.unit_cost || 0)
    }
  }

  // Expenses grouped by bucket
  const expenseRes = await fetchAllForAggregate((from, to) =>
    supabase
      .from("expenses")
      .select("amount, category:expense_categories(bucket)", { count: "exact" })
      .eq("org_id", orgId)
      .gte("expense_date", period.from)
      .lte("expense_date", period.to)
      .range(from, to)
  )
  if (expenseRes.error) console.error("[lib/finance] truy vấn lỗi:", expenseRes.error)

  const expensesByBucket: Record<ExpenseBucket, number> = {
    cogs: 0, operating: 0, hr: 0, financial: 0, tax: 0, other: 0,
  }
  let totalExpenses = 0
  type ExpRow = { amount: number; category?: { bucket?: ExpenseBucket } | null }
  for (const e of (expenseRes.rows as unknown as ExpRow[]) || []) {
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
    // Toàn bộ số trên bảng cân đối đều là TỔNG. Server chỉ trả 1.000 dòng
    // mỗi request nên phải lấy đủ qua nhiều trang, nếu không thì cân đối
    // kế toán sai mà vẫn "cân".
    fetchAllForAggregate<{ amount: number }>((from, to) =>
      supabase
        .from("payments")
        .select("amount, collected_at, receivable:receivables!inner(org_id)", { count: "exact" })
        .eq("receivable.org_id", orgId)
        .lte("collected_at", asOfIso)
        .range(from, to)
    ),
    fetchAllForAggregate<{ amount: number; paid: number }>((from, to) =>
      supabase
        .from("receivables")
        .select("amount, paid", { count: "exact" })
        .eq("org_id", orgId)
        .neq("status", "paid")
        .range(from, to)
    ),
    fetchAllForAggregate<{ qty_on_hand: number; unit_cost: number }>((from, to) =>
      supabase
        .from("batches")
        .select("qty_on_hand, unit_cost", { count: "exact" })
        .eq("org_id", orgId)
        .gt("qty_on_hand", 0)
        .range(from, to)
    ),
    fetchAllForAggregate<{ amount: number; paid: number }>((from, to) =>
      supabase
        .from("payables")
        .select("amount, paid", { count: "exact" })
        .eq("org_id", orgId)
        .neq("status", "paid")
        .range(from, to)
    ),
    fetchAllForAggregate<{ amount: number }>((from, to) =>
      supabase
        .from("payable_payments")
        .select("amount, paid_at, payable:payables!inner(org_id)", { count: "exact" })
        .eq("payable.org_id", orgId)
        .lte("paid_at", asOfIso)
        .range(from, to)
    ),
    fetchAllForAggregate<{ amount: number; is_paid: boolean }>((from, to) =>
      supabase
        .from("expenses")
        .select("amount, is_paid, paid_at, expense_date", { count: "exact" })
        .eq("org_id", orgId)
        .lte("expense_date", asOf)
        .range(from, to)
    ),
  ])
  const qErr2 = [
    paymentsRes.error, receivablesRes.error, batchesRes.error,
    payablesRes.error, payablePaymentsRes.error, expensesRes.error,
  ].find(Boolean)
  if (qErr2) console.error("[lib/finance] truy vấn lỗi:", qErr2)

  const cashIn = paymentsRes.rows.reduce((s, p) => s + Number(p.amount || 0), 0)
  const paidPayables = payablePaymentsRes.rows.reduce((s, p) => s + Number(p.amount || 0), 0)
  const paidExpenses = expensesRes.rows
    .filter((e) => e.is_paid)
    .reduce((s, e) => s + Number(e.amount || 0), 0)
  const cash = cashIn - paidPayables - paidExpenses

  const accountsReceivable = receivablesRes.rows
    .reduce((s, r) => s + Math.max(0, Number(r.amount) - Number(r.paid)), 0)

  const inventory = batchesRes.rows
    .reduce((s, b) => s + Number(b.qty_on_hand || 0) * Number(b.unit_cost || 0), 0)

  const accountsPayable = payablesRes.rows
    .reduce((s, p) => s + Math.max(0, Number(p.amount) - Number(p.paid)), 0)

  const unpaidExpenses = expensesRes.rows
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
    fetchAllForAggregate<{ amount: number }>((from, to) =>
      supabase
        .from("payments")
        .select("amount, collected_at, receivable:receivables!inner(org_id)", { count: "exact" })
        .eq("receivable.org_id", orgId)
        .gte("collected_at", fromIso)
        .lte("collected_at", toIso)
        .range(from, to)
    ),
    fetchAllForAggregate<{ amount: number }>((from, to) =>
      supabase
        .from("payable_payments")
        .select("amount, paid_at, payable:payables!inner(org_id)", { count: "exact" })
        .eq("payable.org_id", orgId)
        .gte("paid_at", fromIso)
        .lte("paid_at", toIso)
        .range(from, to)
    ),
    fetchAllForAggregate<{ amount: number }>((from, to) =>
      supabase
        .from("expenses")
        .select("amount, paid_at, is_paid", { count: "exact" })
        .eq("org_id", orgId)
        .eq("is_paid", true)
        .gte("paid_at", fromIso)
        .lte("paid_at", toIso)
        .range(from, to)
    ),
  ])
  const qErr = [paymentsRes.error, payablePaymentsRes.error, expensesRes.error].find(Boolean)
  if (qErr) console.error("[lib/finance] truy vấn lỗi:", qErr)

  const cashFromCustomers = paymentsRes.rows.reduce((s, p) => s + Number(p.amount || 0), 0)
  const cashToSuppliers = payablePaymentsRes.rows.reduce((s, p) => s + Number(p.amount || 0), 0)
  const cashToExpenses = expensesRes.rows.reduce((s, e) => s + Number(e.amount || 0), 0)

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
