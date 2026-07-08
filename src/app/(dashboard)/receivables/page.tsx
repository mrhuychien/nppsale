"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { PageHeader } from "@/components/ui/page-header"
import {
  RECEIVABLE_COLUMNS,
  DEFAULT_RECEIVABLE_COLUMNS,
  type ReceivableColumnKey,
} from "./list-config"
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
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const isDriver = authUser?.role === "driver"
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [allUnpaid, setAllUnpaid] = useState<Array<Pick<Receivable, "amount" | "paid" | "due_date" | "status">>>([])
  const [loading, setLoading] = useState(true)
  const pg = usePagination(50)
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("receivables", DEFAULT_RECEIVABLE_COLUMNS, [])
  const show = (k: ReceivableColumnKey) => visibleColumns.includes(k)

  // Aging summary: chỉ load các trường nhẹ (amount, paid, due_date, status)
  // cho UNPAID — 1 lần mount, không join.
  useEffect(() => {
    async function loadSummary() {
      const { data } = await supabase
        .from("receivables")
        .select("amount, paid, due_date, status")
        .neq("status", "paid")
      setAllUnpaid((data as Array<Pick<Receivable, "amount" | "paid" | "due_date" | "status">>) || [])
    }
    loadSummary()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Paginated table query (gồm join customer + sales_user).
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      const { data, count } = await supabase
        .from("receivables")
        .select(
          "*, customer:customers(store_name), sales_user:users!receivables_sales_user_id_fkey(full_name)",
          { count: "exact" }
        )
        .order("due_date")
        .range(pg.from, pg.to)
      if (cancelled) return
      setReceivables((data as Receivable[]) || [])
      pg.setTotal(count ?? 0)
      setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [pg.from, pg.to]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  // Tổng + aging dùng allUnpaid (full unpaid set) — chính xác toàn tổng,
  // không phụ thuộc page hiện tại.
  const totalOutstanding = allUnpaid.reduce((sum, r) => sum + (Number(r.amount) - Number(r.paid)), 0)
  const agingVariant = (status: string): "success" | "warning" | "danger" | "default" => {
    switch (status) { case "current": return "success"; case "warning": return "warning"; case "overdue": return "danger"; case "critical": return "danger"; default: return "default" }
  }
  const buckets: Record<BucketKey, { amount: number; count: number }> = {
    current: { amount: 0, count: 0 },
    warning: { amount: 0, count: 0 },
    overdue: { amount: 0, count: 0 },
    critical: { amount: 0, count: 0 },
  }
  allUnpaid.forEach((r) => {
    const key: BucketKey = r.due_date ? getAgingStatus(r.due_date) : "current"
    buckets[key].amount += Number(r.amount) - Number(r.paid)
    buckets[key].count += 1
  })

  const bucketConfig: Record<BucketKey, { label: string; sub: string; barClass: string; textClass: string }> = {
    current: { label: "Hiện tại", sub: "0-30 ngày", barClass: "bg-primary", textClass: "text-primary" },
    warning: { label: "Cảnh báo", sub: "31-60 ngày", barClass: "bg-[#fdb022]", textClass: "text-[#b54708]" },
    overdue: { label: "Quá hạn", sub: "61-90 ngày", barClass: "bg-[#f97316]", textClass: "text-[#c2410c]" },
    critical: { label: "Khẩn cấp", sub: ">90 ngày", barClass: "bg-error", textClass: "text-error" },
  }

  const maxAmount = Math.max(
    buckets.current.amount,
    buckets.warning.amount,
    buckets.overdue.amount,
    buckets.critical.amount,
    1
  )

  const handleExportStatement = () => {
    if (typeof window !== "undefined") window.print()
  }

  return (
    <div className="space-y-4">
      <PageHeader title={isSales ? "Công nợ của tôi" : "Công nợ"} description={`Tổng công nợ: ${formatCurrency(totalOutstanding)}`}>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/receivables/aging">Sổ chi tiết</Link></Button>
          <Button variant="outline" asChild><Link href="/receivables/collect">Thu tiền</Link></Button>
        </div>
      </PageHeader>

      {(isSales || isDriver) && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          {isSales
            ? "Bạn chỉ thấy công nợ từ các đơn do bạn tạo."
            : "Bạn thấy công nợ thuộc các đơn giao của bạn (COD)."}
        </div>
      )}

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
                  <div className={`mt-2 text-xl font-bold ${cfg.textClass}`}>
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

      <div className="flex justify-end">
        <ColumnPicker
          available={RECEIVABLE_COLUMNS}
          value={visibleColumns}
          onChange={setColumns}
          onReset={resetColumns}
        />
      </div>

      {loading ? (
        <Skeleton className="h-96" />
      ) : receivables.length === 0 ? (
        <EmptyState icon={<CreditCard className="h-8 w-8 text-muted-foreground" />} title="Chưa có công nợ" />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Khách hàng</TableHead>
                  {show("salesUser") && <TableHead>NV phụ trách</TableHead>}
                  {show("amount") && <TableHead className="text-right">Phải thu</TableHead>}
                  {show("paid") && <TableHead className="text-right">Đã thu</TableHead>}
                  {show("remaining") && <TableHead className="text-right">Còn lại</TableHead>}
                  {show("dueDate") && <TableHead>Hạn</TableHead>}
                  {show("status") && <TableHead>Trạng thái</TableHead>}
                  {show("action") && <TableHead className="text-right">Thao tác</TableHead>}
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
                      {show("salesUser") && <TableCell>{r.sales_user?.full_name || "-"}</TableCell>}
                      {show("amount") && <TableCell className="text-right tabular-nums">{formatCurrency(r.amount)}</TableCell>}
                      {show("paid") && <TableCell className="text-right tabular-nums">{formatCurrency(r.paid)}</TableCell>}
                      {show("remaining") && <TableCell className="text-right font-medium tabular-nums">{formatCurrency(remaining)}</TableCell>}
                      {show("dueDate") && <TableCell>{r.due_date ? formatDate(r.due_date) : "-"}</TableCell>}
                      {show("status") && <TableCell><Badge variant={agingVariant(aging)}>{r.status}</Badge></TableCell>}
                      {show("action") && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleExportStatement()}
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            Xuất bản kê
                          </Button>
                        </TableCell>
                      )}
                      <TableCell>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {receivables.map((r) => {
              const remaining = r.amount - r.paid
              const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
              return (
                <div
                  key={r.id}
                  className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                  onClick={() => router.push(`/receivables/${r.id}`)}
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-base leading-tight truncate">
                          {r.customer?.store_name || "-"}
                        </h3>
                        {r.sales_user?.full_name && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            NV: {r.sales_user.full_name}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Hạn: {r.due_date ? formatDate(r.due_date) : "-"}
                        </p>
                      </div>
                      <div className="shrink-0">
                        <Badge variant={agingVariant(aging)}>{r.status}</Badge>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                      <div>
                        <p className="text-muted-foreground">Phải thu</p>
                        <p className="font-medium">{formatCurrency(r.amount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Đã thu</p>
                        <p className="font-medium">{formatCurrency(r.paid)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Còn lại</p>
                        <p className="font-bold text-destructive">{formatCurrency(remaining)}</p>
                      </div>
                    </div>
                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => handleExportStatement()}
                      >
                        <FileText className="mr-1 h-3.5 w-3.5" />
                        Xuất bản kê
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <DataPagination pg={pg} shownCount={receivables.length} />
        </>
      )}
    </div>
  )
}
