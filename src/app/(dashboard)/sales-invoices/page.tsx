"use client"

/**
 * HÓA ĐƠN BÁN — danh sách.
 *
 * ⚠ ĐỪNG NHẦM VỚI `/invoices`. Trang kia là hoá đơn điện tử MISA (bảng
 * `invoices`, tên cũ giữ nguyên). Trang này là chứng từ THỰC XUẤT của
 * kho: trừ tồn, sinh công nợ, in phiếu giao.
 *
 * ⚠ HỌC NGUYÊN GỐC TỪ DANH SÁCH ĐƠN HÀNG (chủ nhà chốt): thẻ trạng thái
 * có số đếm, một thẻ chứa thanh công cụ · lưới · phân trang, chọn cột,
 * chọn bộ lọc, lọc nâng cao, ngăn XEM NHANH bên phải, và danh sách thẻ
 * riêng cho điện thoại. Hai màn nằm cạnh nhau trong cùng một nhóm; bắt
 * người dùng học hai bố cục cho cùng một việc là thuế đánh lên từng lần
 * chuyển màn.
 *
 * ⚠ LỌC Ở MÁY CHỦ, KHÔNG LỌC TRONG TRANG. Khách / NVBH / ngày / giá trị
 * đều đi vào câu truy vấn — lọc trong 50 dòng đang xem thì chọn "khách
 * A" mà hóa đơn của A nằm ở trang 3 sẽ ra rỗng, và người dùng kết luận
 * là hóa đơn đã mất. Riêng ô tìm nhanh thì lọc tại chỗ, và placeholder
 * nói thẳng điều đó.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronDown, ChevronUp, FileText, Filter, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { usePagination } from "@/hooks/use-pagination"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { DataPagination } from "@/components/ui/data-pagination"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { RouteFilter } from "@/components/orders/route-filter"
import { PipelineTabs } from "@/components/orders/pipeline-tabs"
import {
  DesktopInvoiceTable,
  type InvoiceRow,
  type InvoiceSort,
  type InvoiceSortKey,
} from "@/components/sales-invoices/desktop-invoice-table"
import { InvoiceDrawer } from "@/components/sales-invoices/invoice-drawer"
import { MobileInvoiceList } from "@/components/sales-invoices/mobile-invoice-list"
import { DocListSummary } from "@/components/ui/doc-list-summary"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import {
  periodFrom, nextPeriod, summariseDocLines,
  type ListPeriod, type DocLineSummary,
} from "@/lib/orders/list-summary"
import { vnDateKey } from "@/lib/orders/status-tone"
import { formatCurrency } from "@/lib/utils"
import {
  INVOICE_COLUMNS, INVOICE_FILTERS,
  DEFAULT_INVOICE_COLUMNS, DEFAULT_INVOICE_FILTERS,
  type InvoiceColumnKey, type InvoiceFilterKey,
} from "./list-config"
import type { Customer, User } from "@/types"

/**
 * ⚠ HAI CÂU EMBED KHÁCH HÀNG, giống hệt màn đơn. Lọc theo tuyến phải
 * dùng `!inner` thì PostgREST mới lọc được trên bảng nhúng; dùng `!inner`
 * cho mọi trường hợp là âm thầm bỏ mất hóa đơn của khách đã bị xoá.
 */
const CUSTOMER_EMBED = "customer:customers(store_name, phone, channel, ward, address)"
const CUSTOMER_EMBED_INNER = "customer:customers!inner(store_name, phone, channel, ward, address)"
/**
 * ⚠ `created_at` VÀ `payment_terms` LÀ BẮT BUỘC, không phải cho đẹp.
 * `invoice_date` là cột kiểu `date` — không mang giờ, nên cột "Ngày xuất"
 * trên máy tính và dòng phụ trên điện thoại đều phải lấy giờ từ
 * `created_at`. `payment_terms` là góc phải dòng hai của thẻ điện thoại.
 */
const BASE_COLS =
  "id, invoice_code, invoice_date, created_at, payment_terms, status, total, order_id, customer_id, sales_user_id, replaced_from, replaced_by"
const SALES_EMBED = "sales_user:users!sales_invoices_sales_user_id_fkey(full_name)"

const TABS = [
  { key: "posted", label: "Đã xuất", accent: "#12b76a" },
  { key: "cancelled", label: "Đã hủy", accent: "#f04438" },
  { key: "all", label: "Tất cả", accent: "#181c1e" },
] as const

export default function SalesInvoicesPage() {
  const { loading: authLoading } = useRoleGuard("orders")
  const { user } = useAuth()
  const supabase = createClient()
  const pg = usePagination(50)

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "sales-invoices",
    DEFAULT_INVOICE_COLUMNS,
    DEFAULT_INVOICE_FILTERS,
    INVOICE_COLUMNS,
    INVOICE_FILTERS
  )
  const show = (k: InvoiceColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: InvoiceFilterKey) => activeFilters.includes(k)

  const [rows, setRows] = useState<InvoiceRow[]>([])
  /**
   * Khoảng thời gian của dải tóm tắt trên điện thoại (mẫu chủ nhà gửi).
   * Mặc định "Tháng này" — xem cùng khối ở màn đơn hàng.
   */
  const [period, setPeriod] = useState<ListPeriod>("month")
  /** Mặt hàng đại diện của từng hóa đơn đang hiện. */
  const [lineSummary, setLineSummary] = useState<Record<string, DocLineSummary>>()
  /** Tổng tiền của CẢ bộ lọc. `null` = chưa cộng được. */
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string>("posted")
  const [search, setSearch] = useState("")
  const [routeFilter, setRouteFilter] = useState("all")
  const [customerFilter, setCustomerFilter] = useState("all")
  const [salesFilter, setSalesFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [amountMin, setAmountMin] = useState("")
  const [amountMax, setAmountMax] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filterSheet, setFilterSheet] = useState(false)
  const [sort, setSort] = useState<InvoiceSort | null>(null)
  const [drawerId, setDrawerId] = useState<string | null>(null)

  const [customers, setCustomers] = useState<Pick<Customer, "id" | "store_name">[]>([])
  const [salesUsers, setSalesUsers] = useState<Pick<User, "id" | "full_name">[]>([])
  const [routes, setRoutes] = useState<Array<{ code: string; name: string }>>([])

  const isSales = user?.role === "sales"

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [customersRes, usersRes, routesRes] = await Promise.all([
        supabase.from("customers").select("id, store_name").order("store_name"),
        supabase.from("users").select("id, full_name, role").in("role", ["sales", "manager", "owner"]).order("full_name"),
        supabase.from("sales_routes").select("code, name").eq("is_active", true).order("sort_order"),
      ])
      if (cancelled) return
      const e = ([customersRes, usersRes, routesRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (e) console.error("[sales-invoices] nạp dữ liệu nền lỗi:", e.message)
      setCustomers((customersRes.data as Pick<Customer, "id" | "store_name">[]) || [])
      setSalesUsers((usersRes.data as Pick<User, "id" | "full_name">[]) || [])
      setRoutes((routesRes.data as Array<{ code: string; name: string }>) || [])
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Bộ lọc DÙNG CHUNG cho danh sách và cho phép đếm.
   *
   * ⚠ MỘT HÀM, KHÔNG CHÉP HAI LẦN. Chép ra hai chỗ là một ngày nào đó
   * thêm điều kiện vào một chỗ, và số trên thẻ trạng thái không còn khớp
   * với số dòng bên dưới — ngay trên cùng một màn.
   */
  const applyFilters = useCallback(
    <T extends { eq: (c: string, v: unknown) => T; gte: (c: string, v: unknown) => T; lte: (c: string, v: unknown) => T }>(
      q: T
    ): T => {
      let x = q
      if (customerFilter !== "all") x = x.eq("customer_id", customerFilter)
      if (salesFilter !== "all") x = x.eq("sales_user_id", salesFilter)
      if (routeFilter !== "all") x = x.eq("customer.channel", routeFilter)
      if (dateFrom) x = x.gte("invoice_date", dateFrom)
      if (dateTo) x = x.lte("invoice_date", dateTo)
      if (amountMin) x = x.gte("total", Number(amountMin))
      if (amountMax) x = x.lte("total", Number(amountMax))
      /**
       * ⚠ VIÊN THUỐC KHOẢNG THỜI GIAN ĐI CHUNG MỘT ĐƯỜNG VỚI BỘ LỌC
       * NGÀY. Lọc riêng ở trình duyệt là dải "Tổng tiền hàng" cộng trên
       * một tập còn danh sách hiện một tập khác.
       */
      const pFrom = periodFrom(period)
      if (pFrom) x = x.gte("invoice_date", pFrom)
      return x
    },
    [customerFilter, salesFilter, routeFilter, dateFrom, dateTo, amountMin, amountMax, period]
  )

  const fetchData = useCallback(async () => {
    setLoading(true)
    const cust = routeFilter !== "all" ? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED
    let q = supabase
      .from("sales_invoices")
      .select(`${BASE_COLS}, ${cust}, ${SALES_EMBED}, order:sales_orders(order_code)`, { count: "exact" })
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
    if (status !== "all") q = q.eq("status", status)
    q = applyFilters(q as never) as typeof q

    const { data, error, count } = await q.range(pg.from, pg.to)
    if (error) console.error("[sales-invoices] truy vấn lỗi:", error.message)
    const list = ((data as unknown) as InvoiceRow[]) || []
    setRows(list)
    pg.setTotal(count ?? 0)
    setLoading(false)

    /**
     * Mặt hàng đại diện của từng hóa đơn đang hiện — dòng thứ ba của thẻ
     * điện thoại.
     *
     * ⚠ CHỈ CHO TRANG ĐANG HIỆN, và phân trang: 50 hóa đơn × vài chục
     *   dòng có thể vượt trần 1.000 của PostgREST.
     * ⚠ ĐỌC HỎNG THÌ ĐỂ NGUYÊN `undefined`, đừng ghi `{}` — `{}` làm mọi
     *   thẻ in "0 mặt hàng", câu trả lời sai cho một câu chưa đọc được.
     */
    const ids = list.map((r) => r.id)
    if (ids.length > 0) {
      const lineRes = await fetchAllForAggregate<{
        invoice_id: string
        unit_name: string | null
        quantity: number | string | null
        line_total: number | string | null
        product?: { name?: string | null } | null
      }>((from, to) =>
        supabase
          .from("sales_invoice_lines")
          .select("invoice_id, unit_name, quantity, line_total, product:products(name)", { count: "exact" })
          .in("invoice_id", ids)
          .range(from, to)
      )
      if (lineRes.error) console.warn("[sales-invoices] không đọc được dòng hàng:", lineRes.error)
      else {
        setLineSummary((prev) => ({
          ...prev,
          ...summariseDocLines(lineRes.rows.map((r) => ({ ...r, doc_id: r.invoice_id }))),
        }))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, applyFilters, pg.from, pg.to])

  /**
   * Tổng tiền của CẢ bộ lọc, cho dải tóm tắt trên điện thoại.
   *
   * ⚠ KHÔNG CỘNG `rows`. Đó là một trang 50 dòng; cộng nó rồi gọi là
   *   "Tổng tiền hàng" là in ra con số nhỏ hơn sự thật mà không báo gì.
   * ⚠ CHẠM TRẦN CŨNG LÀ THIẾU → để `null`, dải hiện "—".
   */
  const fetchTotal = useCallback(async () => {
    setFilteredTotal(null)
    const cust = routeFilter !== "all" ? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED
    const res = await fetchAllForAggregate<{ total: number | string }>((from, to) => {
      let q = supabase
        .from("sales_invoices")
        .select(routeFilter !== "all" ? `total, ${cust}` : "total", { count: "exact" })
      if (status !== "all") q = q.eq("status", status)
      return (applyFilters(q as never) as typeof q).range(from, to)
    })
    if (res.error || res.truncated) {
      console.warn("[sales-invoices] không cộng được tổng tiền:", res.error ?? "vượt trần")
      setFilteredTotal(null)
      return
    }
    setFilteredTotal(res.rows.reduce((a, r) => a + (Number(r.total) || 0), 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, applyFilters, routeFilter])

  /**
   * ⚠ ĐẾM Ở MÁY CHỦ, KHÔNG ĐẾM TỪ `rows`. `rows` chỉ là một trang 50
   * dòng — đếm từ đó thì thẻ "Đã xuất" hiện 50 dù sổ có 4.000, và con số
   * trên thẻ mâu thuẫn với con số dưới chân trang.
   */
  const fetchCounts = useCallback(async () => {
    const cust = routeFilter !== "all" ? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED
    const one = async (st: string | null) => {
      let q = supabase
        .from("sales_invoices")
        .select(`id, ${cust}`, { count: "exact", head: true })
      if (st) q = q.eq("status", st)
      const { count, error } = await applyFilters(q as never) as unknown as { count: number | null; error: unknown }
      if (error) console.error("[sales-invoices] đếm lỗi")
      return count ?? 0
    }
    const [posted, cancelled, all] = await Promise.all([one("posted"), one("cancelled"), one(null)])
    setCounts({ posted, cancelled, all })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFilters, routeFilter])

  useEffect(() => {
    if (!authLoading) fetchData()
  }, [authLoading, fetchData])

  useEffect(() => {
    if (!authLoading) fetchTotal()
  }, [authLoading, fetchTotal])

  useEffect(() => {
    if (!authLoading) fetchCounts()
  }, [authLoading, fetchCounts])

  /** Đổi bộ lọc thì về trang 1 — đứng ở trang 7 của một kết quả 2 dòng là màn trắng. */
  useEffect(() => {
    pg.setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, customerFilter, salesFilter, routeFilter, dateFrom, dateTo, amountMin, amountMax])

  const routeNameByCode = useMemo(
    () => Object.fromEntries(routes.map((r) => [r.code, r.name])) as Record<string, string>,
    [routes]
  )

  const routeCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of rows) {
      const c = r.customer?.channel
      if (c) m[c] = (m[c] ?? 0) + 1
    }
    return m
  }, [rows])

  /**
   * ⚠ Ô TÌM NHANH LỌC TRONG TRANG ĐANG XEM — nó không hỏi lại máy chủ.
   * Placeholder phải nói ra, nếu không người dùng gõ số của một hóa đơn ở
   * trang 3, không thấy gì, và kết luận là hóa đơn đã mất.
   */
  const term = search.trim().toLowerCase()
  const filtered = term
    ? rows.filter(
        (r) =>
          r.invoice_code.toLowerCase().includes(term) ||
          (r.customer?.store_name || "").toLowerCase().includes(term) ||
          (r.order?.order_code || "").toLowerCase().includes(term)
      )
    : rows

  const rangeOf = (days: number) => {
    const to = vnDateKey(new Date())
    const from = vnDateKey(new Date(Date.now() - (days - 1) * 86_400_000))
    return { from, to }
  }
  const rangePreset = (() => {
    if (!dateFrom && !dateTo) return "all"
    for (const [k, d] of [["today", 1], ["7d", 7], ["30d", 30]] as const) {
      const r = rangeOf(d)
      if (dateFrom === r.from && dateTo === r.to) return k
    }
    return "custom"
  })()
  const applyRangePreset = (k: string) => {
    if (k === "all") { setDateFrom(""); setDateTo(""); return }
    if (k === "custom") return
    const d = k === "today" ? 1 : k === "7d" ? 7 : 30
    const r = rangeOf(d)
    setDateFrom(r.from); setDateTo(r.to)
  }

  const clearAdvanced = () => {
    setCustomerFilter("all"); setSalesFilter("all"); setRouteFilter("all")
    setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax("")
  }
  const activeFilterCount =
    (customerFilter !== "all" ? 1 : 0) + (salesFilter !== "all" ? 1 : 0) +
    (routeFilter !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) +
    (amountMin || amountMax ? 1 : 0)

  const advancedFilterFields = (
    <>
      {filterActive("date") && (
        <>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">Từ ngày</label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">Đến ngày</label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </>
      )}
      {filterActive("customer") && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">Khách hàng</label>
          <Select value={customerFilter} onValueChange={setCustomerFilter}>
            <SelectTrigger><SelectValue placeholder="Tất cả" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả khách hàng</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.store_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {filterActive("sales") && !isSales && (
        <div className="space-y-2">
          <label className="text-xs font-semibold text-muted-foreground">NV bán hàng</label>
          <Select value={salesFilter} onValueChange={setSalesFilter}>
            <SelectTrigger><SelectValue placeholder="Tất cả" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả NV</SelectItem>
              {salesUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {filterActive("amount") && (
        <>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">Tổng tiền từ</label>
            <Input type="number" placeholder="0" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">Tổng tiền đến</label>
            <Input type="number" placeholder="VD: 50000000" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} />
          </div>
        </>
      )}
      <div className="flex justify-end md:col-span-3">
        <Button variant="ghost" size="sm" onClick={clearAdvanced}>Xóa bộ lọc</Button>
      </div>
    </>
  )

  const drawerInvoice = drawerId ? (rows.find((r) => r.id === drawerId) ?? null) : null
  const onSort = (key: InvoiceSortKey) =>
    setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))

  const canEdit = !!user && ["owner", "manager"].includes(user.role)

  if (authLoading) return <Skeleton className="h-96" />

  const empty = (
    <EmptyState
      icon={<FileText className="h-8 w-8" />}
      title="Chưa có hóa đơn bán nào"
      description="Hóa đơn sinh ra khi nhà phân phối bấm Xuất hàng trên một đơn."
    >
      {/* Không để màn hình thành ngõ cụt — chỉ sang chỗ làm được việc. */}
      <Link href="/orders" className="text-sm text-primary hover:underline">
        Tới danh sách đơn →
      </Link>
    </EmptyState>
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hóa đơn bán"
        description="Chứng từ thực xuất: trừ kho, sinh công nợ, là nguồn của hoá đơn điện tử."
      />

      <PipelineTabs
        className="grid"
        active={status}
        onPick={setStatus}
        tabs={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: counts[t.key] ?? 0,
          accent: t.accent,
        }))}
      />

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm số hóa đơn, khách…"
        activeCount={activeFilterCount}
        onClear={clearAdvanced}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <div className="grid gap-4">
          {routes.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Tuyến</p>
              <RouteFilter inline routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />
            </div>
          )}
          {advancedFilterFields}
        </div>
      </MobileFilterBar>

      {/* ⚠ MÁY TÍNH — một thẻ gồm thanh công cụ, lưới, phân trang. Cùng
          khuôn với màn "Đơn hàng"; đổi ở đây thì đổi cả bên kia. */}
      <div className="hidden lg:flex flex-col overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest">
        <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/40 px-4 py-3">
          {filterActive("search") && (
            <div className="relative min-w-[220px] max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm trong trang này: số hóa đơn, khách…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          )}
          <RouteFilter routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />
          <Select value={rangePreset} onValueChange={applyRangePreset}>
            <SelectTrigger className="h-10 w-[130px] rounded-xl font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hôm nay</SelectItem>
              <SelectItem value="7d">7 ngày</SelectItem>
              <SelectItem value="30d">30 ngày</SelectItem>
              <SelectItem value="all">Tất cả</SelectItem>
              {rangePreset === "custom" && <SelectItem value="custom">Tuỳ chọn</SelectItem>}
            </SelectContent>
          </Select>
          {activeFilterCount + (search ? 1 : 0) > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="font-extrabold text-primary"
              onClick={() => { clearAdvanced(); setSearch("") }}
            >
              Xoá lọc
            </Button>
          )}
          {(filterActive("date") || filterActive("customer") || filterActive("sales") || filterActive("amount")) && (
            <Button variant="outline" onClick={() => setShowAdvanced((v) => !v)} className="gap-2">
              <Filter className="h-4 w-4" />
              Bộ lọc nâng cao
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <FilterPicker
              available={INVOICE_FILTERS}
              value={activeFilters}
              onChange={setFilters}
              onReset={resetFilters}
            />
            <ColumnPicker
              available={INVOICE_COLUMNS}
              value={visibleColumns}
              onChange={setColumns}
              onReset={resetColumns}
            />
          </div>
        </div>

        {showAdvanced && (
          <Card className="mx-4 my-3 rounded-2xl border-dashed">
            <CardContent className="grid gap-4 pt-6 md:grid-cols-3">{advancedFilterFields}</CardContent>
          </Card>
        )}

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10">{empty}</div>
        ) : (
          <DesktopInvoiceTable
            invoices={filtered}
            routeNameByCode={routeNameByCode}
            show={show}
            activeId={drawerId}
            onOpen={(inv) => setDrawerId(inv.id)}
            sort={sort}
            onSort={onSort}
          />
        )}

        <div className="px-4 pb-3 pt-1">
          <DataPagination pg={pg} />
        </div>
      </div>

      {/* ---------------- Điện thoại: danh sách theo mẫu ---------------- */}
      <div className="space-y-3 lg:hidden">
        {/* Dải tóm tắt: viên thuốc khoảng thời gian · bộ lọc · tổng tiền
            của CẢ bộ lọc (không phải của trang đang hiện). */}
        <DocListSummary
          period={period}
          onCyclePeriod={() => setPeriod((p) => nextPeriod(p))}
          onOpenFilter={() => setFilterSheet(true)}
          filtersActive={activeFilterCount > 0 || period !== "month"}
          onClearFilters={() => {
            clearAdvanced()
            setPeriod("month")
          }}
          countText={`${pg.total} hóa đơn`}
          total={filteredTotal === null ? null : formatCurrency(filteredTotal)}
        />

        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border bg-card p-6">{empty}</div>
        ) : (
          <>
            <MobileInvoiceList
              invoices={filtered}
              lineSummary={lineSummary}
              showSalesName={!isSales}
              onOpen={setDrawerId}
            />
            <DataPagination pg={pg} />
          </>
        )}
      </div>

      <InvoiceDrawer
        invoice={drawerInvoice}
        routeName={
          drawerInvoice?.customer?.channel
            ? (routeNameByCode[drawerInvoice.customer.channel] ?? null)
            : null
        }
        canEdit={canEdit}
        onClose={() => setDrawerId(null)}
      />
    </div>
  )
}
