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

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { PeriodSelect } from "@/components/ui/period-select"
import Link from "next/link"
import { ChevronDown, ChevronUp, FileText, Filter } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { MATCH_CAP } from "@/lib/search/list-search"
import { useListSearch } from "@/hooks/use-list-search"
import { SearchSelect } from "@/components/ui/search-select"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus"
import { usePagination } from "@/hooks/use-pagination"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { DataPagination } from "@/components/ui/data-pagination"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { RouteFilter } from "@/components/orders/route-filter"
import { StatusChips } from "@/components/ui/status-chips"
import {
  DesktopInvoiceTable,
  type InvoiceRow,
  type InvoiceSort,
  type InvoiceSortKey,
} from "@/components/sales-invoices/desktop-invoice-table"
import { InvoiceDrawer } from "@/components/sales-invoices/invoice-drawer"
import { MobileInvoiceList } from "@/components/sales-invoices/mobile-invoice-list"
import { DocListSummary } from "@/components/ui/doc-list-summary"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import { DocSearchBox, DocFieldInputs } from "@/components/ui/doc-search-box"
import { useFieldSearch } from "@/hooks/use-field-search"
import { TRUONG_HOA_DON } from "@/lib/search/doc-fields"
import { soTruongDangTim } from "@/lib/search/field-search"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import {
  periodFrom, nextPeriod, summariseDocLines,
  type ListPeriod, type DocLineSummary,
  kyDangLoc,
} from "@/lib/orders/list-summary"
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
  /* Viên thuốc chỉ lọc ở điện thoại — xem `kyDangLoc`. */
  /** Mặt hàng đại diện của từng hóa đơn đang hiện. */
  const [lineSummary, setLineSummary] = useState<Record<string, DocLineSummary>>()
  /** Tổng tiền của CẢ bộ lọc. `null` = chưa cộng được. */
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string>("posted")
  const [search, setSearch] = useState("")
  /**
   * ⚠ Ô TÌM HỎI MÁY CHỦ, KHÔNG LỌC TRONG TRANG ĐANG XEM (chủ nhà báo
   *   21/09/2026: "Tìm kiếm chỉ tìm trong trang 1, phải tìm toàn bộ
   *   chứ?"). Bản cũ lọc `rows` — 50 dòng của trang hiện tại — và có
   *   hẳn một chú thích thừa nhận điều đó, kèm cách vá là ghi vào
   *   placeholder. Một danh sách nghìn hoá đơn thì ô tìm ấy đúng vài
   *   phần trăm số lần dùng.
   */
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [routeFilter, setRouteFilter] = useState("all")
  const [customerFilter, setCustomerFilter] = useState("all")
  const [salesFilter, setSalesFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  /* Kỳ áp cho cả máy tính và điện thoại; hai ô ngày tự chọn thì ô ngày thắng. */
  const kyLoc = kyDangLoc(period, !!(dateFrom || dateTo))
  const [amountMin, setAmountMin] = useState("")
  const [amountMax, setAmountMax] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filterSheet, setFilterSheet] = useState(false)
  const [sort, setSort] = useState<InvoiceSort | null>(null)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const focusTick = useRefreshOnFocus()

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
  const [routes, setRoutes] = useState<Array<{ code: string; name: string }>>([])

  const isSales = user?.role === "sales"

  useEffect(() => {
    let cancelled = false
    ;(async () => {
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
        supabase.from("sales_routes").select("code, name").eq("is_active", true).order("sort_order"),
      ])
      if (cancelled) return
      const e = ([customersRes, usersRes, routesRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (e) console.error("[sales-invoices] nạp dữ liệu nền lỗi:", e.message)
      setCustomers(
        customersRes.rows
          .slice()
          .sort((a, b) => (a.store_name ?? "").localeCompare(b.store_name ?? ""))
      )
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
  /* Gõ tới đâu hỏi tới đó thì mỗi phím một lượt gọi — chờ 300ms. */
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  /**
   * ⚠ HAI LƯỢT TRA RIÊNG VÌ PostgREST KHÔNG CHO `or` BẮC QUA BẢNG
   *   NHÚNG. Tìm theo tên điểm bán hay theo mã đơn gốc đều phải hỏi mã
   *   trước rồi mới lọc theo khoá ngoại. Phần nối dây ở `useListSearch`.
   */
  const listSearch = useListSearch(
    supabase, debouncedSearch, user?.org_id, ["invoice_code"],
    [
      { column: "customer_id", table: "customers", columns: ["store_name", "owner_name", "phone"] },
      { column: "order_id", table: "sales_orders", columns: ["order_code"] },
    ]
  )
  /* ⚠ TÌM THEO TỪNG TRƯỜNG (mẫu 23/09/2026) — mã hóa đơn/đơn, hàng, số lô,
     khách; ghép "VÀ". Xem `useFieldSearch`. Trễ 350 ms cho tấm lọc điện thoại. */
  const [truongTim, setTruongTim] = useState<Record<string, string>>({})
  const [truongTimTre, setTruongTimTre] = useState<Record<string, string>>({})
  useEffect(() => {
    const t = setTimeout(() => setTruongTimTre(truongTim), 350)
    return () => clearTimeout(t)
  }, [truongTim])
  const fieldSearch = useFieldSearch(supabase, user?.org_id, TRUONG_HOA_DON, truongTimTre)
  const searchReady = listSearch.ready && fieldSearch.ready
  const searchTruncated = listSearch.truncated || fieldSearch.truncated

  const applyFilters = useCallback(
    <T extends {
      eq: (c: string, v: unknown) => T
      gte: (c: string, v: unknown) => T
      lte: (c: string, v: unknown) => T
      or: (f: string) => T
    }>(
      q: T
    ): T => {
      let x = q
      /**
       * ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM. Mệnh đề này đi vào CẢ
       *   truy vấn danh sách LẪN các truy vấn đếm/cộng tiền — nếu không
       *   thì con số trên thẻ tóm tắt cộng trên một tập còn danh sách
       *   hiện một tập khác.
       */
      if (listSearch.filter) x = x.or(listSearch.filter)
      // Mỗi trường là MỘT `.or` — PostgREST ghép các `or=` bằng "VÀ".
      for (const f of fieldSearch.filters) x = x.or(f)
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
      const pFrom = periodFrom(kyLoc)
      if (pFrom) x = x.gte("invoice_date", pFrom)
      return x
    },
    [customerFilter, salesFilter, routeFilter, dateFrom, dateTo, amountMin, amountMax, kyLoc,
     listSearch, fieldSearch]
  )

  /**
   * ⚠ LƯỢT GỌI CŨ KHÔNG ĐƯỢC GHI ĐÈ LƯỢT MỚI. Ba phép đọc (danh sách, tổng,
   *   số đếm) chạy lại mỗi khi bộ lọc đổi — trên máy tính còn chạy HAI lần
   *   lúc mở (khổ màn hình đọc xong sau lượt vẽ đầu, `kyLoc` đổi). Lượt cũ
   *   về sau cùng thì tổng "tháng này" nằm lại dưới danh sách "tất cả".
   *   Mỗi phép giữ một số thứ tự; kết quả của lượt không còn mới nhất bị bỏ.
   */
  const luotRef = useRef({ ds: 0, tong: 0, dem: 0 })

  const fetchData = useCallback(async () => {
    setLoading(true)
    /* ⚠ CHỜ LƯỢT TRA MÃ. Giữ "đang nạp" chứ không vẽ một danh sách
       thiếu rồi tự sửa vài trăm mili giây sau. */
    if (!searchReady) return
    const luot = ++luotRef.current.ds
    const cust = routeFilter !== "all" ? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED
    let q = supabase
      .from("sales_invoices")
      .select(`${BASE_COLS}, ${cust}, ${SALES_EMBED}, order:sales_orders(order_code)`, { count: "exact" })
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
    if (status !== "all") q = q.eq("status", status)
    q = applyFilters(q as never) as typeof q

    const { data, error, count } = await q.range(pg.from, pg.to)
    if (luot !== luotRef.current.ds) return
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
  }, [status, applyFilters, searchReady, pg.from, pg.to])

  /**
   * Tổng tiền của CẢ bộ lọc, cho dải tóm tắt trên điện thoại.
   *
   * ⚠ KHÔNG CỘNG `rows`. Đó là một trang 50 dòng; cộng nó rồi gọi là
   *   "Tổng tiền hàng" là in ra con số nhỏ hơn sự thật mà không báo gì.
   * ⚠ CHẠM TRẦN CŨNG LÀ THIẾU → để `null`, dải hiện "—".
   */
  const fetchTotal = useCallback(async () => {
    setFilteredTotal(null)
    if (!searchReady) return
    const luot = ++luotRef.current.tong
    const cust = routeFilter !== "all" ? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED
    const res = await fetchAllForAggregate<{ total: number | string }>((from, to) => {
      let q = supabase
        .from("sales_invoices")
        .select(routeFilter !== "all" ? `total, ${cust}` : "total", { count: "exact" })
      if (status !== "all") q = q.eq("status", status)
      // Tab "Tất cả": hóa đơn đã huỷ không vào tổng tiền.
      else q = q.neq("status", "cancelled")
      return (applyFilters(q as never) as typeof q).range(from, to)
    })
    if (luot !== luotRef.current.tong) return
    if (res.error || res.truncated) {
      console.warn("[sales-invoices] không cộng được tổng tiền:", res.error ?? "vượt trần")
      setFilteredTotal(null)
      return
    }
    setFilteredTotal(res.rows.reduce((a, r) => a + (Number(r.total) || 0), 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, applyFilters, routeFilter, searchReady])

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
    if (!searchReady) return
    const luot = ++luotRef.current.dem
    const [posted, cancelled, all] = await Promise.all([one("posted"), one("cancelled"), one(null)])
    if (luot !== luotRef.current.dem) return
    setCounts({ posted, cancelled, all })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFilters, routeFilter, searchReady])

  /**
   * ⚠ QUAY VỀ TAB NÀY THÌ ĐỌC LẠI — cùng lý do với màn đơn hàng. Nút
   * "Sửa hóa đơn" / "Huỷ đơn" / "In" ở ngăn xem nhanh nay mở TAB MỚI,
   * nên tab danh sách nằm im với bản chụp cũ và hiện trạng thái đã lỗi
   * thời. Xem `useRefreshOnFocus`.
   */
  useEffect(() => {
    if (!authLoading) fetchData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, fetchData, focusTick])

  useEffect(() => {
    if (!authLoading) fetchTotal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, fetchTotal, focusTick])

  useEffect(() => {
    if (!authLoading) fetchCounts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, fetchCounts, focusTick])

  /** Đổi bộ lọc thì về trang 1 — đứng ở trang 7 của một kết quả 2 dòng là màn trắng. */
  useEffect(() => {
    pg.setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, customerFilter, salesFilter, routeFilter, dateFrom, dateTo, amountMin, amountMax, debouncedSearch, kyLoc, fieldSearch.key])

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
   * ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT NỮA. Ô tìm nay hỏi máy chủ (xem
   * `applyFilters`), nên `rows` ĐÃ là kết quả tìm — lọc thêm một lần ở
   * đây là lọc hai lần theo hai luật khác nhau: máy chủ dùng `ilike`
   * không dấu-nhạy, trình duyệt dùng `toLowerCase().includes`. Hai luật
   * lệch nhau là dòng vừa được máy chủ trả về lại bị trình duyệt giấu
   * đi, và số đếm trên phân trang không khớp số dòng nhìn thấy.
   */
  const filtered = rows


  const clearAdvanced = () => {
    setCustomerFilter("all"); setSalesFilter("all"); setRouteFilter("all")
    setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax("")
    setTruongTim({})
  }
  const activeFilterCount =
    (customerFilter !== "all" ? 1 : 0) + (salesFilter !== "all" ? 1 : 0) +
    (routeFilter !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) +
    (amountMin || amountMax ? 1 : 0) + soTruongDangTim(truongTim)

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
            id="inv-customer"
            options={customerOptions}
            valueId={customerFilter === "all" ? "" : customerFilter}
            onPick={(o) => setCustomerFilter(o?.id ?? "all")}
            placeholder="Tất cả khách hàng — gõ để lọc…"
            emptyHint="Không tìm thấy khách nào khớp."
          />
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
            <MoneyInput placeholder="0" value={amountMin} onChange={(n) => setAmountMin(n ? String(n) : "")} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">Tổng tiền đến</label>
            <MoneyInput placeholder="VD: 50.000.000" value={amountMax} onChange={(n) => setAmountMax(n ? String(n) : "")} />
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
      {/*
        ⚠ DÒNG MÔ TẢ CHỈ CÒN Ở MÁY TÍNH — cùng lý do với màn đơn hàng
        (chủ nhà chốt 19/09/2026, "áp dụng cả sang bên ds hoá đơn"). Đây
        là một câu giải thích đọc MỘT lần, không phải con số phải theo
        dõi; để nó chiếm một dải ngang trên mọi lần mở danh sách bằng
        điện thoại là lấy mất chỗ của chính những hóa đơn nó đang nói tới.
      */}
      <PageHeader
        title="Hóa đơn bán"
        descriptionDesktopOnly
        description="Chứng từ thực xuất: trừ kho, sinh công nợ, là nguồn của hoá đơn điện tử."
      />

      {/* ⚠ CÙNG DẢI VỚI MÀN ĐƠN HÀNG (chủ nhà chốt 20/09/2026: dải thống
          kê "về đơn giản, không cần khung như cũ"). Hai màn nằm cạnh nhau
          trong cùng một nhóm; để một bên khung một bên viên thuốc là bắt
          người dùng học hai cách đọc cho cùng một việc. */}
      <StatusChips
        active={status}
        onPick={setStatus}
        chips={TABS.map((t) => ({
          key: t.key,
          label: t.label,
          count: counts[t.key] ?? 0,
          accent: t.accent,
        }))}
      />

      {/*
        ⚠ TRA MÃ CHẠM TRẦN THÌ NÓI RA. Kết quả đang THIẾU và trông y hệt
          lúc đủ — đúng cái lỗi "chỉ tìm trang 1" vừa sửa, chỉ đổi chỗ.
      */}
      {searchTruncated && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-[#7a4b00]">
          <p className="font-semibold">Kết quả tìm đang thiếu</p>
          <p className="mt-0.5">
            Có hơn {MATCH_CAP} điểm bán hoặc đơn hàng khớp &ldquo;{debouncedSearch}&rdquo; —
            danh sách dưới chưa đủ. Gõ thêm cho hẹp lại.
          </p>
        </div>
      )}

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm số hóa đơn, mã đơn, tên khách…"
        activeCount={activeFilterCount}
        onClear={clearAdvanced}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <div className="grid gap-4">
          <DocFieldInputs fields={TRUONG_HOA_DON} values={truongTim} onChange={setTruongTim} />
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
            <DocSearchBox
              className="min-w-[260px] max-w-md flex-1"
              value={search}
              onChange={setSearch}
              placeholder="Tìm số hóa đơn, mã đơn, tên khách…"
              fields={TRUONG_HOA_DON}
              applied={truongTim}
              onApply={setTruongTim}
              onExpand={() => setShowAdvanced(true)}
            />
          )}
          <RouteFilter routes={routes} counts={routeCounts} value={routeFilter} onChange={setRouteFilter} />
          <PeriodSelect
            value={dateFrom || dateTo ? "custom" : period}
            onChange={(k) => { setDateFrom(""); setDateTo(""); setPeriod(k) }}
          />
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

        {/* Khối thống kê (máy tính) — điện thoại có `DocListSummary` bên dưới. */}
        <DocListTotals
          desktopOnly
          label="Tổng tiền hóa đơn"
          countText={`${pg.total} hóa đơn`}
          total={filteredTotal === null ? null : formatCurrency(filteredTotal)}
        />
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
        onChanged={fetchData}
      />
    </div>
  )
}
