"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate, getAgingStatus } from "@/lib/utils"
import { CreditCard, Eye, FileText } from "lucide-react"
import Link from "next/link"
import type { Receivable } from "@/types"

type BucketKey = "current" | "warning" | "overdue" | "critical"

export default function ReceivablesPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("receivables")
        .select("*, customer:customers(store_name), sales_user:users!receivables_sales_user_id_fkey(full_name)")
        .order("due_date")
      setReceivables((data as Receivable[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading || loading) return <Skeleton className="h-96" />

  const totalOutstanding = receivables.reduce((sum, r) => sum + (r.amount - r.paid), 0)
  const agingVariant = (status: string): "success" | "warning" | "danger" | "default" => {
    switch (status) { case "current": return "success"; case "warning": return "warning"; case "overdue": return "danger"; case "critical": return "danger"; default: return "default" }
  }

  // Aging buckets based on days overdue from due_date
  const buckets: Record<BucketKey, { amount: number; count: number }> = {
    current: { amount: 0, count: 0 },
    warning: { amount: 0, count: 0 },
    overdue: { amount: 0, count: 0 },
    critical: { amount: 0, count: 0 },
  }
  receivables.forEach((r) => {
    if (r.status === "paid") return
    const key: BucketKey = r.due_date ? getAgingStatus(r.due_date) : "current"
    buckets[key].amount += r.amount - r.paid
    buckets[key].count += 1
  })

  const bucketConfig: Record<BucketKey, { label: string; sub: string; barClass: string; textClass: string }> = {
    current: { label: "Hiện tại", sub: "0-30 ngày", barClass: "bg-primary", textClass: "text-primary" },
    warning: { label: "Cảnh báo", sub: "31-60 ngày", barClass: "bg-amber-400", textClass: "text-amber-600" },
    overdue: { label: "Quá hạn", sub: "61-90 ngày", barClass: "bg-orange-500", textClass: "text-orange-600" },
    critical: { label: "Khẩn cấp", sub: ">90 ngày", barClass: "bg-destructive", textClass: "text-destructive" },
  }

  const maxAmount = Math.max(
    buckets.current.amount,
    buckets.warning.amount,
    buckets.overdue.amount,
    buckets.critical.amount,
    1
  )

  const handleExportStatement = (r: Receivable) => {
    // Stash customer + receivable details and invoke print dialog
    // eslint-disable-next-line no-console
    console.log("Xuất bản kê công nợ:", {
      customer: r.customer?.store_name,
      customer_id: r.customer_id,
      amount: r.amount,
      paid: r.paid,
      remaining: r.amount - r.paid,
      due_date: r.due_date,
    })
    if (typeof window !== "undefined") window.print()
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Công nợ" description={`Tổng công nợ: ${formatCurrency(totalOutstanding)}`}>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/receivables/aging">Sổ chi tiết</Link></Button>
          <Button variant="outline" asChild><Link href="/receivables/collect">Thu tiền</Link></Button>
        </div>
      </PageHeader>

      {/* Aging Chart */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h3 className="text-lg font-bold">Biểu đồ tuổi nợ</h3>
              <p className="text-xs text-muted-foreground">Phân bổ công nợ theo số ngày quá hạn</p>
            </div>
            <span className="text-xs text-muted-foreground">
              Cập nhật: {formatDate(new Date())}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {(Object.keys(bucketConfig) as BucketKey[]).map((key) => {
              const cfg = bucketConfig[key]
              const b = buckets[key]
              const heightPct = Math.max(4, Math.round((b.amount / maxAmount) * 100))
              return (
                <div
                  key={key}
                  className="flex flex-col rounded-lg border bg-card p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold">{cfg.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {cfg.sub}
                    </span>
                  </div>
                  <div className={`mt-2 text-xl font-black ${cfg.textClass}`}>
                    {formatCurrency(b.amount)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.count} khoản nợ
                  </div>
                  <div className="mt-3 flex h-28 items-end">
                    <div className="h-full w-full rounded bg-muted/40 relative overflow-hidden">
                      <div
                        className={`absolute bottom-0 left-0 right-0 ${cfg.barClass} transition-all`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {receivables.length === 0 ? (
        <EmptyState icon={<CreditCard className="h-8 w-8 text-muted-foreground" />} title="Chưa có công nợ" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Khách hàng</TableHead>
              <TableHead className="hidden sm:table-cell">NV phụ trách</TableHead>
              <TableHead className="text-right">Phải thu</TableHead>
              <TableHead className="text-right">Đã thu</TableHead>
              <TableHead className="text-right">Còn lại</TableHead>
              <TableHead>Hạn</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead className="text-right">Thao tác</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receivables.map((r) => {
              const remaining = r.amount - r.paid
              const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
              return (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/receivables/${r.id}`)}
                >
                  <TableCell className="font-medium">{r.customer?.store_name || "-"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{r.sales_user?.full_name || "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.paid)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(remaining)}</TableCell>
                  <TableCell>{r.due_date ? formatDate(r.due_date) : "-"}</TableCell>
                  <TableCell><Badge variant={agingVariant(aging)}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleExportStatement(r)}
                    >
                      <FileText className="mr-1 h-3.5 w-3.5" />
                      Xuất bản kê
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
