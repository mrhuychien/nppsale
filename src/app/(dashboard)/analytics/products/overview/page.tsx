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
import {
  fetchDeliveredOrders,
  fetchOrderLines,
  type SalesOrderLineRow,
  type SalesOrderRow,
} from "@/lib/analytics/sales"

interface ProductRow {
  id: string
  sku: string
  name: string
  category: string | null
  brand: string | null
  status: string
}

export default function ProductsOverviewPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()

  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)

  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [prevOrders, setPrevOrders] = useState<SalesOrderRow[]>([])
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [prevLines, setPrevLines] = useState<SalesOrderLineRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const prev = previousRange(range)
    const [orderList, prevOrderList, productsRes] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchDeliveredOrders(supabase, user.org_id, prev),
      supabase.from("products").select("id, sku, name, category, brand, status").eq("org_id", user.org_id),
    ])
    const [lineList, prevLineList] = await Promise.all([
      fetchOrderLines(supabase, orderList.map((o) => o.id)),
      fetchOrderLines(supabase, prevOrderList.map((o) => o.id)),
    ])
    setOrders(orderList)
    setPrevOrders(prevOrderList)
    setLines(lineList)
    setPrevLines(prevLineList)
    setProducts((productsRes.data as ProductRow[]) || [])
    setLoading(false)
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const productMap = useMemo(() => {
    const m = new Map<string, ProductRow>()
    for (const p of products) m.set(p.id, p)
    return m
  }, [products])

  const stats = useMemo(() => {
    const totalQty = lines.reduce((s, l) => s + Number(l.quantity || 0), 0)
    const totalRevenue = lines.reduce((s, l) => s + Number(l.line_total || 0), 0)
    const skusSold = new Set(lines.map((l) => l.product_id)).size
    const prevQty = prevLines.reduce((s, l) => s + Number(l.quantity || 0), 0)
    const prevRevenue = prevLines.reduce((s, l) => s + Number(l.line_total || 0), 0)
    const prevSkus = new Set(prevLines.map((l) => l.product_id)).size
    return {
      totalQty,
      totalRevenue,
      skusSold,
      activeProducts: products.filter((p) => p.status === "active").length,
      prevQty,
      prevRevenue,
      prevSkus,
    }
  }, [lines, prevLines, products])

  const topByRevenue = useMemo(() => {
    const cur = new Map<string, { qty: number; revenue: number; orders: Set<string> }>()
    const prev = new Map<string, { qty: number; revenue: number; orders: Set<string> }>()
    for (const l of lines) {
      const e = cur.get(l.product_id) || { qty: 0, revenue: 0, orders: new Set() }
      e.qty += Number(l.quantity || 0)
      e.revenue += Number(l.line_total || 0)
      e.orders.add(l.order_id)
      cur.set(l.product_id, e)
    }
    for (const l of prevLines) {
      const e = prev.get(l.product_id) || { qty: 0, revenue: 0, orders: new Set() }
      e.revenue += Number(l.line_total || 0)
      prev.set(l.product_id, e)
    }
    return Array.from(cur.entries())
      .map(([pid, e]) => ({
        id: pid,
        name: productMap.get(pid)?.name || "—",
        qty: e.qty,
        revenue: e.revenue,
        orderCount: e.orders.size,
        aov: e.orders.size > 0 ? e.revenue / e.orders.size : 0,
        changePct: pctChange(e.revenue, prev.get(pid)?.revenue || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)
  }, [lines, prevLines, productMap])

  const topByQty = useMemo(() => {
    const cur = new Map<string, { qty: number; revenue: number }>()
    for (const l of lines) {
      const e = cur.get(l.product_id) || { qty: 0, revenue: 0 }
      e.qty += Number(l.quantity || 0)
      e.revenue += Number(l.line_total || 0)
      cur.set(l.product_id, e)
    }
    return Array.from(cur.entries())
      .map(([pid, e]) => ({
        id: pid,
        name: productMap.get(pid)?.name || "—",
        qty: e.qty,
        revenue: e.revenue,
      }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10)
  }, [lines, productMap])

  const slowMovers = useMemo(() => {
    const sold = new Set(lines.map((l) => l.product_id))
    return products
      .filter((p) => p.status === "active" && !sold.has(p.id))
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        category: p.category || "—",
      }))
  }, [products, lines])

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  // Suppress unused warning
  void orders
  void prevOrders

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tổng quan hàng hóa</h1>
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
          label="Doanh thu"
          value={stats.totalRevenue}
          format="compactCurrency"
          changePct={pctChange(stats.totalRevenue, stats.prevRevenue)}
          avgLabel="Sản phẩm bán được"
          avgValue={stats.skusSold}
        />
        <KpiCard
          label="Tổng SL bán"
          value={stats.totalQty}
          format="number"
          changePct={pctChange(stats.totalQty, stats.prevQty)}
          avgLabel="Số đơn vị"
          avgValue={stats.totalQty}
        />
        <KpiCard
          label="SKU đã bán"
          value={stats.skusSold}
          format="number"
          changePct={pctChange(stats.skusSold, stats.prevSkus)}
          avgLabel="Tỷ lệ SKU active"
          avgValue={
            stats.activeProducts
              ? `${Math.round((stats.skusSold / stats.activeProducts) * 100)}%`
              : "—"
          }
        />
        <KpiCard
          label="Sản phẩm Active"
          value={stats.activeProducts}
          format="number"
          changePct={null}
          avgLabel="Tổng cộng"
          avgValue={products.length}
        />
      </div>

      <TopListCard
        title="Top 10 hàng hóa theo doanh thu"
        rows={topByRevenue}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên hàng hóa", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "qty", label: "SL bán", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "aov", label: "DT TB/đơn", align: "right", render: (r) => <MoneyCell value={r.aov} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />

      <TopListCard
        title="Top 10 hàng hóa theo số lượng bán"
        rows={topByQty}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Tên hàng hóa", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "qty", label: "Số lượng bán", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
        ]}
      />

      <TopListCard
        title="Hàng hóa Active không phát sinh bán"
        description="Sản phẩm đang hoạt động nhưng không có đơn trong kỳ"
        rows={slowMovers}
        rowKey={(r) => r.id}
        columns={[
          { key: "sku", label: "Mã SKU", render: (r) => <span className="font-mono text-xs">{r.sku}</span> },
          { key: "name", label: "Tên hàng hóa", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "category", label: "Nhóm hàng", render: (r) => r.category },
        ]}
        emptyText="Tất cả sản phẩm active đều có phát sinh bán trong kỳ"
      />
    </div>
  )
}
