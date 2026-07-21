"use client"

/**
 * Trang chuyến giao — list view.
 *
 * Đơn giản: chỉ hiển thị chuyến giao + status theo flow xử lý đơn:
 *   pending      → "Chưa khởi hành"  (delivery row mới tạo, chưa start)
 *   in_transit   → "Đang giao hàng"  (sau Tự giao / driver xuất phát)
 *   completed    → "Đã giao hàng"    (handover xong, items đã nhập kho)
 *   completed + settled_at → "Đã nộp tiền"
 *   cancelled    → "Đã huỷ"
 *
 * Bỏ section "Đơn chờ bàn giao" cũ — sau Pack3 self-deliver flow,
 * chuyến giao tự tạo trong handleSelfDeliver, không cần manual
 * dispatch nữa.
 */

import { useEffect, useMemo, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import Link from "next/link"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import {
  DELIVERY_COLUMNS,
  DEFAULT_DELIVERY_COLUMNS,
  type DeliveryColumnKey,
} from "./list-config"
import { formatCurrency, formatDate } from "@/lib/utils"
import {
  Truck,
  Plus,
  Search,
  Navigation,
  CheckCircle2,
  Clock,
  Wallet,
  XCircle,
  PackageCheck,
} from "lucide-react"
import type { Delivery } from "@/types"

type DerivedStatus =
  | "pending"
  | "in_transit"
  | "delivered"
  | "settled"
  | "cancelled"

interface DeliveryRow extends Omit<Delivery, "driver"> {
  settled_at?: string | null
  settled_amount?: number | null
  goods_handover_at?: string | null
  source_stock_entry_id?: string | null
  driver?: { full_name?: string | null } | null
}

interface DeliveryWithStats extends DeliveryRow {
  _stats: {
    orderCount: number
    deliveredCount: number
    failedCount: number
    totalValue: number
  }
}

const DERIVED_STATUS_META: Record<
  DerivedStatus,
  {
    label: string
    badge: "secondary" | "warning" | "success" | "danger" | "default"
    icon: typeof Clock
    description: string
  }
> = {
  pending: {
    label: "Chưa khởi hành",
    badge: "secondary",
    icon: Clock,
    description: "Chuyến đã tạo, chờ giao",
  },
  in_transit: {
    label: "Đang giao hàng",
    badge: "warning",
    icon: Navigation,
    description: "Lái xe / chủ xe đang trên đường",
  },
  delivered: {
    label: "Đã giao hàng",
    badge: "default",
    icon: PackageCheck,
    description: "Đã bàn giao lại — chờ thu tiền",
  },
  settled: {
    label: "Đã nộp tiền",
    badge: "success",
    icon: Wallet,
    description: "Đã thu tiền + nộp về kế toán",
  },
  cancelled: {
    label: "Đã huỷ",
    badge: "danger",
    icon: XCircle,
    description: "Chuyến bị huỷ",
  },
}

function deriveStatus(d: DeliveryRow): DerivedStatus {
  if (d.status === "cancelled") return "cancelled"
  if (d.settled_at) return "settled"
  if (d.status === "completed") return "delivered"
  if (d.status === "in_transit") return "in_transit"
  return "pending"
}

const TAB_FILTERS: Array<{
  value: "all" | DerivedStatus
  label: string
}> = [
  { value: "all", label: "Tất cả" },
  { value: "in_transit", label: "Đang giao" },
  { value: "delivered", label: "Đã giao — chờ thu tiền" },
  { value: "settled", label: "Đã nộp tiền" },
  { value: "pending", label: "Chưa khởi hành" },
  { value: "cancelled", label: "Đã huỷ" },
]

export default function DeliveriesPage() {
  const { loading: authLoading } = useRoleGuard("deliveries")
  const { user } = useAuth()
  const [deliveries, setDeliveries] = useState<DeliveryWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"all" | DerivedStatus>("all")
  const [search, setSearch] = useState("")
  const [statusCounts, setStatusCounts] = useState<Record<DerivedStatus, number>>({
    pending: 0, in_transit: 0, delivered: 0, settled: 0, cancelled: 0,
  })
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs(
    "deliveries",
    DEFAULT_DELIVERY_COLUMNS,
    []
  )
  const show = (k: DeliveryColumnKey) => visibleColumns.includes(k)
  const supabase = createClient()

  // Reset page khi filter/tab đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stats counts theo derived status — chính xác toàn tổng, không phụ thuộc page.
  useEffect(() => {
    async function loadCounts() {
      const [cancelledRes, inTransitRes, settledRes, deliveredRes, pendingRes] = await Promise.all([
        supabase.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
        supabase.from("deliveries").select("id", { count: "exact", head: true }).eq("status", "in_transit"),
        supabase.from("deliveries").select("id", { count: "exact", head: true })
          .not("settled_at", "is", null).not("status", "eq", "cancelled"),
        supabase.from("deliveries").select("id", { count: "exact", head: true })
          .eq("status", "completed").is("settled_at", null),
        // pending: status null OR status not in (cancelled,in_transit,completed)
        // Đơn giản hoá: count(all) - count(các trên).
        supabase.from("deliveries").select("id", { count: "exact", head: true }),
      ])
      const cancelled = cancelledRes.count ?? 0
      const inTransit = inTransitRes.count ?? 0
      const settled = settledRes.count ?? 0
      const delivered = deliveredRes.count ?? 0
      const total = pendingRes.count ?? 0
      setStatusCounts({
        pending: Math.max(0, total - cancelled - inTransit - settled - delivered),
        in_transit: inTransit,
        delivered,
        settled,
        cancelled,
      })
      // Total value open (in_transit + delivered): cần aggregation từ delivery_lines.
      // Để đơn giản, skip computing chính xác — sẽ tính trên page hiện tại.
    }
    loadCounts()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    async function fetchAll() {
      setLoading(true)
      let q = supabase
        .from("deliveries")
        .select(
          "id, org_id, driver_id, vehicle, route_name, status, started_at, completed_at, created_at, warehouse_confirmed_by, warehouse_confirmed_at, driver_confirmed_by, driver_confirmed_at, settled_at, settled_amount, goods_handover_at, goods_handover_by, goods_handover_notes, source_stock_entry_id, driver:users!deliveries_driver_id_fkey(full_name)",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(pg.from, pg.to)
      // Filter status theo activeTab (cố gắng server-side cho 4/5 trường hợp đơn giản).
      if (activeTab === "cancelled") q = q.eq("status", "cancelled")
      else if (activeTab === "in_transit") q = q.eq("status", "in_transit")
      else if (activeTab === "settled") q = q.not("settled_at", "is", null).not("status", "eq", "cancelled")
      else if (activeTab === "delivered") q = q.eq("status", "completed").is("settled_at", null)
      // activeTab === "pending" hoặc "all" → không filter status (pending hiếm, để client lọc nếu cần).
      const { data: rows, count } = await q
      if (cancelled) return
      const list = ((rows as DeliveryRow[]) || [])

      // Aggregate stats per delivery from delivery_lines.
      const ids = list.map((d) => d.id)
      const statsByDelivery: Record<
        string,
        { orderCount: number; deliveredCount: number; failedCount: number; totalValue: number }
      > = {}
      if (ids.length > 0) {
        const { data: lineRows } = await supabase
          .from("delivery_lines")
          .select("delivery_id, status, order:sales_orders(total)")
          .in("delivery_id", ids)
        type LineRow = {
          delivery_id: string
          status: string
          order?: { total?: number | null } | null
        }
        ;((lineRows as unknown) as LineRow[] | null)?.forEach((l) => {
          const s = (statsByDelivery[l.delivery_id] = statsByDelivery[
            l.delivery_id
          ] || { orderCount: 0, deliveredCount: 0, failedCount: 0, totalValue: 0 })
          s.orderCount += 1
          if (l.status === "delivered") s.deliveredCount += 1
          if (l.status === "failed") s.failedCount += 1
          s.totalValue += Number(l.order?.total || 0)
        })
      }

      const withStats: DeliveryWithStats[] = list.map((d) => ({
        ...d,
        _stats: statsByDelivery[d.id] || {
          orderCount: 0,
          deliveredCount: 0,
          failedCount: 0,
          totalValue: 0,
        },
      }))

      if (!cancelled) {
        // Search/pending filter chạy client-side trên page hiện tại.
        let result = withStats
        if (activeTab === "pending") {
          result = result.filter((d) => deriveStatus(d) === "pending")
        }
        if (debouncedSearch) {
          const term = debouncedSearch.toLowerCase()
          result = result.filter((d) =>
            [d.id, d.route_name, d.vehicle, d.driver?.full_name]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(term)
          )
        }
        setDeliveries(result)
        pg.setTotal(count ?? 0)
        setLoading(false)
      }
    }
    fetchAll()
    return () => {
      cancelled = true
    }
  }, [supabase, pg.from, pg.to, activeTab, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const counts: Record<DerivedStatus, number> = {
      pending: 0,
      in_transit: 0,
      delivered: 0,
      settled: 0,
      cancelled: 0,
    }
    // Counts từ server (chính xác toàn tổng).
    Object.assign(counts, statusCounts)
    // totalValueOpen vẫn tính trên page hiện tại (chưa có server-side aggregation).
    let totalValueOpen = 0
    for (const d of deliveries) {
      const s = deriveStatus(d)
      if (s === "in_transit" || s === "delivered") {
        totalValueOpen += d._stats.totalValue
      }
    }
    return { counts, totalValueOpen }
  }, [deliveries, statusCounts])

  // Đã filter ở fetchAll — pass-through.
  const filtered = deliveries

  if (authLoading) return <Skeleton className="h-96" />

  const isDriver = user?.role === "driver"

  return (
    <div className="space-y-4">
      <PageHeader
        title="Chuyến giao hàng"
        description="Theo dõi mọi chuyến giao theo trạng thái xử lý đơn"
      >
        {!isDriver && (
          <Button asChild>
            <Link href="/deliveries/new">
              <Plus className="h-4 w-4 mr-1.5" /> Tạo chuyến mới
            </Link>
          </Button>
        )}
      </PageHeader>

      {/* Stats cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {(["in_transit", "delivered", "settled", "pending", "cancelled"] as DerivedStatus[]).map(
          (s) => {
            const meta = DERIVED_STATUS_META[s]
            const Icon = meta.icon
            const count = stats.counts[s]
            const accent =
              s === "settled"
                ? "border-l-emerald-500"
                : s === "delivered"
                  ? "border-l-blue-500"
                  : s === "in_transit"
                    ? "border-l-amber-500"
                    : s === "cancelled"
                      ? "border-l-rose-500"
                      : "border-l-muted"
            return (
              <Card
                key={s}
                className={`border-l-4 ${accent} cursor-pointer hover:shadow-sm transition-shadow ${
                  activeTab === s ? "ring-2 ring-primary" : ""
                }`}
                onClick={() => setActiveTab(s)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <Icon className="h-7 w-7 text-muted-foreground" />
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {meta.label}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">{count}</p>
                  </div>
                </CardContent>
              </Card>
            )
          }
        )}
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          className="flex-1"
        >
          <TabsList className="overflow-x-auto justify-start gap-1 h-auto flex-wrap">
            {TAB_FILTERS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
                {t.value !== "all" && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    {stats.counts[t.value as DerivedStatus]}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Tìm route / xe / lái xe..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 w-56"
            />
          </div>
          <ColumnPicker
            available={DELIVERY_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
      </div>

      {/* Deliveries table */}
      {loading ? (
        <Skeleton className="h-64" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<Truck className="h-8 w-8 text-muted-foreground" />}
              title={
                deliveries.length === 0
                  ? "Chưa có chuyến giao nào"
                  : "Không có chuyến phù hợp bộ lọc"
              }
              description={
                deliveries.length === 0
                  ? "Chuyến giao tự tạo khi bạn bấm Tự giao hàng & thu tiền trên 1 phiếu xuất kho, hoặc bạn có thể tạo thủ công."
                  : "Đổi tab hoặc xoá tìm kiếm để xem nhiều hơn."
              }
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Trạng thái</TableHead>
                  <TableHead>Chuyến / Lái xe</TableHead>
                  {show("vehicle") && <TableHead>Xe</TableHead>}
                  {show("orderCount") && <TableHead className="text-right">Số đơn</TableHead>}
                  {show("totalValue") && <TableHead className="text-right">Tổng giá trị</TableHead>}
                  {show("createdAt") && <TableHead className="w-[110px]">Tạo</TableHead>}
                  {show("updatedAt") && <TableHead className="w-[110px]">Cập nhật cuối</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const status = deriveStatus(d)
                  const meta = DERIVED_STATUS_META[status]
                  const Icon = meta.icon
                  const lastUpdate =
                    d.settled_at ||
                    d.completed_at ||
                    d.started_at ||
                    d.created_at
                  return (
                    <TableRow key={d.id} className="hover:bg-muted/40">
                      <TableCell>
                        <Badge variant={meta.badge} className="gap-1">
                          <Icon className="h-3 w-3" />
                          {meta.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/deliveries/${d.id}`}
                          className="font-semibold text-primary hover:underline"
                        >
                          {d.route_name || `Chuyến ${d.id.slice(0, 8)}`}
                        </Link>
                        <div className="text-[11px] text-muted-foreground">
                          {d.driver?.full_name || "Chưa gán lái xe"}
                          {d.source_stock_entry_id && (
                            <span className="ml-1.5 text-[#b54708]">
                              · Tự giao
                            </span>
                          )}
                        </div>
                      </TableCell>
                      {show("vehicle") && (
                        <TableCell className="text-sm">
                          {d.vehicle || "—"}
                        </TableCell>
                      )}
                      {show("orderCount") && (
                        <TableCell className="text-right tabular-nums">
                          <span className="font-semibold">{d._stats.orderCount}</span>
                          {d._stats.deliveredCount > 0 && (
                            <span className="ml-1 text-[10px] text-tertiary">
                              (✓{d._stats.deliveredCount})
                            </span>
                          )}
                          {d._stats.failedCount > 0 && (
                            <span className="ml-1 text-[10px] text-error">
                              (✗{d._stats.failedCount})
                            </span>
                          )}
                        </TableCell>
                      )}
                      {show("totalValue") && (
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(d._stats.totalValue)}
                        </TableCell>
                      )}
                      {show("createdAt") && (
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(d.created_at)}
                        </TableCell>
                      )}
                      {show("updatedAt") && (
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(lastUpdate)}
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <DataPagination pg={pg} shownCount={filtered.length} />
          </CardContent>
        </Card>
      )}

      {/* Hint about flow */}
      <Card className="border-dashed">
        <CardContent className="p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground mb-1.5 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> Flow chuyến giao
          </p>
          <ol className="space-y-0.5 pl-4 list-decimal">
            <li>
              <strong>Đang giao hàng:</strong> sau khi bấm <em>Tự giao hàng & thu tiền</em>{" "}
              trên phiếu xuất kho, hoặc tạo chuyến + driver xuất phát.
            </li>
            <li>
              <strong>Đã giao hàng:</strong> sau khi nhận bàn giao lại từ tài xế (xác nhận
              đơn thất bại / giao 1 phần / nhập kho hàng trả).
            </li>
            <li>
              <strong>Đã nộp tiền:</strong> sau khi quyết toán chuyến giao + lập phiếu thu.
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
