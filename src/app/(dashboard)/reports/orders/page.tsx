"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame, downloadCsv } from "@/components/analytics/report-frame"
import { fetchAllOrders, type SalesOrderRow } from "@/lib/analytics/sales"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency, formatDate } from "@/lib/utils"

interface CustomerRow {
  id: string
  store_name: string
}
interface UserRow {
  id: string
  full_name: string
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  confirmed: "Đã xác nhận",
  picking: "Đang soạn",
  delivering: "Đang giao",
  delivered: "Đã giao",
  cancelled: "Đã hủy",
}

export default function OrdersReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [ordersRes, customersRes, usersRes] = await Promise.all([
      fetchAllOrders(supabase, user.org_id, range),
      supabase.from("customers").select("id, store_name").eq("org_id", user.org_id),
      supabase.from("users").select("id, full_name").eq("org_id", user.org_id),
    ])
    setOrders(ordersRes)
    setCustomers((customersRes.data as CustomerRow[]) || [])
    setUsers((usersRes.data as UserRow[]) || [])
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
  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  const summary = useMemo(() => {
    const byStatus = new Map<string, { count: number; total: number }>()
    for (const o of orders) {
      const e = byStatus.get(o.status) || { count: 0, total: 0 }
      e.count += 1
      e.total += Number(o.total || 0)
      byStatus.set(o.status, e)
    }
    return Array.from(byStatus.entries())
  }, [orders])

  const totalCount = orders.length
  const totalValue = orders.reduce((s, o) => s + Number(o.total || 0), 0)

  const handleExport = () => {
    const rows: (string | number)[][] = [
      ["Mã đơn", "Ngày đặt", "Khách hàng", "Nhân viên", "Trạng thái", "Tổng tiền"],
    ]
    for (const o of orders) {
      rows.push([
        o.order_code,
        formatDate(o.order_date),
        customerMap.get(o.customer_id)?.store_name || "—",
        userMap.get(o.sales_user_id)?.full_name || "—",
        STATUS_LABEL[o.status] || o.status,
        Number(o.total || 0),
      ])
    }
    downloadCsv(`bao-cao-don-hang-${range.from}-${range.to}.csv`, rows)
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo đặt hàng"
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
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tổng số đơn
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">{totalCount}</p>
            </div>
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tổng giá trị
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">{formatCurrency(totalValue)}</p>
            </div>
            <div className="rounded-lg border border-border/40 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Trung bình / đơn
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {formatCurrency(totalCount > 0 ? totalValue / totalCount : 0)}
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Tổng hợp theo trạng thái</h3>
            <table className="w-full border border-border/40 text-sm">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                  <th className="px-3 py-2 text-right font-semibold">Số đơn</th>
                  <th className="px-3 py-2 text-right font-semibold">Tổng tiền</th>
                </tr>
              </thead>
              <tbody>
                {summary.map(([status, e]) => (
                  <tr key={status} className="border-t border-border/30">
                    <td className="px-3 py-2">{STATUS_LABEL[status] || status}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(e.total)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-foreground/40 bg-muted/20 font-bold">
                  <td className="px-3 py-2">Tổng</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(totalValue)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Chi tiết đơn hàng</h3>
            <table className="w-full border border-border/40 text-sm">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Mã đơn</th>
                  <th className="px-3 py-2 text-left font-semibold">Ngày đặt</th>
                  <th className="px-3 py-2 text-left font-semibold">Khách hàng</th>
                  <th className="px-3 py-2 text-left font-semibold">Nhân viên</th>
                  <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                  <th className="px-3 py-2 text-right font-semibold">Tổng tiền</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">
                      Không có đơn hàng trong kỳ
                    </td>
                  </tr>
                ) : (
                  orders.slice(0, 200).map((o) => (
                    <tr key={o.id} className="border-t border-border/30">
                      <td className="px-3 py-2 font-mono text-xs">{o.order_code}</td>
                      <td className="px-3 py-2">{formatDate(o.order_date)}</td>
                      <td className="px-3 py-2">{customerMap.get(o.customer_id)?.store_name || "—"}</td>
                      <td className="px-3 py-2">{userMap.get(o.sales_user_id)?.full_name || "—"}</td>
                      <td className="px-3 py-2">{STATUS_LABEL[o.status] || o.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(o.total || 0))}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            {orders.length > 200 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Hiển thị 200 đơn đầu. Xuất CSV để xem đầy đủ.
              </p>
            )}
          </div>
        </div>
      )}
    </ReportFrame>
  )
}
