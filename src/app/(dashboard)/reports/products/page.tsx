"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame, downloadCsv } from "@/components/analytics/report-frame"
import {
  fetchDeliveredOrders,
  fetchOrderLines,
  fetchReturnsRows,
  type SalesOrderLineRow,
} from "@/lib/analytics/sales"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"

interface ProductRow {
  id: string
  sku: string
  name: string
  base_unit: string
}
interface ReturnLineRow {
  return_id: string
  product_id: string
  quantity: number
  line_total: number
}

export default function ProductsReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_week")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_week"))
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<SalesOrderLineRow[]>([])
  const [returnLines, setReturnLines] = useState<ReturnLineRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const orders = await fetchDeliveredOrders(supabase, user.org_id, range)
    const orderIds = orders.map((o) => o.id)
    const [lineList, productsRes, returnsRows] = await Promise.all([
      fetchOrderLines(supabase, orderIds),
      supabase.from("products").select("id, sku, name, base_unit").eq("org_id", user.org_id),
      fetchReturnsRows(supabase, user.org_id, range),
    ])
    const returnIds = returnsRows.map((r) => r.id)
    let returnLineList: ReturnLineRow[] = []
    if (returnIds.length > 0) {
      const { data } = await supabase
        .from("return_lines")
        .select("return_id, product_id, quantity, line_total")
        .in("return_id", returnIds)
      returnLineList = (data as ReturnLineRow[]) || []
    }
    setLines(lineList)
    setReturnLines(returnLineList)
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

  const rows = useMemo(() => {
    const m = new Map<string, { qty: number; revenue: number; returnQty: number; returnValue: number }>()
    for (const l of lines) {
      const e = m.get(l.product_id) || { qty: 0, revenue: 0, returnQty: 0, returnValue: 0 }
      e.qty += Number(l.quantity || 0)
      e.revenue += Number(l.line_total || 0)
      m.set(l.product_id, e)
    }
    for (const l of returnLines) {
      const e = m.get(l.product_id) || { qty: 0, revenue: 0, returnQty: 0, returnValue: 0 }
      e.returnQty += Number(l.quantity || 0)
      e.returnValue += Number(l.line_total || 0)
      m.set(l.product_id, e)
    }
    return Array.from(m.entries())
      .map(([pid, e]) => ({
        id: pid,
        sku: productMap.get(pid)?.sku || "—",
        name: productMap.get(pid)?.name || "—",
        unit: productMap.get(pid)?.base_unit || "—",
        qty: e.qty,
        revenue: e.revenue,
        returnQty: e.returnQty,
        returnValue: e.returnValue,
        netRevenue: e.revenue - e.returnValue,
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue)
  }, [lines, returnLines, productMap])

  const totals = rows.reduce(
    (acc, r) => {
      acc.qty += r.qty
      acc.revenue += r.revenue
      acc.returnQty += r.returnQty
      acc.returnValue += r.returnValue
      acc.netRevenue += r.netRevenue
      return acc
    },
    { qty: 0, revenue: 0, returnQty: 0, returnValue: 0, netRevenue: 0 }
  )

  const handleExport = () => {
    const out: (string | number)[][] = [
      ["Mã hàng", "Tên hàng", "SL bán", "Doanh thu", "SL trả", "Giá trị trả", "Doanh thu thuần"],
    ]
    for (const r of rows) {
      out.push([r.sku, r.name, r.qty, r.revenue, r.returnQty, -r.returnValue, r.netRevenue])
    }
    downloadCsv(`bao-cao-hang-hoa-${range.from}-${range.to}.csv`, out)
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo bán hàng theo hàng hóa"
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
        <div>
          <table className="w-full border border-border/40 text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Mã hàng</th>
                <th className="px-3 py-2 text-left font-semibold">Tên hàng</th>
                <th className="px-3 py-2 text-right font-semibold">SL Bán</th>
                <th className="px-3 py-2 text-right font-semibold">Doanh thu</th>
                <th className="px-3 py-2 text-right font-semibold">SL Trả</th>
                <th className="px-3 py-2 text-right font-semibold">Giá trị trả</th>
                <th className="px-3 py-2 text-right font-semibold">Doanh thu thuần</th>
              </tr>
              <tr className="border-t border-border/30 bg-muted/10 font-semibold">
                <td className="px-3 py-2" colSpan={2}>SL mặt hàng: {rows.length}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.qty.toLocaleString("vi-VN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totals.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.returnQty.toLocaleString("vi-VN")}</td>
                <td className="px-3 py-2 text-right tabular-nums">-{formatCurrency(totals.returnValue)}</td>
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
                    <td className="px-3 py-2 font-mono text-xs text-primary">{r.sku}</td>
                    <td className="px-3 py-2">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.qty.toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.revenue)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.returnQty.toLocaleString("vi-VN")}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.returnValue > 0 ? `-${formatCurrency(r.returnValue)}` : "0"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.netRevenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </ReportFrame>
  )
}
