import type { SupabaseClient } from "@supabase/supabase-js"
import type { DateRange } from "./period"

export interface SalesAggregates {
  invoiceCount: number       // số hóa đơn (đơn đã giao)
  revenue: number            // doanh thu (subtotal-ish gross)
  returnsValue: number       // giá trị trả
  netRevenue: number         // doanh thu thuần = revenue - returnsValue
  cogs: number               // tổng giá vốn
  grossProfit: number        // lợi nhuận gộp
}

export interface SalesOrderRow {
  id: string
  order_code: string
  order_date: string
  status: string
  total: number
  subtotal: number
  discount: number
  vat: number
  customer_id: string
  sales_user_id: string
}

export interface SalesOrderLineRow {
  id: string
  order_id: string
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_total: number
}

export interface ReturnRow {
  id: string
  return_date?: string | null
  created_at: string
  total_value?: number | null
  total?: number | null
  status: string
}

export interface StockExportLineRow {
  entry_id: string
  product_id: string
  quantity: number
  unit_cost: number
  posted_at: string
}

/** Fetch delivered sales orders within a range (inclusive, by order_date). */
export async function fetchDeliveredOrders(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<SalesOrderRow[]> {
  const { data, error: dataErr } = await supabase
    .from("sales_orders")
    .select("id, order_code, order_date, status, total, subtotal, discount, vat, customer_id, sales_user_id")
    .eq("org_id", orgId)
    .eq("status", "delivered")
    .gte("order_date", range.from)
    .lte("order_date", range.to)
    .order("order_date", { ascending: false })
  if (dataErr) console.error("[analytics/sales] truy vấn lỗi:", dataErr.message)
  return (data as SalesOrderRow[]) || []
}

/** Fetch all sales orders within range regardless of status (for order analytics). */
export async function fetchAllOrders(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<SalesOrderRow[]> {
  const { data, error: dataErr } = await supabase
    .from("sales_orders")
    .select("id, order_code, order_date, status, total, subtotal, discount, vat, customer_id, sales_user_id")
    .eq("org_id", orgId)
    .gte("order_date", range.from)
    .lte("order_date", range.to)
    .order("order_date", { ascending: false })
  if (dataErr) console.error("[analytics/sales] truy vấn lỗi:", dataErr.message)
  return (data as SalesOrderRow[]) || []
}

/** Fetch order lines for the given order ids. */
export async function fetchOrderLines(
  supabase: SupabaseClient,
  orderIds: string[]
): Promise<SalesOrderLineRow[]> {
  if (orderIds.length === 0) return []
  const { data, error: dataErr } = await supabase
    .from("sales_order_lines")
    .select("id, order_id, product_id, unit_name, quantity, unit_price, line_total")
    .in("order_id", orderIds)
  if (dataErr) console.error("[analytics/sales] truy vấn lỗi:", dataErr.message)
  return (data as SalesOrderLineRow[]) || []
}

/** Sum of approved/completed returns within the range. */
export async function fetchReturnsValue(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<number> {
  const fromIso = `${range.from}T00:00:00Z`
  const toIso = `${range.to}T23:59:59Z`
  const { data, error: dataErr } = await supabase
    .from("returns")
    .select("id, status, created_at, credit_note_amount")
    .eq("org_id", orgId)
    .in("status", ["approved", "completed"])
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
  if (dataErr) console.error("[analytics/sales] truy vấn lỗi:", dataErr.message)
  let total = 0
  for (const r of (data as Array<{ credit_note_amount?: number | null }>) || []) {
    total += Math.abs(Number(r.credit_note_amount || 0))
  }
  return total
}

export interface ReturnSummaryRow {
  id: string
  status: string
  customer_id: string
  credit_note_amount: number
  created_at: string
}

export async function fetchReturnsRows(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<ReturnSummaryRow[]> {
  const fromIso = `${range.from}T00:00:00Z`
  const toIso = `${range.to}T23:59:59Z`
  const { data, error: dataErr } = await supabase
    .from("returns")
    .select("id, status, customer_id, credit_note_amount, created_at")
    .eq("org_id", orgId)
    .in("status", ["approved", "completed"])
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
  if (dataErr) console.error("[analytics/sales] truy vấn lỗi:", dataErr.message)
  return ((data as Array<{ id: string; status: string; customer_id: string; credit_note_amount: number | null; created_at: string }>) || []).map((r) => ({
    id: r.id,
    status: r.status,
    customer_id: r.customer_id,
    credit_note_amount: Number(r.credit_note_amount || 0),
    created_at: r.created_at,
  }))
}

/** Sum COGS from posted export stock entries within the range. */
export async function fetchCogsForRange(
  supabase: SupabaseClient,
  orgId: string,
  range: DateRange
): Promise<{ cogs: number; lines: StockExportLineRow[] }> {
  const fromIso = `${range.from}T00:00:00Z`
  const toIso = `${range.to}T23:59:59Z`

  const { data: entries, error: entriesErr } = await supabase
    .from("stock_entries")
    .select("id, type, status, posted_at")
    .eq("org_id", orgId)
    .eq("type", "export")
    .eq("status", "posted")
    .gte("posted_at", fromIso)
    .lte("posted_at", toIso)
  if (entriesErr) console.error("[analytics/sales] truy vấn lỗi:", entriesErr.message)
  const ids = ((entries as Array<{ id: string; posted_at: string }>) || []).map((e) => e.id)
  if (ids.length === 0) return { cogs: 0, lines: [] }

  const postedAtMap = new Map<string, string>()
  for (const e of (entries as Array<{ id: string; posted_at: string }>) || []) {
    postedAtMap.set(e.id, e.posted_at)
  }

  const { data: lines, error: linesErr } = await supabase
    .from("stock_entry_lines")
    .select("entry_id, product_id, quantity, unit_cost")
    .in("entry_id", ids)
  if (linesErr) console.error("[analytics/sales] truy vấn lỗi:", linesErr.message)
  let cogs = 0
  const enriched: StockExportLineRow[] = []
  for (const l of (lines as Array<{ entry_id: string; product_id: string; quantity: number; unit_cost: number }>) || []) {
    const q = Math.abs(Number(l.quantity))
    const c = Number(l.unit_cost || 0)
    cogs += q * c
    enriched.push({
      entry_id: l.entry_id,
      product_id: l.product_id,
      quantity: q,
      unit_cost: c,
      posted_at: postedAtMap.get(l.entry_id) || "",
    })
  }
  return { cogs, lines: enriched }
}

export function summariseSales(
  orders: SalesOrderRow[],
  returnsValue: number,
  cogs: number
): SalesAggregates {
  const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0)
  const netRevenue = revenue - returnsValue
  const grossProfit = netRevenue - cogs
  return {
    invoiceCount: orders.length,
    revenue,
    returnsValue,
    netRevenue,
    cogs,
    grossProfit,
  }
}
