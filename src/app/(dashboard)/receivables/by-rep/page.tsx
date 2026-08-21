"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { fetchForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency } from "@/lib/utils"
import { UserCog } from "lucide-react"
import type { Receivable } from "@/types"

interface RepDebtRow {
  userId: string
  fullName: string
  customerCount: number
  customersWithDebt: number
  totalDebt: number
  totalPaid: number
  totalAmount: number
  overdueAmount: number
  collectionRate: number
  dso: number
}

export default function ReceivablesByRepPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(true)
  // true = bảng tổng hợp bên dưới đang cộng thiếu vì dữ liệu bị cắt.
  const [truncated, setTruncated] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetchData() {
      const res = await fetchForAggregate((cap) =>
        supabase
          .from("receivables")
          .select("id, customer_id, sales_user_id, amount, paid, due_date, status, sales_user:users!receivables_sales_user_id_fkey(id, full_name)")
          .not("sales_user_id", "is", null)
          .range(0, cap)
      )
      if (res.error) console.error("[receivables/by-rep] truy vấn lỗi:", res.error)
      setReceivables((res.rows as unknown as Receivable[]) || [])
      setTruncated(res.truncated)
      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows: RepDebtRow[] = useMemo(() => {
    const map = new Map<string, {
      userId: string
      fullName: string
      customers: Set<string>
      customersWithDebt: Set<string>
      totalDebt: number
      totalPaid: number
      totalAmount: number
      overdueAmount: number
      agingDaysSum: number
      agingCount: number
    }>()

    receivables.forEach((r) => {
      if (!r.sales_user_id) return
      const existing = map.get(r.sales_user_id)
      const remaining = r.amount - r.paid
      const isOverdue = r.status === "overdue"
      const hasDebt = r.status !== "paid"

      // Calculate aging days for DSO
      let agingDays = 0
      if (r.due_date) {
        const now = new Date()
        const due = new Date(r.due_date)
        agingDays = Math.max(0, Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)))
      }

      if (existing) {
        existing.customers.add(r.customer_id)
        if (hasDebt) existing.customersWithDebt.add(r.customer_id)
        existing.totalDebt += remaining
        existing.totalPaid += r.paid
        existing.totalAmount += r.amount
        if (isOverdue) existing.overdueAmount += remaining
        if (hasDebt) {
          existing.agingDaysSum += agingDays
          existing.agingCount += 1
        }
      } else {
        const customers = new Set<string>()
        customers.add(r.customer_id)
        const customersWithDebt = new Set<string>()
        if (hasDebt) customersWithDebt.add(r.customer_id)
        map.set(r.sales_user_id, {
          userId: r.sales_user_id,
          fullName: r.sales_user?.full_name || "-",
          customers,
          customersWithDebt,
          totalDebt: remaining,
          totalPaid: r.paid,
          totalAmount: r.amount,
          overdueAmount: isOverdue ? remaining : 0,
          agingDaysSum: hasDebt ? agingDays : 0,
          agingCount: hasDebt ? 1 : 0,
        })
      }
    })

    const result: RepDebtRow[] = Array.from(map.values()).map((v) => ({
      userId: v.userId,
      fullName: v.fullName,
      customerCount: v.customers.size,
      customersWithDebt: v.customersWithDebt.size,
      totalDebt: v.totalDebt,
      totalPaid: v.totalPaid,
      totalAmount: v.totalAmount,
      overdueAmount: v.overdueAmount,
      collectionRate: v.totalAmount > 0 ? Math.round((v.totalPaid / v.totalAmount) * 100) : 0,
      dso: v.agingCount > 0 ? Math.round(v.agingDaysSum / v.agingCount) : 0,
    }))

    result.sort((a, b) => b.totalDebt - a.totalDebt)
    return result
  }, [receivables])

  const totalOutstanding = rows.reduce((s, r) => s + r.totalDebt, 0)
  const repsWithDebt = rows.filter((r) => r.totalDebt > 0).length
  const worstRep = rows.reduce<RepDebtRow | null>((worst, r) => {
    if (!worst || r.overdueAmount > worst.overdueAmount) return r
    return worst
  }, null)

  if (authLoading || loading) return <Skeleton className="h-96" />

  const rateColor = (rate: number) => {
    if (rate >= 80) return "text-tertiary"
    if (rate >= 60) return "text-[#b54708]"
    return "text-error"
  }

  const rateBadge = (rate: number) => {
    if (rate >= 80) return <Badge variant="success">{rate}%</Badge>
    if (rate >= 60) return <Badge variant="warning">{rate}%</Badge>
    return <Badge variant="danger">{rate}%</Badge>
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Công nợ theo nhân viên bán hàng" backHref="/receivables" />

      {truncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Số tổng chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng nợ NPP</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số NVBH có nợ</p>
            <p className="text-xl font-black mt-1">{repsWithDebt}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">NVBH nợ quá hạn nhiều nhất</p>
            <p className="text-xl font-black mt-1">
              {worstRep && worstRep.overdueAmount > 0
                ? `${worstRep.fullName} (${formatCurrency(worstRep.overdueAmount)})`
                : "-"
              }
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-8 w-8 text-muted-foreground" />}
          title="Không có dữ liệu"
          description="Chưa có công nợ nào gắn với nhân viên bán hàng"
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden lg:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>NVBH</TableHead>
                      <TableHead className="text-right">Số KH phụ trách</TableHead>
                      <TableHead className="text-right">Số KH đang nợ</TableHead>
                      <TableHead className="text-right">Tổng nợ</TableHead>
                      <TableHead className="text-right">Quá hạn</TableHead>
                      <TableHead className="text-center">Tỷ lệ thu hồi</TableHead>
                      <TableHead className="text-right">DSO</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.userId}
                        className="cursor-pointer"
                        onClick={() => router.push(`/receivables/by-rep/${row.userId}`)}
                      >
                        <TableCell className="font-medium">{row.fullName}</TableCell>
                        <TableCell className="text-right">{row.customerCount}</TableCell>
                        <TableCell className="text-right">{row.customersWithDebt}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(row.totalDebt)}</TableCell>
                        <TableCell className="text-right">
                          {row.overdueAmount > 0 ? (
                            <span className="text-destructive font-semibold">{formatCurrency(row.overdueAmount)}</span>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-center">{rateBadge(row.collectionRate)}</TableCell>
                        <TableCell className="text-right">
                          <span className={rateColor(100 - Math.min(row.dso, 100))}>
                            {row.dso > 0 ? `${row.dso} ngày` : "-"}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {rows.map((row) => (
              <div
                key={row.userId}
                className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                onClick={() => router.push(`/receivables/by-rep/${row.userId}`)}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-extrabold text-base leading-tight truncate">{row.fullName}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Phụ trách: {row.customerCount} KH • Đang nợ: {row.customersWithDebt} KH
                      </p>
                    </div>
                    <div className="shrink-0">{rateBadge(row.collectionRate)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2 mt-2 border-t text-xs">
                    <div>
                      <p className="text-muted-foreground">Tổng nợ</p>
                      <p className="font-bold">{formatCurrency(row.totalDebt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Quá hạn</p>
                      <p className={row.overdueAmount > 0 ? "font-bold text-destructive" : "font-medium"}>
                        {row.overdueAmount > 0 ? formatCurrency(row.overdueAmount) : "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">DSO</p>
                      <p className={`font-medium ${rateColor(100 - Math.min(row.dso, 100))}`}>
                        {row.dso > 0 ? `${row.dso} ngày` : "-"}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
