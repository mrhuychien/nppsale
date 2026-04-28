"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportShell, FilterField } from "@/components/analytics/report-shell"
import { downloadCsv } from "@/components/analytics/report-frame"
import { ReportTable, TotalsRow } from "@/components/analytics/report-table"
import {
  fetchDeliveredOrders,
  fetchOrderLines,
  fetchReturnsRows,
  type SalesOrderLineRow,
  type SalesOrderRow,
  type ReturnSummaryRow as ReturnRowMeta,
} from "@/lib/analytics/sales"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"

type Variant = "sales" | "profit" | "receivables" | "products"

const VARIANTS = [
  { key: "sales" as const, label: "Bán hàng" },
  { key: "profit" as const, label: "Lợi nhuận" },
  { key: "receivables" as const, label: "Công nợ" },
  { key: "products" as const, label: "Hàng bán theo khách" },
] as const

interface CustomerRow {
  id: string
  store_name: string
  channel: string | null
  credit_limit: number
  phone: string | null
}
interface ProductRow {
  id: string
  sku: string
  name: string
}
interface ReturnLineRow {
  return_id: string
  customer_id?: string
  product_id: string
  quantity: number
  line_total: number
}
interface ReceivableRow {
  id: string
  customer_id: string
  amount: number
  paid: number
  due_date: string | null
  status: string
  created_at: string
}
interface StockEntryLine {
  entry_id: string
  product_id: string
  quantity: number
  unit_cost: number
}
interface StockEntry {
  id: string
  type: string
}

export default function CustomersReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [variant, setVariant] = useState<Variant>("sales")
  const [preset, setPreset] = useState<PeriodPreset>("this_week")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_week"))
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)

  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [returns, setReturns] = useState<ReturnRowMeta[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [receivables, setReceivables] = useState<ReceivableRow[]>([])
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([])
  const [stockLines, setStockLines] = useState<StockEntryLine[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const fromIso = `${range.from}T00:00:00Z`
    const toIso = `${range.to}T23:59:59Z`
    const [orderList, returnsRows, customersRes, productsRes, receivablesRes, stockEntriesRes] =
      await Promise.all([
        fetchDeliveredOrders(supabase, user.org_id, range),
        fetchReturnsRows(supabase, user.org_id, range),
        supabase
          .from("customers")
          .select("id, store_name, channel, credit_limit, phone")
          .eq("org_id", user.org_id),
        supabase.from("products").select("id, sku, name").eq("org_id", user.org_id),
        supabase
          .from("receivables")
          .select("id, customer_id, amount, paid, due_date, status, created_at")
          .eq("org_id", user.org_id)
          .in("status", ["open", "partial", "overdue"]),
        supabase
          .from("stock_entries")
          .select("id, type")
          .eq("org_id", user.org_id)
          .eq("status", "posted")
          .eq("type", "export")
          .gte("posted_at", fromIso)
          .lte("posted_at", toIso),
      ])
    const orderIds = orderList.map((o) => o.id)
    const returnIds = returnsRows.map((r) => r.id)
    const stockEntryIds = ((stockEntriesRes.data as StockEntry[]) || []).map((e) => e.id)
    const [linesList, retLinesRes, stockLinesRes] = await Promise.all([
      fetchOrderLines(supabase, orderIds),
      returnIds.length === 0
        ? Promise.resolve({ data: [] as ReturnLineRow[] })
        : supabase
            .from("return_lines")
            .select("return_id, product_id, quantity, line_total")
            .in("return_id", returnIds),
      stockEntryIds.length === 0
        ? Promise.resolve({ data: [] as StockEntryLine[] })
        : supabase
            .from("stock_entry_lines")
            .select("entry_id, product_id, quantity, unit_cost")
            .in("entry_id", stockEntryIds),
    ])

    setOrders(orderList)
    setLines(linesList)
    setReturns(returnsRows)
    setReturnLines((retLinesRes.data as ReturnLineRow[]) || [])
    setCustomers((customersRes.data as CustomerRow[]) || [])
    setProducts((productsRes.data as ProductRow[]) || [])
    setReceivables((receivablesRes.data as ReceivableRow[]) || [])
    setStockEntries((stockEntriesRes.data as StockEntry[]) || [])
    setStockLines((stockLinesRes.data as StockEntryLine[]) || [])
    setLoading(false)
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const customerMap = useMemo(() => {
    const m = new Map<string, CustomerRow>()
    for (const c of customers) m.set(c.id, c)
    return m
  }, [customers])
  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  // helper: returns map of return_id -> customer_id (need to fetch from returns)
  const returnIdToCustomer = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of returns) m.set(r.id, r.customer_id)
    return m
  }, [returns])

  const matchSearch = useCallback(
    (c: CustomerRow | undefined) => {
      if (!c) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        c.store_name.toLowerCase().includes(q) ||
        (c.phone || "").toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      )
    },
    [search]
  )

  // -------------------- Bán hàng (theo khách) --------------------
  type SalesRow = {
    id: string
    name: string
    channel: string
    orders: number
    revenue: number
    returnValue: number
    netRevenue: number
  }
  const salesRows: SalesRow[] = useMemo(() => {
    const m = new Map<string, SalesRow>()
    for (const o of orders) {
      const c = customerMap.get(o.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(o.customer_id) || {
        id: o.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        orders: 0,
        revenue: 0,
        returnValue: 0,
        netRevenue: 0,
      }
      e.orders += 1
      e.revenue += Number(o.total || 0)
      m.set(o.customer_id, e)
    }
    for (const r of returns) {
      const c = customerMap.get(r.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(r.customer_id) || {
        id: r.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        orders: 0,
        revenue: 0,
        returnValue: 0,
        netRevenue: 0,
      }
      e.returnValue += Number(r.credit_note_amount || 0)
      m.set(r.customer_id, e)
    }
    return Array.from(m.values())
      .map((r) => ({ ...r, netRevenue: r.revenue - r.returnValue }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [orders, returns, customerMap, matchSearch])

  // -------------------- Lợi nhuận (theo khách) --------------------
  type ProfitRow = SalesRow & { cogs: number; profit: number; margin: number }
  const profitRows: ProfitRow[] = useMemo(() => {
    // average COGS per product across the period
    const productCogs = new Map<string, { qty: number; value: number }>()
    for (const l of stockLines) {
      const e = productCogs.get(l.product_id) || { qty: 0, value: 0 }
      e.qty += Math.abs(Number(l.quantity || 0))
      e.value += Math.abs(Number(l.quantity || 0)) * Number(l.unit_cost || 0)
      productCogs.set(l.product_id, e)
    }
    const avgCost = new Map<string, number>()
    for (const [pid, v] of Array.from(productCogs.entries())) {
      avgCost.set(pid, v.qty > 0 ? v.value / v.qty : 0)
    }
    const linesByOrder = new Map<string, SalesOrderLineRow[]>()
    for (const l of lines) {
      const a = linesByOrder.get(l.order_id) || []
      a.push(l)
      linesByOrder.set(l.order_id, a)
    }
    const m = new Map<string, ProfitRow>()
    for (const o of orders) {
      const c = customerMap.get(o.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(o.customer_id) || {
        id: o.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        orders: 0,
        revenue: 0,
        returnValue: 0,
        netRevenue: 0,
        cogs: 0,
        profit: 0,
        margin: 0,
      }
      e.orders += 1
      e.revenue += Number(o.total || 0)
      const ls = linesByOrder.get(o.id) || []
      for (const l of ls) {
        e.cogs += Number(l.quantity || 0) * (avgCost.get(l.product_id) || 0)
      }
      m.set(o.customer_id, e)
    }
    return Array.from(m.values())
      .map((r) => {
        const profit = r.revenue - r.cogs
        return { ...r, profit, margin: r.revenue > 0 ? (profit / r.revenue) * 100 : 0 }
      })
      .sort((a, b) => b.profit - a.profit)
  }, [orders, lines, stockLines, customerMap, matchSearch])

  // -------------------- Công nợ --------------------
  type RecvRow = {
    id: string
    name: string
    channel: string
    creditLimit: number
    invoices: number
    outstanding: number
    overdueDays: number
  }
  const recvRows: RecvRow[] = useMemo(() => {
    const m = new Map<string, RecvRow>()
    const now = Date.now()
    for (const r of receivables) {
      const c = customerMap.get(r.customer_id)
      if (!matchSearch(c)) continue
      const outstanding = Number(r.amount || 0) - Number(r.paid || 0)
      if (outstanding <= 0) continue
      const e = m.get(r.customer_id) || {
        id: r.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        creditLimit: Number(c?.credit_limit || 0),
        invoices: 0,
        outstanding: 0,
        overdueDays: 0,
      }
      e.invoices += 1
      e.outstanding += outstanding
      const days = r.due_date ? Math.ceil((now - new Date(r.due_date).getTime()) / 86400000) : 0
      if (days > e.overdueDays) e.overdueDays = days
      m.set(r.customer_id, e)
    }
    return Array.from(m.values()).sort((a, b) => b.outstanding - a.outstanding)
  }, [receivables, customerMap, matchSearch])

  // -------------------- Hàng bán theo khách (drill-down) --------------------
  type CustomerProductRow = {
    id: string
    name: string
    channel: string
    revenue: number
    qty: number
    products: { id: string; sku: string; name: string; qty: number; revenue: number; returnQty: number; returnValue: number }[]
  }
  const customerProductRows: CustomerProductRow[] = useMemo(() => {
    const linesByOrder = new Map<string, SalesOrderLineRow[]>()
    for (const l of lines) {
      const a = linesByOrder.get(l.order_id) || []
      a.push(l)
      linesByOrder.set(l.order_id, a)
    }
    const m = new Map<string, CustomerProductRow>()
    for (const o of orders) {
      const c = customerMap.get(o.customer_id)
      if (!matchSearch(c)) continue
      const e = m.get(o.customer_id) || {
        id: o.customer_id,
        name: c?.store_name || "—",
        channel: c?.channel || "—",
        revenue: 0,
        qty: 0,
        products: [],
      }
      e.revenue += Number(o.total || 0)
      const ls = linesByOrder.get(o.id) || []
      const prodMap = new Map<string, { id: string; sku: string; name: string; qty: number; revenue: number; returnQty: number; returnValue: number }>()
      for (const r of e.products) prodMap.set(r.id, r)
      for (const l of ls) {
        const p = productMap.get(l.product_id)
        if (!p) continue
        const pr = prodMap.get(l.product_id) || {
          id: l.product_id,
          sku: p.sku,
          name: p.name,
          qty: 0,
          revenue: 0,
          returnQty: 0,
          returnValue: 0,
        }
        pr.qty += Number(l.quantity || 0)
        pr.revenue += Number(l.line_total || 0)
        prodMap.set(l.product_id, pr)
        e.qty += Number(l.quantity || 0)
      }
      e.products = Array.from(prodMap.values())
      m.set(o.customer_id, e)
    }
    // attribute return lines by customer via return_id
    for (const rl of returnLines) {
      const cid = returnIdToCustomer.get(rl.return_id)
      if (!cid) continue
      const e = m.get(cid)
      if (!e) continue
      const p = productMap.get(rl.product_id)
      if (!p) continue
      const pr = e.products.find((x) => x.id === rl.product_id)
      if (pr) {
        pr.returnQty += Number(rl.quantity || 0)
        pr.returnValue += Number(rl.line_total || 0)
      } else {
        e.products.push({
          id: rl.product_id,
          sku: p.sku,
          name: p.name,
          qty: 0,
          revenue: 0,
          returnQty: Number(rl.quantity || 0),
          returnValue: Number(rl.line_total || 0),
        })
      }
    }
    for (const e of Array.from(m.values())) {
      e.products.sort((a, b) => b.revenue - a.revenue)
    }
    return Array.from(m.values()).sort((a, b) => b.revenue - a.revenue)
  }, [orders, lines, returnLines, productMap, customerMap, returnIdToCustomer, matchSearch])

  const handleExport = () => {
    if (variant === "sales") {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Số đơn", "Doanh thu", "Giá trị trả", "Doanh thu thuần"],
      ]
      for (const r of salesRows)
        out.push([r.name, r.channel, r.orders, r.revenue, -r.returnValue, r.netRevenue])
      downloadCsv(`bao-cao-kh-banhang-${range.from}-${range.to}.csv`, out)
    } else if (variant === "profit") {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Số đơn", "Doanh thu", "Giá vốn", "Lợi nhuận", "Biên LN (%)"],
      ]
      for (const r of profitRows)
        out.push([r.name, r.channel, r.orders, r.revenue, r.cogs, r.profit, r.margin.toFixed(2)])
      downloadCsv(`bao-cao-kh-loinhuan-${range.from}-${range.to}.csv`, out)
    } else if (variant === "receivables") {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Hạn mức", "Số phiếu", "Công nợ", "Tuổi nợ tối đa (ngày)"],
      ]
      for (const r of recvRows)
        out.push([r.name, r.channel, r.creditLimit, r.invoices, r.outstanding, r.overdueDays])
      downloadCsv(`bao-cao-kh-congno-${range.from}-${range.to}.csv`, out)
    } else {
      const out: (string | number)[][] = [
        ["Khách hàng", "Kênh", "Mã hàng", "Tên hàng", "SL bán", "Doanh thu", "SL trả", "Giá trị trả"],
      ]
      for (const c of customerProductRows) {
        for (const p of c.products) {
          out.push([c.name, c.channel, p.sku, p.name, p.qty, p.revenue, p.returnQty, p.returnValue])
        }
      }
      downloadCsv(`bao-cao-kh-hangban-${range.from}-${range.to}.csv`, out)
    }
  }

  if (authLoading) return <Skeleton className="h-64" />

  // Suppress unused warning
  void stockEntries

  return (
    <ReportShell
      title="Báo cáo khách hàng"
      variants={VARIANTS}
      variant={variant}
      onVariantChange={(v) => setVariant(v)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
      filters={
        <FilterField label="Khách hàng">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Theo mã, tên, số điện thoại"
            className="h-9 w-full rounded-md border border-border/60 bg-card px-2 text-sm"
          />
        </FilterField>
      }
    >
      <div className="hidden print:block mb-3 text-center text-xs text-muted-foreground">
        {VARIANTS.find((v) => v.key === variant)?.label} · {formatRangeLabel(range)}
      </div>
      {loading ? (
        <Skeleton className="h-72" />
      ) : variant === "sales" ? (
        <SalesView rows={salesRows} />
      ) : variant === "profit" ? (
        <ProfitView rows={profitRows} />
      ) : variant === "receivables" ? (
        <ReceivablesView rows={recvRows} />
      ) : (
        <CustomerProductsView rows={customerProductRows} />
      )}
    </ReportShell>
  )
}

function SalesView({ rows }: { rows: { id: string; name: string; channel: string; orders: number; revenue: number; returnValue: number; netRevenue: number }[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      returnValue: acc.returnValue + r.returnValue,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { orders: 0, revenue: 0, returnValue: 0, netRevenue: 0 }
  )
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "code", label: "Mã KH", render: (r) => <span className="font-mono text-xs text-primary">KH{r.id.slice(0, 6)}</span> },
        { key: "name", label: "Khách hàng", render: (r) => r.name },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "or", label: "Số đơn", align: "right", render: (r) => r.orders },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "ret", label: "Giá trị trả", align: "right", render: (r) => (r.returnValue > 0 ? `-${formatCurrency(r.returnValue)}` : "0") },
        { key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 3 },
            { content: totals.orders, align: "right" },
            { content: formatCurrency(totals.revenue), align: "right" },
            {
              content: totals.returnValue > 0 ? `-${formatCurrency(totals.returnValue)}` : "0",
              align: "right",
            },
            { content: formatCurrency(totals.netRevenue), align: "right", className: "text-primary" },
          ]}
        />
      }
    />
  )
}

function ProfitView({ rows }: { rows: { id: string; name: string; channel: string; orders: number; revenue: number; cogs: number; profit: number; margin: number }[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      cogs: acc.cogs + r.cogs,
      profit: acc.profit + r.profit,
    }),
    { orders: 0, revenue: 0, cogs: 0, profit: 0 }
  )
  const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "name", label: "Khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "or", label: "Số đơn", align: "right", render: (r) => r.orders },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => formatCurrency(r.revenue) },
        { key: "cogs", label: "Giá vốn", align: "right", render: (r) => formatCurrency(r.cogs) },
        { key: "profit", label: "Lợi nhuận", align: "right", render: (r) => <span className={r.profit >= 0 ? "font-semibold text-emerald-600" : "font-semibold text-red-600"}>{formatCurrency(r.profit)}</span> },
        { key: "m", label: "Biên LN", align: "right", render: (r) => `${r.margin.toFixed(1)}%` },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 2 },
            { content: totals.orders, align: "right" },
            { content: formatCurrency(totals.revenue), align: "right" },
            { content: formatCurrency(totals.cogs), align: "right" },
            { content: formatCurrency(totals.profit), align: "right", className: "text-primary" },
            { content: `${totalMargin.toFixed(1)}%`, align: "right" },
          ]}
        />
      }
    />
  )
}

function ReceivablesView({ rows }: { rows: { id: string; name: string; channel: string; creditLimit: number; invoices: number; outstanding: number; overdueDays: number }[] }) {
  const totals = rows.reduce(
    (acc, r) => ({
      invoices: acc.invoices + r.invoices,
      outstanding: acc.outstanding + r.outstanding,
    }),
    { invoices: 0, outstanding: 0 }
  )
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "name", label: "Khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "cl", label: "Hạn mức", align: "right", render: (r) => formatCurrency(r.creditLimit) },
        { key: "inv", label: "Số phiếu", align: "right", render: (r) => r.invoices },
        { key: "out", label: "Công nợ", align: "right", render: (r) => <span className="font-semibold text-red-600">{formatCurrency(r.outstanding)}</span> },
        { key: "od", label: "Tuổi nợ tối đa", align: "right", render: (r) => (
          <span className={r.overdueDays > 0 ? "font-semibold text-red-600" : ""}>
            {r.overdueDays > 0 ? `${r.overdueDays} ngày` : "—"}
          </span>
        )},
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 3 },
            { content: totals.invoices, align: "right" },
            { content: formatCurrency(totals.outstanding), align: "right", className: "text-red-600" },
            { content: "", align: "right" },
          ]}
        />
      }
    />
  )
}

function CustomerProductsView({
  rows,
}: {
  rows: { id: string; name: string; channel: string; revenue: number; qty: number; products: { id: string; sku: string; name: string; qty: number; revenue: number; returnQty: number; returnValue: number }[] }[]
}) {
  const totals = rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, qty: acc.qty + r.qty }),
    { revenue: 0, qty: 0 }
  )
  return (
    <ReportTable
      rows={rows}
      rowKey={(r) => r.id}
      columns={[
        { key: "name", label: "Khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
        { key: "ch", label: "Kênh", render: (r) => r.channel },
        { key: "qty", label: "Tổng SL", align: "right", render: (r) => r.qty.toLocaleString("vi-VN") },
        { key: "rev", label: "Doanh thu", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.revenue)}</span> },
      ]}
      totalsRow={
        <TotalsRow
          cells={[
            { content: `SL khách hàng: ${rows.length}`, colSpan: 2 },
            { content: totals.qty.toLocaleString("vi-VN"), align: "right" },
            { content: formatCurrency(totals.revenue), align: "right", className: "text-primary" },
          ]}
        />
      }
      expandable={(r) => (
        <div className="rounded-md border border-border/40 bg-background/60">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-emerald-100/60">
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Mã hàng</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase">Tên hàng</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL bán</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Doanh thu</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">SL trả</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase">Giá trị trả</th>
              </tr>
            </thead>
            <tbody>
              {r.products.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-2 text-center text-xs text-muted-foreground">
                    Không có hàng
                  </td>
                </tr>
              ) : (
                r.products.map((p) => (
                  <tr key={p.id} className="border-t border-border/30">
                    <td className="px-3 py-1.5 font-mono text-xs text-primary">{p.sku}</td>
                    <td className="px-3 py-1.5">{p.name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.qty.toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(p.revenue)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {p.returnQty > 0 ? p.returnQty.toLocaleString("vi-VN") : "0"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {p.returnValue > 0 ? `-${formatCurrency(p.returnValue)}` : "0"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    />
  )
}
