"use client"

import { useEffect, useMemo, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { PageHeader } from "@/components/ui/page-header"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import {
  RETURN_COLUMNS,
  DEFAULT_RETURN_COLUMNS,
  RETURN_FILTERS,
  DEFAULT_RETURN_FILTERS,
  type ReturnColumnKey,
  type ReturnFilterKey,
} from "./list-config"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { RETURN_REASONS } from "@/lib/constants"
import { RotateCcw, PieChart, Search, Info } from "lucide-react"
import type { Return } from "@/types"

const REASON_COLORS: Record<string, string> = {
  damaged: "bg-error",
  wrong_item: "bg-[#fdb022]",
  near_expiry: "bg-[#f97316]",
  expired: "bg-[#dc2626]",
  refused: "bg-on-surface-variant",
}

export default function ReturnsPage() {
  const { loading: authLoading } = useRoleGuard("returns")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const [returns, setReturns] = useState<Return[]>([])
  const [loading, setLoading] = useState(true)
  const [reasonFilter, setReasonFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [totalCount, setTotalCount] = useState(0)
  const [reasonCounts, setReasonCounts] = useState<Record<string, number>>({})
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const router = useRouter()
  const supabase = createClient()

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "returns",
    DEFAULT_RETURN_COLUMNS,
    DEFAULT_RETURN_FILTERS
  )
  const show = (k: ReturnColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: ReturnFilterKey) => activeFilters.includes(k)

  // Stats: count theo reason (mount 1 lần, toàn tổng).
  useEffect(() => {
    async function loadStats() {
      const { count: totalC } = await supabase
        .from("returns")
        .select("id", { count: "exact", head: true })
      setTotalCount(totalC ?? 0)
      const counts: Record<string, number> = {}
      await Promise.all(
        RETURN_REASONS.map(async (r) => {
          const { count } = await supabase
            .from("returns")
            .select("id", { count: "exact", head: true })
            .eq("reason", r.value)
          counts[r.value] = count ?? 0
        })
      )
      setReasonCounts(counts)
    }
    loadStats()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const maxReasonCount = Math.max(1, ...Object.values(reasonCounts))

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, reasonFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      let q = supabase
        .from("returns")
        .select(
          "*, customer:customers(store_name), requester:users!returns_requested_by_fkey(full_name), order:sales_orders(order_code)",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(pg.from, pg.to)
      if (filterActive("reason") && reasonFilter !== "all") {
        q = q.eq("reason", reasonFilter)
      }
      const { data, count } = await q
      if (cancelled) return
      const raw = (data as Return[]) || []
      // Search cross-table (customer/requester/order) → client-side trên page.
      let list = raw
      if (filterActive("search") && debouncedSearch) {
        const term = debouncedSearch.toLowerCase()
        list = raw.filter((r) =>
          (r.customer?.store_name || "").toLowerCase().includes(term) ||
          (r.requester?.full_name || "").toLowerCase().includes(term) ||
          ((r as Return & { order?: { order_code?: string } }).order?.order_code || "").toLowerCase().includes(term)
        )
      }
      setReturns(list)
      pg.setTotal(count ?? 0)
      setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, reasonFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  // Đã filter server-side (reason) + client-side trên page (search).
  const filtered = returns

  if (authLoading) return <Skeleton className="h-96" />

  const getReasonLabel = (reason: string | null) =>
    RETURN_REASONS.find((r) => r.value === reason)?.label || reason || "—"

  const totalCredit = filtered.reduce(
    (s, r) => s + Number(r.credit_note_amount || 0),
    0
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title={isSales ? "Trả hàng của tôi" : "Trả hàng"}
        description={`${totalCount} phiếu trả • Tra cứu thông tin`}
      />

      <Card className="border-primary-fixed-dim bg-primary-fixed">
        <CardContent className="flex items-start gap-3 p-3 text-sm">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-0.5 text-on-primary-fixed-variant">
            <p className="font-semibold">Danh sách tra cứu</p>
            <p className="text-xs opacity-90">
              Phiếu trả được tự động tạo từ bước Bàn giao lại sau khi lái xe
              quay về (giao thất bại / khách nhận một phần). Trang này chỉ
              dùng để tra cứu thông tin, không cần thao tác duyệt.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {filterActive("search") && (
              <div className="relative sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Tìm khách / đơn / NV…"
                  className="pl-8 h-9"
                />
              </div>
            )}
            {filterActive("reason") && (
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="h-9 sm:w-56">
                  <SelectValue placeholder="Lọc theo lý do" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả lý do</SelectItem>
                  {RETURN_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(reasonFilter !== "all" || search.trim() !== "") && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReasonFilter("all")
                  setSearch("")
                }}
              >
                Xoá lọc
              </Button>
            )}
            <div className="sm:ml-auto flex items-center gap-2">
              <FilterPicker
                available={RETURN_FILTERS}
                value={activeFilters}
                onChange={setFilters}
                onReset={resetFilters}
              />
              <ColumnPicker
                available={RETURN_COLUMNS}
                value={visibleColumns}
                onChange={setColumns}
                onReset={resetColumns}
              />
            </div>
            <span className="text-xs text-muted-foreground sm:ml-2">
              {pg.total} • Tổng credit{" "}
              <span className="font-semibold text-foreground">
                {formatCurrency(totalCredit)}
              </span>
            </span>
          </div>

          {loading ? (
            <Skeleton className="h-64" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<RotateCcw className="h-8 w-8 text-muted-foreground" />}
              title="Không có phiếu trả nào"
              description="Phiếu trả sẽ xuất hiện tự động khi xử lý bàn giao lại."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {show("date") && <TableHead>Ngày</TableHead>}
                      <TableHead>Khách hàng</TableHead>
                      {show("orderCode") && <TableHead>Đơn gốc</TableHead>}
                      {show("reason") && <TableHead>Lý do</TableHead>}
                      {show("requester") && <TableHead>Người tạo</TableHead>}
                      {show("creditNote") && <TableHead className="text-right">Credit Note</TableHead>}
                      {show("status") && <TableHead>Trạng thái</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const orderCode = (r as Return & { order?: { order_code?: string } }).order?.order_code
                      return (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => router.push(`/returns/${r.id}`)}
                        >
                          {show("date") && (
                            <TableCell className="text-sm whitespace-nowrap">
                              {formatDate(r.created_at)}
                            </TableCell>
                          )}
                          <TableCell className="font-medium">
                            {r.customer?.store_name || "—"}
                          </TableCell>
                          {show("orderCode") && (
                            <TableCell className="font-mono text-xs">
                              {orderCode || "—"}
                            </TableCell>
                          )}
                          {show("reason") && <TableCell>{getReasonLabel(r.reason)}</TableCell>}
                          {show("requester") && (
                            <TableCell className="text-sm">
                              {r.requester?.full_name || "—"}
                            </TableCell>
                          )}
                          {show("creditNote") && (
                            <TableCell className="text-right tabular-nums">
                              {r.credit_note_amount ? formatCurrency(r.credit_note_amount) : "—"}
                            </TableCell>
                          )}
                          {show("status") && (
                            <TableCell>
                              <StatusBadge status={r.status} type="return" />
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile card list */}
              <div className="lg:hidden space-y-3">
                {filtered.map((r) => {
                  const orderCode = (r as Return & { order?: { order_code?: string } }).order?.order_code
                  return (
                    <div
                      key={r.id}
                      className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                      onClick={() => router.push(`/returns/${r.id}`)}
                    >
                      <div className="p-4">
                        <div className="flex justify-between items-start gap-3 mb-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-extrabold text-base leading-tight truncate">
                              {r.customer?.store_name || "—"}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Lý do:{" "}
                              <span className="font-medium text-foreground">
                                {getReasonLabel(r.reason)}
                              </span>
                            </p>
                            {orderCode && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                Đơn gốc: <span className="font-mono">{orderCode}</span>
                              </p>
                            )}
                            {r.requester?.full_name && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                Người tạo: {r.requester.full_name}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(r.created_at)}
                            </p>
                          </div>
                          <div className="shrink-0">
                            <StatusBadge status={r.status} type="return" />
                          </div>
                        </div>
                        {r.credit_note_amount ? (
                          <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                            <span className="text-xs text-muted-foreground">Credit Note</span>
                            <span className="font-bold text-base">
                              {formatCurrency(r.credit_note_amount)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
              <DataPagination pg={pg} shownCount={filtered.length} />
            </>
          )}
        </div>

        {/* Reason breakdown */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChart className="h-4 w-4 text-primary" />
              Phân loại lý do
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {RETURN_REASONS.map((r) => {
              const count = reasonCounts[r.value] || 0
              const pct = (count / maxReasonCount) * 100
              const color = REASON_COLORS[r.value] || "bg-primary"
              return (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setReasonFilter(r.value)}
                  className={`w-full text-left space-y-1 rounded-xl p-2 transition-colors hover:bg-muted/50 ${
                    reasonFilter === r.value ? "bg-muted/50 ring-1 ring-primary/30" : ""
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{r.label}</span>
                    <span className="font-bold">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
