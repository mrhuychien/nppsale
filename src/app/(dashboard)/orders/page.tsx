"use client"

import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { gopCongNoTheoDon } from "@/lib/orders/receivable-sum"
import { LOC_DON_HANG } from "@/lib/search/list-filter-fields"
import { useEffect, useMemo, useState } from "react"
import { PeriodSelect } from "@/components/ui/period-select"
import { usePagination } from "@/hooks/use-pagination"
import { MATCH_CAP } from "@/lib/search/list-search"
import { useListSearch } from "@/hooks/use-list-search"
import { SearchSelect } from "@/components/ui/search-select"
import { DataPagination } from "@/components/ui/data-pagination"
import { useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { newOrderHref } from "@/lib/nav/new-order"

import { useToast } from "@/hooks/use-toast"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Card, CardContent } from "@/components/ui/card"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { MobileOrderList } from "@/components/orders/mobile-order-list"
import { DocListSummary } from "@/components/ui/doc-list-summary"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import { DocSearchBox, DocFieldInputs } from "@/components/ui/doc-search-box"
import { useFieldSearch } from "@/hooks/use-field-search"
import { TRUONG_DON_HANG } from "@/lib/search/doc-fields"
import { soTruongDangTim } from "@/lib/search/field-search"
import { openInNewTab } from "@/components/ui/new-tab-link"
import {
  periodFrom, nextPeriod, summariseDocLines,
  type ListPeriod, type DocLineSummary,
  kyDangLoc,
} from "@/lib/orders/list-summary"
import { RouteFilter } from "@/components/orders/route-filter"
import { StatusChips } from "@/components/ui/status-chips"
import { trangThaiCuaChon } from "@/lib/list/status-multi"
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
import { formatCurrency } from "@/lib/utils"
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Filter,
  Plus,
  ShoppingCart,
  X,
  XCircle,
  ClipboardList,
} from "lucide-react"
import { soanHangHref } from "@/lib/orders/pick-list"
import type { Customer, Invoice, OrderStatus, SalesOrder, User } from "@/types"
import { errorMessage } from "@/lib/errors"

/** Khoá nhớ "đã đọc" của banner phạm vi dữ liệu. */
const SCOPE_HINT_KEY = "npp.hint.orders-scope"

/** Phần nhúng khách hàng trong câu select — hai bản, chỉ khác `!inner`. */
const CUSTOMER_EMBED = "customer:customers(store_name, phone, channel, ward, address, district, province)"
const CUSTOMER_EMBED_INNER = "customer:customers!inner(store_name, phone, channel, ward, address, district, province)"
/**
 * Câu select cho phép ĐẾM khi đang lọc theo tuyến.
 *
 * ⚠ Đếm bình thường dùng `head: true` nên không cần cột nào, nhưng muốn
 * lọc trên bảng nhúng thì bảng nhúng PHẢI có mặt trong câu select —
 * không có thì PostgREST trả lỗi "column customer.channel does not exist".
 */
const COUNT_SELECT_WITH_ROUTE = "id, customer:customers!inner(id)"
/**
 * ⚠ PHÉP CỘNG TIỀN PHẢI CÓ CỘT `total` TRONG CHÍNH CÂU SELECT.
 * `COUNT_SELECT_WITH_ROUTE` chỉ lấy `id` — nó sinh ra để ĐẾM. Mượn nó
 * cho phép cộng thì mọi dòng về không có `total`, và dải tóm tắt hiện
 * đúng 0đ mỗi khi có bộ lọc tuyến. Không lỗi nào bắn ra.
 */
const TOTAL_SELECT_WITH_ROUTE = "total, customer:customers!inner(id)"

/**
 * Các trạng thái có chip lọc, theo đúng thứ tự đơn đi qua.
 *
 * Workflow v2 có bốn trạng thái thật, không còn trạng thái ảo nào phải
 * suy ra từ cột lý do.
 */
const COUNTED_STATUSES = [
  "draft",
  "submitted",
  "partially_invoiced",
  "completed",
  "closed",
  "cancelled",
] as const

const STATUS_CHIP_LABEL: Record<(typeof COUNTED_STATUSES)[number], string> = {
  draft: "Nháp",
  submitted: "Phiếu tạm",
  partially_invoiced: "Xuất một phần",
  completed: "Hoàn thành",
  closed: "Đã đóng",
  cancelled: "Đã huỷ",
}

/**
 * MỖI TAB PHỦ NHỮNG TRẠNG THÁI NÀO.
 *
 * ⚠ LÝ DO CÓ BẢNG NÀY: `sales_orders.status` cho phép SÁU giá trị
 * (mig 119 mở rộng ràng buộc CHECK: draft · submitted ·
 * partially_invoiced · completed · closed · cancelled) nhưng màn này chỉ
 * có bốn tab. Trước hôm nay mỗi tab lọc đúng MỘT trạng thái, nên đơn
 * `partially_invoiced` và `closed` KHÔNG NẰM TRONG TAB NÀO — chúng biến
 * mất khỏi Phiếu tạm, khỏi Hoàn thành, khỏi Đã huỷ, và chỉ còn thấy
 * được ở "Tất cả".
 *
 * Chủ nhà báo đúng chuyện đó: "đơn hàng hoàn thành xong thấy biến mất
 * luôn, không ở bên hoàn thành". Xuất thiếu một dòng là đơn thành
 * `partially_invoiced` — và từ 20/09/2026 nhân viên được đặt vượt tồn
 * nên xuất thiếu là chuyện THƯỜNG, không phải ngoại lệ.
 *
 * ⚠ `partially_invoiced` VỀ "PHIẾU TẠM", KHÔNG VỀ "HOÀN THÀNH". Đơn xuất
 * một phần vẫn còn hàng phải giao — nó thuộc hàng đợi việc. Thanh chọn
 * nhiều vốn đã coi hai trạng thái này là một (xem `hasSubmitted`), nên
 * gộp ở đây là làm cho khớp, không phải đặt luật mới.
 *
 * ⚠ `closed` VỀ "HOÀN THÀNH", và huy hiệu vẫn phân biệt. Hai trạng thái
 * đều là KẾT: không còn gì để giao. Nhưng `completed` = đã giao đủ,
 * `closed` = thôi không giao nốt — `orderTone` giữ chúng hai màu khác
 * nhau (xanh / xám đậm) nên gộp tab không xoá mất khác biệt ấy.
 */
const TAB_STATUSES: Record<string, readonly string[]> = {
  submitted: ["submitted"],
  partially_invoiced: ["partially_invoiced"],
  completed: ["completed", "closed"],
  cancelled: ["cancelled"],
}

/**
 * Bốn tab của màn đơn hàng — CHUNG cho mọi vai trò, không có "Nháp".
 *
 * ⚠ NHÁP KHÔNG CÓ TAB RIÊNG vì ở đây không làm gì được với nó. Việc của
 * một bản nháp là sửa nốt, gửi đi, hoặc xoá — cả ba nút đó nằm ở
 * /sell/drafts. Cho nháp một tab riêng là người dùng mở đúng chỗ không có
 * nút, rồi kết luận đơn của mình bị kẹt. Chính sách SELECT ở migration
 * 119 cũng chỉ cho mỗi người thấy nháp CỦA CHÍNH MÌNH, kể cả chủ — nên
 * không có tab riêng cũng không giấu của ai cái gì. (Nháp vẫn nằm trong
 * "Tất cả", và nút "N đơn nháp" ở đầu trang vẫn dẫn sang /sell/drafts.)
 *
 * ⚠ "TẤT CẢ" ĐÃ TỪNG CỐ Ý KHÔNG CÓ — GHI LẠI CẢ HAI PHÍA ĐỂ KHÔNG AI LẬT
 * MÙ. Lý do cũ: gộp mọi trạng thái vào một danh sách thì người dùng phải
 * tự đọc huy hiệu từng dòng mới biết đơn nào còn chờ xuất hàng. Chủ nhà
 * chốt ngược ngày 19/09/2026: "Thêm phần hiển thị tất cả đơn hàng nữa
 * (3 ô thống kê thành 4 ô)" — trên sổ thật, câu hỏi "tổng cộng có bao
 * nhiêu đơn" là câu hỏi hằng ngày và trước đó không có đường nào hỏi.
 *
 * Lý do cũ vẫn được giữ bằng chỗ ĐỨNG, không bằng việc vắng mặt: "Tất
 * cả" nằm CUỐI (giống màn hóa đơn), và màn vẫn mở ra ở "Phiếu tạm" —
 * hàng đợi việc trong ngày — chứ không mở ra ở "Tất cả".
 *
 * ⚠ KHÔNG thu `COUNTED_STATUSES` xuống theo. Đó là danh sách ĐẾM và là
 * nguồn nhãn; nháp vẫn phải đếm được để còn dẫn người dùng sang đúng chỗ.
 */
const ORDER_TABS = [
  "all",
  "submitted",
  "partially_invoiced",
  "completed",
  "cancelled",
] as const

/**
 * Tab mở màn: hàng đợi việc, không phải "Tất cả".
 *
 * ⚠ ĐỪNG ĐẶT THẲNG GIÁ TRỊ NÀY LÀM TRỊ KHỞI TẠO CỦA `statusFilter`. Xem
 * `effectiveStatus`: ô trống "" mang nghĩa "người dùng CHƯA chạm tab
 * nào", và chính nghĩa đó cho phép ô tìm toàn hệ thống buông trạng thái.
 * Khởi tạo thẳng bằng "submitted" là mọi lần tìm từ thanh tiêu đề đều bị
 * ép về Phiếu tạm và trả RỖNG cho đơn đã hoàn thành hoặc đã huỷ.
 */
const DEFAULT_ORDER_TAB = "all"

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
  const [customers, setCustomers] = useState<
    Pick<Customer, "id" | "store_name" | "owner_name" | "phone">[]
  >([])
  const [salesUsers, setSalesUsers] = useState<Pick<User, "id" | "full_name">[]>([])
  /* ⚠ Dựng một lần theo `customers` — mảng mới mỗi lần vẽ là ô tìm nhận
     một danh sách "đổi" liên tục. */
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        label: c.store_name,
        hint: [c.owner_name, c.phone].filter(Boolean).join(" · ") || null,
        keywords: [c.owner_name, c.phone].filter(Boolean).join(" "),
      })),
    [customers]
  )
  const [receivablesByOrder, setReceivablesByOrder] = useState<
    Record<string, { amount: number; paid: number; status: string; due_date: string | null }>
  >({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [misaLoadingId, setMisaLoadingId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  /** "" = chưa chạm tab nào — xem `effectiveStatus`, KHÔNG đổi thành "all". */
  const [statusFilter, setStatusFilter] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showAdvanced, setShowAdvanced] = useState(false)
  /**
   * Khoảng thời gian của dải tóm tắt trên điện thoại (mẫu chủ nhà gửi).
   *
   * ⚠ MẶC ĐỊNH "THÁNG NÀY", KHÔNG PHẢI "TẤT CẢ". Nhà phân phối mở màn
   * này mỗi ngày; "tất cả" là kéo về cả lịch sử nhiều năm để trả lời một
   * câu hỏi về hôm nay, và dải tổng tiền phía trên thành một con số vô
   * nghĩa.
   */
  const [period, setPeriod] = useState<ListPeriod>("month")
  /* Viên thuốc chỉ lọc ở điện thoại — xem `kyDangLoc`. */
  /** Mặt hàng đại diện + số dòng của từng đơn đang hiện. */
  const [lineSummary, setLineSummary] = useState<Record<string, DocLineSummary>>()
  /** Tổng tiền của CẢ bộ lọc. `null` = chưa cộng được — xem `DocListSummary`. */
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null)

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
  /* Kỳ áp cho cả máy tính và điện thoại; hai ô ngày tự chọn thì ô ngày thắng. */
  const kyLoc = kyDangLoc(period, !!(dateFrom || dateTo))
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
  /**
   * ⚠ QUAY VỀ TAB NÀY THÌ ĐỌC LẠI. Nút "Xuất hàng" nay mở TAB MỚI, nên
   * tab danh sách không còn bị rời đi và quay lại — nó nằm im với bản
   * chụp cũ, và đơn vừa xuất vẫn hiện ở tab Phiếu tạm như chưa có gì.
   * Xem `useRefreshOnFocus`.
   */
  const focusTick = useRefreshOnFocus()
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
    DEFAULT_ORDER_FILTERS,
    ORDER_COLUMNS,
    ORDER_FILTERS
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
        /**
         * ⚠ KÉO ĐỦ THEO TRANG, và đọc cả `owner_name` + `phone`.
         *   `.select()` trơn cắt ở 1.000 dòng: khách thứ 1.001 trở đi
         *   không lọc được, mà bộ lọc im lặng như thể họ không có đơn
         *   nào. Và một ô GÕ ĐỂ TÌM chỉ soi tên cửa hàng thì gõ số điện
         *   thoại vẫn ra rỗng.
         *
         * ⚠ Phân trang theo `id` — mốc chia trang phải DUY NHẤT; hai
         *   cửa hàng trùng tên là các trang lặp/sót nhau.
         */
        fetchAllForAggregate<Pick<Customer, "id" | "store_name" | "owner_name" | "phone">>(
          (from, to) =>
            supabase
              .from("customers")
              .select("id, store_name, owner_name, phone", { count: "exact" })
              .order("id")
              .range(from, to)
        ),
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
      setCustomers(
        customersRes.rows
          .slice()
          .sort((a, b) => (a.store_name ?? "").localeCompare(b.store_name ?? ""))
      )
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
  /**
   * Ô TÌM HỎI MÁY CHỦ, TÌM CẢ SỔ (chủ nhà báo 21/09/2026: "Tìm kiếm chỉ
   * tìm trong trang 1, phải tìm toàn bộ chứ?").
   *
   * ⚠ BẢN CŨ CHỈ `ilike("order_code")` — gõ tên điểm bán ra RỖNG, còn
   *   tệ hơn "chỉ trang 1" vì không trang nào chứa kết quả cả.
   *
   * ⚠ TÊN KHÁCH PHẢI TRA RIÊNG: PostgREST không cho `or` bắc qua bảng
   *   nhúng. Phần nối dây nằm ở `useListSearch`.
   */
  const listSearch = useListSearch(
    supabase, debouncedSearch, user?.org_id, ["order_code"],
    [{ column: "customer_id", table: "customers", columns: ["store_name", "owner_name", "phone"] }]
  )
  /**
   * ⚠ TÌM THEO TỪNG TRƯỜNG (mẫu chủ nhà 23/09/2026) — mã đơn, mã/tên hàng,
   *   khách. Ghép "VÀ" với nhau và với ô tìm nhanh; xem `useFieldSearch`.
   *   Trễ 350 ms: tấm lọc điện thoại áp ngay khi gõ.
   */
  const [truongTim, setTruongTim] = useState<Record<string, string>>({})
  const [truongTimTre, setTruongTimTre] = useState<Record<string, string>>({})
  useEffect(() => {
    const t = setTimeout(() => setTruongTimTre(truongTim), 350)
    return () => clearTimeout(t)
  }, [truongTim])
  const fieldSearch = useFieldSearch(supabase, user?.org_id, TRUONG_DON_HANG, truongTimTre)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026), ghép VÀ như tìm theo trường. */
  const locNC = useAdvancedFilter("orders", LOC_DON_HANG)
  const searchReady = listSearch.ready && fieldSearch.ready && locNC.ready

  const applyCommonFilters = <T,>(q: T): T => {
    let x = q as any // eslint-disable-line @typescript-eslint/no-explicit-any
    if (debouncedSearch) {
      /* ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM — xem `listSearch`. */
      if (listSearch.filter) x = x.or(listSearch.filter)
    }
    // Mỗi trường là MỘT `.or` — PostgREST ghép các `or=` bằng "VÀ".
    for (const f of fieldSearch.filters) x = x.or(f)
    for (const f of locNC.menhDe) x = x.or(f)
    // ⚠ Tuyến của đơn = tuyến của ĐIỂM BÁN, và nó nằm ở `customers.channel`
    // (cột lưu MÃ tuyến — xem migration 018). Lọc trên bảng nhúng thì phần
    // nhúng phải là `!inner`, nếu không PostgREST vẫn trả đơn về nhưng bỏ
    // trống phần khách — danh sách đầy dòng "—" trông như dữ liệu hỏng.
    if (routeFilter !== "all") x = x.eq("customer.channel", routeFilter)
    if (customerFilter !== "all") x = x.eq("customer_id", customerFilter)
    if (salesFilter !== "all") x = x.eq("sales_user_id", salesFilter)
    if (dateFrom) x = x.gte("order_date", dateFrom)
    if (dateTo) x = x.lte("order_date", dateTo + "T23:59:59")
    /**
     * ⚠ VIÊN THUỐC KHOẢNG THỜI GIAN ĐI CHUNG MỘT ĐƯỜNG VỚI BỘ LỌC NGÀY.
     * Để nó lọc riêng ở trình duyệt là dải "Tổng tiền hàng" cộng trên một
     * tập, còn danh sách hiện một tập khác — hai con số cạnh nhau, không
     * khớp, không ai giải thích được.
     */
    const pFrom = periodFrom(kyLoc)
    if (pFrom) x = x.gte("order_date", pFrom)
    if (amountMin) x = x.gte("total", parseFloat(amountMin))
    if (amountMax) x = x.lte("total", parseFloat(amountMax))
    return x as T
  }

  /** Lọc theo trạng thái. Tách riêng vì phép đếm phải chạy cho TỪNG trạng thái. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /** Danh sách tab đang vẽ. */
  const tabKeys: readonly string[] = ORDER_TABS
  /**
   * Trạng thái THẬT SỰ được lọc.
   *
   * ⚠ "" NGHĨA LÀ NGƯỜI DÙNG CHƯA CHẠM TAB NÀO — KHÔNG PHẢI "all". Từ khi
   * "Tất cả" trở thành một tab thật (chủ nhà chốt 19/09/2026), "all" là
   * một LỰA CHỌN của người dùng; trộn hai nghĩa vào cùng một giá trị là
   * không còn phân biệt được "chưa chọn gì" với "đã chọn Tất cả", và cả
   * hai nhánh dưới đây đều sai theo.
   *
   * ⚠ KHÔNG ÉP TRẠNG THÁI KHI ĐANG TÌM KIẾM. Tìm và trạng thái nối AND
   * trong CÙNG một truy vấn (xem chỗ gọi `applyStatusFilter` bên dưới),
   * nên đứng ở tab Phiếu tạm mà gõ mã một đơn đã huỷ thì ra RỖNG. Ô tìm
   * trên thanh tiêu đề đẩy sang `/orders?q=…` KHÔNG kèm trạng thái — tức
   * là mọi lần tìm toàn hệ thống đều rơi vào đúng cái bẫy đó.
   *
   * Tìm kiếm là tra cứu TOÀN CỤC, tab là điều hướng. Người dùng tự chọn
   * một tab rồi mới gõ tìm thì tôn trọng lựa chọn đó — nhánh buông trạng
   * thái dưới đây chỉ chạy khi họ CHƯA chạm tab nào.
   *
   * ⚠ Cũng buông khi đang lọc theo BƯỚC XỬ LÝ: bộ lọc đó chạy phía trình
   * duyệt trên đúng trang đang xem, ép thêm trạng thái vào truy vấn là nó
   * lọc trên một tập đã bị cắt và ra danh sách rỗng khó hiểu.
   *
   * ⚠ Một đường dẫn sâu kiểu `/orders?status=draft` vẫn được tôn trọng
   * nguyên trạng — nó là lựa chọn tường minh của nơi gọi, dù "draft"
   * không có tab nào sáng lên.
   */
  const searching = debouncedSearch.trim().length > 0
  const effectiveStatus =
    statusFilter === ""
      ? searching
        ? "all"
        : DEFAULT_ORDER_TAB
      : statusFilter

  /**
   * Lọc theo trạng thái — theo NHÓM của tab, không theo một giá trị.
   *
   * ⚠ `.in(...)` CHỨ KHÔNG `.eq(...)` CHO TAB. Xem `TAB_STATUSES`: bốn
   * tab phải phủ hết sáu trạng thái, nếu không đơn rơi vào khe giữa các
   * tab và biến mất khỏi màn hình.
   *
   * ⚠ GIÁ TRỊ KHÔNG PHẢI TAB THÌ LỌC ĐÚNG NÓ. Đường dẫn sâu
   * `/orders?status=draft` là lựa chọn tường minh của nơi gọi; quy nó về
   * một nhóm là trả về thứ người ta không hỏi.
   */
  const applyStatusFilter = <T,>(q: T, status: string): T => {
    const x = q as any // eslint-disable-line @typescript-eslint/no-explicit-any
    /* ⚠ CHỌN NHIỀU (chủ nhà 25/09/2026): "submitted,completed" → hợp các nhóm. */
    const ds = trangThaiCuaChon(status, TAB_STATUSES)
    if (!ds) return x as T
    return (ds.length === 1 ? x.eq("status", ds[0]) : x.in("status", ds)) as T
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
      /* Chờ lượt tra — đếm với bộ lọc "chưa xong" là nháy các tab về 0. */
      if (!searchReady) return
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
      /**
       * ⚠ SỐ TRÊN TAB PHẢI LÀ SỐ CỦA CẢ NHÓM. Đếm riêng `submitted` rồi
       * dán lên tab đang lọc `submitted + partially_invoiced` là con số
       * trên thẻ nhỏ hơn số dòng đếm được bên dưới nó — đúng loại lệch
       * mà thẻ đếm sinh ra để tránh.
       */
      for (const [tab, group] of Object.entries(TAB_STATUSES)) {
        counts[tab] = group.reduce((n, st) => n + (counts[st] ?? 0), 0)
      }
      setStatusCounts(counts)
    }
    loadCounts()
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, listSearch, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax, kyLoc, fieldSearch.key, locNC.key, focusTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page về 1 mỗi khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, effectiveStatus, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax, kyLoc, fieldSearch.key, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // List query — filter server-side, paginate.
  useEffect(() => {
    let cancelled = false
    async function fetchOrders() {
      setLoading(true)
      /* ⚠ CHỜ LƯỢT TRA MÃ KHÁCH. Giữ nguyên trạng thái "đang nạp" chứ
         không vẽ ra một danh sách thiếu rồi tự sửa. */
      if (!searchReady) return
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
        `id, org_id, order_code, customer_id, sales_user_id, order_date, expected_delivery, status, current_workflow_stage, payment_terms, subtotal, discount, vat, total, merged_into, notes, approved_by, approved_at, approval_reason, created_at, ${cust}, sales_user:users!sales_orders_sales_user_id_fkey(full_name), creator:users!sales_orders_created_by_fkey(full_name)`,
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
        /* ⚠ Đơn nhiều hóa đơn = nhiều phiếu công nợ — GỘP, không lấy dòng cuối. */
        setReceivablesByOrder(
          gopCongNoTheoDon((recvRes.data as Array<{ order_id: string | null; amount: number; paid: number; status: string; due_date: string | null }>) || [])
        )
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
  }, [pg.from, pg.to, debouncedSearch, listSearch, effectiveStatus, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax, kyLoc, fieldSearch.key, locNC.key, focusTick]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /**
   * Dòng hàng của đúng các đơn đang hiện — nuôi CẢ cột "SL MH" của bảng
   * máy tính LẪN dòng "mặt hàng chính" của thẻ điện thoại (mẫu mới).
   *
   * Một truy vấn cho cả trang, phân trang vì 50 đơn × vài chục dòng có
   * thể vượt 1.000.
   *
   * ⚠ ĐỌC HỎNG THÌ ĐỂ `undefined`, KHÔNG ĐỂ `{}`. `{}` làm thẻ in "0 mặt
   *   hàng" cho mọi đơn — câu trả lời sai cho một câu chưa đọc được.
   */
  useEffect(() => {
    if (orders.length === 0) return
    let cancelled = false
    const ids = orders.map((o) => o.id)
    ;(async () => {
      const res = await fetchAllForAggregate<{
        order_id: string
        unit_name: string | null
        quantity: number | string | null
        line_total: number | string | null
        product?: { name?: string | null } | null
      }>((from, to) =>
        supabase
          .from("sales_order_lines")
          .select("order_id, unit_name, quantity, line_total, product:products(name)", { count: "exact" })
          .in("order_id", ids)
          .range(from, to)
      )
      if (cancelled) return
      if (res.error) {
        console.warn("[orders] không đọc được dòng hàng:", res.error)
        return
      }
      const m: Record<string, number> = {}
      for (const id of ids) m[id] = 0
      for (const r of res.rows) m[r.order_id] = (m[r.order_id] || 0) + 1
      setLineCountByOrder((prev) => ({ ...prev, ...m }))
      setLineSummary((prev) => ({
        ...prev,
        ...summariseDocLines(res.rows.map((r) => ({ ...r, doc_id: r.order_id }))),
      }))
    })()
    return () => {
      cancelled = true
    }
  }, [orders]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Tổng tiền của CẢ bộ lọc, cho dải tóm tắt trên điện thoại.
   *
   * ⚠ KHÔNG CỘNG CÁC DÒNG ĐANG HIỆN. Danh sách phân trang 50 dòng; cộng
   *   trang hiện tại rồi gọi nó là "Tổng tiền hàng" là in ra một con số
   *   nhỏ hơn sự thật mà không có gì báo.
   *
   * ⚠ CẮT BỚT Ở TRẦN CŨNG LÀ THIẾU. Chạm trần thì để `null` → dải hiện
   *   "—", chứ không hiện một con số hụt.
   */
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFilteredTotal(null)
      /* Chờ lượt tra — cộng với bộ lọc "chưa xong" là nháy ra 0. */
      if (!searchReady) return
      const res = await fetchAllForAggregate<{ total: number | string }>((from, to) => {
        const q = applyStatusFilter(
          applyCommonFilters(
            // audit-ok: lỗi đi vào nhánh `res.error` ngay dưới.
            supabase
              .from("sales_orders")
              .select(routeFilter !== "all" ? TOTAL_SELECT_WITH_ROUTE : "total", { count: "exact" })
              .range(from, to)
          ),
          effectiveStatus
        )
        // Tab "Tất cả": đơn đã huỷ không vào tổng tiền (số đơn vẫn đếm cả).
        return effectiveStatus === "all" ? q.neq("status", "cancelled") : q
      })
      if (cancelled) return
      if (res.error || res.truncated) {
        console.warn("[orders] không cộng được tổng tiền:", res.error ?? "vượt trần")
        setFilteredTotal(null)
        return
      }
      setFilteredTotal(res.rows.reduce((a, r) => a + (Number(r.total) || 0), 0))
    })()
    return () => { cancelled = true }
  }, [debouncedSearch, listSearch, effectiveStatus, routeFilter, customerFilter, salesFilter, dateFrom, dateTo, amountMin, amountMax, kyLoc, fieldSearch.key, locNC.key, focusTick]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ⚠ Bộ lọc pipeline đã bỏ (chủ nhà chốt 23/09/2026) — mọi lọc chạy ở máy chủ. */
  const filtered = orders

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
  /**
   * HUỶ MỘT HOẶC NHIỀU ĐƠN.
   *
   * ⚠ MỘT HÀM CHO CẢ THANH CHỌN NHIỀU LẪN NGĂN XEM NHANH. Ngăn xem nhanh
   * có nút Huỷ đơn riêng (chủ nhà yêu cầu); viết lại phép huỷ ở đó là
   * hai đường, và chỉ một trong hai đếm số dòng ghi được — tức chỉ một
   * trong hai nhìn thấy khi RLS từ chối.
   */
  const cancelOrders = async (ids: string[]) => {
    if (!user) return
    const selected = orders.filter((o) => ids.includes(o.id))
    // Đơn ĐÃ XUẤT phải huỷ qua RPC (hoàn kho, xoá công nợ) — không gộp
    // vào đây được.
    const cancellable = selected.filter(
      (o) => o.status === "draft" || o.status === "submitted"
    )
    if (cancellable.length === 0) {
      toast({ title: "Không có đơn nào hủy được", variant: "destructive" })
      return
    }
    if (
      !confirm(
        cancellable.length === 1
          ? `Hủy đơn ${cancellable[0].order_code}? Không thể hoàn tác.`
          : `Hủy ${cancellable.length} đơn hàng? Không thể hoàn tác.`
      )
    )
      return
    setBulkLoading(true)
    try {
      /**
       * ⚠ TỪNG ĐƠN MỘT QUA RPC `cancel_order`, KHÔNG UPDATE THẲNG. Bản cũ
       *   chạy một lệnh `UPDATE … IN (ids)`: `cancelled_by` / lý do để
       *   trống, và phiếu trả nháp kèm đơn nằm lại ở `draft` mãi mãi (gắn
       *   vào đơn đã huỷ thì `complete_return` không bao giờ nhận). RPC huỷ
       *   cả phiếu trả nháp và tự gửi thông báo cho người đứng tên.
       *
       * ⚠ Chỉ vá state theo ĐÚNG những đơn RPC nhận — lấy `ids` làm chuẩn
       *   là tin vào thứ mình muốn xảy ra.
       */
      const done = new Set<string>()
      const loi: string[] = []
      for (const o of cancellable) {
        const { error } = await supabase.rpc("cancel_order", {
          p_order_id: o.id,
          p_reason: `Huỷ hàng loạt ở danh sách đơn — ${user.full_name || "người dùng"}`,
        })
        if (error) loi.push(`${o.order_code}: ${errorMessage(error)}`)
        else done.add(o.id)
      }
      if (done.size === 0) {
        throw new Error(loi.join(" · ") || "Không hủy được đơn nào. Tải lại trang để xem trạng thái mới.")
      }

      setOrders((prev) =>
        prev.map((o) => (done.has(o.id) ? { ...o, status: "cancelled" as const } : o))
      )
      toast({ title: `Đã hủy ${done.size} đơn` })
      if (done.size < ids.length) {
        toast({
          title: `${ids.length - done.size} đơn không hủy được`,
          description: loi.join(" · ") || "Bạn không có quyền với những đơn đó, hoặc chúng đã đi tiếp.",
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
    const headers = ["Mã đơn", "Khách hàng", "Tính cho NV", "Ngày đặt", "Tổng tiền", "Trạng thái"]
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
   * vào huy hiệu "đang lọc" thì tab MẶC ĐỊNH cũng làm huy hiệu sáng lên
   * và nút "Xoá lọc" mọc ra cho một thứ không ai đặt. So với
   * `DEFAULT_ORDER_TAB` chứ không so với một chuỗi viết tay: mặc định
   * đã đổi từ "Phiếu tạm" sang "Tất cả" (chủ nhà chốt 20/09/2026), và
   * một chuỗi viết tay ở đây sẽ đứng yên.
   */
  const statusIsFiltered = effectiveStatus !== DEFAULT_ORDER_TAB
  /**
   * Danh sách đang bị thu hẹp bởi MỘT thao tác nào đó của người dùng —
   * tab, ô tìm, bộ lọc nâng cao hay bước xử lý. Dùng để phân biệt "lọc
   * trượt" với "chưa có đơn nào".
   */
  const activeFilterCount =
    (statusIsFiltered ? 1 : 0) + (routeFilter !== "all" ? 1 : 0) +
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) +
    (customerFilter !== "all" ? 1 : 0) + (salesFilter !== "all" ? 1 : 0) +
    (amountMin ? 1 : 0) + (amountMax ? 1 : 0) +
    soTruongDangTim(truongTim)
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
    setRouteFilter("all")
    setDateFrom(""); setDateTo("")
    setCustomerFilter("all"); setSalesFilter("all")
    setAmountMin(""); setAmountMax("")
    setTruongTim({})
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
                {/*
            ⚠ GÕ ĐỂ TÌM, KHÔNG CUỘN (chủ nhà chốt 21/09/2026). Bỏ chọn
              (nút ✕) là quay về "tất cả khách" — vai trò cũ của mục
              "Tất cả khách hàng" trong `<Select>`.
          */}
          <SearchSelect
            id="ord-customer"
            options={customerOptions}
            valueId={customerFilter === "all" ? "" : customerFilter}
            onPick={(o) => setCustomerFilter(o?.id ?? "all")}
            placeholder="Tất cả khách hàng — gõ để lọc…"
            emptyHint="Không tìm thấy khách nào khớp."
          />
              </div>
            )}
            {filterActive("sales") && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground">Tính cho NV</label>
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
                  {/* Rỗng = không lọc; xoá trắng ô (MoneyInput phát 0) cũng về rỗng. */}
                  <MoneyInput
                    placeholder="0"
                    value={amountMin}
                    onChange={(n) => setAmountMin(n ? String(n) : "")}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">Tổng tiền đến</label>
                  <MoneyInput
                    placeholder="VD: 50.000.000"
                    value={amountMax}
                    onChange={(n) => setAmountMax(n ? String(n) : "")}
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
                    onClick={() => cancelOrders(Array.from(selectedIds))}
                    disabled={bulkLoading}
                    className="border-error/40 text-on-error-container hover:bg-error-container"
                  >
                    <XCircle className="mr-2 h-4 w-4" />
                    Hủy {cancellableCount} đơn
                  </Button>
                )}
                {/* SOẠN HÀNG (chủ nhà 25/09/2026): gộp các đơn đang chọn → tổng hàng cần xuất, in. */}
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="nut-soan-hang"
                  onClick={() => router.push(soanHangHref(Array.from(selectedIds)))}
                >
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Soạn hàng
                </Button>
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



  return (
    <div className="space-y-4">
      {/*
        `orders` chỉ là TRANG HIỆN TẠI (50 dòng/trang), không phải tổng. Dòng
        phụ đề trước đây in ra số đó nên có 125 đơn mà ghi "50 đơn hàng".
        `pg.total` là số server trả về kèm count: "exact".
      */}
      {/*
        ⚠ DÒNG MÔ TẢ CHỈ CÒN Ở MÁY TÍNH (chủ nhà chốt 19/09/2026: "Bỏ
        phần khoanh đỏ"). Trên điện thoại mọi vế của nó đã có chỗ nói
        đúng hơn: "N đơn hôm nay · tiền" nằm ở đầu nhóm HÔM NAY, "N phiếu
        tạm chờ xuất" là con số trên thẻ Phiếu tạm, "N đơn · đang xem 50"
        nằm ở chân trang. Giữ nguyên ở máy tính vì bảng máy tính không gom
        theo ngày — ở đó dòng này là nơi DUY NHẤT nói ra tiền hàng hôm nay.
      */}
      <PageHeader
        title={isSales ? "Đơn của tôi" : "Đơn hàng"}
        descriptionDesktopOnly
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
        {/* ⚠ NÚT NÀY CHỈ CÒN Ở MÁY TÍNH. Trên điện thoại thanh dưới đã có
            nút "Bán hàng" tròn xanh đi tới ĐÚNG cùng một chỗ
            (`NEW_ORDER_HREF`), lúc nào cũng thấy — hai nút cùng việc nằm
            cách nhau một gang tay chỉ tốn chỗ của danh sách. Máy tính
            không có thanh dưới nên ở đó phải giữ. */}
        {/* Soạn hàng: gộp nhiều đơn → tổng hàng cần xuất (chọn đơn ngay trong màn đó). */}
        <Button variant="outline" onClick={() => router.push(soanHangHref([]))}>
          <ClipboardList className="mr-2 h-4 w-4" /> Soạn hàng
        </Button>
        {user && hasPermission(user.role, "orders", "create") && (
          <Button className="hidden lg:inline-flex" onClick={() => router.push(newOrderHref())}>
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
      {/*
        ⚠ MỘT HÀNG VIÊN THUỐC, KHÔNG KHUNG (chủ nhà chốt 20/09/2026).
          Thẻ có khung chia ô đều nhau vốn ÉP số ô: bốn ô đã phải thu đệm
          và cỡ chữ cho vừa màn 375px, và chính cái trần ấy là lý do
          `partially_invoiced` không có ô nào — đơn xuất thiếu vì thế
          biến mất khỏi mọi tab. Hàng cuộn ngang thì không có trần.
      */}
      <StatusChips
        multi
        active={effectiveStatus}
        onPick={(k) => setStatusFilter(k)}
        chips={tabKeys.map((k) => ({
          key: k,
          label: k === "all" ? "Tất cả" : STATUS_CHIP_LABEL[k as (typeof COUNTED_STATUSES)[number]],
          count: statusCounts[k] ?? 0,
          accent: k === "all" ? "#181c1e" : orderTone(k).accent,
        }))}
      />

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
          <DocFieldInputs fields={TRUONG_DON_HANG} values={truongTim} onChange={setTruongTim} />
          <AdvancedFilter truong={LOC_DON_HANG} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
          {routes.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">Tuyến</p>
              <RouteFilter inline routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />
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
          <DocSearchBox
            className="flex-1 min-w-[260px] max-w-md"
            value={search}
            onChange={setSearch}
            placeholder="Tìm mã đơn, tên khách, số điện thoại…"
            fields={TRUONG_DON_HANG}
            applied={truongTim}
            onApply={setTruongTim}
            onExpand={() => setShowAdvanced(true)}
          />
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
        <PeriodSelect
          value={dateFrom || dateTo ? "custom" : period}
          onChange={(k) => { setDateFrom(""); setDateTo(""); setPeriod(k) }}
        />
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
            Lọc nhanh
            {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <AdvancedFilter truong={LOC_DON_HANG} value={locNC.dieuKien} onApply={locNC.apDung} />
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

        {/* Khối thống kê (máy tính) — điện thoại có `DocListSummary` bên dưới. */}
        <DocListTotals
          desktopOnly
          countText={`${pg.total} đơn hàng`}
          total={filteredTotal === null ? null : formatCurrency(filteredTotal)}
        />
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
            onApprove={(o) => openInNewTab(`/sales-invoices/new?order=${o.id}`)}
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

      {/*
        ⚠ TRA MÃ KHÁCH CHẠM TRẦN THÌ NÓI RA. Kết quả đang THIẾU và nó
          trông y hệt lúc đủ — đúng cái lỗi "chỉ tìm trang 1" vừa sửa,
          chỉ đổi chỗ sang "300 khách đầu". Im lặng ở đây là đi lại đúng
          con đường cũ.
      */}
      {(listSearch.truncated || fieldSearch.truncated) && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-[#7a4b00]">
          <p className="font-semibold">Kết quả tìm đang thiếu</p>
          <p className="mt-0.5">
            Có hơn {MATCH_CAP} điểm bán khớp &ldquo;{debouncedSearch}&rdquo; — danh sách dưới
            chỉ gồm đơn của {MATCH_CAP} điểm bán đầu. Gõ thêm cho hẹp lại, hoặc lọc theo
            điểm bán.
          </p>
        </div>
      )}

      {/* Điện thoại: khung xương / trạng thái rỗng / danh sách nhóm theo
          ngày. Máy tính có thẻ bảng riêng ở trên với thanh công cụ của nó. */}
      <div className="lg:hidden">
      {/* Dải tóm tắt theo mẫu: viên thuốc khoảng thời gian · bộ lọc ·
          "Tổng tiền hàng" với tổng của CẢ bộ lọc. */}
      <DocListSummary
        period={period}
        onCyclePeriod={() => setPeriod((p) => nextPeriod(p))}
        onOpenFilter={() => setFilterSheet(true)}
        filtersActive={activeFilterCount > 0 || period !== "month"}
        onClearFilters={() => {
          clearAdvancedFilters()
          setPeriod("month")
        }}
        countText={`${pg.total} đơn hàng`}
        total={filteredTotal === null ? null : formatCurrency(filteredTotal)}
      />
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
              lineSummary={lineSummary}
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
        onApprove={(o) => openInNewTab(`/sales-invoices/new?order=${o.id}`)}
        canCancel={!!canApprove}
        cancelling={bulkLoading}
        onCancel={(o) => cancelOrders([o.id])}
      />

    </div>
  )
}
