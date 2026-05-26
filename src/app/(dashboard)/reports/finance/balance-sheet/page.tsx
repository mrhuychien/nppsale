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
import { fetchBalanceSheet, type BalanceSheetData } from "@/lib/finance"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Printer, Wallet, Receipt, Boxes, Scale } from "lucide-react"

export default function BalanceSheetPage() {
  const { loading: authLoading } = useRoleGuard("reports")
  const { user } = useAuth()
  const supabase = createClient()

  const today = new Date().toISOString().slice(0, 10)
  const [asOf, setAsOf] = useState(today)
  const [data, setData] = useState<BalanceSheetData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    const result = await fetchBalanceSheet(supabase, user.org_id, asOf)
    setData(result)
    setLoading(false)
  }, [user?.org_id, asOf]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  if (authLoading) return <Skeleton className="h-96" />

  const balanced = data && Math.abs(data.assets.total - (data.liabilities.total + data.equity.total)) < 1

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bảng cân đối tài sản"
        description={`Tại ngày ${formatDate(asOf)}`}
        backHref="/reports"
      >
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1.5" /> In báo cáo
        </Button>
      </PageHeader>

      {/* Period */}
      <Card className="print:hidden">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Tại ngày</Label>
            <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAsOf(new Date().toISOString().slice(0, 10))}
            >
              Hôm nay
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Boxes className="h-3.5 w-3.5" /> Tổng tài sản
                </div>
                <p className="text-xl font-black mt-1">{formatCurrency(data.assets.total)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Receipt className="h-3.5 w-3.5" /> Tổng nợ
                </div>
                <p className="text-xl font-black mt-1">{formatCurrency(data.liabilities.total)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Scale className="h-3.5 w-3.5" /> Vốn chủ sở hữu
                </div>
                <p className={`text-xl font-black mt-1 ${data.equity.total >= 0 ? "text-tertiary" : "text-error"}`}>
                  {formatCurrency(data.equity.total)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Balance sheet */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Assets */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Boxes className="h-4 w-4" /> Tài sản
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="flex justify-between py-1.5 text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Wallet className="h-3 w-3" /> Tiền mặt / ngân hàng
                    </span>
                    <span>{formatCurrency(data.assets.cash)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 text-muted-foreground">
                    <span className="pl-5">Công nợ phải thu</span>
                    <span>{formatCurrency(data.assets.accountsReceivable)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 text-muted-foreground">
                    <span className="pl-5">Hàng tồn kho</span>
                    <span>{formatCurrency(data.assets.inventory)}</span>
                  </div>
                  <div className="flex justify-between py-2 border-t-2 border-foreground mt-2 font-black">
                    <span>TỔNG TÀI SẢN</span>
                    <span>{formatCurrency(data.assets.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Liabilities + Equity */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Scale className="h-4 w-4" /> Nguồn vốn
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 font-mono text-sm">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground pb-1">
                    Nợ phải trả
                  </div>
                  <div className="flex justify-between py-1.5 text-muted-foreground">
                    <span className="pl-5">Công nợ nhà cung cấp</span>
                    <span>{formatCurrency(data.liabilities.accountsPayable)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 text-muted-foreground">
                    <span className="pl-5">Chi phí phải trả</span>
                    <span>{formatCurrency(data.liabilities.unpaidExpenses)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b font-semibold">
                    <span>Tổng nợ phải trả</span>
                    <span>{formatCurrency(data.liabilities.total)}</span>
                  </div>

                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground pt-3 pb-1">
                    Vốn chủ sở hữu
                  </div>
                  <div className="flex justify-between py-1.5 text-muted-foreground">
                    <span className="pl-5">Lợi nhuận giữ lại</span>
                    <span className={data.equity.retainedEarnings >= 0 ? "text-tertiary" : "text-error"}>
                      {formatCurrency(data.equity.retainedEarnings)}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b font-semibold">
                    <span>Tổng vốn CSH</span>
                    <span>{formatCurrency(data.equity.total)}</span>
                  </div>

                  <div className="flex justify-between py-2 border-t-2 border-foreground mt-2 font-black">
                    <span>TỔNG NGUỒN VỐN</span>
                    <span>{formatCurrency(data.liabilities.total + data.equity.total)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Balance check */}
          <div className={`rounded-xl border p-3 text-sm ${balanced ? "border-tertiary/40 bg-[#ecfdf3] text-tertiary" : "border-[#fdb022]/40 bg-[#fff4ed] text-[#b54708]"}`}>
            <p className="font-semibold">
              {balanced ? "✓ Bảng cân đối đã cân" : "⚠ Lệch cân đối"}
            </p>
            <p className="text-xs mt-0.5">
              Tài sản {formatCurrency(data.assets.total)} vs Nguồn vốn {formatCurrency(data.liabilities.total + data.equity.total)}
              {!balanced && ` (lệch ${formatCurrency(Math.abs(data.assets.total - data.liabilities.total - data.equity.total))})`}
            </p>
            <p className="text-xs mt-1 text-muted-foreground">
              Ghi chú: mô hình đơn giản — tiền mặt được ước tính từ (tổng thu từ KH) − (tổng trả NCC) − (chi phí đã trả).
              Chưa bao gồm vốn góp ban đầu, TSCĐ, nợ dài hạn, v.v.
            </p>
          </div>

          {/* Quick links */}
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" size="sm" asChild>
              <Link href="/reports/finance/pnl">Báo cáo lãi lỗ</Link>
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
