"use client"

import { errorMessage } from "@/lib/errors"
import { CHUA_PHAN_CONG, chonNv } from "@/lib/customers/loc-nhan-vien"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_KHACH_HANG } from "@/lib/search/list-filter-fields"
import { useEffect, useMemo, useRef, useState } from "react"
import { dieuKienTim } from "@/lib/search/list-search"
import { usePagination } from "@/hooks/use-pagination"
import { StatusChips } from "@/components/ui/status-chips"
import { DocListLayout } from "@/components/ui/doc-list-layout"
import { buildManagers, managersSummary, type Manager } from "@/lib/customers/managers"
import { CHUA_CO_TUYEN, dinhDangSdt, sdtTuTimKiem } from "@/lib/customers/tao-khach"
import Link from "@/components/ui/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient, type ResilientResult } from "@/lib/supabase/resilient"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { locDanhSachMa, catTrangMa, xepTheoMa } from "@/lib/customers/loc-nhanh"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useToast } from "@/hooks/use-toast"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { CustomerTable } from "@/components/customers/customer-table"
import {
  MobileCustomersScreen,
  BUOC_TAI_KHACH,
  diaChiNgan,
  type KhachMobile,
  type NhanKhach,
  type SapXepKhach,
} from "@/components/customers/mobile-customers-screen"
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
  todayVN,
  QUICK_FILTER_LABEL,
  type QuickFilter,
} from "@/lib/customers/list-view"
import type { Customer, Receivable } from "@/types"
import {
  CUSTOMER_COLUMNS,
  DEFAULT_CUSTOMER_COLUMNS,
  CUSTOMER_FILTERS,
  DEFAULT_CUSTOMER_FILTERS,
  type CustomerFilterKey,
  COT_TIM_KHACH,
} from "./list-config"

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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Khoá truy vấn lần tải trước (trừ `pg.to`) — trùng nghĩa là "Tải thêm", không vẽ lại nhịp đầu. */
  const khoaTaiRef = useRef<KhoaTai>(null)
  /** Danh sách mã của thẻ lọc nhanh SAU khi áp bộ lọc khác — nhớ theo khoá lọc để "Tải thêm" không lọc lại. */
  const quickLocRef = useRef<{ khoa: string; ids: string[] } | null>(null)
  const [search, setSearch] = useState("")
  const [quick, setQuick] = useState<QuickFilter>("all")
  const [statusFilter, setStatusFilter] = useState("all")
  /* `?tuyen=chua` — thông báo "khách chưa gán tuyến" mở thẳng danh sách cần cập nhật (chủ nhà 01/10/2026). */
  const [channelFilter, setChannelFilter] = useState("all")
  // Đọc trong effect, không lúc render đầu (HTML máy chủ ≠ máy khách → lỗi hydrate #418).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tuyen") === "chua") setChannelFilter(CHUA_CO_TUYEN)
  }, [])
  const [salesUserFilter, setSalesUserFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [totalCustomers, setTotalCustomers] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  /* 20 khách một lần — điện thoại "Tải thêm 20", máy tính 20/trang (chủ nhà 26/09/2026). */
  const pg = usePagination(BUOC_TAI_KHACH)
  /** Cách sắp của danh sách "Tất cả" trên điện thoại. */
  const [sapXep, setSapXep] = useState<SapXepKhach>("name")
  /** "T7" / "CN" — tuyến của hôm nay, tính ở trình duyệt để không lệch lúc hydrate. */
  const [thuHomNay, setThuHomNay] = useState("")
  useEffect(() => {
    const d = new Date(`${todayVN()}T12:00:00`).getDay()
    setThuHomNay(d === 0 ? "CN" : `T${d + 1}`)
  }, [])
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
        /* ⚠ Đọc ĐỦ (phân trang) — đọc trơn bị `db.max_rows` cắt ở 1.000 điểm, thẻ "Tuyến hôm nay" thiếu khách. */
        fetchAllForAggregate<{ customer_id: string; visit_order: number | null }>((from, to) =>
          supabase
            .from("pjp_routes")
            .select("customer_id, visit_order", { count: "exact" })
            .eq("day_of_week", dow)
            .eq("is_active", true)
            .order("visit_order")
            .order("id")
            .range(from, to)
        ),
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
      const qErr = ([totalRes, visitsRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[app/customers] truy vấn lỗi:", qErr.message)
      if (pjpRes.error) console.error("[app/customers] truy vấn tuyến hôm nay lỗi:", pjpRes.error)

      setTotalCustomers(totalRes.count ?? 0)

      const visitsToday = new Set<string>()
      for (const v of (visitsRes.data as Array<{ customer_id: string | null }>) || []) {
        if (v.customer_id) visitsToday.add(v.customer_id)
      }
      setVisitedToday(visitsToday)

      const stops = new Map<string, number>()
      const pjpRows = pjpRes.rows
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
          if (remaining === 0) continue
          /* Phiếu ÂM (hàng trả > hàng xuất, mig 186) TRỪ vào nợ của khách —
             nhưng không bao giờ là nợ quá hạn. */
          debtMap[r.customer_id] = (debtMap[r.customer_id] || 0) + remaining
          if (remaining > 0 && daysOverdueOf(r.due_date) > 0) {
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

  /** Bộ lọc nhân viên đang áp (`null` = không lọc). NVBH chỉ thấy khách của mình nên không có bộ lọc này. */
  const nvLoc = !isSales && activeFilters.includes("sales") && salesUserFilter !== "all" ? salesUserFilter : null

  // Reset page khi filter/search đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, locNC.key, statusFilter, channelFilter, salesUserFilter, quick, sapXep, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Danh sách mã khách mà thẻ lọc nhanh giới hạn vào. `null` = không giới hạn. */
  /**
   * ⚠ "NỢ NHIỀU NHẤT" SẮP TRÊN TOÀN BỘ NỢ ĐÃ ĐỌC (`debts` kéo đủ mọi phiếu), không sắp trong
   *   trang đang tải — sắp 20 dòng đầu theo tên rồi xếp lại theo nợ là bỏ sót người nợ nhiều ở
   *   trang sau. Chỉ gồm khách CÒN NỢ; đang gõ tìm thì về thứ tự tên.
   */
  const noNhieuNhat = quick === "all" && sapXep === "debt" && !debouncedSearch && debts !== null
  const quickIds = useMemo<string[] | null>(() => {
    if (quick === "today") return Array.from(todayStops.keys())
    if (quick === "overdue") return overdueIds
    if (noNhieuNhat && debts) {
      return Object.keys(debts).filter((id) => debts[id] > 0).sort((a, b) => debts[b] - debts[a])
    }
    return null
  }, [quick, todayStops, overdueIds, noNhieuNhat, debts])

  // List query — paginate + filter server-side.
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      const khoa = JSON.stringify([debouncedSearch, locNC.key, statusFilter, channelFilter, nvLoc, quickIds, refreshTick, pg.from])
      if (!laTaiThem(khoaTaiRef, khoa, pg.to, false)) setLoading(true)
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
        setManagersMap({})
        setLoading(false)
        return
      }

      /**
       * Thẻ lọc nhanh phân trang trên DANH SÁCH MÃ đã có sẵn, không phân
       * trang ở server: gửi một `in.()` dài hàng nghìn mã là URL vượt
       * trần của proxy và request chết với 414 mà không ai đoán ra vì sao.
       */
      /* Bộ lọc khác thẻ lọc nhanh (NV / ô tìm / lọc nâng cao / trạng thái / tuyến) — áp chung cho truy vấn
         danh sách và cho bước lọc danh sách mã bên dưới. */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apLoc = (q: any) => {
        /* ⚠ LỌC NHÂN VIÊN TRÊN MÁY CHỦ (chủ nhà 03/10/2026: "nhân viên 60 khách mà có 3 khách hiện") — bản cũ lọc
           trong 20 khách của trang đang tải. NV chính đang hoạt động, như cột "Phụ trách". */
        if (nvLoc) {
          q = q.eq("nv_chinh.role", "primary").eq("nv_chinh.status", "active")
          q = nvLoc === CHUA_PHAN_CONG ? q.is("nv_chinh", null) : q.eq("nv_chinh.user_id", nvLoc)
        }
        if (debouncedSearch) {
          /* Tìm cả theo ĐỊA CHỈ (chủ nhà 26/09/2026) — `tim_kd` cũng có địa chỉ từ mig 203. */
          q = q.or(dieuKienTim("customers", COT_TIM_KHACH, debouncedSearch))
        }
        /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
        for (const f of locNC.menhDe) q = q.or(f)
        if (statusFilter !== "all") q = q.eq("status", statusFilter)
        if (channelFilter === CHUA_CO_TUYEN) q = q.or("channel.is.null,channel.eq.")
        else if (channelFilter !== "all") q = q.eq("channel", channelFilter)
        return q
      }
      const coLocKhac = !!(nvLoc || debouncedSearch || locNC.menhDe.length || statusFilter !== "all" || channelFilter !== "all")

      /**
       * ⚠ THẺ LỌC NHANH + BỘ LỌC KHÁC: lọc TOÀN BỘ danh sách mã trước, rồi mới cắt trang (rà soát 03/10/2026 —
       *   bản cũ cắt 20 mã rồi mới lọc, trang gần như trống, tổng số sai). Kết quả lọc giữ trong `quickLocRef` để
       *   "Tải thêm" không đọc lại cả danh sách. `src/lib/customers/loc-nhanh.ts`.
       */
      let quickLoc: string[] | null = null
      if (quickIds) {
        const khoaLoc = JSON.stringify([quickIds, nvLoc, debouncedSearch, locNC.key, statusFilter, channelFilter, refreshTick])
        if (quickLocRef.current?.khoa === khoaLoc) quickLoc = quickLocRef.current.ids
        else {
          try {
            quickLoc = await locDanhSachMa(quickIds, coLocKhac, (lo, from, to) =>
              apLoc(supabase.from("customers").select("id" + chonNv(nvLoc), { count: "exact" }).in("id", lo)).order("id").range(from, to)
            )
          } catch (e) {
            if (cancelled) return
            setCustomers([])
            setLoadError(errorMessage(e, "Không lọc được danh sách khách"))
            pg.setTotal(0)
            setLoading(false)
            return
          }
          if (cancelled) return
          quickLocRef.current = { khoa: khoaLoc, ids: quickLoc }
        }
        if (quickLoc.length === 0) {
          setCustomers([])
          setLoadError(null)
          pg.setTotal(0)
          setManagersMap({})
          setLoading(false)
          return
        }
      }
      const idSlice = quickLoc ? catTrangMa(quickLoc, pg.from, pg.to) : null

      const build = (select: string, from = pg.from, to = pg.to, dem = true) => {
        let q = apLoc(
          supabase
            .from("customers")
            .select(select + chonNv(nvLoc), dem ? { count: "exact" } : undefined)
            .order("store_name")
        )
        if (idSlice) q = q.in("id", idSlice)
        else q = q.range(from, to)
        return q
      }
      const chon = "id, org_id, store_name, owner_name, phone, address, province, district, ward, channel, group_id, credit_limit, payment_terms, status, gps_lat, gps_lng, created_at, created_by, billing_name, tax_code, billing_address, billing_email, payment_method_label, group:customer_groups(*)"
      // eslint-disable-next-line no-restricted-syntax
      const chonDuPhong = "*, group:customer_groups(*)"
      /* Tải HAI NHỊP (chủ nhà 26/09/2026): 20 khách đầu vẽ ngay, phần còn lại về sau. Thẻ lọc
         nhanh (lát mã, `idSlice`) hỏi một lượt như cũ. "Tải thêm" cùng truy vấn thì không vẽ lại. */
      const taiThem = laTaiThem(khoaTaiRef, khoa, pg.to)
      const res = idSlice
        ? await selectResilient<Customer>((sel) => build(sel), chon, chonDuPhong)
        : await taiHaiNhip<Customer, ResilientResult<Customer>>(
            (from, to, dem) => selectResilient<Customer>((sel) => build(sel, from, to, dem), chon, chonDuPhong),
            pg.from,
            pg.to,
            (dau) => {
              if (cancelled) return
              setCustomers(dau.data)
              setLoadError(null)
              pg.setTotal(dau.count ?? 0)
              setLoading(false)
            },
            { boQuaDau: taiThem }
          )
      // Huỷ request khi điều hướng nhanh — không phải lỗi, và không
      // được ghi mảng rỗng đè lên danh sách đang hiện.
      if (cancelled || res.aborted) return
      /* Thẻ lọc nhanh: giữ thứ tự của danh sách mã (thứ tự ghé / nợ giảm dần), không theo tên. */
      const list = idSlice ? xepTheoMa(res.data, idSlice) : res.data
      setCustomers(list)
      setLoadError(res.error)
      // Danh sách đã đủ để xem; đơn / lần ghé gần nhất về sau (ô hiện "…" chứ không "Chưa có").
      setLoading(false)
      // Với thẻ lọc nhanh, tổng là độ dài danh sách mã — `count` trả về
      // chỉ đếm trong lát cắt vừa gửi đi.
      pg.setTotal(quickLoc ? quickLoc.length : res.count ?? 0)

      // Load aggregates CHỈ cho khách trên page hiện tại.
      const ids = list.map((c) => c.id)
      if (ids.length === 0) {
        setManagersMap({})
        setLoading(false)
        return
      }
      /* Chủ nhà 27/09/2026: bỏ hai cột "Đơn gần nhất" / "Lần ghé gần nhất" — phần đọc chậm nhất
         của màn (1.000 dòng đơn + 1.000 dòng ghé thăm, rồi hỏi bù từng khách). */
      // KHÔNG lọc role='primary' nữa: cột "Phụ trách" phải hiện đủ
      // những người cùng vào một điểm bán. Bộ lọc theo NV (máy chủ, `nvLoc`) vẫn chỉ lấy người CHÍNH.
      const assignsRes = await supabase
        .from("customer_assignments")
        .select("customer_id, user_id, role, status, user:users(id, full_name, is_active)")
        .in("customer_id", ids)
        .eq("status", "active")
      if (assignsRes.error) console.error("[app/customers] truy vấn lỗi:", assignsRes.error.message)
      if (cancelled) return
      type AssignRow = {
        customer_id: string
        user_id: string
        role: string | null
        status: string | null
        user?: { id: string; full_name: string; is_active: boolean | null } | null
      }
      const assignRows = (assignsRes.data as unknown as AssignRow[]) || []

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
  }, [pg.from, pg.to, debouncedSearch, locNC.key, statusFilter, channelFilter, nvLoc, quickIds, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Mọi bộ lọc (kể cả nhân viên — `nvLoc`) chạy trên máy chủ.
  const filtered = customers

  /** Đang xem tuyến hôm nay và không gõ tìm → xếp theo điểm dừng. */
  const routeMode = quick === "today" && !debouncedSearch

  const ordered = useMemo(() => {
    if (routeMode) {
      return filtered
        .slice()
        .sort((a, b) => (todayStops.get(a.id) ?? 0) - (todayStops.get(b.id) ?? 0))
    }
    // Lát mã đã sắp theo nợ / nợ quá hạn, nhưng máy chủ trả theo tên — xếp lại theo lát mã.
    if (quickIds && quick !== "today") {
      const thu = new Map(quickIds.map((id, i) => [id, i]))
      return filtered.slice().sort((a, b) => (thu.get(a.id) ?? 0) - (thu.get(b.id) ?? 0))
    }
    return filtered
  }, [filtered, routeMode, todayStops, quickIds, quick])

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

  /** Tên tuyến theo mã kênh của khách ("Tuyến T7"). */
  const tenTuyen = (code: string | null | undefined): string | null => {
    if (!code) return null
    const r = routes.find((x) => x.code === code)
    const ten = (r?.name || code).trim()
    return /^tuyến/i.test(ten) ? ten : `Tuyến ${ten}`
  }

  /** Dựng một thẻ khách cho màn điện thoại. */
  const khachMobile = (c: Customer): KhachMobile => {
    const overdue = overdueIds.includes(c.id)
    const stop = todayStops.get(c.id)
    const visited = visitedToday.has(c.id)
    const tags: NhanKhach[] = []
    if (overdue) tags.push({ label: "Nợ quá hạn", tone: "danger" })
    /**
     * ⚠ NGOÀI CHẾ ĐỘ ĐI TUYẾN VẪN PHẢI THẤY "ĐÃ GHÉ HÔM NAY". Trong chế độ đi tuyến dấu ✓ ở
     *   ô tròn đã nói điều đó; ở các thẻ lọc khác thì không — và nhân viên ghé lại một cửa
     *   hàng vừa ghé sáng nay.
     */
    if (!routeMode && visited) tags.push({ label: "Đã ghé hôm nay", tone: "success" })
    /**
     * ⚠ "AI PHỤ TRÁCH" PHẢI CÒN TRÊN ĐIỆN THOẠI (với quản lý). Bảng máy tính có cột riêng; thẻ
     *   điện thoại chỉ có một dòng phụ, nên nó chen vào đây. NVBH xem khách của chính mình
     *   nên bỏ đi cho gọn.
     */
    const meta = [c.owner_name, tenTuyen(c.channel), isSales ? null : managersSummary(managersMap[c.id] || [])]
      .filter(Boolean)
      .join(" · ")
    return {
      id: c.id,
      name: c.store_name,
      avatar: routeMode && visited ? "✓" : routeMode && stop !== undefined ? String(stop) : customerInitial(c.store_name),
      debt: debts ? debts[c.id] || 0 : null,
      overdue,
      meta,
      address: diaChiNgan(c),
      phone: (c.phone ?? "").trim(),
      tags,
      visited: routeMode && visited,
    }
  }

  /* Chủ nhà 01/10/2026: tìm SĐT không ra → tạo khách mới gán sẵn số vừa tìm. */
  const sdtTim = sdtTuTimKiem(debouncedSearch)
  const taoMoiHref = sdtTim ? `/customers/new?sdt=${sdtTim}` : "/customers/new"
  const coQuyenTao = !!user && hasPermission(user.role, "customers", "create")
  const emptyState = (
    <EmptyState
      icon={<Users className="h-8 w-8 text-muted-foreground" />}
      title={
        loadError
          ? "Không tải được dữ liệu"
          : quick === "today"
            ? "Hôm nay chưa có điểm nào trong tuyến"
            : quick === "overdue"
              ? "Không có khách nợ quá hạn"
              : noNhieuNhat
                ? "Không có khách nào còn nợ"
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
              : noNhieuNhat
                ? "Bấm “Nợ nhiều nhất” để về thứ tự tên."
                : totalCustomers === 0
                  ? user?.role === "sales"
                    ? "Bạn chưa được phân công khách hàng nào. Vào Thêm KH để tìm và nhận khách có sẵn về danh sách của mình, hoặc nhờ quản lý phân công."
                    : user?.role === "warehouse" || user?.role === "driver"
                      ? "Vai trò của bạn chỉ xem được khách hàng gắn với công việc được giao. Liên hệ quản lý hoặc kế toán nếu cần tra cứu khách hàng."
                      : "Bắt đầu bằng cách thêm khách hàng đầu tiên"
                  : "Thử điều chỉnh bộ lọc"
      }
    >
      {sdtTim && coQuyenTao && !loadError && (
        <Link
          href={taoMoiHref}
          data-testid="tao-khach-voi-sdt"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Tạo khách mới với số {dinhDangSdt(sdtTim)}
        </Link>
      )}
    </EmptyState>
  )

  /* ⚠ CÔNG NỢ ĐỌC THIẾU / LỖI TẢI THÌ NÓI TRƯỚC KHI NGƯỜI TA ĐỌC CON SỐ — cả hai màn. */
  const canhBao = (
    <>
      {debtWarning && (
        <div className="rounded-xl border border-warning/40 bg-[#fff4ed] px-4 py-3 text-sm text-[#b54708]">
          <p className="font-semibold">Công nợ trong danh sách chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{debtWarning}</p>
        </div>
      )}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách khách hàng</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}
    </>
  )

  const chuVietTat = (() => {
    const w = (authUser?.full_name ?? "").trim().split(/\s+/).filter(Boolean)
    if (w.length === 0) return "U"
    return ((w[0][0] ?? "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase()
  })()

  return (
    <div className="space-y-4">
      {/* Máy tính: đầu trang, ô tìm, thẻ lọc, bảng. Điện thoại: `MobileCustomersScreen` ở cuối. */}
      <div className="hidden lg:block">
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
            <Button size="sm" onClick={() => router.push(taoMoiHref)}>
              <Plus className="mr-2 h-4 w-4" /> Thêm KH
            </Button>
          </>
        )}
      </PageHeader>
      </div>

      {isSales && (
        <div className="hidden lg:flex rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          <span>Bạn chỉ thấy KH được phân công cho bạn. Liên hệ Quản lý nếu cần phân công thêm.</span>
        </div>
      )}

      {/* Thẻ lọc nhanh — dải trạng thái chung (`StatusChips`) như đơn / hóa đơn, luôn có số
          đếm để biết có đáng bấm. Máy tính; điện thoại có dải riêng trong `MobileCustomersScreen`. */}
      <StatusChips
        className="hidden lg:flex"
        active={quick}
        onPick={(k) => setQuick(k as QuickFilter)}
        chips={QUICK_FILTERS.map((k) => ({
          key: k,
          label: QUICK_FILTER_LABEL[k],
          count: quickCount(k),
          accent: k === "overdue" ? "#ef5350" : k === "today" ? "#2563eb" : "#98a2b3",
        }))}
      />

      {/* Thanh tuyến hôm nay — chỉ hiện khi đang xem tuyến. */}
      {routeMode && (
        <div className="hidden lg:flex items-center gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-3 shadow-card">
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

      <div className="hidden lg:block">{canhBao}</div>

      {/* ⚠ KHUÔN DANH SÁCH CHUNG — phần MÁY TÍNH (chủ nhà 27/09/2026): một thẻ gồm thanh công
          cụ · lưới · phân trang, như đơn / hóa đơn. Điện thoại giữ `MobileCustomersScreen`
          theo mẫu chủ nhà gửi 26/09/2026 (`cards={null}`). */}
      <DocListLayout
        toolbar={
          <>
            {/* Ô tìm — cùng một `search` với ô trong đầu trang xanh của điện thoại. */}
            <div className="relative min-w-[260px] max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tên cửa hàng, chủ quán, SĐT, địa chỉ…"
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
            {filterActive("status") && (
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger aria-label="Trạng thái" className="h-10 w-40 rounded-xl font-semibold"><SelectValue placeholder="Trạng thái" /></SelectTrigger>
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
                <SelectTrigger aria-label="Tuyến" className="h-10 w-44 rounded-xl font-semibold"><SelectValue placeholder="Tuyến" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả tuyến</SelectItem>
                  <SelectItem value={CHUA_CO_TUYEN}>Chưa có tuyến</SelectItem>
                  {routes.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.code} — {r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {filterActive("sales") && !isSales && (
              <Select value={salesUserFilter} onValueChange={setSalesUserFilter}>
                <SelectTrigger aria-label="Nhân viên" className="h-10 w-48 rounded-xl font-semibold"><SelectValue placeholder="Nhân viên" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả nhân viên</SelectItem>
                  <SelectItem value={CHUA_PHAN_CONG}>Chưa phân công</SelectItem>
                  {salesUsers.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasDeskFilter && (
              <Button variant="ghost" size="sm" className="font-extrabold text-primary" onClick={clearFilters}>Bỏ lọc</Button>
            )}
          </>
        }
        toolbarEnd={
          <>
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
          </>
        }
        /* Danh mục khách, không phải chứng từ — nợ từng khách nằm ở cột Công nợ. */
        totals={null}
        loading={loading}
        isEmpty={ordered.length === 0}
        empty={emptyState}
        pg={pg}
        shownCount={ordered.length}
        table={
          <CustomerTable
            customers={ordered}
            debts={debts || {}}
            debtsUnknown={debts === null}
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
        }
        cards={null}
      />

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="khách hàng"
      />

      {/* Điện thoại — theo mẫu chủ nhà gửi 26/09/2026. Đặt CUỐI để các phép tìm `.first()` của
          màn máy tính không vớ phải phần tử đang ẩn. */}
      <MobileCustomersScreen
        title={isSales ? "Khách hàng của tôi" : "Khách hàng"}
        subtitle={[
          isSales ? "KH được phân công" : `${totalCustomers} khách hàng`,
          thuHomNay ? `Tuyến ${thuHomNay} hôm nay` : null,
        ].filter(Boolean).join(" · ")}
        userInitials={chuVietTat}
        search={search}
        onSearch={setSearch}
        stats={[
          { key: "today", label: "Cần ghé", count: quickCount("today"), tone: "primary" },
          { key: "overdue", label: QUICK_FILTER_LABEL.overdue, count: quickCount("overdue"), tone: "danger" },
          { key: "all", label: QUICK_FILTER_LABEL.all, count: quickCount("all"), tone: "default" },
        ]}
        quick={quick}
        onPickQuick={setQuick}
        statusFilter={statusFilter}
        onStatus={setStatusFilter}
        channelFilter={channelFilter}
        onChannel={setChannelFilter}
        routes={routes}
        route={{ visited: visitedOnRoute, total: routeTotal }}
        canCreate={!!user && hasPermission(user.role, "customers", "create")}
        taoMoiHref={taoMoiHref}
        listLabel={
          debouncedSearch ? "Kết quả" : quick === "all" ? (noNhieuNhat ? "Còn nợ" : "Tất cả") : QUICK_FILTER_LABEL[quick]
        }
        count={pg.total}
        sort={quick === "all" && !debouncedSearch && debts !== null ? sapXep : null}
        onToggleSort={() => setSapXep((v) => (v === "debt" ? "name" : "debt"))}
        items={ordered.map(khachMobile)}
        loading={loading}
        empty={emptyState}
        loaded={pg.from + ordered.length}
        onLoadMore={() => pg.setPageSize(pg.pageSize + BUOC_TAI_KHACH)}
        notice={canhBao}
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
