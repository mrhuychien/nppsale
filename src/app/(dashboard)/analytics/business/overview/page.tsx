"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useCustomerGroups } from "@/hooks/use-customer-groups"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiCard } from "@/components/analytics/kpi-card"
import { TrendChart } from "@/components/analytics/trend-chart"
import { ChangeBadge, MoneyCell, TopListCard } from "@/components/analytics/top-list"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  previousRange,
  pctChange,
  daysBetween,
  dailyBuckets,
  formatRangeLabel,
} from "@/lib/analytics/period"
import {
  fetchDeliveredOrders,
  fetchOrderLines,
  fetchReturnsValue,
  fetchCogsForRange,
  type SalesOrderRow,
  type SalesOrderLineRow,
} from "@/lib/analytics/sales"

type TabKey = "revenue" | "returns" | "net" | "profit" | "invoices"

const TABS: { key: TabKey; label: string }[] = [
  { key: "revenue", label: "Doanh thu" },
  { key: "returns", label: "Trả hàng" },
  { key: "net", label: "Doanh thu thuần" },
  { key: "profit", label: "Lợi nhuận gộp" },
  { key: "invoices", label: "Số hóa đơn" },
]

interface UserRow {
  id: string
  full_name: string
}
interface CustomerRow {
  id: string
  store_name: string
  group_id: string | null
  channel: string | null
}
interface CustomerGroupRow {
  id: string
  name: string
}
interface ProductRow {
  id: string
  name: string
  category: string | null
}

export default function BusinessOverviewPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()

  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>("revenue")

  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [prevOrders, setPrevOrders] = useState<SalesOrderRow[]>([])
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [prevLines, setPrevLines] = useState<SalesOrderLineRow[]>([])
  const [returnsValue, setReturnsValue] = useState(0)
  const [prevReturnsValue, setPrevReturnsValue] = useState(0)
  const [cogs, setCogs] = useState(0)
  const [prevCogs, setPrevCogs] = useState(0)
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const { groups } = useCustomerGroups()
  const [products, setProducts] = useState<ProductRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const prev = previousRange(range)
    const [
      orderList,
      prevOrderList,
      retVal,
      prevRetVal,
      cogsRes,
      prevCogsRes,
      customersRes,
      productsRes,
      usersRes,
    ] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchDeliveredOrders(supabase, user.org_id, prev),
      fetchReturnsValue(supabase, user.org_id, range),
      fetchReturnsValue(supabase, user.org_id, prev),
      fetchCogsForRange(supabase, user.org_id, range),
      fetchCogsForRange(supabase, user.org_id, prev),
      supabase.from("customers").select("id, store_name, group_id, channel").eq("org_id", user.org_id),
      supabase.from("products").select("id, name, category").eq("org_id", user.org_id),
      supabase.from("users").select("id, full_name").eq("org_id", user.org_id),
    ])
    const orderIds = orderList.map((o) => o.id)
    const prevOrderIds = prevOrderList.map((o) => o.id)
    const [lineList, prevLineList] = await Promise.all([
      fetchOrderLines(supabase, orderIds),
      fetchOrderLines(supabase, prevOrderIds),
    ])

    setOrders(orderList)
    setPrevOrders(prevOrderList)
    setLines(lineList)
    setPrevLines(prevLineList)
    setReturnsValue(retVal)
    setPrevReturnsValue(prevRetVal)
    setCogs(cogsRes.cogs)
    setPrevCogs(prevCogsRes.cogs)
    setCustomers((customersRes.data as CustomerRow[]) || [])
    setProducts((productsRes.data as ProductRow[]) || [])
    setUsers((usersRes.data as UserRow[]) || [])
    setLoading(false)
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const days = daysBetween(range)

  const totals = useMemo(() => {
    const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total || 0), 0)
    const netRevenue = revenue - returnsValue
    const prevNet = prevRevenue - prevReturnsValue
    const grossProfit = netRevenue - cogs
    const prevGross = prevNet - prevCogs
    return {
      revenue,
      prevRevenue,
      returnsValue,
      prevReturnsValue,
      netRevenue,
      prevNet,
      cogs,
      prevCogs,
      grossProfit,
      prevGross,
      invoices: orders.length,
      prevInvoices: prevOrders.length,
    }
  }, [orders, prevOrders, returnsValue, prevReturnsValue, cogs, prevCogs])

  // Trend buckets per day
  const trend = useMemo(() => {
    const buckets = dailyBuckets(range)
    const dayIdx = new Map<string, number>()
    buckets.forEach((b, i) => dayIdx.set(b.date, i))
    const revenueArr = new Array<number>(buckets.length).fill(0)
    const cogsArr = new Array<number>(buckets.length).fill(0)
    const returnsArr = new Array<number>(buckets.length).fill(0)
    const profitArr = new Array<number>(buckets.length).fill(0)
    for (const o of orders) {
      const d = String(o.order_date).slice(0, 10)
      const i = dayIdx.get(d)
      if (i !== undefined) revenueArr[i] += Number(o.total || 0)
    }
    // We don't have per-day cogs/returns precise mapping cheaply; approximate by spreading totals
    // proportionally to revenue distribution (good enough for visualisation).
    const totalRevenue = revenueArr.reduce((s, v) => s + v, 0)
    for (let i = 0; i < buckets.length; i++) {
      const r = revenueArr[i]
      const ratio = totalRevenue > 0 ? r / totalRevenue : 0
      cogsArr[i] = cogs * ratio
      returnsArr[i] = returnsValue * ratio
      profitArr[i] = r - returnsArr[i] - cogsArr[i]
    }
    return {
      labels: buckets.map((b) => b.label),
      revenue: revenueArr,
      cogs: cogsArr,
      returns: returnsArr,
      profit: profitArr,
    }
  }, [orders, range, cogs, returnsValue])

  // Top customer groups by revenue
  const topGroups = useMemo(() => {
    const customerMap = new Map<string, CustomerRow>()
    for (const c of customers) customerMap.set(c.id, c)
    const groupMap = new Map<string, CustomerGroupRow>()
    for (const g of groups) groupMap.set(g.id, g)

    const cur = new Map<string, { revenue: number; orders: number }>()
    const prev = new Map<string, { revenue: number; orders: number }>()
    for (const o of orders) {
      const c = customerMap.get(o.customer_id)
      const gid = c?.group_id || ""
      const e = cur.get(gid) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      cur.set(gid, e)
    }
    for (const o of prevOrders) {
      const c = customerMap.get(o.customer_id)
      const gid = c?.group_id || ""
      const e = prev.get(gid) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      prev.set(gid, e)
    }
    return Array.from(cur.entries())
      .map(([gid, e]) => {
        const p = prev.get(gid)
        return {
          id: gid,
          name: groupMap.get(gid)?.name || "Chưa phân nhóm",
          revenue: e.revenue,
          orders: e.orders,
          aov: e.orders > 0 ? e.revenue / e.orders : 0,
          changePct: pctChange(e.revenue, p?.revenue || 0),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [orders, prevOrders, customers, groups])

  // Top products by revenue
  const topProducts = useMemo(() => {
    const productMap = new Map<string, ProductRow>()
    for (const p of products) productMap.set(p.id, p)
    const cur = new Map<string, { revenue: number; qty: number; orders: Set<string> }>()
    const prev = new Map<string, { revenue: number; qty: number; orders: Set<string> }>()
    for (const l of lines) {
      const e = cur.get(l.product_id) || { revenue: 0, qty: 0, orders: new Set() }
      e.revenue += Number(l.line_total || 0)
      e.qty += Number(l.quantity || 0)
      e.orders.add(l.order_id)
      cur.set(l.product_id, e)
    }
    for (const l of prevLines) {
      const e = prev.get(l.product_id) || { revenue: 0, qty: 0, orders: new Set() }
      e.revenue += Number(l.line_total || 0)
      e.qty += Number(l.quantity || 0)
      e.orders.add(l.order_id)
      prev.set(l.product_id, e)
    }
    return Array.from(cur.entries())
      .map(([pid, e]) => {
        const p = prev.get(pid)
        return {
          id: pid,
          name: productMap.get(pid)?.name || "—",
          revenue: e.revenue,
          qty: e.qty,
          orders: e.orders.size,
          aov: e.orders.size > 0 ? e.revenue / e.orders.size : 0,
          changePct: pctChange(e.revenue, p?.revenue || 0),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [lines, prevLines, products])

  // Top channels — channel stored on customer.
  const topChannels = useMemo(() => {
    const customerMap = new Map<string, CustomerRow>()
    for (const c of customers) customerMap.set(c.id, c)
    const cur = new Map<string, { revenue: number; orders: number }>()
    const prev = new Map<string, { revenue: number; orders: number }>()
    const fallback = "Bán trực tiếp"
    for (const o of orders) {
      const ch = customerMap.get(o.customer_id)?.channel || fallback
      const e = cur.get(ch) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      cur.set(ch, e)
    }
    for (const o of prevOrders) {
      const ch = customerMap.get(o.customer_id)?.channel || fallback
      const e = prev.get(ch) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      prev.set(ch, e)
    }
    return Array.from(cur.entries())
      .map(([ch, e]) => {
        const p = prev.get(ch)
        return {
          id: ch,
          name: ch,
          revenue: e.revenue,
          orders: e.orders,
          aov: e.orders > 0 ? e.revenue / e.orders : 0,
          changePct: pctChange(e.revenue, p?.revenue || 0),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [orders, prevOrders, customers])

  // Top employees
  const topEmployees = useMemo(() => {
    const userMap = new Map<string, UserRow>()
    for (const u of users) userMap.set(u.id, u)
    const cur = new Map<string, { revenue: number; orders: number }>()
    const prev = new Map<string, { revenue: number; orders: number }>()
    for (const o of orders) {
      const e = cur.get(o.sales_user_id) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      cur.set(o.sales_user_id, e)
    }
    for (const o of prevOrders) {
      const e = prev.get(o.sales_user_id) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      prev.set(o.sales_user_id, e)
    }
    return Array.from(cur.entries())
      .map(([uid, e]) => {
        const p = prev.get(uid)
        return {
          id: uid,
          name: userMap.get(uid)?.full_name || "—",
          revenue: e.revenue,
          orders: e.orders,
          aov: e.orders > 0 ? e.revenue / e.orders : 0,
          changePct: pctChange(e.revenue, p?.revenue || 0),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [orders, prevOrders, users])

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tổng quan kinh doanh</h1>
          <p className="text-sm text-muted-foreground">{formatRangeLabel(range)}</p>
        </div>
        <DateRangePicker
          value={range}
          preset={preset}
          onChange={(p, r) => {
            setPreset(p)
            setRange(r)
          }}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Số hóa đơn"
          value={totals.invoices}
          format="number"
          avgValue={days > 0 ? totals.invoices / days : 0}
          changePct={pctChange(totals.invoices, totals.prevInvoices)}
        />
        <KpiCard
          label="Doanh thu"
          value={totals.revenue}
          format="compactCurrency"
          avgValue={days > 0 ? totals.revenue / days : 0}
          changePct={pctChange(totals.revenue, totals.prevRevenue)}
        />
        <KpiCard
          label="Giá trị trả"
          value={totals.returnsValue}
          format="compactCurrency"
          avgValue={days > 0 ? totals.returnsValue / days : 0}
          changePct={pctChange(totals.returnsValue, totals.prevReturnsValue)}
        />
        <KpiCard
          label="Doanh thu thuần"
          value={totals.netRevenue}
          format="compactCurrency"
          avgValue={days > 0 ? totals.netRevenue / days : 0}
          changePct={pctChange(totals.netRevenue, totals.prevNet)}
        />
        <KpiCard
          label="Tổng giá vốn"
          value={totals.cogs}
          format="compactCurrency"
          avgValue={days > 0 ? totals.cogs / days : 0}
          changePct={pctChange(totals.cogs, totals.prevCogs)}
        />
        <KpiCard
          label="Lợi nhuận gộp"
          value={totals.grossProfit}
          format="compactCurrency"
          avgValue={days > 0 ? totals.grossProfit / days : 0}
          changePct={pctChange(totals.grossProfit, totals.prevGross)}
        />
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Chỉ số kinh doanh</h3>
        </div>
        <TrendChart
          labels={trend.labels}
          series={[
            { key: "revenue", label: "Doanh thu", color: "#2563eb", data: trend.revenue },
            { key: "returns", label: "Trả hàng", color: "#22c55e", data: trend.returns },
            { key: "cogs", label: "Tổng giá vốn", color: "#f59e0b", data: trend.cogs },
            { key: "profit", label: "Lợi nhuận gộp", color: "#ef4444", data: trend.profit },
          ]}
        />
      </div>

      <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm">
        <div className="mb-4">
          <h3 className="text-base font-semibold">Phân tích theo</h3>
        </div>
        <div className="border-b border-border/40">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => {
              const active = activeTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={
                    "border-b-2 px-3 py-2 text-sm font-medium -mb-px " +
                    (active
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground")
                  }
                >
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Hiển thị xếp hạng theo {TABS.find((t) => t.key === activeTab)?.label.toLowerCase()}.
          Các bảng dưới đây sắp xếp giảm dần và giới hạn 10 mục.
        </p>
      </div>

      <div className="space-y-5">
        <TopListCard
          title="Top 10 nhóm hàng"
          rows={topGroups}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Tên nhóm hàng", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
            { key: "aov", label: "Doanh thu TB/đơn", align: "right", render: (r) => <MoneyCell value={r.aov} /> },
            { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
          ]}
        />

        <TopListCard
          title="Top 10 hàng hóa"
          rows={topProducts}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Tên hàng hóa", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
            { key: "aov", label: "Doanh thu TB/đơn", align: "right", render: (r) => <MoneyCell value={r.aov} /> },
            { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
          ]}
        />

        <TopListCard
          title="Top 10 kênh bán"
          rows={topChannels}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Kênh bán", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
            { key: "aov", label: "Doanh thu TB/đơn", align: "right", render: (r) => <MoneyCell value={r.aov} /> },
            { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
          ]}
        />

        <TopListCard
          title="Top 10 nhân viên"
          rows={topEmployees}
          rowKey={(r) => r.id}
          columns={[
            { key: "name", label: "Tên nhân viên", render: (r) => <span className="font-medium">{r.name}</span> },
            { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
            { key: "aov", label: "Doanh thu TB/đơn", align: "right", render: (r) => <MoneyCell value={r.aov} /> },
            { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
          ]}
        />
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Dữ liệu được tổng hợp đến {formatRangeLabel(range).split(" - ")[1]} 23:59:59 (UTC+07:00)
      </p>
    </div>
  )
}
