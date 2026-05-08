"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame, downloadXlsx } from "@/components/analytics/report-frame"
import { FilterField, FilterSearchSelect } from "@/components/analytics/report-shell"
import { useFilterCatalogs } from "@/lib/analytics/filter-catalogs"
import { fetchDeliveredOrders, type SalesOrderRow } from "@/lib/analytics/sales"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"

interface CustomerRow {
  id: string
  store_name: string
  channel: string | null
}

export default function ChannelsReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [routeFilter, setRouteFilter] = useState("")
  const [customerFilter, setCustomerFilter] = useState("")
  const catalogs = useFilterCatalogs(user?.org_id)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [orderList, customersRes] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      supabase.from("customers").select("id, store_name, channel").eq("org_id", user.org_id),
    ])
    setOrders(orderList)
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

  const rows = useMemo(() => {
    const m = new Map<string, { revenue: number; orders: number; customers: Set<string> }>()
    const fallback = "Bán trực tiếp"
    // Resolve route filter to candidate channel strings (id / code / name)
    const route = routeFilter ? catalogs.routes.find((r) => r.id === routeFilter) : null
    const matchVals = route
      ? ([route.id, route.label, route.hint].filter(Boolean) as string[])
      : null
    for (const o of orders) {
      if (customerFilter && o.customer_id !== customerFilter) continue
      const ch = customerMap.get(o.customer_id)?.channel || fallback
      if (matchVals && !matchVals.includes(ch)) continue
      const e = m.get(ch) || { revenue: 0, orders: 0, customers: new Set() }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      e.customers.add(o.customer_id)
      m.set(ch, e)
    }
    return Array.from(m.entries())
      .map(([ch, e]) => ({
        id: ch,
        name: ch,
        revenue: e.revenue,
        orders: e.orders,
        customers: e.customers.size,
        aov: e.orders > 0 ? e.revenue / e.orders : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [orders, customerMap, customerFilter, routeFilter, catalogs.routes])

  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      customers: acc.customers + r.customers,
    }),
    { orders: 0, revenue: 0, customers: 0 }
  )

  const handleExport = () => {
    const out: (string | number)[][] = [
      ["Kênh bán", "Số khách", "Số đơn", "Doanh thu", "TB/đơn"],
    ]
    for (const r of rows) {
      out.push([r.name, r.customers, r.orders, r.revenue, r.aov])
    }
    downloadXlsx(`bao-cao-kenh-${range.from}-${range.to}`, out)
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo theo kênh bán hàng"
      subtitle={loading ? "Đang tải..." : formatRangeLabel(range)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
      filters={
        <>
          <FilterField label="Kênh bán">
            <FilterSearchSelect
              value={routeFilter}
              onChange={setRouteFilter}
              options={catalogs.routes}
              placeholder="Chọn kênh bán"
              loading={catalogs.loading}
            />
          </FilterField>
          <FilterField label="Khách hàng">
            <FilterSearchSelect
              value={customerFilter}
              onChange={setCustomerFilter}
              options={catalogs.customers}
              placeholder="Theo mã, tên, SĐT"
              loading={catalogs.loading}
            />
          </FilterField>
        </>
      }
    >
      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <table className="w-full border border-border/40 text-sm">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Kênh bán</th>
              <th className="px-3 py-2 text-right font-semibold">Số khách</th>
              <th className="px-3 py-2 text-right font-semibold">Số đơn</th>
              <th className="px-3 py-2 text-right font-semibold">Doanh thu</th>
              <th className="px-3 py-2 text-right font-semibold">TB/đơn</th>
            </tr>
            <tr className="border-t border-border/30 bg-muted/10 font-semibold">
              <td className="px-3 py-2">SL kênh: {rows.length}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.customers}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.orders}</td>
              <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.revenue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrency(totals.orders > 0 ? totals.revenue / totals.orders : 0)}
              </td>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Không có dữ liệu trong kỳ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border/30">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.customers}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.orders}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.aov)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </ReportFrame>
  )
}
