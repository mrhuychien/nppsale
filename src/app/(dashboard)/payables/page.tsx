"use client"

import { useEffect, useState, useMemo } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
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
  const { user, loading: authLoading } = useRoleGuard("receivables")
  const [payables, setPayables] = useState<Payable[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [allOpen, setAllOpen] = useState<Array<Pick<Payable, "amount" | "paid" | "due_date" | "supplier_id" | "status">>>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("payables", DEFAULT_PAYABLE_COLUMNS, [])
  const show = (k: PayableColumnKey) => visibleColumns.includes(k)

  // Stats: load all UNPAID light fields cho aging summary.
  useEffect(() => {
    async function loadOpen() {
      const { data } = await supabase
        .from("payables")
        .select("amount, paid, due_date, supplier_id, status")
        .neq("status", "paid")
      setAllOpen((data as Array<Pick<Payable, "amount" | "paid" | "due_date" | "supplier_id" | "status">>) || [])
    }
    loadOpen()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Paginated table query.
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      // selectResilient: DB thiếu cột thì tự thử lại với '*', và luôn trả error
      // để hiển thị nguyên nhân thay vì danh sách rỗng im lặng.
      const build = (select: string) => {
        let q = supabase
          .from("payables")
          .select(select, { count: "exact" })
          .order("due_date")
          .range(pg.from, pg.to)
        if (debouncedSearch) {
          const term = `%${debouncedSearch.replace(/[%_]/g, "\\$&")}%`
          q = q.ilike("invoice_number", term)
        }
        if (statusFilter !== "all") q = q.eq("status", statusFilter)
        return q
      }
      const res = await selectResilient<Payable>(
        build,
        "id, invoice_number, amount, paid, due_date, status, supplier:suppliers(name, code)",
        // eslint-disable-next-line no-restricted-syntax
        "*, supplier:suppliers(name, code)"
      )
      if (cancelled) return
      setPayables(res.data)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)
      setLoading(false)
    }
    fetchData()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter supplier name client-side trên page hiện tại (cross-table join filter
  // không trực tiếp được trên server-side với Supabase).
  const filtered = useMemo(() => {
    if (!debouncedSearch) return payables
    const q = debouncedSearch.toLowerCase()
    // Nếu invoice_number đã match server-side, mọi row đều OK.
    // Đồng thời also lọc theo supplier nếu user search tên NCC.
    return payables.filter(
      (p) =>
        p.invoice_number?.toLowerCase().includes(q) ||
        p.supplier?.name?.toLowerCase().includes(q) ||
        p.supplier?.code?.toLowerCase().includes(q)
    )
  }, [payables, debouncedSearch])

  if (authLoading) return <Skeleton className="h-96" />

  const totalOutstanding = allOpen.reduce((sum, p) => sum + (Number(p.amount) - Number(p.paid)), 0)
  const totalInTerm = allOpen
    .filter((p) => !p.due_date || getAgingStatus(p.due_date) === "current")
    .reduce((sum, p) => sum + (Number(p.amount) - Number(p.paid)), 0)
  const totalOverdue = allOpen
    .filter((p) => p.due_date && getAgingStatus(p.due_date) !== "current")
    .reduce((sum, p) => sum + (Number(p.amount) - Number(p.paid)), 0)
  const suppliersWithDebt = new Set(allOpen.map((p) => p.supplier_id)).size

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

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách công nợ nhà cung cấp</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <Skeleton className="h-96" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Factory className="h-8 w-8 text-muted-foreground" />}
          title={loadError ? "Không tải được dữ liệu" : "Chưa có công nợ NCC"}
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : search || statusFilter !== "all"
                ? "Thử thay đổi bộ lọc"
                : payables.length === 0 &&
                    (user?.role === "sales" || user?.role === "driver" || user?.role === "warehouse")
                  ? "Vai trò của bạn không có quyền xem công nợ nhà cung cấp (giá vốn nhập). Đây là dữ liệu tài chính chỉ dành cho Chủ, Quản lý và Kế toán — liên hệ kế toán nếu cần đối chiếu."
                  : "Tạo công nợ nhà cung cấp đầu tiên"
          }
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
          <DataPagination pg={pg} shownCount={filtered.length} />
        </>
      )}
    </div>
  )
}
