"use client"

import { useEffect, useMemo, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { newOrderHref } from "@/lib/nav/new-order"

import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { MobileOrderList } from "@/components/orders/mobile-order-list"
import { RouteFilter } from "@/components/orders/route-filter"
import { PipelineTabs } from "@/components/orders/pipeline-tabs"
import { DesktopOrderTable, type OrderSort, type OrderSortKey } from "@/components/orders/desktop-order-table"
import { OrderDrawer } from "@/components/orders/order-drawer"
import { orderTone, vnDateKey } from "@/lib/orders/status-tone"
import { canEditOrder } from "@/lib/orders/edit-permission"
import {
  loadInvoiceableLines,
  postInvoice,
  invoiceWarnings,
} from "@/lib/orders/post-invoice"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useOrderSync } from "@/hooks/use-order-sync"
import { LoadMore } from "@/components/ui/load-more"
import {
  ORDER_COLUMNS,
  DEFAULT_ORDER_COLUMNS,
  ORDER_FILTERS,
  DEFAULT_ORDER_FILTERS,
  type OrderColumnKey,
  type OrderFilterKey,
} from "./list-config"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  OrderPipeline,
  STEPS,
  classifyOrder,
  type PipelineStepKey,
} from "@/components/orders/order-pipeline"
import { formatCurrency } from "@/lib/utils"
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Filter,
  Plus,
  Search,
  ShoppingCart,
  X,
  XCircle,
} from "lucide-react"
import type { Customer, Invoice, OrderStatus, SalesOrder, User } from "@/types"
import { errorMessage } from "@/lib/errors"

/** Khoá nhớ "đã đọc" của banner phạm vi dữ liệu. */
const SCOPE_HINT_KEY = "npp.hint.orders-scope"

/** Phần nhúng khách hàng trong câu select — hai bản, chỉ khác `!inner`. */
const CUSTOMER_EMBED = "customer:customers(store_name, phone, channel)"
const CUSTOMER_EMBED_INNER = "customer:customers!inner(store_name, phone, channel)"
/**
 * Câu select cho phép ĐẾM khi đang lọc theo tuyến.
 *
 * ⚠ Đếm bình thường dùng `head: true` nên không cần cột nào, nhưng muốn
 * lọc trên bảng nhúng thì bảng nhúng PHẢI có mặt trong câu select —
 * không có thì PostgREST trả lỗi "column customer.channel does not exist".
 */
const COUNT_SELECT_WITH_ROUTE = "id, customer:customers!inner(id)"

/**
 * Các trạng thái có chip lọc, theo đúng thứ tự đơn đi qua.
 *
 * Workflow v2 có bốn trạng thái thật, không còn trạng thái ảo nào phải
 * suy ra từ cột lý do.
 */
const COUNTED_STATUSES = [
  "draft",
  "submitted",
  "completed",
  "cancelled",
] as const

const STATUS_CHIP_LABEL: Record<(typeof COUNTED_STATUSES)[number], string> = {
  draft: "Nháp",
  submitted: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
}

/**
 * Ba tab của màn đơn hàng — CHUNG cho mọi vai trò, không có "Tất cả" và
 * không có "Nháp".
 *
 * ⚠ NHÁP KHÔNG NẰM Ở ĐÂY vì ở đây không làm gì được với nó. Việc của một
 * bản nháp là sửa nốt, gửi đi, hoặc xoá — cả ba nút đó nằm ở /sell/drafts.
 * Cho nháp hiện cả hai chỗ là người dùng mở đúng chỗ không có nút, rồi
 * kết luận đơn của mình bị kẹt. Chính sách SELECT ở migration 119 cũng
 * chỉ cho mỗi người thấy nháp CỦA CHÍNH MÌNH, kể cả chủ — nên bỏ tab này
 * không giấu của ai cái gì.
 *
 * ⚠ KHÔNG CÓ "TẤT CẢ" là có chủ ý: gộp bốn trạng thái vào một danh sách
 * thì người dùng phải tự đọc huy hiệu từng dòng mới biết đơn nào còn chờ
 * xuất hàng. Ba tab là ba câu hỏi họ thật sự hỏi — và với nhà phân phối,
 * tab đầu chính là hàng đợi việc trong ngày.
 *
 * ⚠ KHÔNG thu `COUNTED_STATUSES` xuống theo. Đó là danh sách ĐẾM và là
 * nguồn nhãn; nháp vẫn phải đếm được để còn dẫn người dùng sang đúng chỗ.
 */
const ORDER_TABS = ["submitted", "completed", "cancelled"] as const

export default function OrdersPage() {
  const { user, loading: authLoading } = useRoleGuard("orders")
  // Đơn tạo ngoại tuyến còn nằm trong hộp chờ — mẫu thiết kế đặt băng báo
  // ngay trên danh sách, không giấu trong một trang khác.
  const { pendingCount: outboxCount } = useOrderSync()
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const isDriver = authUser?.role === "driver"
  const { toast } = useToast()
  const [orders, setOrders] = useState<SalesOrder[]>([])
  const [invoiceMap, setInvoiceMap] = useState<Record<string, Invoice>>({})
  const [customers, setCustomers] = useState<Pick<Customer, "id" | "store_name">[]>([])
  const [salesUsers, setSalesUsers] = useState<Pick<User, "id" | "full_name">[]>([])
  const [receivablesByOrder, setReceivablesByOrder] = useState<
    Record<string, { amount: number; paid: number; status: string; due_date: string | null }>
  >({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [misaLoadingId, setMisaLoadingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [pipelineStep, setPipelineStep] = useState<PipelineStepKey | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showAdvanced, setShowAdvanced] = useState(false)
  // Sheet lọc trên mobile (thay ô tìm + "Bộ lọc nâng cao" + FilterPicker).
  const [filterSheet, setFilterSheet] = useState(false)
  // Chế độ chọn nhiều: bật rồi thì CHẠM CẢ THẺ là chọn, không cần checkbox
  // 16px trên mỗi thẻ — riêng màn này đo được 107 vùng chạm dưới 44px.
  const [selectMode, setSelectMode] = useState(false)
  // Banner phạm vi dữ liệu: thông tin một lần, nhớ bằng localStorage.
  // Khởi tạo `false` rồi bật trong effect — đọc localStorage ngay lúc
  // render đầu làm HTML máy chủ khác HTML máy khách (lỗi hydrate #418).
  const [showScopeHint, setShowScopeHint] = useState(false)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [customerFilter, setCustomerFilter] = useState("all")
  const [salesFilter, setSalesFilter] = useState("all")
  /**
   * Lọc theo TUYẾN bán hàng.
   *
   * ⚠ Giá trị là MÃ tuyến (`sales_routes.code`), không phải id. Tuyến của
   * một điểm bán nằm ở `customers.channel` và cột đó lưu mã — xem
   * migration 018.
   */
  const [routeFilter, setRouteFilter] = useState("all")
  const [routes, setRoutes] = useState<Array<{ code: string; name: string }>>([])
  /** mã tuyến → số đơn ĐÃ DUYỆT (chưa giao) — để bộ lọc tuyến xếp tuyến đang có hàng lên đầu. */
  const [routeCounts, setRouteCounts] = useState<Record<string, number>>({})
  /** Số mặt hàng của từng đơn trên trang đang xem (cột "SL MH"). */
  const [lineCountByOrder, setLineCountByOrder] = useState<Record<string, number>>({})
  /** Đơn đang mở ở ngăn chi tiết bên phải (máy tính). */
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [sort, setSort] = useState<OrderSort | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  /**
   * Đơn đang mở dialog Xuất hàng. Đây là đường DUY NHẤT để sửa số lượng
   * hay giá lúc xuất — nút "Xuất hàng" của thanh chọn nhiều xuất đủ phần
   * còn lại, không hỏi gì.
   */
  /** "N đơn hôm nay · tổng" cho dòng mô tả đầu trang — null = chưa đọc được. */
  const [todaySummary, setTodaySummary] = useState<{ count: number; total: number } | null>(null)
  const [amountMin, setAmountMin] = useState("")
  const [amountMax, setAmountMax] = useState("")
  const [bulkLoading, setBulkLoading] = useState(false)
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "orders",
    DEFAULT_ORDER_COLUMNS,
    DEFAULT_ORDER_FILTERS
  )
  const show = (k: OrderColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: OrderFilterKey) => activeFilters.includes(k)

  // Deep-link: /orders?status=draft → preselect the status filter.
  // /orders?q=SO-... → điền ô tìm kiếm (từ ô tìm nhanh trên header).
  useEffect(() => {
    const s = searchParams.get("status")
    if (s) setStatusFilter(s)
    const q = searchParams.get("q")
    if (q !== null) setSearch(q)
  }, [searchParams])

  // Load metadata (customers, users) + counts theo status — 1 lần khi mount.
  useEffect(() => {
    /**
     * Số đơn ĐÃ DUYỆT theo tuyến — gợi ý cho bộ lọc tuyến ("tuyến nào đang
     * có hàng chờ ra xe"). Đơn đã duyệt chưa giao thường vài trăm, nên kéo
     * về đếm ở trình duyệt là đủ; PHẢI phân trang vì server cắt 1.000.
     * ⚠ Đây là gợi ý, không phải con số kế toán: đọc hỏng thì ghi log và
     * bộ lọc vẫn dùng được, chỉ không xếp tuyến theo số đơn.
     */
    async function loadRouteCounts() {
      const res = await fetchAllForAggregate<{ customer: { channel: string | null } | null }>(
        (from, to) =>
          supabase
            .from("sales_orders")
            .select("id, customer:customers!inner(channel)", { count: "exact" })
            .eq("status", "submitted")
            .range(from, to)
      )
      if (res.error) {
        console.warn("[orders] không đếm được đơn theo tuyến:", res.error)
        return
      }
      const m: Record<string, number> = {}
      for (const r of res.rows) {
        const code = r.customer?.channel
        if (code) m[code] = (m[code] || 0) + 1
      }
      setRouteCounts(m)
    }
    void loadRouteCounts()

    /**
     * "N đơn hôm nay · tổng tiền" — dòng mô tả đầu trang theo mẫu. Đếm
     * theo ngày đặt (giờ VN), bỏ đơn huỷ. Đọc hỏng thì dòng đó KHÔNG hiện
     * con số, thay vì hiện 0.
     */
    async function loadTodaySummary() {
      const res = await fetchAllForAggregate<{ total: number }>((from, to) =>
        supabase
          .from("sales_orders")
          .select("total", { count: "exact" })
          .eq("order_date", vnDateKey(new Date()))
          .neq("status", "cancelled")
          .range(from, to)
      )
      if (res.error) {
        console.warn("[orders] không đọc được tổng hôm nay:", res.error)
        return
      }
      setTodaySummary({
        count: res.rows.length,
        total: res.rows.reduce((a, r) => a + (Number(r.total) || 0), 0),
      })
    }
    void loadTodaySummary()

    async function loadMeta() {
      const [customersRes, usersRes, routesRes] = await Promise.all([
        supabase.from("customers").select("id, store_name").order("store_name"),
        supabase.from("users").select("id, full_name, role").in("role", ["sales", "manager", "owner"]).order("full_name"),
        supabase
          .from("sales_routes")
          .select("code, name")
          .eq("is_active", true)
          .order("sort_order"),
      ])
      const qErr2 = ([customersRes, usersRes, routesRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr2) console.error("[app/orders] truy vấn lỗi:", qErr2.message)
      setCustomers((customersRes.data as Pick<Customer, "id" | "store_name">[]) || [])
      setSalesUsers((usersRes.data as Pick<User, "id" | "full_name">[]) || [])
      setRoutes((routesRes.data as Array<{ code: string; name: string }>) || [])

    }
    loadMeta()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Bộ lọc DÙNG CHUNG cho danh sách và cho phép đếm.
   *
   * ⚠ MỘT NƠI KHAI DUY NHẤT. Hai bản chép tay là cách chắc nhất để con số
   * trên chip nói khác danh sách bên dưới nó — và người dùng tin con số.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyCommonFilters = <T,>(q: T): T => {
    let x = q as any // eslint-disable-line @typescript-eslint/no-explicit-any
    if (debouncedSearch) {
      const term = `%${debouncedSearch.replace(/[%_]/g, "\\$&")}%`
      x = x.ilike("order_code", term)
    }
    // ⚠ Tuyến của đơn = tuyến của ĐIỂM BÁN, và nó nằm ở `customers.channel`
    // (cột lưu MÃ tuyến — xem migration 018). Lọc trên bảng nhúng thì phần
    // nhúng phải là `!inner`, nếu không PostgREST vẫn trả đơn về nhưng bỏ
    // trống phần khách — danh sách đầy dòng "—" trông như dữ liệu hỏng.
    if (routeFilter !== "all") x = x.eq("customer.channel", routeFilter)
    if (customerFilter !== "all") x = x.eq("customer_id", customerFilter)
    if (salesFilter !== "all") x = x.eq("sales_user_id", salesFilter)
    if (dateFrom) x = x.gte("order_date", dateFrom)
    if (dateTo) x = x.lte("order_date", dateTo + "T23:59:59")
    if (amountMin) x = x.gte("total", parseFloat(amountMin))
    if (amountMax) x = x.lte("total", parseFloat(amountMax))
    return x as T
  }

  /** Lọc theo trạng thái. Tách riêng vì phép đếm phải chạy cho TỪNG trạng thái. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /**
   * Danh sách tab đang vẽ, và trạng thái THẬT SỰ được lọc.
   *
   * ⚠ NVBH KHÔNG CÓ TAB "TẤT CẢ" nên giá trị mặc định "all" — và cả một
   * đường dẫn sâu kiểu `/orders?status=draft` — phải quy về một tab có
   * thật. Không quy thì màn mở ra với mọi chip xám và một danh sách gồm
   * cả nháp lẫn đơn đã huỷ, tức là đúng cái mà ba tab kia sinh ra để
   * tránh.
   *
   * ⚠ Trừ khi đang lọc theo BƯỚC XỬ LÝ: bộ lọc đó chạy phía trình duyệt
   * trên đúng trang đang xem, nên ép thêm trạng thái vào truy vấn là nó
   * lọc trên một tập đã bị cắt và ra danh sách rỗng khó hiểu.
   */
  const tabKeys: readonly string[] = ORDER_TABS
  /**
   * ⚠ KHÔNG ÉP TRẠNG THÁI KHI ĐANG TÌM KIẾM. Tìm và trạng thái nối AND
   * trong CÙNG một truy vấn (xem chỗ gọi `applyStatusFilter` bên dưới),
   * nên đứng ở tab Phiếu tạm mà gõ mã một đơn đã huỷ thì ra RỖNG. Ô tìm
   * trên thanh tiêu đề đẩy sang `/orders?q=…` KHÔNG kèm trạng thái — tức
   * là mọi lần tìm toàn hệ thống đều rơi vào đúng cái bẫy đó.
   *
   * Tìm kiếm là tra cứu TOÀN CỤC, tab là điều hướng. Người dùng tự chọn
   * một tab rồi mới gõ tìm thì tôn trọng lựa chọn đó — điều kiện dưới chỉ
   * buông khi họ CHƯA chọn tab nào (giá trị còn là "all").
   *
   * ⚠ Cũng buông khi đang lọc theo BƯỚC XỬ LÝ: bộ lọc đó chạy phía trình
   * duyệt trên đúng trang đang xem, ép thêm trạng thái vào truy vấn là nó
   * lọc trên một tập đã bị cắt và ra danh sách rỗng khó hiểu.
   */
  const searching = debouncedSearch.trim().length > 0
  const effectiveStatus =
    !pipelineStep && !searching && !(ORDER_TABS as readonly string[]).includes(statusFilter)
      ? "submitted"
      : statusFilter

  const applyStatusFilter = <T,>(q: T, status: string): T => {
    let x = q as any // eslint-disable-line @typescript-eslint/no-explicit-any
    if (status !== "all") {
      x = x.eq("status", status)
    }
    return x as T
  }

  /**
   * Đếm đơn theo trạng thái — cho các chip lọc.
   *
   * ⚠ ĐẾM PHẢI ĂN THEO ĐÚNG BỘ LỌC CỦA DANH SÁCH (trừ chính trạng thái).
   * Trước đây phép đếm chạy MỘT lần lúc mở trang và bỏ qua mọi bộ lọc khác,
   * nên lọc theo tuyến rồi thì chip ghi "Đã giao 120" trong khi danh sách
   * dưới nó chỉ có 7 dòng. Con số trên chip phải trả lời đúng một câu: bấm
   * vào đây thì thấy bao nhiêu đơn.
   */
  useEffect(() => {
    let cancelled = false
    async function loadCounts() {
      // audit-ok: lỗi của CẢ chùm truy vấn được gộp lại ở `countErr` ngay
      // bên dưới; không kiểm từng chỗ vì một phép đếm hỏng hay tất cả hỏng
      // đều dẫn tới cùng một việc phải làm.
      const base = () =>
        applyCommonFilters(
          // audit-ok: xem chú thích ngay trên — lỗi gộp vào `countErr`.
          supabase
            .from("sales_orders")
            .select(routeFilter !== "all" ? COUNT_SELECT_WITH_ROUTE : "id", {
              count: "exact",
              head: true,
            })
        )
      const [total, ...resps] = await Promise.all([
        base(),
        ...COUNTED_STATUSES.map((st) => applyStatusFilter(base(), st)),
      ])
      if (cancelled) return
      // ⚠ Đếm hỏng thì mọi chip hiện 0 — trông y hệt "chưa có đơn nào", và
      // người dùng kết luận tuyến này chưa ai đặt hàng.
      const countErr = [total, ...resps].find((r) => r?.error)?.error
      if (countErr) console.error("[app/orders] đếm theo trạng thái lỗi:", countErr.message)
      const totalC = total.count
      const counts: Record<string, number> = { all: totalC ?? 0 }
      COUNTED_STATUSES.forEach((st, i) => {
        counts[st] = resps[i].count ?? 0
      })
      setStatusCounts(counts)
    }
    loadCounts()
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page về 1 mỗi khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, effectiveStatus, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax, pipelineStep]) // eslint-disable-line react-hooks/exhaustive-deps

  // List query — filter server-side, paginate.
  useEffect(() => {
    let cancelled = false
    async function fetchOrders() {
      setLoading(true)
      // selectResilient: nếu DB production thiếu cột (lệch migration) thì tự thử
      // lại với '*' thay vì trả danh sách rỗng im lặng; luôn trả error để hiển thị.
      const build = (select: string) => {
        // audit-ok: `selectResilient` trả lỗi ra ngoài và nơi gọi đưa vào
        // `setLoadError` để hiện lên màn hình.
        const q = supabase
          .from("sales_orders")
          .select(select, { count: "exact" })
          .order("created_at", { ascending: false })
          .range(pg.from, pg.to)
        return applyStatusFilter(applyCommonFilters(q), effectiveStatus)
      }
      // ⚠ `!inner` CHỈ khi đang lọc tuyến. Bật luôn thì đơn nào chưa gắn
      // khách sẽ biến mất khỏi danh sách mà không ai biết vì sao.
      const cust = routeFilter !== "all" ? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED
      const res = await selectResilient<SalesOrder>(
        build,
        `id, org_id, order_code, customer_id, sales_user_id, order_date, expected_delivery, status, current_workflow_stage, payment_terms, subtotal, discount, vat, total, merged_into, notes, approved_by, approved_at, approval_reason, created_at, ${cust}, sales_user:users!sales_orders_sales_user_id_fkey(full_name)`,
        // eslint-disable-next-line no-restricted-syntax
        `*, ${cust}, sales_user:users!sales_orders_sales_user_id_fkey(full_name)`
      )
      // Điều hướng nhanh làm request bị huỷ. Đó không phải lỗi — ghi
      // mảng rỗng đè lên danh sách đang hiện, kèm một thẻ đỏ
      // "signal is aborted without reason", là ném chuyện nội bộ vào mặt
      // người dùng.
      if (cancelled || res.aborted) return
      const ordersData = res.data
      setOrders(ordersData)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)

      // Load receivables + invoices CHỈ cho orders đang hiển thị trên page.
      const ids = ordersData.map((o) => o.id)
      if (ids.length > 0) {
        const [recvRes, invRes] = await Promise.all([
          supabase
            .from("receivables")
            .select("order_id, amount, paid, status, due_date")
            .in("order_id", ids),
          supabase.from("invoices").select("id, org_id, order_id, invoice_number, customer_name, customer_address, customer_tax_code, subtotal, vat, total, status, issued_at, created_at, misa_invoice_id, misa_ref_id, misa_inv_no, misa_inv_series, misa_inv_date, misa_invoice_code, misa_relation, misa_org_ref_id, misa_note, misa_no_locked, misa_invoice_url, misa_status, misa_error, misa_sent_at, misa_signed_at, misa_lookup_code, misa_published_at").in("order_id", ids),
        ])
        const qErr = ([recvRes, invRes] as Array<{ error?: { message?: string } | null }>)
          .find((r) => r?.error)?.error
        if (qErr) console.error("[app/orders] truy vấn lỗi:", qErr.message)
        if (cancelled) return
        const recvMap: Record<string, { amount: number; paid: number; status: string; due_date: string | null }> = {}
        for (const r of (recvRes.data as Array<{ order_id: string | null; amount: number; paid: number; status: string; due_date: string | null }>) || []) {
          if (r.order_id) recvMap[r.order_id] = { amount: r.amount, paid: r.paid, status: r.status, due_date: r.due_date }
        }
        setReceivablesByOrder(recvMap)
        const invMap: Record<string, Invoice> = {}
        for (const inv of (invRes.data as Invoice[]) || []) {
          if (inv.order_id) invMap[inv.order_id] = inv
        }
        setInvoiceMap(invMap)
      } else {
        setReceivablesByOrder({})
        setInvoiceMap({})
      }
      setLoading(false)
    }
    fetchOrders()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, effectiveStatus, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax]) // eslint-disable-line react-hooks/exhaustive-deps

  // Đã filter server-side (search/status/customer/sales/date/amount).
  // Chỉ còn pipelineStep filter client-side vì cần tổng hợp receivable+invoice.
  // Note: pipeline filter chỉ áp dụng trên trang hiện tại — chấp nhận trade-off
  // để khỏi phải replicate classifyOrder() trong SQL.
  useEffect(() => {
    try {
      setShowScopeHint(localStorage.getItem(SCOPE_HINT_KEY) !== "1")
    } catch {
      // Trình duyệt chặn localStorage (chế độ riêng tư) — cứ hiện, thà
      // hiện thừa còn hơn nuốt mất lời giải thích vì sao danh sách ngắn.
      setShowScopeHint(true)
    }
  }, [])

  const dismissScopeHint = () => {
    setShowScopeHint(false)
    try { localStorage.setItem(SCOPE_HINT_KEY, "1") } catch { /* không sao */ }
  }

  // Cột "SL MH": đếm dòng hàng của đúng các đơn đang hiện. Một truy vấn
  // cho cả trang, phân trang vì 50 đơn × vài chục dòng có thể vượt 1.000.
  useEffect(() => {
    if (orders.length === 0) return
    let cancelled = false
    const ids = orders.map((o) => o.id)
    ;(async () => {
      const res = await fetchAllForAggregate<{ order_id: string }>((from, to) =>
        supabase.from("sales_order_lines").select("order_id", { count: "exact" }).in("order_id", ids).range(from, to)
      )
      if (cancelled) return
      if (res.error) {
        console.warn("[orders] không đếm được số mặt hàng:", res.error)
        return
      }
      const m: Record<string, number> = {}
      for (const id of ids) m[id] = 0
      for (const r of res.rows) m[r.order_id] = (m[r.order_id] || 0) + 1
      setLineCountByOrder((prev) => ({ ...prev, ...m }))
    })()
    return () => {
      cancelled = true
    }
  }, [orders]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!pipelineStep) return orders
    return orders.filter(
      (o) => classifyOrder(o, receivablesByOrder[o.id], invoiceMap[o.id]) === pipelineStep
    )
  }, [orders, pipelineStep, receivablesByOrder, invoiceMap])

  const routeNameByCode = useMemo(
    () => Object.fromEntries(routes.map((r) => [r.code, r.name])) as Record<string, string>,
    [routes]
  )

  if (authLoading) return <Skeleton className="h-96" />
  const allSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id))
  const someSelected = filtered.some((o) => selectedIds.has(o.id))

  const toggleAll = () => {
    const next = new Set(selectedIds)
    if (allSelected) {
      filtered.forEach((o) => next.delete(o.id))
    } else {
      filtered.forEach((o) => next.add(o.id))
    }
    setSelectedIds(next)
  }

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  const clearSelection = () => setSelectedIds(new Set())

  const canApprove = user && hasPermission(user.role, "orders", "approve")

  /**
   * XUẤT ĐỦ phần còn lại cho một hoặc nhiều đơn, KHÔNG rời trang.
   *
   * ⚠ HAI ĐƯỜNG XUẤT HÀNG, CÓ CHỦ Ý. Việc thường ngày là xuất đủ những
   * gì khách đặt, và bắt mở màn soạn cho từng đơn trong một loạt mười
   * đơn là biến việc thường ngày thành cực hình. Muốn sửa số lượng hay
   * giá thì bấm nút trên ĐÚNG một dòng — đường đó sang `/sales-invoices/new`.
   *
   * ⚠ ĐI QUA RPC, KHÔNG UPDATE THẲNG. Xuất hàng là trừ kho FIFO + dựng
   * hóa đơn + sinh công nợ + đổi trạng thái; trigger ở migration 124
   * chặn đường tắt. Mỗi đơn một lệnh gọi vì mỗi đơn là một giao dịch
   * riêng — đơn thiếu tồn không được kéo cả loạt còn lại đổ theo.
   */
  const approveOrders = async (ids: string[]) => {
    if (!user || !canApprove || ids.length === 0) return
    setBulkLoading(true)
    if (ids.length === 1) setApprovingId(ids[0])
    const failed: string[] = []
    let ok = 0
    /**
     * ⚠ XUẤT THÀNH CÔNG ≠ XUẤT ĐỦ HÀNG. Khi đơn vị bật cho phép bán âm,
     * RPC KHÔNG ném lỗi lúc thiếu hàng: nó trừ hết tồn có, cho tồn âm,
     * vẫn sinh công nợ đủ tiền, và trả `error = null`. Phải ĐỌC kết quả
     * trả về mới biết — xem `completeOrder`.
     */
    const warned: string[] = []
    const doneIds: string[] = []
    /**
     * ⚠ TRẠNG THÁI MỚI LẤY TỪ RPC, KHÔNG ĐOÁN "completed". Đơn xuất
     * thiếu một dòng sẽ về `partially_invoiced`; vá state thành
     * "completed" là màn hình nói đơn đã giao đủ trong khi còn hàng nằm
     * lại, và không ai bấm Xuất tiếp nữa.
     */
    const newStatus = new Map<string, string>()
    try {
      for (const id of ids) {
        const code = orders.find((o) => o.id === id)?.order_code ?? id
        try {
          /**
           * ⚠ HỎI RPC XEM CÒN GÌ CHƯA XUẤT, không tự dựng dòng từ state
           *   của trang. Trang có thể đang giữ bản chụp cũ vài phút —
           *   đơn đã xuất một phần ở máy khác thì dựng lại từ state là
           *   xuất chồng lên phần đã giao.
           */
          const lines = await loadInvoiceableLines(supabase, id)
          const r = await postInvoice(supabase, {
            orderId: id,
            lines: lines
              .filter((l) => l.remainingQty > 0)
              .map((l) => ({
                orderLineId: l.orderLineId,
                productId: l.productId,
                unitName: l.unitName,
                conversionFactor: l.conversionFactor,
                quantity: l.remainingQty,
                unitPrice: l.unitPrice,
                lineDiscount: l.lineDiscount,
                vatRate: l.vatRate,
                isExchange: l.isExchange,
                note: l.note,
              })),
          })
          ok += 1
          doneIds.push(id)
          newStatus.set(id, r.orderStatus ?? "completed")
          const w = invoiceWarnings(r)
          if (w) warned.push(`${code}: ${w}`)
        } catch (e) {
          failed.push(`${code}: ${errorMessage(e)}`)
        }
      }
      if (ok > 0) {
        setOrders((prev) =>
          prev.map((o) =>
            doneIds.includes(o.id)
              ? {
                  ...o,
                  status: (newStatus.get(o.id) ?? "completed") as OrderStatus,
                  approval_reason: null,
                }
              : o
          )
        )
        toast({ title: `Đã xuất hàng ${ok} đơn` })
      }
      /**
       * ⚠ Cảnh báo đi TOAST RIÊNG, không nhét vào description của toast
       * thành công. Nó phải đọc như một việc phải làm chứ không phải một
       * lời chúc mừng có chú thích.
       */
      if (warned.length > 0) {
        toast({
          title: `${warned.length} đơn xuất thiếu hàng`,
          description: warned.join(" · "),
          variant: "destructive",
        })
      }
      if (failed.length > 0) {
        toast({
          title: `${failed.length} đơn không xuất được`,
          description: failed.join(" · "),
          variant: "destructive",
        })
      }
      clearSelection()
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setBulkLoading(false)
      setApprovingId(null)
    }
  }
  const handleBulkApprove = () => approveOrders(Array.from(selectedIds))

  // Bulk cancel — only applies to orders not yet delivered/cancelled
  const handleBulkCancel = async () => {
    if (!user) return
    const selected = orders.filter((o) => selectedIds.has(o.id))
    // Đơn ĐÃ XUẤT phải huỷ qua RPC (hoàn kho, xoá công nợ) — không gộp
    // vào đây được.
    const cancellable = selected.filter(
      (o) => o.status === "draft" || o.status === "submitted"
    )
    if (cancellable.length === 0) {
      toast({ title: "Không có đơn nào hủy được", variant: "destructive" })
      return
    }
    if (!confirm(`Hủy ${cancellable.length} đơn hàng? Không thể hoàn tác.`)) return
    const ids = cancellable.map((o) => o.id)
    setBulkLoading(true)
    try {
      /**
       * ⚠ RLS TỪ CHỐI LÀ 0 DÒNG, HTTP 200, `error` NULL. Lệnh này chạy
       * trên nhiều đơn cùng lúc, nên không đếm dòng thì màn hình báo
       * "Đã hủy 12 đơn" trong khi chính sách chỉ cho qua 3 — và vì ngay
       * dưới đây state được tự vá theo `ids`, chín đơn kia hiện "Đã huỷ"
       * cho tới khi người dùng tải lại trang.
       *
       * ⚠ Trả về ĐÚNG những id ghi được, rồi chỉ vá state theo chúng.
       * Lấy `ids` làm chuẩn là tin vào thứ mình muốn xảy ra.
       */
      const { data: rows, error } = await supabase
        .from("sales_orders")
        .update({ status: "cancelled" })
        .in("id", ids)
        .select("id")
      if (error) throw error
      const done = new Set(((rows as Array<{ id: string }>) ?? []).map((r) => r.id))
      if (done.size === 0) {
        throw new Error(
          "Không hủy được đơn nào — bạn không có quyền với những đơn này, hoặc chúng đã đi tiếp. Tải lại trang để xem trạng thái mới."
        )
      }

      if (user.org_id) {
        const { createNotification } = await import("@/lib/notifications")
        for (const o of cancellable) {
          // Chỉ báo cho đơn THẬT SỰ huỷ được — báo cho đơn RLS chặn là
          // gửi cho nhân viên một tin về việc chưa xảy ra.
          if (done.has(o.id) && o.sales_user_id && o.sales_user_id !== user.id) {
            createNotification(supabase, {
              orgId: user.org_id,
              userId: o.sales_user_id,
              type: "order_cancelled",
              title: `Đơn ${o.order_code} đã bị hủy`,
              body: `Bởi ${user.full_name || "Quản lý"}`,
              linkUrl: `/orders/${o.id}`,
              metadata: { order_id: o.id, order_code: o.order_code },
            })
          }
        }
      }

      setOrders((prev) =>
        prev.map((o) => (done.has(o.id) ? { ...o, status: "cancelled" as const } : o))
      )
      toast({ title: `Đã hủy ${done.size} đơn` })
      if (done.size < ids.length) {
        toast({
          title: `${ids.length - done.size} đơn không hủy được`,
          description: "Bạn không có quyền với những đơn đó, hoặc chúng đã đi tiếp.",
          variant: "destructive",
        })
      }
      clearSelection()
    } catch (err) {
      const message = errorMessage(err)
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setBulkLoading(false)
    }
  }

  const handleExportCsv = () => {
    const selected = orders.filter((o) => selectedIds.has(o.id))
    const headers = ["Mã đơn", "Khách hàng", "NV bán hàng", "Ngày đặt", "Tổng tiền", "Trạng thái"]
    const rows = selected.map((o) => [
      o.order_code,
      o.customer?.store_name || "",
      o.sales_user?.full_name || "",
      o.order_date,
      String(o.total),
      o.status,
    ])
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: `Đã xuất ${selected.length} đơn hàng` })
  }

  const resetAdvanced = () => {
    setDateFrom("")
    setDateTo("")
    setCustomerFilter("all")
    setSalesFilter("all")
    setAmountMin("")
    setAmountMax("")
  }

  const handleXuatHoaDonList = async (order: SalesOrder) => {
    setMisaLoadingId(order.id)
    try {
      // Auto-create invoice if none exists
      let invoiceId = invoiceMap[order.id]?.id
      if (!invoiceId) {
        const customer = order.customer as Record<string, unknown> | undefined
        const { data: newInvoice, error: invErr } = await supabase
          .from("invoices")
          .insert({
            org_id: order.org_id,
            order_id: order.id,
            invoice_number: null,
            customer_name: (customer?.billing_name as string) || (customer?.store_name as string) || "",
            customer_address: (customer?.billing_address as string) || (customer?.address as string) || null,
            customer_tax_code: (customer?.tax_code as string) || null,
            subtotal: order.subtotal,
            vat: order.vat,
            total: order.total,
            status: "draft",
          })
          .select("id")
          .single()
        if (invErr || !newInvoice) throw new Error(invErr?.message || "Không thể tạo hóa đơn")
        invoiceId = newInvoice.id
      }

      const res = await fetch("/api/einvoice/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, mode: "as_sold" }),
      })
      const text = await res.text()
      let data: { error?: string; cached?: boolean; inv_no?: string; lookup_code?: string; sandbox?: boolean } = {}
      try { data = text ? JSON.parse(text) : {} } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(data.error || `Phát hành MISA thất bại (HTTP ${res.status})${text && !data.error ? `: ${text.slice(0, 200)}` : ""}`)

      toast({
        title: data.cached ? "Hoá đơn đã phát hành trước đó" : "Đã phát hành hoá đơn điện tử",
        description: `${data.inv_no ? `Số HĐ: ${data.inv_no} · ` : ""}Mã tra cứu: ${data.lookup_code || "—"}${data.sandbox ? " (sandbox)" : ""}`,
      })

      // Refresh invoice map
      const { data: updatedInv, error: updatedInvErr } = await supabase
        .from("invoices")
        .select("id, org_id, order_id, invoice_number, customer_name, customer_address, customer_tax_code, subtotal, vat, total, status, issued_at, created_at, misa_invoice_id, misa_ref_id, misa_inv_no, misa_inv_series, misa_inv_date, misa_invoice_code, misa_relation, misa_org_ref_id, misa_note, misa_no_locked, misa_invoice_url, misa_status, misa_error, misa_sent_at, misa_signed_at, misa_lookup_code, misa_published_at")
        .eq("id", invoiceId)
        .single()
      if (updatedInvErr) console.error("[orders] truy vấn lỗi:", updatedInvErr.message)
      if (updatedInv) {
        setInvoiceMap((prev) => ({ ...prev, [order.id]: updatedInv as Invoice }))
      }
    } catch (error) {
      toast({ title: "Lỗi xuất HĐ", description: errorMessage(error), variant: "destructive" })
    } finally {
      setMisaLoadingId(null)
    }
  }

  // Số bộ lọc đang bật, KHÔNG tính ô tìm — hiện trên badge nút Lọc để
  // việc giấu bộ lọc vào sheet không thành giấu mất trạng thái.
  // ⚠ Trên điện thoại MỌI bộ lọc nằm trong sheet (người dùng yêu cầu), nên
  // con số trên nút Lọc phải đếm cả trạng thái, tuyến và bước xử lý — không
  // thì đang lọc "Đã duyệt" mà nút Lọc báo 0, người ta không hiểu vì sao
  // danh sách thiếu đơn.
  /**
   * ⚠ TAB TRẠNG THÁI LÀ ĐIỀU HƯỚNG, KHÔNG PHẢI BỘ LỌC NÂNG CAO. Đếm nó
   * vào huy hiệu "đang lọc" thì tab mặc định (Phiếu tạm) cũng làm huy
   * hiệu sáng lên và nút "Xoá lọc" mọc ra cho một thứ không ai đặt.
   */
  const statusIsFiltered = effectiveStatus !== "submitted"
  /**
   * Danh sách đang bị thu hẹp bởi MỘT thao tác nào đó của người dùng —
   * tab, ô tìm, bộ lọc nâng cao hay bước xử lý. Dùng để phân biệt "lọc
   * trượt" với "chưa có đơn nào".
   */
  const activeFilterCount =
    (statusIsFiltered ? 1 : 0) + (routeFilter !== "all" ? 1 : 0) + (pipelineStep ? 1 : 0) +
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) +
    (customerFilter !== "all" ? 1 : 0) + (salesFilter !== "all" ? 1 : 0) +
    (amountMin ? 1 : 0) + (amountMax ? 1 : 0)
  /**
   * Danh sách đang bị thu hẹp bởi MỘT thao tác nào đó của người dùng —
   * tab, ô tìm hay bộ lọc. Dùng để phân biệt "lọc trượt" với "chưa có
   * đơn nào", hai thứ trông y hệt nhau vì cả hai đều lọc phía máy chủ.
   */
  const narrowed = searching || activeFilterCount > 0

  /**
   * ⚠ KHÔNG ĐỤNG TỚI TAB. Đặt `statusFilter` về "all" ở đây thì nó bị quy
   * ngược về "submitted" ngay dòng sau — tức nút "Xoá lọc" âm thầm ném
   * người dùng từ tab họ đang đứng về tab Phiếu tạm, trong khi họ chỉ
   * muốn bỏ bộ lọc tuyến hay khoảng ngày.
   */
  const clearAdvancedFilters = () => {
    setRouteFilter("all"); setPipelineStep(null)
    setDateFrom(""); setDateTo("")
    setCustomerFilter("all"); setSalesFilter("all")
    setAmountMin(""); setAmountMax("")
  }

  // Các ô lọc nâng cao — DÙNG CHUNG cho thẻ desktop và sheet mobile.
  // Nhân đôi JSX là để hai bên trôi khỏi nhau: thêm một ô lọc ở desktop
  // rồi quên bên mobile thì trên điện thoại lọc đó biến mất không dấu vết.
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
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả khách hàng</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.store_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {filterActive("sales") && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">NV bán hàng</label>
                <Select value={salesFilter} onValueChange={setSalesFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Tất cả" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả NV</SelectItem>
                    {salesUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {filterActive("amount") && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Tổng tiền từ</label>
                  <Input
                    type="number"
                    placeholder="0"
                    value={amountMin}
                    onChange={(e) => setAmountMin(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Tổng tiền đến</label>
                  <Input
                    type="number"
                    placeholder="VD: 50000000"
                    value={amountMax}
                    onChange={(e) => setAmountMax(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="md:col-span-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={resetAdvanced}>
                Xóa bộ lọc
              </Button>
            </div>
    </>
  )

  const drawerOrder = drawerId ? (orders.find((o) => o.id === drawerId) ?? null) : null
  const onSort = (key: OrderSortKey) =>
    setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }))

  /**
   * Khoảng ngày theo mẫu: Hôm nay / 7 ngày / 30 ngày / Tất cả — chỉ là
   * cách đặt nhanh `dateFrom`/`dateTo`; ô ngày trong bộ lọc nâng cao vẫn
   * là nguồn thật, nên chọn tay một khoảng lạ thì ô này hiện "Tuỳ chọn".
   */
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

  const bulkBar = selectedIds.size > 0 && (() => {
        const selectedOrders = orders.filter((o) => selectedIds.has(o.id))
        const allSameStatus = selectedOrders.length > 0 &&
          selectedOrders.every((o) => o.status === selectedOrders[0].status)
        const sharedStatus = allSameStatus ? selectedOrders[0].status : null
        const cancellableCount = selectedOrders.filter(
          (o) => o.status === "draft" || o.status === "submitted"
        ).length
        // Đơn đã xuất một phần vẫn xuất tiếp được — bỏ nó ra là bắt
        // người dùng mở từng đơn một chỉ để bấm đúng cái nút này.
        const hasSubmitted = selectedOrders.some(
          (o) => o.status === "submitted" || o.status === "partially_invoiced"
        )

        return (
          <div className="flex flex-wrap items-center gap-2 border-b border-[#d3e0f7] bg-[#e3edfb] px-4 py-2 text-[13px] font-bold text-[#1e3a8a] lg:rounded-none rounded-xl lg:border-b">
              <div className="mr-1">
                Đã chọn {selectedIds.size} đơn ·{" "}
                {formatCurrency(selectedOrders.reduce((a, o) => a + (Number(o.total) || 0), 0))}
                {allSameStatus && sharedStatus && (
                  <span className="ml-2 text-xs text-on-surface-variant font-normal">
                    • cùng trạng thái: {sharedStatus}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {canApprove && hasSubmitted && (
                  <Button size="sm" onClick={handleBulkApprove} disabled={bulkLoading}>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Xuất hàng
                  </Button>
                )}
                {cancellableCount > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleBulkCancel}
                    disabled={bulkLoading}
                    className="border-error/40 text-on-error-container hover:bg-error-container"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Hủy {cancellableCount} đơn
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={handleExportCsv}>
                  <Download className="mr-2 h-4 w-4" />
                  Xuất CSV
                </Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  <X className="mr-2 h-4 w-4" />
                  Hủy chọn
                </Button>
              </div>
          </div>
        )
      })()


  /**
   * Bước xử lý (pipeline) cho sheet lọc điện thoại — cùng phép phân loại
   * `classifyOrder` với thanh pipeline desktop, đếm trên trang đang xem.
   */
  const pipelineChips = (() => {
    const counts: Record<string, number> = {}
    for (const o of orders) {
      const k = classifyOrder(o, receivablesByOrder[o.id], invoiceMap[o.id])
      if (k) counts[k] = (counts[k] || 0) + 1
    }
    return (
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {STEPS.map((st) => {
          const active = pipelineStep === st.key
          return (
            <button
              key={st.key}
              type="button"
              aria-pressed={active}
              onClick={() => {
                const next = active ? null : st.key
                setPipelineStep(next)
                if (next) setStatusFilter("all")
              }}
              className={`flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border-[1.5px] px-3 text-[13px] font-bold ${
                active
                  ? "border-on-surface bg-on-surface text-surface"
                  : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
              }`}
            >
              {st.label}
              <span className={`grid h-[18px] min-w-[18px] place-items-center rounded-full px-1.5 text-[11px] font-extrabold ${active ? "bg-surface/20 text-surface" : "bg-surface-container text-on-surface-variant"}`}>
                {counts[st.key] ?? 0}
              </span>
            </button>
          )
        })}
      </div>
    )
  })()

  return (
    <div className="space-y-4">
      {/*
        `orders` chỉ là TRANG HIỆN TẠI (50 dòng/trang), không phải tổng. Dòng
        phụ đề trước đây in ra số đó nên có 125 đơn mà ghi "50 đơn hàng".
        `pg.total` là số server trả về kèm count: "exact".
      */}
      <PageHeader
        title={isSales ? "Đơn của tôi" : "Đơn hàng"}
        description={[
          todaySummary ? `${todaySummary.count} đơn hôm nay · ${formatCurrency(todaySummary.total)}` : null,
          (statusCounts.submitted ?? 0) > 0 ? `${statusCounts.submitted} phiếu tạm chờ xuất` : null,
          pg.total === orders.length ? `${pg.total} đơn` : `${pg.total} đơn · đang xem ${orders.length}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      >
        {/* ⚠ ĐƯỜNG SANG ĐƠN NHÁP. Ba tab ở đây không có tab Nháp — chính
            sách SELECT của migration 119 cũng chỉ cho mỗi người thấy nháp
            của mình — nên nếu màn này không có một liên kết nào sang
            /sell/drafts thì bản nháp thành thứ không có đường đi tới.
            Chỉ hiện khi thật sự còn nháp: một nút mờ đếm 0 là nhiễu. */}
        {(statusCounts.draft ?? 0) > 0 && (
          <Button variant="outline" onClick={() => router.push("/sell/drafts")}>
            <FileText className="mr-2 h-4 w-4" /> {statusCounts.draft} đơn nháp
          </Button>
        )}
        {user && hasPermission(user.role, "orders", "create") && (
          <Button onClick={() => router.push(newOrderHref())}>
            <Plus className="mr-2 h-4 w-4" /> Tạo đơn
          </Button>
        )}
      </PageHeader>

      {(isSales || isDriver) && showScopeHint && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          <span>
            {isSales
              // RLS lọc theo `sales_user_id = auth.uid()` (002_rls_policies.sql:292),
              // tức đơn BẠN PHỤ TRÁCH — không phải đơn bạn bấm nút tạo. Quản lý
              // tạo đơn rồi giao cho bạn thì bạn vẫn thấy, dù không phải bạn tạo.
              ? "Bạn chỉ thấy đơn bạn phụ trách. Ban quản lý sẽ thấy tất cả đơn của tổ chức."
              : "Bạn chỉ thấy đơn thuộc chuyến giao của bạn."}
          </span>
          {/* Đây là thông tin MỘT LẦN, không phải cảnh báo thường trực —
              để nó chiếm 56px trên mọi lần mở danh sách là lấy mất chỗ của
              chính những đơn nó đang nói tới. */}
          <button
            type="button"
            onClick={dismissScopeHint}
            aria-label="Đã hiểu, ẩn thông báo"
            className="tap ml-auto shrink-0 flex items-center justify-center text-on-primary-fixed-variant/70"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ⚠ TRÊN ĐIỆN THOẠI MỌI BỘ LỌC NẰM TRONG SHEET (người dùng yêu cầu):
          tuyến và bước xử lý chỉ đứng ngoài ở máy tính. Hàng chip trạng
          thái trong sheet đã BỎ HẲN — ba tab dưới đây thay nó ở mọi khổ
          màn, nên không còn hai chỗ cùng đổi một giá trị. */}
      {/* ⚠ BA TAB KHÔNG NẰM TRONG SHEET. Quy tắc "mọi bộ lọc vào sheet" ở
          trên nói về BỘ LỌC; ba tab này là ĐIỀU HƯỚNG — màn mở ra ở tab
          Phiếu tạm, giấu tab đi là không có đường nào sang Hoàn thành /
          Đã huỷ. Ba cột vừa khít 375px (năm thì nhãn cụt thành "Ho…"). */}
      <PipelineTabs
        className="grid"
        active={pipelineStep ? "" : effectiveStatus}
        onPick={(k) => {
          setStatusFilter(k)
          setPipelineStep(null)
        }}
        tabs={tabKeys.map((k) => ({
          key: k,
          label: k === "all" ? "Tất cả" : STATUS_CHIP_LABEL[k as (typeof COUNTED_STATUSES)[number]],
          count: statusCounts[k] ?? 0,
          accent: k === "all" ? "#181c1e" : orderTone(k).accent,
        }))}
      />

      {/* Pipeline 7-step status bar (Update #2 v2 §8) — máy tính. */}
      {filterActive("pipeline") && (
        <div className="hidden lg:block">
          <OrderPipeline
            orders={orders}
            receivables={receivablesByOrder}
            invoices={invoiceMap}
            active={pipelineStep}
            onChange={(next) => {
              setPipelineStep(next)
              // Picking a pipeline step clears the special-state chip filter
              // so the two filters don't fight each other.
              if (next) setStatusFilter("all")
            }}
          />
        </div>
      )}

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm mã đơn, tên khách…"
        activeCount={activeFilterCount}
        onClear={clearAdvancedFilters}
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
          {filterActive("pipeline") && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Bước xử lý</p>
              {pipelineChips}
            </div>
          )}
          {advancedFilterFields}
        </div>
      </MobileFilterBar>

      {/* ⚠ MÁY TÍNH — theo mẫu thiết kế "Đơn hàng": một thẻ trắng gồm thanh
          công cụ (tìm · tuyến · NVBH · khoảng ngày · xoá lọc), dải chọn
          nhiều, bảng, và phân trang. Điện thoại có danh sách riêng ở dưới. */}
      <div className="hidden lg:flex flex-col overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest">
      <div className="flex flex-wrap items-center gap-2 border-b border-outline-variant/40 px-4 py-3">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm mã đơn hàng…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
        {routes.length > 0 && (
          <RouteFilter routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />
        )}
        {!isSales && salesUsers.length > 0 && (
          <Select value={salesFilter} onValueChange={setSalesFilter}>
            <SelectTrigger className="h-10 w-[180px] rounded-xl font-semibold">
              <SelectValue placeholder="Tất cả NVBH" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả NVBH</SelectItem>
              {salesUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
          <Button variant="ghost" size="sm" className="font-extrabold text-primary" onClick={() => { clearAdvancedFilters(); setSearch("") }}>
            Xoá lọc
          </Button>
        )}
        {(filterActive("date") || filterActive("customer") || filterActive("sales") || filterActive("amount")) && (
          <Button
            variant="outline"
            onClick={() => setShowAdvanced((v) => !v)}
            className="gap-2"
          >
            <Filter className="h-4 w-4" />
            Bộ lọc nâng cao
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FilterPicker
            available={ORDER_FILTERS}
            value={activeFilters}
            onChange={setFilters}
            onReset={resetFilters}
          />
          <ColumnPicker
            available={ORDER_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
      </div>

      {showAdvanced && (
        <Card className="mx-4 my-3 rounded-2xl border-dashed">
          <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
            {advancedFilterFields}
          </CardContent>
        </Card>
      )}

        {bulkBar}
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : (
          <DesktopOrderTable
            orders={filtered}
            routeNameByCode={routeNameByCode}
            lineCountByOrder={lineCountByOrder}
            receivablesByOrder={receivablesByOrder}
            invoiceMap={invoiceMap}
            show={show}
            selectedIds={selectedIds}
            allSelected={allSelected}
            someSelected={someSelected}
            onToggleAll={toggleAll}
            onToggleOne={toggleOne}
            activeId={drawerId}
            onOpen={(o) => setDrawerId(o.id)}
            canApprove={!!canApprove}
            approvingId={approvingId}
            onApprove={(o) => router.push(`/sales-invoices/new?order=${o.id}`)}
            misaLoadingId={misaLoadingId}
            onInvoice={handleXuatHoaDonList}
            sort={sort}
            onSort={onSort}
          />
        )}
        <div className="hidden lg:block px-4 pb-3">
          <DataPagination pg={pg} shownCount={filtered.length} />
        </div>
      </div>

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách đơn hàng</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {/* Điện thoại: khung xương / trạng thái rỗng / danh sách nhóm theo
          ngày. Máy tính có thẻ bảng riêng ở trên với thanh công cụ của nó. */}
      <div className="lg:hidden">
      {bulkBar}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        /**
         * ⚠ RỖNG VÌ LỌC TRƯỢT ≠ RỖNG VÌ CHƯA CÓ ĐƠN NÀO. Trạng thái và ô
         * tìm được lọc PHÍA MÁY CHỦ, nên tìm trượt cũng làm `orders` rỗng
         * y hệt tổ chức chưa có đơn nào — và màn bảo người dùng "Tạo đơn
         * hàng đầu tiên" trong khi họ chỉ đang gõ nhầm một mã đơn. Đang
         * có tab hay bộ lọc nào bật thì phải nói ra điều đó.
         */
        <EmptyState
          icon={<ShoppingCart className="h-8 w-8 text-muted-foreground" />}
          title={
            loadError
              ? "Không tải được dữ liệu"
              : narrowed
                ? "Không có đơn hàng phù hợp"
                : "Chưa có đơn hàng"
          }
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : narrowed
                ? searching
                  ? `Không tìm thấy đơn nào khớp “${search.trim()}”.`
                  : "Thử đổi tab hoặc điều chỉnh bộ lọc."
                : isDriver
                  ? "Bạn chưa được gán chuyến giao hàng nào. Đơn hàng chỉ hiện sau khi kho lập phiếu giao và gán bạn làm tài xế."
                  : isSales
                    ? "Bạn chưa tạo đơn nào và chưa được phân công khách hàng nào. Nhờ quản lý phân công khách hàng, hoặc tạo đơn đầu tiên."
                    : "Tạo đơn hàng đầu tiên"
          }
        />
      ) : (
        <>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {/* Chế độ chọn thay cho checkbox trên từng thẻ. Tắt thì chạm
                hàng = mở đơn; bật thì chạm hàng = chọn. Nhấn giữ 500ms trên
                một hàng cũng bật. Đây là chỗ xoá được ~51 vùng chạm 16px. */}
            <div className="flex items-center gap-2">
              <Button
                variant={selectMode ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setSelectMode((v) => !v)
                  if (selectMode) setSelectedIds(new Set())
                }}
              >
                {selectMode ? `Xong (${selectedIds.size})` : "Chọn"}
              </Button>
              {selectMode && (
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {allSelected ? "Bỏ chọn tất cả" : `Chọn tất cả (${filtered.length})`}
                </Button>
              )}
            </div>

            {outboxCount > 0 && (
              <div className="flex items-center gap-2.5 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-bold text-[#7a4b00]">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#fdb022]" />
                {outboxCount} đơn chờ đẩy lên khi có mạng
              </div>
            )}

            {/* ⚠ Theo mẫu thiết kế "Đơn của tôi": nhóm theo ngày, mỗi đơn
                một hàng có vạch màu trạng thái. Cả hàng là một vùng chạm —
                không nút "Sửa" / "Xuất hoá đơn" trên từng hàng nữa; hai việc
                đó nằm ở màn chi tiết, nơi có đủ ngữ cảnh để làm. */}
            <MobileOrderList
              orders={filtered}
              showSalesName={!isSales}
              selectMode={selectMode}
              selectedIds={selectedIds}
              onToggle={toggleOne}
              onEnterSelect={(id) => {
                setSelectMode(true)
                toggleOne(id)
              }}
            />
            <LoadMore pg={pg} shown={filtered.length} />
          </div>
        </>
      )}
      </div>

      <OrderDrawer
        order={drawerOrder}
        routeName={drawerOrder?.customer?.channel ? (routeNameByCode[drawerOrder.customer.channel] ?? null) : null}
        onClose={() => setDrawerId(null)}
        canApprove={!!canApprove}
        canEdit={
          !!user &&
          !!drawerOrder &&
          canEditOrder({
            role: user.role,
            userId: user.id,
            status: drawerOrder.status,
            salesUserId: drawerOrder.sales_user_id ?? null,
            hasUpdatePermission: hasPermission(user.role, "orders", "update"),
          })
        }
        approving={approvingId === drawerOrder?.id}
        onApprove={(o) => router.push(`/sales-invoices/new?order=${o.id}`)}
      />

    </div>
  )
}
