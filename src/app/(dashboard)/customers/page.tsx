"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useToast } from "@/hooks/use-toast"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { CustomerTable } from "@/components/customers/customer-table"
import { VisitCheckinDialog } from "@/components/customers/visit-checkin-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { BulkActionsBar, type BulkAction } from "@/components/ui/bulk-actions-bar"
import { Plus, Search, Users, MapPin, HandCoins, ClipboardList, Navigation, Calendar, ShoppingBag, Route, FilePlus2, Power, PowerOff } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import type { Customer, Receivable, SalesOrder } from "@/types"
import {
  CUSTOMER_COLUMNS,
  DEFAULT_CUSTOMER_COLUMNS,
  CUSTOMER_FILTERS,
  DEFAULT_CUSTOMER_FILTERS,
  type CustomerFilterKey,
} from "./list-config"

interface LastOrderInfo {
  order_code: string
  order_date: string
  total: number
}

interface LastVisitInfo {
  visit_date: string
  check_in_at: string | null
  result: string | null
  sales_user_name: string | null
}

export default function CustomersPage() {
  const { user, loading: authLoading } = useRoleGuard("customers")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const [customers, setCustomers] = useState<Customer[]>([])
  const [debts, setDebts] = useState<Record<string, number>>({})
  const [visitedToday, setVisitedToday] = useState<Set<string>>(new Set())
  const [lastOrders, setLastOrders] = useState<Record<string, LastOrderInfo>>({})
  const [lastVisits, setLastVisits] = useState<Record<string, LastVisitInfo>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [channelFilter, setChannelFilter] = useState("all")
  const [salesUserFilter, setSalesUserFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const { toast } = useToast()
  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "customers",
    DEFAULT_CUSTOMER_COLUMNS,
    DEFAULT_CUSTOMER_FILTERS
  )
  const [routes, setRoutes] = useState<Array<{ code: string; name: string }>>([])
  const [salesUsers, setSalesUsers] = useState<Array<{ id: string; full_name: string }>>([])
  const [primaryRepMap, setPrimaryRepMap] = useState<Record<string, string>>({})
  const [visitTarget, setVisitTarget] = useState<Customer | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const { data: cData } = await supabase
        .from("customers")
        .select("*, group:customer_groups(*)")
        .order("store_name")
      const list = (cData as Customer[]) || []
      setCustomers(list)

      // Unpaid receivables per customer
      const { data: recData } = await supabase
        .from("receivables")
        .select("customer_id, amount, paid, status")
        .neq("status", "paid")
      const debtMap: Record<string, number> = {}
      for (const r of (recData as Pick<Receivable, "customer_id" | "amount" | "paid">[]) || []) {
        const outstanding = Number(r.amount || 0) - Number(r.paid || 0)
        if (outstanding > 0) {
          debtMap[r.customer_id] = (debtMap[r.customer_id] || 0) + outstanding
        }
      }
      setDebts(debtMap)

      // Today's orders (visits) per customer
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const { data: orders } = await supabase
        .from("sales_orders")
        .select("customer_id, order_date, created_at")
        .gte("created_at", todayStart.toISOString())
      const visits = new Set<string>()
      for (const o of (orders as Pick<SalesOrder, "customer_id">[]) || []) {
        if (o.customer_id) visits.add(o.customer_id)
      }
      setVisitedToday(visits)

      // Latest order per customer (any time)
      const { data: latestOrders } = await supabase
        .from("sales_orders")
        .select("customer_id, order_code, order_date, total")
        .order("order_date", { ascending: false })
        .limit(500)
      const orderMap: Record<string, LastOrderInfo> = {}
      for (const o of (latestOrders as Array<Pick<SalesOrder, "customer_id" | "order_code" | "order_date" | "total">>) || []) {
        if (o.customer_id && !orderMap[o.customer_id]) {
          orderMap[o.customer_id] = {
            order_code: o.order_code,
            order_date: o.order_date,
            total: o.total,
          }
        }
      }
      setLastOrders(orderMap)

      // Latest visit per customer
      const { data: latestVisits } = await supabase
        .from("visit_logs")
        .select("customer_id, visit_date, check_in_at, result, sales_user:users!visit_logs_sales_user_id_fkey(full_name)")
        .order("visit_date", { ascending: false })
        .order("check_in_at", { ascending: false })
        .limit(500)
      const visitMap: Record<string, LastVisitInfo> = {}
      for (const v of (latestVisits as Array<{ customer_id: string; visit_date: string; check_in_at: string | null; result: string | null; sales_user?: { full_name?: string } | null }>) || []) {
        if (v.customer_id && !visitMap[v.customer_id]) {
          visitMap[v.customer_id] = {
            visit_date: v.visit_date,
            check_in_at: v.check_in_at,
            result: v.result,
            sales_user_name: v.sales_user?.full_name || null,
          }
        }
      }
      setLastVisits(visitMap)

      // Primary sales rep per customer (for filter "Nhân viên phụ trách")
      const { data: assignmentRows } = await supabase
        .from("customer_assignments")
        .select("customer_id, user_id, role, status")
        .eq("role", "primary")
        .eq("status", "active")
      const repMap: Record<string, string> = {}
      for (const a of (assignmentRows as Array<{ customer_id: string; user_id: string }>) || []) {
        if (!repMap[a.customer_id]) repMap[a.customer_id] = a.user_id
      }
      setPrimaryRepMap(repMap)

      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load active sales users for the rep filter
  useEffect(() => {
    if (isSales) return // sales only see their own customers, no need for filter
    async function loadReps() {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, role")
        .in("role", ["sales", "manager", "owner"])
        .eq("is_active", true)
        .order("full_name")
      setSalesUsers((data as Array<{ id: string; full_name: string }>) || [])
    }
    loadReps()
  }, [isSales]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load sales routes for the filter dropdown
  useEffect(() => {
    async function loadRoutes() {
      const { data } = await supabase
        .from("sales_routes")
        .select("code, name")
        .eq("is_active", true)
        .order("sort_order")
      setRoutes((data as Array<{ code: string; name: string }>) || [])
    }
    loadRoutes()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filterActive = (k: CustomerFilterKey) => activeFilters.includes(k)

  const filtered = customers.filter((c) => {
    if (filterActive("search") && search) {
      const q = search.toLowerCase()
      const matches =
        c.store_name.toLowerCase().includes(q) ||
        c.owner_name.toLowerCase().includes(q) ||
        c.phone.includes(search)
      if (!matches) return false
    }
    if (filterActive("status") && statusFilter !== "all" && c.status !== statusFilter)
      return false
    if (filterActive("channel") && channelFilter !== "all" && c.channel !== channelFilter)
      return false
    if (filterActive("sales") && salesUserFilter !== "all") {
      if (salesUserFilter === "_none" ? primaryRepMap[c.id] : primaryRepMap[c.id] !== salesUserFilter)
        return false
    }
    return true
  })

  const totalRoute = customers.length
  const visitedCount = customers.filter((c) => visitedToday.has(c.id)).length
  const progressPct = totalRoute > 0 ? Math.round((visitedCount / totalRoute) * 100) : 0

  const handleCheckIn = (c: Customer) => {
    setVisitTarget(c)
  }

  const handleVisitSuccess = async () => {
    // Refresh last visits after check-in
    const { data: latestVisits } = await supabase
      .from("visit_logs")
      .select("customer_id, visit_date, check_in_at, result, sales_user:users!visit_logs_sales_user_id_fkey(full_name)")
      .order("visit_date", { ascending: false })
      .order("check_in_at", { ascending: false })
      .limit(500)
    const visitMap: Record<string, LastVisitInfo> = {}
    for (const v of (latestVisits as Array<{ customer_id: string; visit_date: string; check_in_at: string | null; result: string | null; sales_user?: { full_name?: string } | null }>) || []) {
      if (v.customer_id && !visitMap[v.customer_id]) {
        visitMap[v.customer_id] = {
          visit_date: v.visit_date,
          check_in_at: v.check_in_at,
          result: v.result,
          sales_user_name: v.sales_user?.full_name || null,
        }
      }
    }
    setLastVisits(visitMap)
  }

  const handleInventoryCheck = () => {
    alert("Tính năng đang phát triển")
  }

  const toggleOne = (id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (next) s.add(id)
      else s.delete(id)
      return s
    })
  }
  const toggleAll = (next: boolean) => {
    setSelectedIds(next ? new Set(filtered.map((c) => c.id)) : new Set())
  }
  const clearSelection = () => setSelectedIds(new Set())

  const allSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))
  const someSelected = filtered.some((c) => selectedIds.has(c.id))

  const setStatusBulk = async (next: "active" | "suspended") => {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    const ids = Array.from(selectedIds)
    const { error } = await supabase
      .from("customers")
      .update({ status: next })
      .in("id", ids)
    setBulkSaving(false)
    if (error) {
      toast({ title: "Lỗi cập nhật trạng thái", description: error.message, variant: "destructive" })
      return
    }
    setCustomers((prev) =>
      prev.map((c) => (selectedIds.has(c.id) ? { ...c, status: next } : c))
    )
    clearSelection()
    toast({
      title: next === "active" ? `Đã kích hoạt ${ids.length} KH` : `Đã tạm ngưng ${ids.length} KH`,
    })
  }

  const canEdit = !!user && hasPermission(user.role, "customers", "update")
  const bulkActions: BulkAction[] = canEdit
    ? [
        {
          key: "activate",
          label: "Kích hoạt",
          icon: Power,
          onClick: () => setStatusBulk("active"),
          loading: bulkSaving,
          variant: "default",
        },
        {
          key: "suspend",
          label: "Tạm ngưng",
          icon: PowerOff,
          onClick: () => setStatusBulk("suspended"),
          loading: bulkSaving,
          variant: "outline",
        },
      ]
    : []

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title={isSales ? "Khách hàng của tôi" : "Khách hàng"} description={`${customers.length} khách hàng`}>
        {user && hasPermission(user.role, "customers", "create") && (
          <Button onClick={() => router.push("/customers/new")}><Plus className="mr-2 h-4 w-4" /> Thêm KH</Button>
        )}
      </PageHeader>

      {isSales && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          <span>Bạn chỉ thấy KH được phân công cho bạn. Liên hệ Quản lý nếu cần phân công thêm.</span>
        </div>
      )}

      {/* Route progress (visible on all sizes; prominent on mobile) */}
      <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card p-4">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <p className="text-label-md uppercase text-on-surface-variant">Lộ trình hôm nay</p>
            <p className="text-xl font-bold tracking-tight text-on-surface tabular-data">
              {visitedCount}
              <span className="text-sm font-medium text-on-surface-variant"> / {totalRoute} điểm đã ghé</span>
            </p>
          </div>
          <span className="text-sm font-bold text-primary tabular-data">{progressPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-surface-container overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Tìm tên, SĐT..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        )}
        {filterActive("status") && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Trạng thái" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="active">Đang hoạt động</SelectItem>
              <SelectItem value="suspended">Tạm ngưng</SelectItem>
              <SelectItem value="locked">Đã khoá</SelectItem>
            </SelectContent>
          </Select>
        )}
        {filterActive("channel") && (
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Tuyến" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả tuyến</SelectItem>
              {routes.map((r) => (
                <SelectItem key={r.code} value={r.code}>{r.code} — {r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterActive("sales") && !isSales && (
          <Select value={salesUserFilter} onValueChange={setSalesUserFilter}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Nhân viên" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả nhân viên</SelectItem>
              <SelectItem value="_none">Chưa phân công</SelectItem>
              {salesUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FilterPicker
            available={CUSTOMER_FILTERS}
            value={activeFilters}
            onChange={setFilters}
            onReset={resetFilters}
          />
          <ColumnPicker
            available={CUSTOMER_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/customers/routes">
            <Route className="h-3.5 w-3.5 mr-1.5" /> Tuyến
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Users className="h-8 w-8 text-muted-foreground" />} title="Chưa có khách hàng" description="Bắt đầu bằng cách thêm khách hàng đầu tiên" />
      ) : (
        <>
          {/* Desktop: existing table */}
          <div className="hidden lg:block">
            <CustomerTable
              customers={filtered}
              debts={debts}
              lastOrders={lastOrders}
              lastVisits={lastVisits}
              canCollect={!!user && hasPermission(user.role, "receivables", "create")}
              visibleColumns={visibleColumns}
              selectable={canEdit}
              selectedIds={selectedIds}
              onToggleSelect={toggleOne}
              onToggleSelectAll={toggleAll}
              allSelected={allSelected}
              someSelected={someSelected && !allSelected}
            />
          </div>

          {/* Mobile: card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((c) => {
              const debt = debts[c.id] || 0
              const isBadDebt = debt > 0 && c.credit_limit > 0 && debt > c.credit_limit
              const hasVisited = visitedToday.has(c.id)
              const lastOrder = lastOrders[c.id]
              const lastVisit = lastVisits[c.id]
              return (
                <div
                  key={c.id}
                  className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden"
                >
                  <div
                    className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${
                      isBadDebt ? "bg-danger" : hasVisited ? "bg-success" : "bg-primary"
                    }`}
                  />
                  <div
                    className="p-4 pl-5 cursor-pointer active:scale-[0.99] transition-transform"
                    onClick={() => router.push(`/customers/${c.id}`)}
                  >
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-base leading-tight truncate">
                          {c.store_name}
                        </h3>
                        {c.owner_name && (
                          <p className="text-xs font-medium text-primary/80 mt-0.5 truncate">
                            {c.owner_name}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">{c.phone}</p>
                        <div className="flex items-center gap-1 text-muted-foreground mt-1">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <p className="text-xs truncate">{c.address || "-"}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {hasVisited && (
                          <Badge variant="success" className="whitespace-nowrap mb-1">Đã ghé hôm nay</Badge>
                        )}
                        {c.channel && <Badge variant="outline">{c.channel}</Badge>}
                      </div>
                    </div>

                    {/* Summary row: last visit, last order, debt */}
                    <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                      <div>
                        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                          <Navigation className="h-3 w-3 shrink-0" />
                          <span>Ghé thăm</span>
                        </div>
                        {lastVisit ? (
                          <p className="font-medium">{formatDate(lastVisit.visit_date)}</p>
                        ) : (
                          <p className="text-muted-foreground italic">Chưa có</p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                          <ShoppingBag className="h-3 w-3 shrink-0" />
                          <span>Đơn gần nhất</span>
                        </div>
                        {lastOrder ? (
                          <>
                            <p className="font-medium truncate">{formatDate(lastOrder.order_date)}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {formatCurrency(lastOrder.total)}
                            </p>
                          </>
                        ) : (
                          <p className="text-muted-foreground italic">Chưa có</p>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
                          <Calendar className="h-3 w-3 shrink-0" />
                          <span>Công nợ</span>
                        </div>
                        {debt > 0 ? (
                          <p className={`font-bold ${isBadDebt ? "text-danger" : "text-warning-foreground"}`}>
                            {formatCurrency(debt)}
                          </p>
                        ) : (
                          <p className="text-muted-foreground">0đ</p>
                        )}
                        {isBadDebt && (
                          <p className="text-[10px] font-bold text-danger">Nợ xấu</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-4 border-t divide-x">
                    <button
                      type="button"
                      className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold text-primary hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/orders/new?customerId=${c.id}`)
                      }}
                    >
                      <FilePlus2 className="h-4 w-4" /> Tạo đơn
                    </button>
                    <button
                      type="button"
                      className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold text-on-surface hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleCheckIn(c)
                      }}
                    >
                      <Navigation className="h-4 w-4" /> Ghé thăm
                    </button>
                    <button
                      type="button"
                      disabled={debt <= 0}
                      className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold text-error hover:bg-muted/50 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={(e) => {
                        e.stopPropagation()
                        router.push(`/receivables/collect?customerId=${c.id}`)
                      }}
                    >
                      <HandCoins className="h-4 w-4" /> Thu tiền
                    </button>
                    <button
                      type="button"
                      className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-semibold text-on-surface hover:bg-muted/50 active:scale-95 transition"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleInventoryCheck()
                      }}
                    >
                      <ClipboardList className="h-4 w-4" /> Kiểm tồn
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {visitTarget && (
        <VisitCheckinDialog
          open={!!visitTarget}
          onOpenChange={(open) => !open && setVisitTarget(null)}
          customerId={visitTarget.id}
          customerName={visitTarget.store_name}
          onSuccess={handleVisitSuccess}
        />
      )}

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="khách hàng"
      />
    </div>
  )
}
