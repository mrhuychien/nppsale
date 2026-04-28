"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { KpiCard } from "@/components/analytics/kpi-card"
import { ChangeBadge, MoneyCell, NumberCell, TopListCard } from "@/components/analytics/top-list"
import { DateRangePicker } from "@/components/analytics/date-range-picker"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  previousRange,
  pctChange,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { fetchDeliveredOrders, type SalesOrderRow } from "@/lib/analytics/sales"

interface CustomerRow {
  id: string
  store_name: string
  channel: string | null
  group_id: string | null
  created_at: string
  status: string
}

export default function CustomersOverviewPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [prevOrders, setPrevOrders] = useState<SalesOrderRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const prev = previousRange(range)
    const [orderList, prevOrderList, customersRes] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchDeliveredOrders(supabase, user.org_id, prev),
      supabase
        .from("customers")
        .select("id, store_name, channel, group_id, created_at, status")
        .eq("org_id", user.org_id),
    ])
    setOrders(orderList)
    setPrevOrders(prevOrderList)
    setCustomers((customersRes.data as CustomerRow[]) || [])
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

  const stats = useMemo(() => {
    const buyers = new Set(orders.map((o) => o.customer_id))
    const prevBuyers = new Set(prevOrders.map((o) => o.customer_id))
    const revenue = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const prevRevenue = prevOrders.reduce((s, o) => s + Number(o.total || 0), 0)
    const fromIso = new Date(range.from + "T00:00:00").toISOString()
    const toIso = new Date(range.to + "T23:59:59").toISOString()
    const newCustomers = customers.filter(
      (c) => c.created_at >= fromIso && c.created_at <= toIso
    ).length
    return {
      totalCustomers: customers.length,
      activeCustomers: buyers.size,
      prevActive: prevBuyers.size,
      newCustomers,
      revenue,
      prevRevenue,
      arpu: buyers.size > 0 ? revenue / buyers.size : 0,
      prevArpu: prevBuyers.size > 0 ? prevRevenue / prevBuyers.size : 0,
    }
  }, [orders, prevOrders, customers, range])

  const topCustomers = useMemo(() => {
    const cur = new Map<string, { revenue: number; orders: number }>()
    const prev = new Map<string, { revenue: number; orders: number }>()
    for (const o of orders) {
      const e = cur.get(o.customer_id) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      cur.set(o.customer_id, e)
    }
    for (const o of prevOrders) {
      const e = prev.get(o.customer_id) || { revenue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      prev.set(o.customer_id, e)
    }
    return Array.from(cur.entries())
      .map(([cid, e]) => {
        const c = customerMap.get(cid)
        return {
          id: cid,
          name: c?.store_name || "—",
          channel: c?.channel || "—",
          revenue: e.revenue,
          orders: e.orders,
          aov: e.orders > 0 ? e.revenue / e.orders : 0,
          changePct: pctChange(e.revenue, prev.get(cid)?.revenue || 0),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [orders, prevOrders, customerMap])

  const inactive = useMemo(() => {
    const buyers = new Set(orders.map((o) => o.customer_id))
    return customers
      .filter((c) => c.status === "active" && !buyers.has(c.id))
      .slice(0, 10)
  }, [orders, customers])

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
          <h1 className="text-2xl font-bold text-foreground">Tổng quan khách hàng</h1>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Tổng khách hàng"
          value={stats.totalCustomers}
          format="number"
          changePct={null}
        />
        <KpiCard
          label="Khách hàng có giao dịch"
          value={stats.activeCustomers}
          format="number"
          changePct={pctChange(stats.activeCustomers, stats.prevActive)}
        />
        <KpiCard
          label="Khách hàng mới trong kỳ"
          value={stats.newCustomers}
          format="number"
          changePct={null}
        />
        <KpiCard
          label="Doanh thu / Khách"
          value={stats.arpu}
          format="compactCurrency"
          changePct={pctChange(stats.arpu, stats.prevArpu)}
        />
      </div>

      <TopListCard
        title="Top 10 khách hàng theo doanh thu"
        rows={topCustomers}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên khách hàng", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "channel", label: "Kênh", render: (r) => r.channel },
          { key: "orders", label: "Số đơn", align: "right", render: (r) => <NumberCell value={r.orders} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "aov", label: "DT TB/đơn", align: "right", render: (r) => <MoneyCell value={r.aov} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />

      <TopListCard
        title="Khách hàng Active không phát sinh"
        description="Khách trong tệp Active nhưng không mua hàng trong kỳ"
        rows={inactive}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên khách hàng", render: (r) => <span className="font-medium">{r.store_name}</span> },
          { key: "channel", label: "Kênh", render: (r) => r.channel || "—" },
          { key: "status", label: "Trạng thái", render: (r) => r.status },
        ]}
        emptyText="Tất cả khách hàng active đều có phát sinh"
      />
    </div>
  )
}
