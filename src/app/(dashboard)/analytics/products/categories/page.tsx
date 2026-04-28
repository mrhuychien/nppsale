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
import { fetchDeliveredOrders, fetchOrderLines, type SalesOrderLineRow } from "@/lib/analytics/sales"

interface ProductRow {
  id: string
  name: string
  category: string | null
  brand: string | null
}

export default function ProductsCategoriesPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [prevLines, setPrevLines] = useState<SalesOrderLineRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const prev = previousRange(range)
    const [orders, prevOrders, productsRes] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchDeliveredOrders(supabase, user.org_id, prev),
      supabase.from("products").select("id, name, category, brand").eq("org_id", user.org_id),
    ])
    const [lineList, prevLineList] = await Promise.all([
      fetchOrderLines(supabase, orders.map((o) => o.id)),
      fetchOrderLines(supabase, prevOrders.map((o) => o.id)),
    ])
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

  const aggregate = useCallback(
    (rows: SalesOrderLineRow[], key: "category" | "brand") => {
      const m = new Map<string, { qty: number; revenue: number; skuSet: Set<string> }>()
      for (const l of rows) {
        const p = productMap.get(l.product_id)
        const k = (p?.[key] as string | null | undefined) || "Khác"
        const e = m.get(k) || { qty: 0, revenue: 0, skuSet: new Set() }
        e.qty += Number(l.quantity || 0)
        e.revenue += Number(l.line_total || 0)
        e.skuSet.add(l.product_id)
        m.set(k, e)
      }
      return m
    },
    [productMap]
  )

  const byCategory = useMemo(() => {
    const cur = aggregate(lines, "category")
    const prev = aggregate(prevLines, "category")
    return Array.from(cur.entries())
      .map(([k, e]) => ({
        id: k,
        name: k,
        qty: e.qty,
        revenue: e.revenue,
        skus: e.skuSet.size,
        changePct: pctChange(e.revenue, prev.get(k)?.revenue || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [lines, prevLines, aggregate])

  const byBrand = useMemo(() => {
    const cur = aggregate(lines, "brand")
    const prev = aggregate(prevLines, "brand")
    return Array.from(cur.entries())
      .map(([k, e]) => ({
        id: k,
        name: k,
        qty: e.qty,
        revenue: e.revenue,
        skus: e.skuSet.size,
        changePct: pctChange(e.revenue, prev.get(k)?.revenue || 0),
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [lines, prevLines, aggregate])

  const totalRevenue = byCategory.reduce((s, r) => s + r.revenue, 0)
  const prevTotalRevenue = byCategory.reduce((s, r) => {
    const p = prevLines.filter((l) => productMap.get(l.product_id)?.category === r.name)
    return s + p.reduce((a, x) => a + Number(x.line_total || 0), 0)
  }, 0)

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
          <h1 className="text-2xl font-bold text-foreground">Phân loại hàng hóa</h1>
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
          label="Tổng doanh thu (đã phân loại)"
          value={totalRevenue}
          format="compactCurrency"
          changePct={pctChange(totalRevenue, prevTotalRevenue)}
        />
        <KpiCard
          label="Số nhóm hàng"
          value={byCategory.length}
          format="number"
          changePct={null}
        />
        <KpiCard
          label="Số thương hiệu"
          value={byBrand.length}
          format="number"
          changePct={null}
        />
      </div>

      <TopListCard
        title="Phân tích theo nhóm hàng (category)"
        rows={byCategory}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Nhóm hàng", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "skus", label: "SKU", align: "right", render: (r) => <NumberCell value={r.skus} /> },
          { key: "qty", label: "SL bán", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />

      <TopListCard
        title="Phân tích theo thương hiệu (brand)"
        rows={byBrand}
        rowKey={(r) => r.id}
        columns={[
          { key: "name", label: "Thương hiệu", render: (r) => <span className="font-medium">{r.name}</span> },
          { key: "skus", label: "SKU", align: "right", render: (r) => <NumberCell value={r.skus} /> },
          { key: "qty", label: "SL bán", align: "right", render: (r) => <NumberCell value={r.qty} /> },
          { key: "revenue", label: "Doanh thu", align: "right", render: (r) => <MoneyCell value={r.revenue} /> },
          { key: "delta", label: "So với kỳ trước", align: "right", render: (r) => <ChangeBadge pct={r.changePct} /> },
        ]}
      />
    </div>
  )
}
