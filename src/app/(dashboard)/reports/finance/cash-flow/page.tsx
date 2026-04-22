"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { fetchCashFlow, type CashFlowData, type FinancePeriod } from "@/lib/finance"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Printer, ArrowDownCircle, ArrowUpCircle, TrendingUp, TrendingDown } from "lucide-react"

export default function CashFlowPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()

  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)

  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today.toISOString().slice(0, 10))
  const [data, setData] = useState<CashFlowData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const period: FinancePeriod = { from, to }
    const result = await fetchCashFlow(supabase, user.org_id, period)
    setData(result)
    setLoading(false)
  }, [user?.org_id, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Báo cáo dòng tiền"
        description={`${formatDate(from)} - ${formatDate(to)}`}
        backHref="/reports"
      >
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1.5" /> In báo cáo
        </Button>
      </PageHeader>

      {/* Period */}
      <Card className="print:hidden">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Từ ngày</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Đến ngày</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const d = new Date()
                setFrom(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10))
                setTo(d.toISOString().slice(0, 10))
              }}
            >
              Tháng này
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const d = new Date()
                setFrom(new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10))
                setTo(d.toISOString().slice(0, 10))
              }}
            >
              Năm nay
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-emerald-700">
                  <ArrowDownCircle className="h-3.5 w-3.5" /> Thu từ KH
                </div>
                <p className="text-xl font-black mt-1 text-emerald-700">
                  {formatCurrency(data.operating.cashFromCustomers)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-red-700">
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Trả NCC
                </div>
                <p className="text-xl font-black mt-1 text-red-700">
                  {formatCurrency(data.operating.cashToSuppliers)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-amber-700">
                  <ArrowUpCircle className="h-3.5 w-3.5" /> Chi phí đã trả
                </div>
                <p className="text-xl font-black mt-1 text-amber-700">
                  {formatCurrency(data.operating.cashToExpenses)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {data.netChange >= 0 ? <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> : <TrendingDown className="h-3.5 w-3.5 text-red-600" />}
                  Dòng tiền ròng
                </div>
                <p className={`text-xl font-black mt-1 ${data.netChange >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatCurrency(data.netChange)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Chi tiết dòng tiền</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 font-mono text-sm">
                {/* Operating */}
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-1">
                  I. Hoạt động kinh doanh
                </div>
                <div className="flex justify-between py-1.5 pl-4 text-emerald-700">
                  <span className="flex items-center gap-1.5">
                    <ArrowDownCircle className="h-3 w-3" /> Thu từ khách hàng
                  </span>
                  <span className="font-semibold">+{formatCurrency(data.operating.cashFromCustomers)}</span>
                </div>
                <div className="flex justify-between py-1.5 pl-4 text-red-700">
                  <span className="flex items-center gap-1.5">
                    <ArrowUpCircle className="h-3 w-3" /> Trả nhà cung cấp
                  </span>
                  <span className="font-semibold">−{formatCurrency(data.operating.cashToSuppliers)}</span>
                </div>
                <div className="flex justify-between py-1.5 pl-4 text-red-700">
                  <span className="flex items-center gap-1.5">
                    <ArrowUpCircle className="h-3 w-3" /> Chi phí hoạt động đã trả
                  </span>
                  <span className="font-semibold">−{formatCurrency(data.operating.cashToExpenses)}</span>
                </div>
                <div className="flex justify-between py-2 border-b font-bold">
                  <span>Dòng tiền HĐKD ròng</span>
                  <span className={data.operating.net >= 0 ? "text-emerald-700" : "text-red-700"}>
                    {data.operating.net >= 0 ? "+" : ""}{formatCurrency(data.operating.net)}
                  </span>
                </div>

                {/* Investing */}
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground pt-3 pb-1">
                  II. Hoạt động đầu tư
                </div>
                <div className="flex justify-between py-1.5 pl-4 text-muted-foreground italic">
                  <span>Chưa có giao dịch</span>
                  <span>{formatCurrency(0)}</span>
                </div>
                <div className="flex justify-between py-2 border-b font-bold">
                  <span>Dòng tiền đầu tư ròng</span>
                  <span>{formatCurrency(data.investing.net)}</span>
                </div>

                {/* Financing */}
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground pt-3 pb-1">
                  III. Hoạt động tài chính
                </div>
                <div className="flex justify-between py-1.5 pl-4 text-muted-foreground italic">
                  <span>Chưa có giao dịch</span>
                  <span>{formatCurrency(0)}</span>
                </div>
                <div className="flex justify-between py-2 border-b font-bold">
                  <span>Dòng tiền tài chính ròng</span>
                  <span>{formatCurrency(data.financing.net)}</span>
                </div>

                {/* Total */}
                <div className="flex justify-between py-3 border-t-2 border-foreground mt-2 text-base font-black">
                  <span>TĂNG/GIẢM TIỀN RÒNG</span>
                  <span className={data.netChange >= 0 ? "text-emerald-700" : "text-red-700"}>
                    {data.netChange >= 0 ? "+" : ""}{formatCurrency(data.netChange)}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground mt-4 italic">
                  * Báo cáo hiện chỉ theo dõi dòng tiền hoạt động (thu/chi đã thực hiện).
                  Các giao dịch đầu tư (mua TSCĐ) và tài chính (vay vốn, góp vốn) sẽ được
                  bổ sung khi có module liên quan.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports/finance/pnl">Báo cáo lãi lỗ</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports/finance/balance-sheet">Bảng cân đối</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/finance/expenses">Quản lý chi phí</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
