"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { PageHeader } from "@/components/ui/page-header"
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
  damaged: "bg-red-500",
  wrong_item: "bg-amber-500",
  near_expiry: "bg-orange-500",
  expired: "bg-rose-600",
  refused: "bg-slate-500",
}

export default function ReturnsPage() {
  const { loading: authLoading } = useRoleGuard("returns")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const [returns, setReturns] = useState<Return[]>([])
  const [loading, setLoading] = useState(true)
  const [reasonFilter, setReasonFilter] = useState("all")
  const [search, setSearch] = useState("")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("returns")
        .select(
          "*, customer:customers(store_name), requester:users!returns_requested_by_fkey(full_name), order:sales_orders(order_code)"
        )
        .order("created_at", { ascending: false })
      setReturns((data as Return[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const reasonCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    RETURN_REASONS.forEach((r) => (counts[r.value] = 0))
    returns.forEach((r) => {
      if (r.reason && counts[r.reason] !== undefined) counts[r.reason]++
    })
    return counts
  }, [returns])

  const maxReasonCount = Math.max(1, ...Object.values(reasonCounts))

  const filtered = useMemo(() => {
    let list = returns
    if (reasonFilter !== "all") list = list.filter((r) => r.reason === reasonFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((r) =>
        (r.customer?.store_name || "").toLowerCase().includes(q) ||
        (r.requester?.full_name || "").toLowerCase().includes(q) ||
        ((r as Return & { order?: { order_code?: string } }).order?.order_code || "").toLowerCase().includes(q)
      )
    }
    return list
  }, [returns, reasonFilter, search])

  if (authLoading || loading) return <Skeleton className="h-96" />

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
        description={`${returns.length} phiếu trả • Tra cứu thông tin`}
      />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-3 text-sm">
          <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="space-y-0.5 text-primary">
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
            <div className="relative sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm khách / đơn / NV…"
                className="pl-8 h-9"
              />
            </div>
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
            <span className="text-xs text-muted-foreground sm:ml-auto">
              {filtered.length} / {returns.length} • Tổng credit{" "}
              <span className="font-semibold text-foreground">
                {formatCurrency(totalCredit)}
              </span>
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<RotateCcw className="h-8 w-8 text-muted-foreground" />}
              title="Không có phiếu trả nào"
              description="Phiếu trả sẽ xuất hiện tự động khi xử lý bàn giao lại."
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block rounded-2xl border bg-card shadow-sm overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ngày</TableHead>
                      <TableHead>Khách hàng</TableHead>
                      <TableHead>Đơn gốc</TableHead>
                      <TableHead>Lý do</TableHead>
                      <TableHead>Người tạo</TableHead>
                      <TableHead className="text-right">Credit Note</TableHead>
                      <TableHead>Trạng thái</TableHead>
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
                          <TableCell className="text-sm whitespace-nowrap">
                            {formatDate(r.created_at)}
                          </TableCell>
                          <TableCell className="font-medium">
                            {r.customer?.store_name || "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {orderCode || "—"}
                          </TableCell>
                          <TableCell>{getReasonLabel(r.reason)}</TableCell>
                          <TableCell className="text-sm">
                            {r.requester?.full_name || "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.credit_note_amount ? formatCurrency(r.credit_note_amount) : "—"}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={r.status} type="return" />
                          </TableCell>
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
                      className="relative rounded-2xl border bg-card shadow-ambient overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
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
            </>
          )}
        </div>

        {/* Reason breakdown */}
        <Card className="rounded-2xl shadow-ambient h-fit">
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
