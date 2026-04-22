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
import { fetchPnl, type PnlData, type FinancePeriod } from "@/lib/finance"
import { formatCurrency, formatDate } from "@/lib/utils"
import { TrendingUp, TrendingDown, Printer } from "lucide-react"

const BUCKET_LABEL: Record<string, string> = {
  cogs: "Điều chỉnh giá vốn",
  operating: "Chi phí vận hành",
  hr: "Chi phí nhân sự",
  financial: "Chi phí tài chính",
  tax: "Thuế",
  other: "Chi phí khác",
}

export default function PnLPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()

  const today = new Date()
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1)

  const [from, setFrom] = useState(firstOfMonth.toISOString().slice(0, 10))
  const [to, setTo] = useState(today.toISOString().slice(0, 10))
  const [data, setData] = useState<PnlData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const period: FinancePeriod = { from, to }
    const result = await fetchPnl(supabase, user.org_id, period)
    setData(result)
    setLoading(false)
  }, [user?.org_id, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  if (authLoading) return <Skeleton className="h-96" />

  const grossMargin = data && data.revenue > 0 ? (data.grossProfit / data.revenue) * 100 : 0
  const netMargin = data && data.revenue > 0 ? (data.netProfit / data.revenue) * 100 : 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="Báo cáo Lãi Lỗ (P&L)"
        description={`${formatDate(from)} - ${formatDate(to)}`}
        backHref="/reports"
      >
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1.5" /> In báo cáo
        </Button>
      </PageHeader>

      {/* Period selector */}
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
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Doanh thu
                </p>
                <p className="text-xl font-black mt-1">{formatCurrency(data.revenue)}</p>
                <p className="text-xs text-muted-foreground">{data.orderCount} đơn</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Lợi nhuận gộp
                </p>
                <p className={`text-xl font-black mt-1 ${data.grossProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatCurrency(data.grossProfit)}
                </p>
                <p className="text-xs text-muted-foreground">Biên: {grossMargin.toFixed(1)}%</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Lợi nhuận HĐKD
                </p>
                <p className={`text-xl font-black mt-1 ${data.operatingProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatCurrency(data.operatingProfit)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {data.netProfit >= 0 ? <TrendingUp className="h-3 w-3 text-emerald-600" /> : <TrendingDown className="h-3 w-3 text-red-600" />}
                  Lợi nhuận ròng
                </div>
                <p className={`text-xl font-black mt-1 ${data.netProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                  {formatCurrency(data.netProfit)}
                </p>
                <p className="text-xs text-muted-foreground">Biên: {netMargin.toFixed(1)}%</p>
              </CardContent>
            </Card>
          </div>

          {/* P&L breakdown */}
          <Card>
            <CardHeader>
              <CardTitle>Chi tiết</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 font-mono text-sm">
                <div className="flex justify-between py-2 border-b">
                  <span className="font-semibold">Doanh thu (Revenue)</span>
                  <span className="font-bold">{formatCurrency(data.revenue)}</span>
                </div>
                <div className="flex justify-between py-2 pl-4 text-muted-foreground">
                  <span>Trừ: Giá vốn hàng bán (COGS)</span>
                  <span>({formatCurrency(data.cogs)})</span>
                </div>
                <div className="flex justify-between py-2 border-b font-bold">
                  <span>= Lợi nhuận gộp</span>
                  <span className={data.grossProfit >= 0 ? "text-emerald-700" : "text-red-700"}>
                    {formatCurrency(data.grossProfit)}
                  </span>
                </div>

                <div className="pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Chi phí vận hành
                </div>
                {data.expensesByBucket.operating > 0 && (
                  <div className="flex justify-between py-1.5 pl-4 text-muted-foreground">
                    <span>{BUCKET_LABEL.operating}</span>
                    <span>({formatCurrency(data.expensesByBucket.operating)})</span>
                  </div>
                )}
                {data.expensesByBucket.hr > 0 && (
                  <div className="flex justify-between py-1.5 pl-4 text-muted-foreground">
                    <span>{BUCKET_LABEL.hr}</span>
                    <span>({formatCurrency(data.expensesByBucket.hr)})</span>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b font-bold">
                  <span>= Lợi nhuận HĐKD (EBIT)</span>
                  <span className={data.operatingProfit >= 0 ? "text-emerald-700" : "text-red-700"}>
                    {formatCurrency(data.operatingProfit)}
                  </span>
                </div>

                {(data.expensesByBucket.financial > 0 ||
                  data.expensesByBucket.tax > 0 ||
                  data.expensesByBucket.other > 0) && (
                  <div className="pt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Các khoản khác
                  </div>
                )}
                {data.expensesByBucket.financial > 0 && (
                  <div className="flex justify-between py-1.5 pl-4 text-muted-foreground">
                    <span>{BUCKET_LABEL.financial}</span>
                    <span>({formatCurrency(data.expensesByBucket.financial)})</span>
                  </div>
                )}
                {data.expensesByBucket.tax > 0 && (
                  <div className="flex justify-between py-1.5 pl-4 text-muted-foreground">
                    <span>{BUCKET_LABEL.tax}</span>
                    <span>({formatCurrency(data.expensesByBucket.tax)})</span>
                  </div>
                )}
                {data.expensesByBucket.other > 0 && (
                  <div className="flex justify-between py-1.5 pl-4 text-muted-foreground">
                    <span>{BUCKET_LABEL.other}</span>
                    <span>({formatCurrency(data.expensesByBucket.other)})</span>
                  </div>
                )}

                <div className="flex justify-between py-3 border-t-2 border-foreground mt-2 text-base font-black">
                  <span>LỢI NHUẬN RÒNG (Net Profit)</span>
                  <span className={data.netProfit >= 0 ? "text-emerald-700" : "text-red-700"}>
                    {formatCurrency(data.netProfit)}
                  </span>
                </div>

                {data.expensesByBucket.cogs > 0 && (
                  <div className="mt-4 text-xs text-muted-foreground italic">
                    * Đã có {formatCurrency(data.expensesByBucket.cogs)} điều chỉnh giá vốn
                    (hao hụt kiểm kê) được tính vào COGS phía trên.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" size="sm" asChild>
              <Link href="/finance/expenses">Quản lý chi phí</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports/finance/balance-sheet">Bảng cân đối</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports/finance/cash-flow">Dòng tiền</Link>
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
