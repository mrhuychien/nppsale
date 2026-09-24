"use client"

import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_KHACH_HANG } from "@/lib/search/list-filter-fields"
import { useEffect, useMemo, useState } from "react"
import { dieuKienTim } from "@/lib/search/list-search"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { buildManagers, managersSummary, type Manager } from "@/lib/customers/managers"
import { LoadMore } from "@/components/ui/load-more"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useToast } from "@/hooks/use-toast"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { CustomerTable } from "@/components/customers/customer-table"
import { CustomerListRow, type CustomerRowTag } from "@/components/customers/customer-list-row"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { BulkActionsBar, type BulkAction } from "@/components/ui/bulk-actions-bar"
import { CustomerImportDialog } from "@/components/customers/customer-import-dialog"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import {
  Plus, Search, Users, Route, Power, PowerOff, Upload, X, Map as MapIcon,
} from "lucide-react"
import { daysOverdueOf } from "@/lib/utils"
import {
  customerInitial,
  daysSinceVN,
  debtText,
  lastOrderText,
  groupByInitial,
  rowAccent,
  todayVN,
  COLD_DAYS,
  QUICK_FILTER_LABEL,
  QUICK_FILTER_GROUP,
  type QuickFilter,
} from "@/lib/customers/list-view"
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

/**
 * ⚠ BA THẺ LỌC NHANH, KHÔNG PHẢI BỐN. Mẫu có thêm "Chưa đặt 30 ngày";
 * thẻ đó cần biết ĐƠN GẦN NHẤT CỦA MỌI KHÁCH, mà PostgREST không tính
 * được `max(order_date) GROUP BY customer_id`. Làm ở trình duyệt nghĩa
 * là tải toàn bộ lịch sử đơn của cả nghìn khách về điện thoại. Dấu hiệu
 * "ngủ đông" vẫn hiện trên từng dòng (nhãn vàng + vạch vàng) vì dữ liệu
 * đó có sẵn theo trang; chỉ riêng BỘ LỌC là đang chờ một khung nhìn tổng
 * hợp phía database. Xem báo cáo gửi chủ nhà.
 */
const QUICK_FILTERS: QuickFilter[] = ["today", "overdue", "all"]

/**
 * Dòng MỚI NHẤT của từng khách trong `ids` (đơn gần nhất, lần ghé gần nhất).
 *
 * ⚠ VÌ SAO KHÔNG ĐỌC MỘT LỆNH `.in(ids)` NHƯ TRƯỚC. Lệnh ấy trả MỌI đơn /
 *   lần ghé của cả trang khách, sắp mới → cũ, và PostgREST cắt ở 1.000
 *   dòng TRONG IM LẶNG. Vài khách đặt hàng dày là lấp đầy 1.000 dòng ấy —
 *   khách còn lại hiện ô "Đơn gần nhất" / "Ghé gần nhất" TRỐNG như thể
 *   chưa từng mua, trong khi họ vẫn đang mua đều.
 *
 * CÁCH LÀM: đọc một trang đầu (≤1.000 dòng). Trang ấy chưa đầy → đã thấy
 *   hết, khách nào vắng là thật sự không có. Trang ấy ĐẦY → khách nào
 *   chưa thấy thì hỏi riêng từng người `.limit(1)` (tối đa bằng số khách
 *   trên trang, song song). Kết quả luôn đúng, và thường chỉ tốn 1 lệnh.
 *
 * ⚠ Lỗi thì trả `error` để nơi gọi HIỆN RA, không đổ về "chưa có đơn".
 */
type TrangMoiNhat = PromiseLike<{ data: unknown; error: { message: string } | null }>
async function moiNhatTheoKhach<T extends { customer_id: string }>(
  ids: string[],
  dung: (lo: string[]) => { range: (a: number, b: number) => TrangMoiNhat; limit: (n: number) => TrangMoiNhat }
): Promise<{ map: Record<string, T>; error: string | null }> {
  const map: Record<string, T> = {}
  const dau = await dung(ids).range(0, 999)
  if (dau.error) return { map, error: dau.error.message }
  const rows = (dau.data as T[] | null) || []
  for (const r of rows) if (r.customer_id && !map[r.customer_id]) map[r.customer_id] = r
  // Máy chủ trả ít hơn trần → đã thấy hết, không cần hỏi thêm.
  if (rows.length < 1000) return { map, error: null }
  const thieu = ids.filter((id) => !map[id])
  const rieng = await Promise.all(thieu.map((id) => dung([id]).limit(1)))
  const loi = rieng.find((r) => r.error)?.error
  if (loi) return { map, error: loi.message }
  for (const r of rieng) {
    const row = ((r.data as T[] | null) || [])[0]
    if (row) map[row.customer_id] = row
  }
  return { map, error: null }
}

export default function CustomersPage() {
  const { user, loading: authLoading } = useRoleGuard("customers")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const [customers, setCustomers] = useState<Customer[]>([])
  /**
   * `null` = CHƯA/KHÔNG đọc được công nợ. KHÔNG được hiện thành 0.
   *
   * ⚠ KHỞI TẠO BẰNG `null`, KHÔNG PHẢI `{}`. Truy vấn danh sách thường
   * xong trước phép cộng công nợ, nên với `{}` cả màn hiện "Không nợ"
   * trong vài trăm mili-giây — đủ để người đang quét tìm khách nợ đọc
   * nhầm rồi bỏ qua.
   */
  const [debts, setDebts] = useState<Record<string, number> | null>(null)
  const [debtWarning, setDebtWarning] = useState<string | null>(null)
  const [overdueIds, setOverdueIds] = useState<string[]>([])
  const [visitedToday, setVisitedToday] = useState<Set<string>>(new Set())
  /** Mã khách → số thứ tự điểm dừng trong tuyến hôm nay. */
  const [todayStops, setTodayStops] = useState<Map<string, number>>(new Map())
  const [lastOrders, setLastOrders] = useState<Record<string, LastOrderInfo>>({})
  const [lastVisits, setLastVisits] = useState<Record<string, LastVisitInfo>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [quick, setQuick] = useState<QuickFilter>("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [channelFilter, setChannelFilter] = useState("all")
  const [salesUserFilter, setSalesUserFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const locNC = useAdvancedFilter("customers", LOC_KHACH_HANG)
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
    DEFAULT_CUSTOMER_FILTERS,
    CUSTOMER_COLUMNS,
    CUSTOMER_FILTERS
  )
  const [routes, setRoutes] = useState<Array<{ code: string; name: string }>>([])
  const [salesUsers, setSalesUsers] = useState<Array<{ id: string; full_name: string }>>([])
  const [primaryRepMap, setPrimaryRepMap] = useState<Record<string, string>>({})
  const [managersMap, setManagersMap] = useState<Record<string, Manager[]>>({})
  const router = useRouter()
  const supabase = createClient()

  /**
   * Nền chung của ba thẻ lọc: tổng số khách, tuyến hôm nay, đã ghé hôm
   * nay, và công nợ còn mở của TOÀN BỘ khách.
   *
   * ⚠ CÔNG NỢ PHẢI KÉO ĐỦ QUA `fetchAllForAggregate`. Đọc thẳng một lần
   * là PostgREST cắt ở 1.000 dòng, HTTP 200, không lỗi — và thẻ "Nợ quá
   * hạn" đếm thiếu đúng những khách cần đòi nhất. Chạm trần thì để
   * `debts = null` và BÁO, chứ không hiện một con số thiếu.
   */
  useEffect(() => {
    let cancelled = false
    async function loadStats() {
      const todayDate = todayVN()
      // `getDay()` của máy người dùng (điện thoại ở Việt Nam) khớp với
      // quy ước 0=Chủ nhật của `pjp_routes.day_of_week`.
      const dow = new Date(`${todayDate}T12:00:00`).getDay()
      const [totalRes, visitsRes, pjpRes, recvRes] = await Promise.all([
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase.from("visit_logs").select("customer_id").eq("visit_date", todayDate),
        supabase
          .from("pjp_routes")
          .select("customer_id, visit_order")
          .eq("day_of_week", dow)
          .eq("is_active", true)
          .order("visit_order"),
        fetchAllForAggregate<Pick<Receivable, "customer_id" | "amount" | "paid" | "due_date">>(
          (from, to) =>
            supabase
              .from("receivables")
              .select("customer_id, amount, paid, due_date", { count: "exact" })
              .neq("status", "paid")
              .order("id")
              .range(from, to)
        ),
      ])
      if (cancelled) return
      const qErr = ([totalRes, visitsRes, pjpRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[app/customers] truy vấn lỗi:", qErr.message)

      setTotalCustomers(totalRes.count ?? 0)

      const visitsToday = new Set<string>()
      for (const v of (visitsRes.data as Array<{ customer_id: string | null }>) || []) {
        if (v.customer_id) visitsToday.add(v.customer_id)
      }
      setVisitedToday(visitsToday)

      const stops = new Map<string, number>()
      const pjpRows =
        (pjpRes.data as Array<{ customer_id: string; visit_order: number | null }>) || []
      pjpRows.forEach((r, i) => {
        // Nhiều nhân viên có thể cùng xếp một điểm vào hôm nay — giữ lần
        // đầu gặp để số điểm dừng không nhảy giữa hai lần vẽ.
        if (!stops.has(r.customer_id)) stops.set(r.customer_id, r.visit_order ?? i + 1)
      })
      setTodayStops(stops)

      if (recvRes.error || recvRes.truncated) {
        setDebts(null)
        setOverdueIds([])
        setDebtWarning(
          recvRes.error
            ? `Không đọc được công nợ: ${recvRes.error}`
            : "Công nợ vượt trần tải về nên cột nợ và thẻ “Nợ quá hạn” đang KHÔNG đủ — hãy dùng trang Công nợ để có số đúng."
        )
      } else {
        const debtMap: Record<string, number> = {}
        const overdueMap: Record<string, number> = {}
        for (const r of recvRes.rows) {
          const remaining = Number(r.amount || 0) - Number(r.paid || 0)
          if (remaining <= 0) continue
          debtMap[r.customer_id] = (debtMap[r.customer_id] || 0) + remaining
          if (daysOverdueOf(r.due_date) > 0) {
            overdueMap[r.customer_id] = (overdueMap[r.customer_id] || 0) + remaining
          }
        }
        setDebts(debtMap)
        setDebtWarning(null)
        // Sắp theo số nợ quá hạn giảm dần: người nợ nhiều nhất lên đầu.
        setOverdueIds(
          Object.keys(overdueMap).sort((a, b) => overdueMap[b] - overdueMap[a])
        )
      }
    }
    loadStats()
    return () => { cancelled = true }
  }, [refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi filter/search đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, locNC.key, statusFilter, channelFilter, salesUserFilter, quick, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Danh sách mã khách mà thẻ lọc nhanh giới hạn vào. `null` = không giới hạn. */
  const quickIds = useMemo<string[] | null>(() => {
    if (quick === "today") return Array.from(todayStops.keys())
    if (quick === "overdue") return overdueIds
    return null
  }, [quick, todayStops, overdueIds])

  // List query — paginate + filter server-side.
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      /**
       * ⚠ THẺ LỌC RỖNG THÌ DỪNG, ĐỪNG GỬI `in.()`. Một `.in("id", [])`
       * hoá thành `id=in.()` — PostgREST coi là lỗi cú pháp và trả về
       * lỗi 400, nên màn hiện "không tải được" thay vì "không có khách
       * nào trong tuyến hôm nay". Hai câu đó dẫn tới hai hành động khác
       * hẳn nhau.
       */
      if (quickIds !== null && quickIds.length === 0) {
        setCustomers([])
        setLoadError(null)
        pg.setTotal(0)
        setDebts((d) => d)
        setLastOrders({}); setLastVisits({}); setPrimaryRepMap({}); setManagersMap({})
        setLoading(false)
        return
      }

      /**
       * Thẻ lọc nhanh phân trang trên DANH SÁCH MÃ đã có sẵn, không phân
       * trang ở server: gửi một `in.()` dài hàng nghìn mã là URL vượt
       * trần của proxy và request chết với 414 mà không ai đoán ra vì sao.
       */
      const idSlice = quickIds ? quickIds.slice(pg.from, pg.to + 1) : null

      const build = (select: string) => {
        let q = supabase
          .from("customers")
          .select(select, { count: "exact" })
          .order("store_name")
        if (idSlice) q = q.in("id", idSlice)
        else q = q.range(pg.from, pg.to)
        if (debouncedSearch) {
          q = q.or(dieuKienTim("customers", ["store_name", "owner_name", "phone"], debouncedSearch))
        }
        /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
        for (const f of locNC.menhDe) q = q.or(f)
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
      // Với thẻ lọc nhanh, tổng là độ dài danh sách mã — `count` trả về
      // chỉ đếm trong lát cắt vừa gửi đi.
      pg.setTotal(quickIds ? quickIds.length : res.count ?? 0)

      // Load aggregates CHỈ cho khách trên page hiện tại.
      const ids = list.map((c) => c.id)
      if (ids.length === 0) {
        setLastOrders({}); setLastVisits({}); setPrimaryRepMap({}); setManagersMap({})
        setLoading(false)
        return
      }
      type LastOrderRow = Pick<SalesOrder, "customer_id" | "order_code" | "order_date" | "total">
      type LastVisitRow = {
        customer_id: string
        visit_date: string
        check_in_at: string | null
        result: string | null
        sales_user?: { full_name?: string } | null
      }
      const [lastOrdersRes, lastVisitsRes, assignsRes] = await Promise.all([
        moiNhatTheoKhach<LastOrderRow>(ids, (lo) =>
          supabase
            .from("sales_orders")
            .select("customer_id, order_code, order_date, total")
            .in("customer_id", lo)
            .order("order_date", { ascending: false })
            .order("id")
        ),
        moiNhatTheoKhach<LastVisitRow>(ids, (lo) =>
          supabase
            .from("visit_logs")
            .select("customer_id, visit_date, check_in_at, result, sales_user:users!visit_logs_sales_user_id_fkey(full_name)")
            .in("customer_id", lo)
            .order("visit_date", { ascending: false })
            .order("check_in_at", { ascending: false })
            .order("id")
        ),
        // KHÔNG lọc role='primary' nữa: cột "Phụ trách" phải hiện đủ
        // những người cùng vào một điểm bán. Bộ lọc theo NVBH bên dưới
        // vẫn chỉ lấy người CHÍNH — xem repMap.
        supabase
          .from("customer_assignments")
          .select("customer_id, user_id, role, status, user:users(id, full_name, is_active)")
          .in("customer_id", ids)
          .eq("status", "active"),
      ])
      if (assignsRes.error) console.error("[app/customers] truy vấn lỗi:", assignsRes.error.message)
      // ⚠ Đơn / lần ghé gần nhất đọc hỏng thì NÓI RA — ô trống ở đây đọc
      //   thành "khách chưa từng mua", một kết luận sai về người thật.
      const aggErr = lastOrdersRes.error ?? lastVisitsRes.error
      if (aggErr) setLoadError((prev) => prev ?? `Đơn / lần ghé gần nhất: ${aggErr}`)
      if (cancelled) return
      const orderMap: Record<string, LastOrderInfo> = {}
      for (const [cid, o] of Object.entries(lastOrdersRes.map)) {
        orderMap[cid] = { order_code: o.order_code, order_date: o.order_date, total: o.total }
      }
      setLastOrders(orderMap)
      const visitMap: Record<string, LastVisitInfo> = {}
      for (const [cid, v] of Object.entries(lastVisitsRes.map)) {
        visitMap[cid] = {
          visit_date: v.visit_date,
          check_in_at: v.check_in_at,
          result: v.result,
          sales_user_name: v.sales_user?.full_name || null,
        }
      }
      setLastVisits(visitMap)
      type AssignRow = {
        customer_id: string
        user_id: string
        role: string | null
        status: string | null
        user?: { id: string; full_name: string; is_active: boolean | null } | null
      }
      const assignRows = (assignsRes.data as unknown as AssignRow[]) || []
      const repMap: Record<string, string> = {}
      for (const a of assignRows) {
        // Bộ lọc "nhân viên phụ trách" vẫn hiểu là người CHÍNH — giữ
        // nguyên hành vi cũ, đừng để việc thêm cột đổi nghĩa bộ lọc.
        if (a.role === "primary" && !repMap[a.customer_id]) repMap[a.customer_id] = a.user_id
      }
      setPrimaryRepMap(repMap)

      // Ngành hàng của những người đang phụ trách trang này.
      const managerIds = Array.from(new Set(assignRows.map((a) => a.user_id).filter(Boolean)))
      let links: Array<{ user_id: string; supplier_id: string }> = []
      let sups: Array<{ id: string; name: string }> = []
      if (managerIds.length > 0) {
        const [linkRes, supRes] = await Promise.all([
          supabase.from("user_suppliers").select("user_id, supplier_id").in("user_id", managerIds),
          supabase.from("suppliers").select("id, name"),
        ])
        const linkErr = [linkRes, supRes].find((r) => r.error)?.error
        if (linkErr) console.error("[app/customers] truy vấn lỗi:", linkErr.message)
        links = (linkRes.data as typeof links) || []
        sups = (supRes.data as typeof sups) || []
      }
      const byCustomer = new Map<string, AssignRow[]>()
      for (const a of assignRows) {
        const arr = byCustomer.get(a.customer_id)
        if (arr) arr.push(a)
        else byCustomer.set(a.customer_id, [a])
      }
      const mgrMap: Record<string, Manager[]> = {}
      for (const [cid, rows] of Array.from(byCustomer.entries())) {
        mgrMap[cid] = buildManagers(
          rows.map((r) => ({ user_id: r.user_id, role: r.role, status: r.status })),
          rows.map((r) => r.user).filter((u): u is NonNullable<typeof u> => !!u),
          links,
          sups
        )
      }
      setManagersMap(mgrMap)

      setLoading(false)
    }
    fetchData()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, locNC.key, statusFilter, channelFilter, quickIds, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /** Đang xem tuyến hôm nay và không gõ tìm → xếp theo điểm dừng. */
  const routeMode = quick === "today" && !debouncedSearch

  const ordered = useMemo(() => {
    if (!routeMode) return filtered
    return filtered
      .slice()
      .sort((a, b) => (todayStops.get(a.id) ?? 0) - (todayStops.get(b.id) ?? 0))
  }, [filtered, routeMode, todayStops])

  /** Nhóm hiển thị trên điện thoại. */
  const groups = useMemo(() => {
    if (routeMode) {
      const un = ordered.filter((c) => !visitedToday.has(c.id))
      const vi = ordered.filter((c) => visitedToday.has(c.id))
      return [
        ...(un.length ? [{ label: "Chưa ghé", items: un }] : []),
        ...(vi.length ? [{ label: "Đã ghé", items: vi }] : []),
      ]
    }
    if (quick === "all" && !debouncedSearch) return groupByInitial(ordered)
    if (!ordered.length) return []
    return [
      {
        label: debouncedSearch
          ? `Kết quả · “${debouncedSearch}”`
          : QUICK_FILTER_GROUP[quick],
        items: ordered,
      },
    ]
  }, [ordered, routeMode, quick, debouncedSearch, locNC.key, visitedToday])

  const visitedOnRoute = Array.from(todayStops.keys()).filter((id) => visitedToday.has(id)).length
  const routeTotal = todayStops.size

  const quickCount = (k: QuickFilter): number =>
    k === "today" ? todayStops.size : k === "overdue" ? overdueIds.length : totalCustomers

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

  const clearFilters = () => {
    setStatusFilter("all")
    setChannelFilter("all")
    setSalesUserFilter("all")
  }
  const hasDeskFilter =
    statusFilter !== "all" || channelFilter !== "all" || salesUserFilter !== "all"

  /** Dựng một dòng khách cho danh sách điện thoại. */
  const renderRow = (c: Customer, index: number) => {
    const debt = debts ? debts[c.id] || 0 : null
    const overdue = overdueIds.includes(c.id)
    const stop = todayStops.get(c.id)
    const visited = visitedToday.has(c.id)
    const lastOrder = lastOrders[c.id]
    const coldDays = lastOrder ? daysSinceVN(lastOrder.order_date) : null
    const accent = rowAccent({
      visitedToday: visited,
      routeMode,
      overdue,
      onTodayRoute: stop !== undefined,
      coldDays,
    })
    const tags: CustomerRowTag[] = []
    if (overdue) tags.push({ label: "Quá hạn", tone: "danger" })
    if (coldDays !== null && coldDays >= COLD_DAYS) tags.push({ label: "Ngủ đông", tone: "warning" })
    /**
     * ⚠ NGOÀI CHẾ ĐỘ ĐI TUYẾN VẪN PHẢI THẤY "ĐÃ GHÉ HÔM NAY". Trong chế
     *   độ đi tuyến dấu ✓ ở ô tròn đã nói điều đó; ở các thẻ lọc khác
     *   không có ô tròn dạng ✓, nên không còn dấu hiệu nào — và nhân
     *   viên ghé lại một cửa hàng vừa ghé sáng nay.
     */
    if (!routeMode && visited) tags.push({ label: "Đã ghé hôm nay", tone: "success" })
    /**
     * ⚠ "AI PHỤ TRÁCH" PHẢI CÒN TRÊN ĐIỆN THOẠI. Bảng máy tính có cột
     *   riêng cho nó; dòng điện thoại chỉ có một dòng phụ, nên nó phải
     *   chen vào đây. Bỏ đi là quản lý mở danh sách trên điện thoại và
     *   không còn cách nào biết điểm bán lạ này của ai.
     */
    const meta = [c.ward, c.owner_name, managersSummary(managersMap[c.id] || [])]
      .filter(Boolean)
      .join(" · ")
    return (
      <CustomerListRow
        key={c.id}
        href={`/customers/${c.id}`}
        accent={accent}
        avatar={
          routeMode && visited
            ? "✓"
            : routeMode && stop !== undefined
              ? String(stop)
              : customerInitial(c.store_name)
        }
        name={c.store_name}
        meta={meta || "—"}
        tags={tags}
        rightTop={debt === null ? "—" : debtText(debt)}
        rightTopTone={
          debt === null ? "muted" : overdue ? "danger" : debt > 0 ? "default" : "muted"
        }
        rightBottom={
          debt === null ? "chưa đọc được nợ" : lastOrderText(lastOrder?.order_date ?? null)
        }
        divider={index > 0}
      />
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={isSales ? "Khách hàng của tôi" : "Khách hàng"}
        description={`${totalCustomers} khách hàng`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link href="/sales/pjp">
            <MapIcon className="mr-1.5 h-4 w-4" /> Tuyến hôm nay
          </Link>
        </Button>
        {user && hasPermission(user.role, "customers", "create") && (
          <>
            <Button variant="outline" size="sm" className="hidden lg:inline-flex" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Nhập Excel
            </Button>
            <Button size="sm" onClick={() => router.push("/customers/new")}>
              <Plus className="mr-2 h-4 w-4" /> Thêm KH
            </Button>
          </>
        )}
      </PageHeader>

      {isSales && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          <span>Bạn chỉ thấy KH được phân công cho bạn. Liên hệ Quản lý nếu cần phân công thêm.</span>
        </div>
      )}

      {/* Ô tìm — một ô duy nhất cho cả điện thoại lẫn máy tính. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tên cửa hàng, chủ quán, SĐT…"
          {...SEARCH_FIELD_PROPS}
          className={`pl-10 pr-10 ${HIDE_NATIVE_CLEAR}`}
        />
        {search && (
          <button
            type="button"
            aria-label="Xoá ô tìm"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-surface-container"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Thẻ lọc nhanh — cuộn ngang, luôn hiện số đếm để biết có đáng bấm. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {QUICK_FILTERS.map((k) => {
          const on = quick === k
          return (
            <button
              key={k}
              type="button"
              onClick={() => setQuick(k)}
              className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-bold transition-colors ${
                on
                  ? "border-on-surface bg-on-surface text-white"
                  : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
              }`}
            >
              {QUICK_FILTER_LABEL[k]}
              <span
                className={`rounded-full px-1.5 text-[11px] tabular-data ${
                  on ? "bg-white/20" : "bg-surface-container-low"
                }`}
              >
                {quickCount(k)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Thanh tuyến hôm nay — chỉ hiện khi đang xem tuyến. */}
      {routeMode && (
        <div className="flex items-center gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 shadow-card">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-on-surface">Tuyến hôm nay</p>
            <p className="mt-0.5 truncate text-xs font-medium text-on-surface-variant">
              {routeTotal === 0
                ? "Chưa xếp điểm nào cho hôm nay"
                : `Đã ghé ${visitedOnRoute}/${routeTotal} điểm · còn ${routeTotal - visitedOnRoute} điểm`}
            </p>
            {routeTotal > 0 && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-container">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.round((visitedOnRoute / routeTotal) * 100)}%` }}
                />
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/sales/pjp">{routeTotal === 0 ? "Xếp tuyến" : "Đi tuyến"}</Link>
          </Button>
        </div>
      )}

      {/* Bộ lọc chi tiết — máy tính. */}
      <div className="hidden lg:flex flex-wrap items-center gap-2">
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
        {hasDeskFilter && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>Bỏ lọc</Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <AdvancedFilter truong={LOC_KHACH_HANG} value={locNC.dieuKien} onApply={locNC.apDung} />
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
          <Button variant="outline" size="sm" asChild>
            <Link href="/customers/routes">
              <Route className="h-3.5 w-3.5 mr-1.5" /> Tuyến
            </Link>
          </Button>
        </div>
      </div>

      {/* Bộ lọc chi tiết — điện thoại, gấp vào một hàng chọn. */}
      <div className="grid grid-cols-2 gap-2 lg:hidden">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-10"><SelectValue placeholder="Trạng thái" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi trạng thái</SelectItem>
            <SelectItem value="active">Đang hoạt động</SelectItem>
            <SelectItem value="suspended">Tạm ngưng</SelectItem>
            <SelectItem value="locked">Đã khoá</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter} onValueChange={setChannelFilter}>
          <SelectTrigger className="h-10"><SelectValue placeholder="Tuyến" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Mọi tuyến</SelectItem>
            {routes.map((r) => (
              <SelectItem key={r.code} value={r.code}>{r.code} — {r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ⚠ CÔNG NỢ ĐỌC THIẾU THÌ NÓI TRƯỚC KHI NGƯỜI TA ĐỌC CON SỐ. */}
      {debtWarning && (
        <div className="rounded-xl border border-warning/40 bg-[#fff4ed] px-4 py-3 text-sm text-[#b54708]">
          <p className="font-semibold">Công nợ trong danh sách chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{debtWarning}</p>
        </div>
      )}

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách khách hàng</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : ordered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8 text-muted-foreground" />}
          title={
            loadError
              ? "Không tải được dữ liệu"
              : quick === "today"
                ? "Hôm nay chưa có điểm nào trong tuyến"
                : quick === "overdue"
                  ? "Không có khách nợ quá hạn"
                  : totalCustomers === 0
                    ? "Chưa có khách hàng"
                    : "Không có khách hàng phù hợp"
          }
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : quick === "today"
                ? "Vào Tuyến hôm nay để xếp điểm cần ghé, hoặc bấm Tất cả để xem toàn bộ khách."
                : quick === "overdue"
                  ? "Chưa có khoản nợ nào quá hạn thanh toán."
                  : totalCustomers === 0
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
          {/* Máy tính: bảng đầy đủ, có chọn nhiều và đổi cột. */}
          <div className="hidden lg:block">
            <CustomerTable
              customers={ordered}
              debts={debts || {}}
              debtsUnknown={debts === null}
              lastOrders={lastOrders}
              lastVisits={lastVisits}
              managers={managersMap}
              canCollect={!!user && hasPermission(user.role, "receivables", "create")}
              visibleColumns={visibleColumns}
              selectable={canEdit}
              selectedIds={selectedIds}
              onToggleSelect={toggleOne}
              onToggleSelectAll={toggleAll}
              allSelected={allSelected}
              someSelected={someSelected && !allSelected}
            />
            <DataPagination pg={pg} shownCount={ordered.length} />
          </div>

          {/* Điện thoại: dòng gọn, gộp theo nhóm. */}
          <div className="space-y-4 lg:hidden">
            {groups.map((g) => (
              <div key={g.label} className="overflow-hidden rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card">
                <div className="flex items-baseline justify-between gap-2 border-b border-outline-variant/40 bg-surface-container-low px-4 py-2">
                  <span className="truncate text-[12px] font-bold uppercase tracking-wider text-on-surface-variant">
                    {g.label}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold text-on-surface-variant tabular-data">
                    {g.items.length} khách
                  </span>
                </div>
                {g.items.map((c, i) => renderRow(c, i))}
              </div>
            ))}
            <LoadMore pg={pg} shown={ordered.length} />
          </div>
        </>
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
