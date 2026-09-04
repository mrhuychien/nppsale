"use client"

import { useEffect, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { MobileRecordCard } from "@/components/ui/mobile-record-card"
import { LoadMore } from "@/components/ui/load-more"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
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
import { CustomerImportDialog } from "@/components/customers/customer-import-dialog"
import {
  Phone, Plus, Search, Users, HandCoins, ClipboardList, Navigation, Route, FilePlus2, Power, PowerOff, Upload } from "lucide-react"
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterSheet, setFilterSheet] = useState(false)
  const [statusFilter, setStatusFilter] = useState("all")
  const [channelFilter, setChannelFilter] = useState("all")
  const [salesUserFilter, setSalesUserFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [stats, setStats] = useState({ total: 0, visited: 0 })
  const [importOpen, setImportOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
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

  // Stats: tổng KH + KH đã ghé hôm nay — count query, không phụ thuộc pagination.
  useEffect(() => {
    async function loadStats() {
      // "Đã ghé hôm nay" phải đếm LƯỢT GHÉ, không phải đơn hàng.
      //
      // Trước đây chỗ này đếm distinct customer_id trong sales_orders tạo
      // hôm nay. Ghé thăm và bán được hàng là hai việc khác nhau: nhân viên
      // ghé 10 cửa hàng, lấy được 3 đơn thì màn Khách hàng hiện "3" còn màn
      // Trang chủ (đếm visit_logs) hiện "10" — hai con số cùng tên "hôm nay"
      // trên hai màn hình. Và huy hiệu "Đã ghé hôm nay" trên từng dòng khách
      // cũng sai theo: ghé mà không bán được thì không có huy hiệu.
      //
      // Ngày lấy theo lịch máy của người dùng (điện thoại ở Việt Nam) chứ
      // không phải UTC — visit_date là cột `date` nên so bằng chuỗi YYYY-MM-DD.
      const today = new Date()
      const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
      const [totalRes, visitsTodayRes] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase
          .from("visit_logs")
          .select("customer_id")
          .eq("visit_date", todayDate),
      ])
      const qErr2 = ([totalRes, visitsTodayRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr2) console.error("[app/customers] truy vấn lỗi:", qErr2.message)
      const visitsToday = new Set<string>()
      for (const v of (visitsTodayRes.data as Array<{ customer_id: string | null }>) || []) {
        if (v.customer_id) visitsToday.add(v.customer_id)
      }
      setStats({ total: totalRes.count ?? 0, visited: visitsToday.size })
      setVisitedToday(visitsToday)
    }
    loadStats()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi filter/search đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, statusFilter, channelFilter, salesUserFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  // List query — paginate + filter server-side.
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      // selectResilient: nếu DB production thiếu cột (lệch migration) thì tự
      // thử lại với '*' thay vì trả danh sách rỗng im lặng; luôn trả error
      // để hiển thị nguyên nhân cho người dùng.
      const build = (select: string) => {
        let q = supabase
          .from("customers")
          .select(select, { count: "exact" })
          .order("store_name")
          .range(pg.from, pg.to)
        if (debouncedSearch) {
          const term = `%${debouncedSearch.replace(/[%_]/g, "\\$&")}%`
          q = q.or(`store_name.ilike.${term},owner_name.ilike.${term},phone.ilike.${term}`)
        }
        if (statusFilter !== "all") q = q.eq("status", statusFilter)
        if (channelFilter !== "all") q = q.eq("channel", channelFilter)
        return q
      }
      const res = await selectResilient<Customer>(
        build,
        "id, org_id, store_name, owner_name, phone, address, province, district, ward, channel, group_id, credit_limit, payment_terms, status, gps_lat, gps_lng, created_at, created_by, billing_name, tax_code, billing_address, billing_email, payment_method_label, group:customer_groups(*)",
        // eslint-disable-next-line no-restricted-syntax
        "*, group:customer_groups(*)"
      )
      // Huỷ request khi điều hướng nhanh — không phải lỗi, và không
      // được ghi mảng rỗng đè lên danh sách đang hiện.
      if (cancelled || res.aborted) return
      const list = res.data
      setCustomers(list)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)

      // Load aggregates CHỈ cho khách trên page hiện tại.
      const ids = list.map((c) => c.id)
      if (ids.length === 0) {
        setDebts({}); setLastOrders({}); setLastVisits({}); setPrimaryRepMap({})
        setLoading(false)
        return
      }
      const [recvRes, lastOrdersRes, lastVisitsRes, assignsRes] = await Promise.all([
        supabase
          .from("receivables")
          .select("customer_id, amount, paid, status")
          .in("customer_id", ids)
          .neq("status", "paid"),
        supabase
          .from("sales_orders")
          .select("customer_id, order_code, order_date, total")
          .in("customer_id", ids)
          .order("order_date", { ascending: false }),
        supabase
          .from("visit_logs")
          .select("customer_id, visit_date, check_in_at, result, sales_user:users!visit_logs_sales_user_id_fkey(full_name)")
          .in("customer_id", ids)
          .order("visit_date", { ascending: false })
          .order("check_in_at", { ascending: false }),
        supabase
          .from("customer_assignments")
          .select("customer_id, user_id, role, status")
          .in("customer_id", ids)
          .eq("role", "primary")
          .eq("status", "active"),
      ])
      const qErr = ([recvRes, lastOrdersRes, lastVisitsRes, assignsRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[app/customers] truy vấn lỗi:", qErr.message)
      if (cancelled) return
      const debtMap: Record<string, number> = {}
      for (const r of (recvRes.data as Pick<Receivable, "customer_id" | "amount" | "paid">[]) || []) {
        const outstanding = Number(r.amount || 0) - Number(r.paid || 0)
        if (outstanding > 0) debtMap[r.customer_id] = (debtMap[r.customer_id] || 0) + outstanding
      }
      setDebts(debtMap)
      const orderMap: Record<string, LastOrderInfo> = {}
      for (const o of (lastOrdersRes.data as Array<Pick<SalesOrder, "customer_id" | "order_code" | "order_date" | "total">>) || []) {
        if (o.customer_id && !orderMap[o.customer_id]) {
          orderMap[o.customer_id] = { order_code: o.order_code, order_date: o.order_date, total: o.total }
        }
      }
      setLastOrders(orderMap)
      const visitMap: Record<string, LastVisitInfo> = {}
      for (const v of (lastVisitsRes.data as Array<{ customer_id: string; visit_date: string; check_in_at: string | null; result: string | null; sales_user?: { full_name?: string } | null }>) || []) {
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
      const repMap: Record<string, string> = {}
      for (const a of (assignsRes.data as Array<{ customer_id: string; user_id: string }>) || []) {
        if (!repMap[a.customer_id]) repMap[a.customer_id] = a.user_id
      }
      setPrimaryRepMap(repMap)

      setLoading(false)
    }
    fetchData()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, statusFilter, channelFilter, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load active sales users for the rep filter
  useEffect(() => {
    if (isSales) return // sales only see their own customers, no need for filter
    async function loadReps() {
      const { data, error: dataErr } = await supabase
        .from("users")
        .select("id, full_name, role")
        .in("role", ["sales", "manager", "owner"])
        .eq("is_active", true)
        .order("full_name")
      if (dataErr) console.error("[app/customers] truy vấn lỗi:", dataErr.message)
      setSalesUsers((data as Array<{ id: string; full_name: string }>) || [])
    }
    loadReps()
  }, [isSales]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load sales routes for the filter dropdown
  useEffect(() => {
    async function loadRoutes() {
      const { data, error: dataErr } = await supabase
        .from("sales_routes")
        .select("code, name")
        .eq("is_active", true)
        .order("sort_order")
      if (dataErr) console.error("[app/customers] truy vấn lỗi:", dataErr.message)
      setRoutes((data as Array<{ code: string; name: string }>) || [])
    }
    loadRoutes()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filterActive = (k: CustomerFilterKey) => activeFilters.includes(k)

  // Sales rep filter client-side (cần primaryRepMap đã load cho page hiện tại).
  // Các filter khác đã server-side.
  const filtered = customers.filter((c) => {
    if (filterActive("sales") && salesUserFilter !== "all") {
      if (salesUserFilter === "_none" ? primaryRepMap[c.id] : primaryRepMap[c.id] !== salesUserFilter)
        return false
    }
    return true
  })

  const totalRoute = stats.total
  const visitedCount = stats.visited
  const progressPct = totalRoute > 0 ? Math.round((visitedCount / totalRoute) * 100) : 0

  const handleCheckIn = (c: Customer) => {
    setVisitTarget(c)
  }

  const handleVisitSuccess = async () => {
    // Refresh last visits after check-in
    const { data: latestVisits, error: latestVisitsErr } = await supabase
      .from("visit_logs")
      .select("customer_id, visit_date, check_in_at, result, sales_user:users!visit_logs_sales_user_id_fkey(full_name)")
      .order("visit_date", { ascending: false })
      .order("check_in_at", { ascending: false })
      .limit(500)
    if (latestVisitsErr) console.error("[app/customers] truy vấn lỗi:", latestVisitsErr.message)
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

  // Bộ lọc đang bật (ngoài ô tìm) — hiện lên badge nút Lọc.
  const activeFilterCount =
    (statusFilter !== "all" ? 1 : 0) +
    (channelFilter !== "all" ? 1 : 0) +
    (salesUserFilter !== "all" ? 1 : 0)

  const clearFilters = () => {
    setStatusFilter("all")
    setChannelFilter("all")
    setSalesUserFilter("all")
  }

  return (
    <div className="space-y-4">
      <PageHeader title={isSales ? "Khách hàng của tôi" : "Khách hàng"} description={`${customers.length} khách hàng`}>
        {user && hasPermission(user.role, "customers", "create") && (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Nhập Excel
            </Button>
            <Button onClick={() => router.push("/customers/new")}><Plus className="mr-2 h-4 w-4" /> Thêm KH</Button>
          </>
        )}
      </PageHeader>

      {isSales && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          <span>Bạn chỉ thấy KH được phân công cho bạn. Liên hệ Quản lý nếu cần phân công thêm.</span>
        </div>
      )}

      {/* Lộ trình hôm nay — mobile thu về MỘT dòng có thanh tiến độ
          (56px thay vì 96px). Cùng số liệu, chỉ bớt chỗ trống. */}
      <div className="rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card p-3 lg:p-4">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-label-md uppercase text-on-surface-variant">Lộ trình hôm nay</p>
              <span className="shrink-0 text-sm font-bold text-primary tabular-data">{progressPct}%</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <p className="shrink-0 text-base font-bold tracking-tight text-on-surface tabular-data lg:text-xl">
                {visitedCount}
                <span className="text-xs font-medium text-on-surface-variant lg:text-sm">
                  {" "}/ {totalRoute} điểm
                </span>
              </p>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm tên cửa hàng, SĐT…"
        activeCount={activeFilterCount}
        onClear={clearFilters}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Trạng thái</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Tất cả" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                <SelectItem value="active">Đang hoạt động</SelectItem>
                <SelectItem value="suspended">Tạm ngưng</SelectItem>
                <SelectItem value="locked">Đã khoá</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Tuyến</label>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger><SelectValue placeholder="Tất cả tuyến" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả tuyến</SelectItem>
                {routes.map((r) => (
                  <SelectItem key={r.code} value={r.code}>{r.code} — {r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!isSales && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-on-surface-variant">Nhân viên</label>
              <Select value={salesUserFilter} onValueChange={setSalesUserFilter}>
                <SelectTrigger><SelectValue placeholder="Tất cả nhân viên" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả nhân viên</SelectItem>
                  <SelectItem value="_none">Chưa phân công</SelectItem>
                  {salesUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button variant="outline" className="h-11 w-full" asChild>
            <Link href="/customers/routes">
              <Route className="mr-1.5 h-4 w-4" /> Quản lý tuyến
            </Link>
          </Button>
        </div>
      </MobileFilterBar>

      <div className="hidden lg:flex flex-wrap items-center gap-2">
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

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách khách hàng</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8 text-muted-foreground" />}
          title={
            loadError
              ? "Không tải được dữ liệu"
              : customers.length === 0
                ? "Chưa có khách hàng"
                : "Không có khách hàng phù hợp"
          }
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : customers.length === 0
                ? user?.role === "sales"
                  ? "Bạn chưa được phân công khách hàng nào. Vào Thêm KH để tìm và nhận khách có sẵn về danh sách của mình, hoặc nhờ quản lý phân công."
                  : user?.role === "warehouse" || user?.role === "driver"
                    ? "Vai trò của bạn chỉ xem được khách hàng gắn với công việc được giao. Liên hệ quản lý hoặc kế toán nếu cần tra cứu khách hàng."
                    : "Bắt đầu bằng cách thêm khách hàng đầu tiên"
                : "Thử điều chỉnh bộ lọc"
          }
        />
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
                <MobileRecordCard
                  key={c.id}
                  href={`/customers/${c.id}`}
                  title={c.store_name}
                  // Công nợ là con số NVBH quét mắt tìm khi mở danh sách
                  // khách — đưa lên dòng đầu thay vì chôn ở ô thứ ba của
                  // lưới tóm tắt.
                  amount={debt > 0 ? formatCurrency(debt) : undefined}
                  amountTone={debt > 0 ? "danger" : "default"}
                  accent={isBadDebt ? "danger" : hasVisited ? "warning" : null}
                  subtitle={
                    <>
                      {c.owner_name && <span className="font-medium text-primary/80">{c.owner_name}</span>}
                      {c.phone && <span>· {c.phone}</span>}
                      {lastVisit && <span>· Ghé {formatDate(lastVisit.visit_date)}</span>}
                      {lastOrder && <span>· Đơn {formatDate(lastOrder.order_date)}</span>}
                    </>
                  }
                  badges={
                    <>
                      {hasVisited && <Badge variant="success">Đã ghé hôm nay</Badge>}
                      {c.channel && <Badge variant="outline">{c.channel}</Badge>}
                      {isBadDebt && (
                        <span className="rounded-full bg-error-container px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-error-container">
                          Nợ xấu
                        </span>
                      )}
                    </>
                  }
                  footer={
                    <>
                      {/* Hai việc NVBH làm nhiều nhất khi mở danh sách
                          khách — trước đây phải vào chi tiết mới làm được
                          (gọi điện) hoặc nằm trong nút 40px (tạo đơn). */}
                      <div className="flex gap-2">
                        {c.phone ? (
                          <a
                            href={`tel:${c.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border border-outline-variant text-[13px] font-semibold text-on-surface active:bg-surface-container"
                          >
                            <Phone className="h-4 w-4" /> Gọi
                          </a>
                        ) : (
                          <span className="flex h-11 flex-1 items-center justify-center rounded-lg border border-dashed border-outline-variant text-[13px] text-on-surface-variant">
                            Chưa có SĐT
                          </span>
                        )}
                        <Button variant="outline" className="h-11 flex-1" asChild>
                          {/* Tham số là `customerId` — order-form đọc đúng
                              tên này rồi tự chọn khách. */}
                          <Link href={`/orders/new?customerId=${c.id}`}>
                            <FilePlus2 className="mr-1.5 h-4 w-4" /> Tạo đơn
                          </Link>
                        </Button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <Button
                          variant="ghost"
                          className="h-11 text-[12px]"
                          onClick={() => handleCheckIn(c)}
                        >
                          <Navigation className="mr-1 h-3.5 w-3.5" /> Ghé thăm
                        </Button>
                        <Button
                          variant="ghost"
                          className="h-11 text-[12px] text-error disabled:opacity-40"
                          disabled={debt <= 0}
                          asChild={debt > 0}
                        >
                          {debt > 0 ? (
                            <Link href={`/receivables/collect?customerId=${c.id}`}>
                              <HandCoins className="mr-1 h-3.5 w-3.5" /> Thu tiền
                            </Link>
                          ) : (
                            <span>
                              <HandCoins className="mr-1 h-3.5 w-3.5" /> Thu tiền
                            </span>
                          )}
                        </Button>
                        <Button variant="ghost" className="h-11 text-[12px]" onClick={handleInventoryCheck}>
                          <ClipboardList className="mr-1 h-3.5 w-3.5" /> Kiểm tồn
                        </Button>
                      </div>
                    </>
                  }
                />
              )
            })}
            <LoadMore pg={pg} shown={filtered.length} />
          </div>
          <div className="hidden lg:block">
            <DataPagination pg={pg} shownCount={filtered.length} />
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

      <CustomerImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        autoAssignToSelf={isSales}
        onImported={() => {
          pg.reset()
          setRefreshTick((t) => t + 1)
        }}
      />
    </div>
  )
}
