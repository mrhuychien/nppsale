"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportFrame } from "@/components/analytics/report-frame"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  fetchAllOrders,
  fetchDeliveredOrders,
  fetchReturnsValue,
  fetchCogsForRange,
  type SalesOrderRow,
} from "@/lib/analytics/sales"
import { type DateRange, rangeFromPreset } from "@/lib/analytics/period"

interface CashReceiptRow {
  id: string
  receipt_code: string
  submitted_amount: number
  expected_amount: number
  status: string
  received_at: string | null
  source_type: string
}

interface ExpenseRow {
  amount: number
  description: string | null
  expense_date: string
}

export default function EndOfDayPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()
  const [date, setDate] = useState<string>(rangeFromPreset("today").from)
  const [, setLoading] = useState(true)
  const [orders, setOrders] = useState<SalesOrderRow[]>([])
  const [delivered, setDelivered] = useState<SalesOrderRow[]>([])
  const [returnsValue, setReturnsValue] = useState(0)
  const [cogs, setCogs] = useState(0)
  const [cashReceipts, setCashReceipts] = useState<CashReceiptRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])

  const range: DateRange = useMemo(() => ({ from: date, to: date }), [date])

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const [allOrders, delivList, retVal, cogsRes, cashRes, expRes] = await Promise.all([
      fetchAllOrders(supabase, user.org_id, range),
      fetchDeliveredOrders(supabase, user.org_id, range),
      fetchReturnsValue(supabase, user.org_id, range),
      fetchCogsForRange(supabase, user.org_id, range),
      supabase
        .from("cash_receipts")
        .select("id, receipt_code, submitted_amount, expected_amount, status, received_at, source_type")
        .eq("org_id", user.org_id)
        .eq("receipt_date", date),
      supabase
        .from("expenses")
        .select("amount, description, expense_date")
        .eq("org_id", user.org_id)
        .eq("expense_date", date),
    ])
    setOrders(allOrders)
    setDelivered(delivList)
    setReturnsValue(retVal)
    setCogs(cogsRes.cogs)
    setCashReceipts((cashRes.data as CashReceiptRow[]) || [])
    setExpenses((expRes.data as ExpenseRow[]) || [])
    setLoading(false)
  }, [user?.org_id, range, date, supabase])

  useEffect(() => {
    load()
  }, [load])

  const revenue = delivered.reduce((s, o) => s + Number(o.total || 0), 0)
  const netRevenue = revenue - returnsValue
  const grossProfit = netRevenue - cogs
  const cashIn = cashReceipts
    .filter((r) => r.status === "received")
    .reduce((s, r) => s + Number(r.submitted_amount || 0), 0)
  const cashOut = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)
  const ordersByStatus = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] || 0) + 1
    return acc
  }, {})

  if (authLoading) return <Skeleton className="h-64" />

  return (
    <ReportFrame
      title="Báo cáo cuối ngày"
      subtitle={`Ngày: ${formatDate(date)}`}
      range={range}
      preset="custom"
      onChangeRange={(_p, r) => setDate(r.from)}
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <SmallStat label="Đơn tạo trong ngày" value={String(orders.length)} />
          <SmallStat label="Đơn đã giao" value={String(delivered.length)} />
          <SmallStat label="Doanh thu" value={formatCurrency(revenue)} />
          <SmallStat label="Trả hàng" value={formatCurrency(returnsValue)} />
          <SmallStat label="Doanh thu thuần" value={formatCurrency(netRevenue)} accent />
          <SmallStat label="LN gộp" value={formatCurrency(grossProfit)} accent />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 font-semibold">Trạng thái đơn hàng</h3>
            <table className="w-full border border-border/40 text-sm">
              <thead>
                <tr className="bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                  <th className="px-3 py-2 text-right font-semibold">Số đơn</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(ordersByStatus).map(([k, v]) => (
                  <tr key={k} className="border-t border-border/30">
                    <td className="px-3 py-2 capitalize">{k}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{v}</td>
                  </tr>
                ))}
                {Object.keys(ordersByStatus).length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-muted-foreground">
                      Không có đơn nào
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="mb-2 font-semibold">Tiền mặt</h3>
            <table className="w-full border border-border/40 text-sm">
              <tbody>
                <tr className="border-b border-border/30">
                  <td className="px-3 py-2">Phiếu thu (đã nhận)</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-600">
                    +{formatCurrency(cashIn)}
                  </td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="px-3 py-2">Chi phí trong ngày</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-600">
                    -{formatCurrency(cashOut)}
                  </td>
                </tr>
                <tr className="border-t-2 border-foreground/40">
                  <td className="px-3 py-2 font-bold">Chênh lệch quỹ</td>
                  <td className="px-3 py-2 text-right tabular-nums font-bold">
                    {formatCurrency(cashIn - cashOut)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="mb-2 font-semibold">Danh sách phiếu thu</h3>
          <table className="w-full border border-border/40 text-sm">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground">
                <th className="px-3 py-2 text-left font-semibold">Mã phiếu</th>
                <th className="px-3 py-2 text-left font-semibold">Nguồn</th>
                <th className="px-3 py-2 text-left font-semibold">Trạng thái</th>
                <th className="px-3 py-2 text-right font-semibold">Giá trị</th>
              </tr>
            </thead>
            <tbody>
              {cashReceipts.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                    Chưa có phiếu thu trong ngày
                  </td>
                </tr>
              ) : (
                cashReceipts.map((r) => (
                  <tr key={r.id} className="border-t border-border/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.receipt_code}</td>
                    <td className="px-3 py-2">{r.source_type}</td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(Number(r.submitted_amount || 0))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ReportFrame>
  )
}

function SmallStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border/40 bg-card p-3 print:bg-transparent">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${accent ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  )
}
