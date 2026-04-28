"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame, downloadCsv } from "@/components/analytics/report-frame"
import { fetchAllOrders, fetchDeliveredOrders, type SalesOrderRow } from "@/lib/analytics/sales"
import {
  type DateRange,
  type PeriodPreset,
  rangeFromPreset,
  formatRangeLabel,
} from "@/lib/analytics/period"
import { formatCurrency } from "@/lib/utils"

interface UserRow {
  id: string
  full_name: string
  role: string
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Chủ doanh nghiệp",
  manager: "Quản lý",
  accountant: "Kế toán",
  sales: "Kinh doanh",
  warehouse: "Thủ kho",
  driver: "Tài xế",
}

export default function EmployeesReportPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [preset, setPreset] = useState<PeriodPreset>("this_month")
  const [range, setRange] = useState<DateRange>(() => rangeFromPreset("this_month"))
  const [loading, setLoading] = useState(true)
  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [allOrders, setAllOrders] = useState<SalesOrderRow[]>([])
  const [users, setUsers] = useState<UserRow[]>([])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [delivered, all, usersRes] = await Promise.all([
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchAllOrders(supabase, user.org_id, range),
      supabase.from("users").select("id, full_name, role").eq("org_id", user.org_id),
    ])
    setOrders(delivered)
    setAllOrders(all)
    setUsers((usersRes.data as UserRow[]) || [])
    setLoading(false)
  }, [user?.org_id, range, supabase])

  useEffect(() => {
    load()
  }, [load])

  const userMap = useMemo(() => {
    const m = new Map<string, UserRow>()
    for (const u of users) m.set(u.id, u)
    return m
  }, [users])

  const rows = useMemo(() => {
    const m = new Map<string, { delivered: number; deliveredValue: number; total: number; totalValue: number; cancelled: number }>()
    for (const o of allOrders) {
      const e = m.get(o.sales_user_id) || {
        delivered: 0,
        deliveredValue: 0,
        total: 0,
        totalValue: 0,
        cancelled: 0,
      }
      e.total += 1
      e.totalValue += Number(o.total || 0)
      if (o.status === "cancelled") e.cancelled += 1
      m.set(o.sales_user_id, e)
    }
    for (const o of orders) {
      const e = m.get(o.sales_user_id)
      if (e) {
        e.delivered += 1
        e.deliveredValue += Number(o.total || 0)
      }
    }
    return Array.from(m.entries())
      .map(([uid, e]) => {
        const u = userMap.get(uid)
        return {
          id: uid,
          name: u?.full_name || "—",
          role: ROLE_LABEL[u?.role || ""] || u?.role || "—",
          orders: e.total,
          delivered: e.delivered,
          deliveredValue: e.deliveredValue,
          totalValue: e.totalValue,
          cancelled: e.cancelled,
          aov: e.delivered > 0 ? e.deliveredValue / e.delivered : 0,
        }
      })
      .sort((a, b) => b.deliveredValue - a.deliveredValue)
  }, [orders, allOrders, userMap])

  const totals = rows.reduce(
    (acc, r) => ({
      orders: acc.orders + r.orders,
      delivered: acc.delivered + r.delivered,
      cancelled: acc.cancelled + r.cancelled,
      deliveredValue: acc.deliveredValue + r.deliveredValue,
    }),
    { orders: 0, delivered: 0, cancelled: 0, deliveredValue: 0 }
  )

  const handleExport = () => {
    const out: (string | number)[][] = [
      ["Nhân viên", "Vai trò", "Tổng đơn", "Đơn đã giao", "Đơn hủy", "Doanh thu giao", "TB/đơn"],
    ]
    for (const r of rows) {
      out.push([r.name, r.role, r.orders, r.delivered, r.cancelled, r.deliveredValue, r.aov])
    }
    downloadCsv(`bao-cao-nhan-vien-${range.from}-${range.to}.csv`, out)
  }

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo theo nhân viên"
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
              <th className="px-3 py-2 text-left font-semibold">Nhân viên</th>
              <th className="px-3 py-2 text-left font-semibold">Vai trò</th>
              <th className="px-3 py-2 text-right font-semibold">Tổng đơn</th>
              <th className="px-3 py-2 text-right font-semibold">Đơn đã giao</th>
              <th className="px-3 py-2 text-right font-semibold">Đơn hủy</th>
              <th className="px-3 py-2 text-right font-semibold">Doanh thu giao</th>
              <th className="px-3 py-2 text-right font-semibold">TB/đơn</th>
            </tr>
            <tr className="border-t border-border/30 bg-muted/10 font-semibold">
              <td className="px-3 py-2" colSpan={2}>SL nhân viên: {rows.length}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.orders}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.delivered}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totals.cancelled}</td>
              <td className="px-3 py-2 text-right tabular-nums text-primary">{formatCurrency(totals.deliveredValue)}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrency(totals.delivered > 0 ? totals.deliveredValue / totals.delivered : 0)}
              </td>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  Không có nhân viên có phát sinh đơn trong kỳ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border/30">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2">{r.role}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.orders}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.delivered}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.cancelled}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(r.deliveredValue)}</td>
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
