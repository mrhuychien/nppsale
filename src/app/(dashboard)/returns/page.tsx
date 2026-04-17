"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { RETURN_REASONS } from "@/lib/constants"
import {
  RotateCcw,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  BadgeCheck,
  PieChart,
} from "lucide-react"
import type { Return } from "@/types"

export default function ReturnsPage() {
  const { user, loading: authLoading } = useRoleGuard("returns")
  const [returns, setReturns] = useState<Return[]>([])
  const [loading, setLoading] = useState(true)
  const [reasonFilter, setReasonFilter] = useState("all")
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("returns")
        .select(
          "*, customer:customers(store_name), requester:users!returns_requested_by_fkey(full_name)"
        )
        .order("created_at", { ascending: false })
      setReturns((data as Return[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    return {
      pending: returns.filter((r) => r.status === "pending").length,
      approved: returns.filter((r) => r.status === "approved").length,
      rejected: returns.filter((r) => r.status === "rejected").length,
      completed: returns.filter((r) => r.status === "completed").length,
    }
  }, [returns])

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
    if (reasonFilter === "all") return returns
    return returns.filter((r) => r.reason === reasonFilter)
  }, [returns, reasonFilter])

  if (authLoading || loading) return <Skeleton className="h-96" />

  const getReasonLabel = (reason: string | null) =>
    RETURN_REASONS.find((r) => r.value === reason)?.label || reason || "-"

  const REASON_COLORS: Record<string, string> = {
    damaged: "bg-red-500",
    wrong_item: "bg-amber-500",
    near_expiry: "bg-orange-500",
    expired: "bg-rose-600",
    refused: "bg-slate-500",
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Trả hàng" description={`${returns.length} yêu cầu`}>
        {user && hasPermission(user.role, "returns", "create") && (
          <Button onClick={() => router.push("/returns/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo yêu cầu
          </Button>
        )}
      </PageHeader>

      {/* Stats cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-2xl shadow-ambient">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-xl bg-amber-100 p-3 text-amber-700">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Chờ duyệt</div>
              <div className="text-2xl font-bold">{stats.pending}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-ambient">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Đã duyệt</div>
              <div className="text-2xl font-bold">{stats.approved}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-ambient">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-xl bg-red-100 p-3 text-red-700">
              <XCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Từ chối</div>
              <div className="text-2xl font-bold">{stats.rejected}</div>
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-ambient">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
              <BadgeCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Hoàn tất</div>
              <div className="text-2xl font-bold">{stats.completed}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="w-56">
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
            {reasonFilter !== "all" && (
              <Button size="sm" variant="ghost" onClick={() => setReasonFilter("all")}>
                Xóa lọc
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {filtered.length} / {returns.length}
            </span>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<RotateCcw className="h-8 w-8 text-muted-foreground" />}
              title="Chưa có yêu cầu trả hàng"
            />
          ) : (
            <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Lý do</TableHead>
                    <TableHead>Người yêu cầu</TableHead>
                    <TableHead className="text-right">Credit Note</TableHead>
                    <TableHead>Ngày</TableHead>
                    <TableHead>Trạng thái</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/returns/${r.id}`)}
                    >
                      <TableCell className="font-medium">
                        {r.customer?.store_name || "-"}
                      </TableCell>
                      <TableCell>{getReasonLabel(r.reason)}</TableCell>
                      <TableCell>{r.requester?.full_name || "-"}</TableCell>
                      <TableCell className="text-right">
                        {r.credit_note_amount ? formatCurrency(r.credit_note_amount) : "-"}
                      </TableCell>
                      <TableCell>{formatDate(r.created_at)}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} type="return" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
