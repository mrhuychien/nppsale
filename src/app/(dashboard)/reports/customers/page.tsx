"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame, downloadCsv } from "@/components/analytics/report-frame"
import {
  fetchDeliveredOrders,
  fetchReturnsRows,
  type SalesOrderRow,
} from "@/lib/analytics/sales"
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

interface ReturnSummary {
  customer_id: string
  credit_note_amount: number
}

export default function CustomersReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_week")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_week"))
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [returns, setReturns] = useState<ReturnSummary[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [orderList, returnsRows, customersRes] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchReturnsRows(supabase, user.org_id, range),
      supabase.from("customers").select("id, store_name, channel").eq("org_id", user.org_id),
    ])
    setOrders(orderList)
    setReturns(returnsRows.map((r) => ({ customer_id: r.customer_id, credit_note_amount: r.credit_note_amount })))
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
    const m = new Map<string, { revenue: number; returnValue: number; orders: number }>()
    for (const o of orders) {
      const e = m.get(o.customer_id) || { revenue: 0, returnValue: 0, orders: 0 }
      e.revenue += Number(o.total || 0)
      e.orders += 1
      m.set(o.customer_id, e)
    }
    for (const r of returns) {
      const e = m.get(r.customer_id) || { revenue: 0, returnValue: 0, orders: 0 }
      e.returnValue += Number(r.credit_note_amount || 0)
      m.set(r.customer_id, e)
    }
    return Array.from(m.entries())
      .map(([cid, e]) => {
        const c = customerMap.get(cid)
        return {
          id: cid,
          name: c?.store_name || "—",
          channel: c?.channel || "—",
          orders: e.orders,
          revenue: e.revenue,
          returnValue: e.returnValue,
          netRevenue: e.revenue - e.returnValue,
        }
      })
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [orders, returns, customerMap])

  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      revenue: acc.revenue + r.revenue,
      returnValue: acc.returnValue + r.returnValue,
      netRevenue: acc.netRevenue + r.netRevenue,
    }),
    { orders: 0, revenue: 0, returnValue: 0, netRevenue: 0 }
  )

  const handleExport = () => {
    const out: (string | number)[][] = [
      ["Mã KH", "Khách hàng", "Kênh", "Số đơn", "Doanh thu", "Giá trị trả", "Doanh thu thuần"],
    ]
    for (const r of rows) {
      out.push([r.id.slice(0, 8), r.name, r.channel, r.orders, r.revenue, -r.returnValue, r.netRevenue])
    }
    downloadCsv(`bao-cao-khach-hang-${range.from}-${range.to}.csv`, out)
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo bán hàng theo khách hàng"
      subtitle={loading ? "Đang tải..." : formatRangeLabel(range)}
      range={range}
      preset={preset}
      onChangeRange={(p, r) => {
        setPreset(p)
        setRange(r)
      }}
      onExportCsv={handleExport}
    >
      {loading ? (
        <Skeleton className="h-72" />
      ) : (
        <table className="w-full border border-border/40 text-sm">
          <thead>
            <tr className="bg-muted/30 text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Mã KH</th>
              <th className="px-3 py-2 text-left font-semibold">Khách hàng</th>
              <th className="px-3 py-2 text-left font-semibold">Kênh</th>
              <th className="px-3 py-2 text-right font-semibold">Số đơn</th>
              <th className="px-3 py-2 text-right font-semibold">Doanh thu</th>
              <th className="px-3 py-2 text-right font-semibold">Giá trị trả</th>
              <th className="px-3 py-2 text-right font-semibold">Doanh thu thuần</th>
            </tr>
            <tr className="border-t border-border/30 bg-muted/10 font-semibold">
              <td className="px-3 py-2" colSpan={3}>SL khách hàng: {rows.length}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.orders}</td>
              <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.revenue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {totals.returnValue > 0 ? `-${formatCurrency(totals.returnValue)}` : "0"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.netRevenue)}</td>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Không có dữ liệu trong kỳ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border/30">
                  <td className="px-3 py-2 font-mono text-xs text-primary">KH{r.id.slice(0, 6)}</td>
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.channel}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.orders}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.revenue)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.returnValue > 0 ? `-${formatCurrency(r.returnValue)}` : "0"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.netRevenue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </ReportFrame>
  )
}
