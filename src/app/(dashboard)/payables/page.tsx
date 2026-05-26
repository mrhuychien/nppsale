"use client"

import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { PageHeader } from "@/components/ui/page-header"
import {
  PAYABLE_COLUMNS,
  DEFAULT_PAYABLE_COLUMNS,
  type PayableColumnKey,
} from "./list-config"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate, getAgingStatus } from "@/lib/utils"
import { Factory, Plus, Search } from "lucide-react"
import Link from "next/link"
import type { Payable, PayableStatus } from "@/types"

type StatusFilter = "all" | "open" | "partial" | "overdue" | "paid"

const PAYABLE_STATUS_MAP: Record<PayableStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" }> = {
  open: { label: "Chưa trả", variant: "secondary" },
  partial: { label: "Trả một phần", variant: "warning" },
  paid: { label: "Đã trả đủ", variant: "success" },
  overdue: { label: "Quá hạn", variant: "danger" },
}

export default function PayablesPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const [payables, setPayables] = useState<Payable[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("payables", DEFAULT_PAYABLE_COLUMNS, [])
  const show = (k: PayableColumnKey) => visibleColumns.includes(k)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("payables")
        .select("*, supplier:suppliers(name, code)")
        .order("due_date")
      setPayables((data as Payable[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let result = payables
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (p) =>
          p.supplier?.name?.toLowerCase().includes(q) ||
          p.supplier?.code?.toLowerCase().includes(q) ||
          p.invoice_number?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== "all") {
      result = result.filter((p) => p.status === statusFilter)
    }
    return result
  }, [payables, search, statusFilter])

  if (authLoading || loading) return <Skeleton className="h-96" />

  const openPayables = payables.filter((p) => p.status !== "paid")
  const totalOutstanding = openPayables.reduce((sum, p) => sum + (p.amount - p.paid), 0)
  const totalInTerm = openPayables
    .filter((p) => !p.due_date || getAgingStatus(p.due_date) === "current")
    .reduce((sum, p) => sum + (p.amount - p.paid), 0)
  const totalOverdue = openPayables
    .filter((p) => p.due_date && getAgingStatus(p.due_date) !== "current")
    .reduce((sum, p) => sum + (p.amount - p.paid), 0)
  const suppliersWithDebt = new Set(openPayables.map((p) => p.supplier_id)).size

  const getDaysOverdue = (dueDate: string | null): number => {
    if (!dueDate) return 0
    const now = new Date()
    const due = new Date(dueDate)
    return Math.ceil((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
  }

  const agingVariant = (status: string): "success" | "warning" | "danger" | "default" => {
    switch (status) {
      case "current": return "success"
      case "warning": return "warning"
      case "overdue": return "danger"
      case "critical": return "danger"
      default: return "default"
    }
  }

  const agingLabel = (days: number): string => {
    if (days <= 0) return "Trong hạn"
    return `${days} ngày`
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Công nợ nhà cung cấp" description={`Tổng phải trả: ${formatCurrency(totalOutstanding)}`}>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/payables/by-supplier">Theo NCC</Link>
          </Button>
          <Button asChild className="bg-primary text-on-primary shadow-card">
            <Link href="/payables/new"><Plus className="mr-2 h-4 w-4" />Tạo công nợ NCC</Link>
          </Button>
        </div>
      </PageHeader>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng phải trả</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trong hạn</p>
            <p className="text-xl font-black mt-1 text-tertiary">{formatCurrency(totalInTerm)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quá hạn</p>
            <p className="text-xl font-black mt-1 text-destructive">{formatCurrency(totalOverdue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số NCC đang nợ</p>
            <p className="text-xl font-black mt-1">{suppliersWithDebt}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm theo NCC, mã hóa đơn..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {(["all", "open", "partial", "overdue", "paid"] as StatusFilter[]).map((f) => {
                const labels: Record<StatusFilter, string> = {
                  all: "Tất cả",
                  open: "Chưa trả",
                  partial: "Trả 1 phần",
                  overdue: "Quá hạn",
                  paid: "Đã trả",
                }
                return (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      statusFilter === f
                        ? "bg-primary text-on-primary"
                        : "bg-surface-low text-muted-foreground hover:bg-surface-container"
                    }`}
                  >
                    {labels[f]}
                  </button>
                )
              })}
            </div>
            <ColumnPicker
              available={PAYABLE_COLUMNS}
              value={visibleColumns}
              onChange={setColumns}
              onReset={resetColumns}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Factory className="h-8 w-8 text-muted-foreground" />}
          title="Chưa có công nợ NCC"
          description={search || statusFilter !== "all" ? "Thử thay đổi bộ lọc" : "Tạo công nợ nhà cung cấp đầu tiên"}
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
                      <TableHead>Nhà cung cấp</TableHead>
                      {show("invoiceNumber") && <TableHead>Mã HĐ</TableHead>}
                      {show("amount") && <TableHead className="text-right">Số tiền</TableHead>}
                      {show("paid") && <TableHead className="text-right">Đã trả</TableHead>}
                      {show("remaining") && <TableHead className="text-right">Còn lại</TableHead>}
                      {show("dueDate") && <TableHead>Hạn trả</TableHead>}
                      {show("aging") && <TableHead>Tuổi nợ</TableHead>}
                      {show("status") && <TableHead>Trạng thái</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const remaining = p.amount - p.paid
                      const aging = p.due_date ? getAgingStatus(p.due_date) : "current"
                      const daysOverdue = getDaysOverdue(p.due_date)
                      const statusCfg = PAYABLE_STATUS_MAP[p.status as PayableStatus] || { label: p.status, variant: "default" as const }
                      return (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer"
                          onClick={() => router.push(`/payables/${p.id}`)}
                        >
                          <TableCell className="font-medium">{p.supplier?.name || "-"}</TableCell>
                          {show("invoiceNumber") && <TableCell className="font-mono text-xs">{p.invoice_number || "-"}</TableCell>}
                          {show("amount") && <TableCell className="text-right tabular-nums">{formatCurrency(p.amount)}</TableCell>}
                          {show("paid") && <TableCell className="text-right tabular-nums">{formatCurrency(p.paid)}</TableCell>}
                          {show("remaining") && <TableCell className="text-right font-bold tabular-nums">{formatCurrency(remaining)}</TableCell>}
                          {show("dueDate") && <TableCell>{p.due_date ? formatDate(p.due_date) : "-"}</TableCell>}
                          {show("aging") && (
                            <TableCell>
                              {p.status !== "paid" && p.due_date ? (
                                <Badge variant={agingVariant(aging)}>{agingLabel(daysOverdue)}</Badge>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                          )}
                          {show("status") && (
                            <TableCell>
                              <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((p) => {
              const remaining = p.amount - p.paid
              const aging = p.due_date ? getAgingStatus(p.due_date) : "current"
              const daysOverdue = getDaysOverdue(p.due_date)
              const statusCfg = PAYABLE_STATUS_MAP[p.status as PayableStatus] || { label: p.status, variant: "default" as const }
              return (
                <div
                  key={p.id}
                  className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                  onClick={() => router.push(`/payables/${p.id}`)}
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-base leading-tight truncate">
                          {p.supplier?.name || "-"}
                        </h3>
                        {p.invoice_number && (
                          <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate">
                            HĐ: {p.invoice_number}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Hạn: {p.due_date ? formatDate(p.due_date) : "-"}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                        {p.status !== "paid" && p.due_date && (
                          <Badge variant={agingVariant(aging)}>{agingLabel(daysOverdue)}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                      <div>
                        <p className="text-muted-foreground">Số tiền</p>
                        <p className="font-medium">{formatCurrency(p.amount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Đã trả</p>
                        <p className="font-medium">{formatCurrency(p.paid)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Còn lại</p>
                        <p className="font-bold text-destructive">{formatCurrency(remaining)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
