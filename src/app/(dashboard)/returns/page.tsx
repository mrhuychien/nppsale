"use client"

import { useLuuTrangThai } from "@/hooks/use-luu-trang-thai"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_TRA_HANG } from "@/lib/search/list-filter-fields"
import { useEffect, useRef, useState } from "react"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { PageHeader } from "@/components/ui/page-header"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import {
  RETURN_COLUMNS,
  DEFAULT_RETURN_COLUMNS,
  RETURN_FILTERS,
  DEFAULT_RETURN_FILTERS,
  type ReturnColumnKey,
  type ReturnFilterKey,
} from "./list-config"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatCurrency, formatDate } from "@/lib/utils"
import { MATCH_CAP } from "@/lib/search/list-search"
import { useListSearch } from "@/hooks/use-list-search"
import { docMaPhieuTra, tenPhieuTra } from "@/lib/returns/ma-phieu"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import { DocSearchBox } from "@/components/ui/doc-search-box"
import { useFieldSearch } from "@/hooks/use-field-search"
import { TRUONG_TRA_HANG } from "@/lib/search/doc-fields"
import { RETURN_REASONS } from "@/lib/constants"
import { RotateCcw, PieChart, Info, Plus, Check } from "lucide-react"
import { bamTrangThai, dangChon, trangThaiCuaChon } from "@/lib/list/status-multi"
import Link from "@/components/ui/link"
import type { Return } from "@/types"
import { ReturnDrawer } from "@/components/returns/return-drawer"
import { MobileReturnsScreen, BUOC_TAI_TRA } from "@/components/returns/mobile-returns-screen"
import { cacNgayDangHien, docThongKeNgay, type ThongKeNgay } from "@/lib/list/thong-ke-ngay"
import { MobileReturnSheet } from "@/components/returns/mobile-return-sheet"
import { TAB_TRA_MOBILE, ngayNhomTra, viTatTen } from "@/lib/returns/mobile-list"
import { useKhoMay } from "@/hooks/use-is-desktop"
import { hasPermission } from "@/lib/permissions"
import { useToast } from "@/hooks/use-toast"
import { docDemNhom, tongDem, type DemNhom } from "@/lib/list/dem-nhom"
import { XuatExcelButton, type KetQuaXuat } from "@/components/ui/xuat-excel-button"
import { napDong } from "@/lib/xuat-excel/nap"
import {
  CHON_PHIEU_TRA_KHACH, DONG_TRA_KHACH, xuatTraHangKhach, type DongTraKhach, type PhieuTraKhach,
} from "@/lib/xuat-excel/cac-man"

/** Nhân viên được tính khoản trừ của phiếu (`sales_user_id`). */
const tenNV = (r: Return) => (r as Return & { seller?: { full_name?: string | null } | null }).seller?.full_name ?? null

const REASON_COLORS: Record<string, string> = {
  damaged: "bg-error",
  wrong_item: "bg-[#fdb022]",
  near_expiry: "bg-[#f97316]",
  expired: "bg-[#dc2626]",
  refused: "bg-on-surface-variant",
}

/**
 * Tab của màn phiếu trả. "Chờ xử lý" đứng ĐẦU vì đó là việc phải làm;
 * "Tất cả" đứng CUỐI vì đó là chỗ tra cứu.
 */
const RETURN_TABS = [
  { value: "submitted", label: "Chờ xử lý" },
  { value: "draft", label: "Nháp" },
  { value: "completed", label: "Đã nhập kho" },
  { value: "cancelled", label: "Đã huỷ" },
  { value: "all", label: "Tất cả" },
] as const

const MAC_DINH_TRANG_THAI = "submitted,draft"

/**
 * ⚠ NGÀY HIỆN LÀ NGÀY CHỨNG TỪ (`return_date`, mig 188), không phải lúc bấm lập (chủ nhà
 *   25/09/2026: "Cập nhật ngày trong phiếu trả nhưng ngoài list hiển thị vẫn ngày cũ ?").
 */
const ngayPhieu = (r: Return) => (r as Return & { return_date?: string | null }).return_date || r.created_at

export default function ReturnsPage() {
  const { loading: authLoading } = useRoleGuard("returns")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  /* Khổ màn: `false` = điện thoại (màn theo mẫu 27/09/2026), `null` = chưa biết — số riêng của
     mỗi khổ chỉ đọc khi đã biết khổ. */
  const laMay = useKhoMay()
  const laDienThoai = laMay === false
  const { toast } = useToast()
  /** Phiếu đang mở ở ngăn điện thoại. */
  const [nganMo, setNganMo] = useState<string | null>(null)
  /** Tăng sau khi hoàn thành / huỷ ở ngăn → đọc lại danh sách, số trên tab, thẻ Chờ xử lý. */
  const [taiLai, setTaiLai] = useState(0)
  const [returns, setReturns] = useState<Return[]>([])
  /** Phiếu đang mở ở ngăn xem nhanh — `null` là đóng (chủ nhà 25/09/2026). */
  const [xemNhanh, setXemNhanh] = useState<string | null>(null)
  /** Số phiếu TH- (mig 193), đọc riêng — sổ chưa có cột thì chỉ mất số. */
  const [maPhieu, setMaPhieu] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  /** Khoá truy vấn lần tải trước (trừ `pg.to`) — trùng nghĩa là "Tải thêm", không vẽ lại nhịp đầu. */
  const khoaTaiRef = useRef<KhoaTai>(null)
  const [reasonFilter, setReasonFilter] = useState("all")
  /** NV được tính khoản trừ: "all" · "none" (chưa gán) · id người dùng. */
  const [sellerFilter, setSellerFilter] = useState("all")
  const [nhanVien, setNhanVien] = useState<Array<{ id: string; full_name: string | null }>>([])
  /**
   * ⚠ MỞ RA Ở "CHỜ XỬ LÝ", không phải "Tất cả". Màn này là HÀNG ĐỢI VIỆC
   * chứ không phải sổ tra cứu: thứ duy nhất cần hành động là phiếu chưa
   * hoàn thành. Trộn cả phiếu đã xong vào danh sách mặc định là việc cần
   * làm chìm trong hàng trăm dòng đã xong.
   */
  /* ⚠ "Chờ xử lý" nay chỉ có ở phiếu TỰ SINH (chủ nhà 25/09/2026, mig 191); phiếu tự
     lập chờ bấm Hoàn thành nằm ở Nháp — hàng đợi việc phải gồm cả hai. */
  /* ⚠ Nhớ qua lần tải lại (chủ nhà 25/09/2026) — `useLuuTrangThai`. */
  const [statusFilter, setStatusFilter] = useLuuTrangThai("returns", MAC_DINH_TRANG_THAI)
  /* Điện thoại chọn MỘT tab (mẫu mở ở "Chờ xử lý"); lựa chọn nhiều chip của máy tính → coi là Chờ
     xử lý. Tính NGAY ở đây (không qua effect) — không thì lượt đọc đầu theo bộ cũ rồi đọc lại. */
  const ttHieuLuc = laDienThoai && !TAB_TRA_MOBILE.some((t) => t.key === statusFilter) ? "submitted" : statusFilter
  const [search, setSearch] = useState("")
  const [totalCount, setTotalCount] = useState(0)
  const [reasonCounts, setReasonCounts] = useState<Record<string, number>>({})
  const pg = usePagination()
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const supabase = createClient()

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "returns",
    DEFAULT_RETURN_COLUMNS,
    DEFAULT_RETURN_FILTERS,
    RETURN_COLUMNS,
    RETURN_FILTERS
  )
  const show = (k: ReturnColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: ReturnFilterKey) => activeFilters.includes(k)

  // Stats: count theo reason (mount 1 lần, toàn tổng).
  useEffect(() => {
    /* Màn máy tính mới có ô "Phân loại lý do" và số tổng ở đầu trang. */
    if (laMay !== true) return
    async function loadStats() {
      const { count: totalC, error: totalErr } = await supabase
        .from("returns")
        .select("id", { count: "exact", head: true })
      if (totalErr) console.error("[returns] đếm tổng lỗi:", totalErr.message)
      setTotalCount(totalC ?? 0)
      const counts: Record<string, number> = {}
      await Promise.all(
        RETURN_REASONS.map(async (r) => {
          const { count, error: countErr } = await supabase
            .from("returns")
            .select("id", { count: "exact", head: true })
            .eq("reason", r.value)
          if (countErr) console.error("[app/returns] đếm theo lý do lỗi:", countErr.message)
          counts[r.value] = count ?? 0
        })
      )
      setReasonCounts(counts)
    }
    loadStats()
  }, [laMay, taiLai]) // eslint-disable-line react-hooks/exhaustive-deps

  const maxReasonCount = Math.max(1, ...Object.values(reasonCounts))

  /* ⚠ TÌM THEO TỪNG TRƯỜNG (mẫu 23/09/2026) — mã đơn / hóa đơn gốc, hàng,
     khách; ghép "VÀ". Xem `useFieldSearch`. */
  const [truongTim, setTruongTim] = useState<Record<string, string>>({})
  const fieldSearch = useFieldSearch(supabase, authUser?.org_id, TRUONG_TRA_HANG, truongTim)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026), ghép VÀ như tìm theo trường. */
  const locNC = useAdvancedFilter("returns", LOC_TRA_HANG)

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, reasonFilter, sellerFilter, ttHieuLuc, activeFilters, fieldSearch.key, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ TÌM CHÉO BA BẢNG. Phiếu trả tra theo tên điểm bán, tên người đề
   *   nghị và mã đơn gốc — cả ba đều là bảng nhúng, mà PostgREST không
   *   cho `or` bắc qua bảng nhúng.
   */
  const listSearch = useListSearch(
    /* Tìm theo số phiếu TH- (mig 193) như tìm HD- / DH-. */
    supabase, debouncedSearch, authUser?.org_id, ["return_code"],
    [
      { column: "customer_id", table: "customers", columns: ["store_name", "owner_name", "phone"] },
      { column: "requested_by", table: "users", columns: ["full_name"] },
      { column: "order_id", table: "sales_orders", columns: ["order_code"] },
    ],
    "returns",
    // số chỉ tìm số phiếu trả (chủ nhà 01/10/2026)
    true
  )

  /* Chờ cả hai lượt tra — ô tìm nhanh và các trường. */
  const searchReady = listSearch.ready && fieldSearch.ready && locNC.ready

  /**
   * MỘT bộ lọc cho cả danh sách lẫn phép cộng tổng — hai đường lọc riêng là
   * hai con số cạnh nhau không khớp nhau.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apDungLoc = <Q extends { or: (f: string) => any; eq: (c: string, v: string) => any; in: (c: string, v: string[]) => any; is: (c: string, v: null) => any }>(q: Q, boTrangThai = false): Q => {
    let x = q
    if (listSearch.filter) x = x.or(listSearch.filter)
    for (const f of fieldSearch.filters) x = x.or(f)
    for (const f of locNC.menhDe) x = x.or(f)
    /* Điện thoại luôn có ô lý do (mẫu 27/09/2026) — không theo bộ chọn ô lọc của máy tính. */
    if ((filterActive("reason") || laDienThoai) && reasonFilter !== "all") x = x.eq("reason", reasonFilter)
    /* ⚠ CHỌN NHIỀU TRẠNG THÁI (chủ nhà 25/09/2026) — xem `status-multi.ts`. */
    const ttChon = boTrangThai ? null : trangThaiCuaChon(ttHieuLuc)
    if (ttChon) x = ttChon.length === 1 ? x.eq("status", ttChon[0]) : x.in("status", ttChon)
    if (filterActive("seller") && sellerFilter === "none") x = x.is("sales_user_id", null)
    else if (filterActive("seller") && sellerFilter !== "all") x = x.eq("sales_user_id", sellerFilter)
    return x
  }

  /* Danh sách NV để lọc — cùng tập người `assign_doc_seller` nhận (mig 178). */
  useEffect(() => {
    if (laMay !== true || authUser?.role === "sales") return
    let huy = false
    supabase.from("users").select("id, full_name").in("role", ["sales", "manager", "owner"]).order("full_name")
      .then(({ data, error }) => {
        if (huy) return
        if (error) console.error("[returns] không đọc được danh sách NV:", error.message)
        setNhanVien((data as Array<{ id: string; full_name: string | null }>) ?? [])
      })
    return () => { huy = true }
  }, [laMay, authUser?.role]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      /* Tải HAI NHỊP (chủ nhà 26/09/2026): 20 phiếu đầu vẽ ngay, phần còn lại về sau. Tải thêm
         cùng truy vấn: giữ danh sách đang hiện. */
      const khoa = JSON.stringify([debouncedSearch, listSearch, reasonFilter, sellerFilter, ttHieuLuc, activeFilters, fieldSearch.key, locNC.key, pg.from, laMay, taiLai])
      if (!laTaiThem(khoaTaiRef, khoa, pg.to, false)) setLoading(true)
      /* ⚠ CHỜ LƯỢT TRA MÃ — xem `useListSearch`. Chờ cả biết khổ màn (lọc lý do khác nhau). */
      if (!searchReady) return
      if (laMay === null) return
      const taoQ = (from: number, to: number, dem: boolean) => {
        const q = supabase
          .from("returns")
          .select(
            "id, created_at, return_date, reason, status, credit_note_amount, credit_with_invoice, invoice_id, order_id, destination_zone, customer:customers(store_name), requester:users!returns_requested_by_fkey(full_name), seller:users!returns_sales_user_id_fkey(full_name), order:sales_orders(order_code), invoice:sales_invoices(invoice_code)",
            dem ? { count: "exact" } : undefined
          )
          /* ⚠ NGÀY CHỨNG TỪ (mig 188) — sửa ngày phiếu thì danh sách xếp theo ngày mới. */
          .order("return_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(from, to)
        /**
         * ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM (chủ nhà báo 21/09/2026).
         *   Bản cũ đọc một trang rồi `raw.filter(...)` ở trình duyệt —
         *   gõ tên khách của một phiếu ở trang 3 là ra rỗng, và
         *   `pg.setTotal(count)` vẫn ghi tổng của phép đếm CHƯA lọc, nên
         *   phân trang hứa 8 trang trong khi chỉ có vài dòng hiện ra.
         */
        return apDungLoc(q) as unknown as PromiseLike<{ data: Return[] | null; count: number | null; error: { message: string } | null }>
      }
      const truoc = khoaTaiRef.current
      const taiThem = laTaiThem(khoaTaiRef, khoa, pg.to)
      /* ⚠ "TẢI THÊM" CHỈ ĐỌC PHẦN MỚI (tối ưu lượt gọi 27/09/2026) — không đọc lại các phiếu đang hiện. */
      if (taiThem && truoc) {
        const { data: moi, error: loiMoi } = await taoQ(truoc.to + 1, pg.to, false)
        if (cancelled) return
        if (loiMoi) console.error("[returns] tải thêm lỗi:", loiMoi.message)
        const them = (moi as unknown as Return[]) || []
        setReturns((cu) => {
          const co = new Set(cu.map((r) => r.id))
          return [...cu, ...them.filter((r) => !co.has(r.id))]
        })
        docMaPhieuTra(supabase, them.map((r) => r.id)).then((m) => {
          if (!cancelled) setMaPhieu((cu) => new Map([...Array.from(cu), ...Array.from(m)]))
        })
        setLoading(false)
        return
      }
      const { data, count , error: qErr } = await taiHaiNhip(taoQ, pg.from, pg.to, (dau) => {
        if (cancelled) return
        setReturns(dau.data ?? [])
        pg.setTotal(dau.count ?? 0)
        setLoading(false)
      }, { boQuaDau: taiThem })
      if (qErr) console.error("[returns] truy vấn lỗi:", qErr.message)
      if (cancelled) return
      /* ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT — máy chủ đã lọc. Lọc hai lần
         theo hai luật khác nhau là dòng máy chủ vừa trả về lại bị trình
         duyệt giấu đi, và số trên phân trang không khớp số dòng thấy. */
      const ds = (data as unknown as Return[]) || []
      setReturns(ds)
      pg.setTotal(count ?? 0)
      docMaPhieuTra(supabase, ds.map((r) => r.id)).then((m) => { if (!cancelled) setMaPhieu(m) })
      setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, listSearch, reasonFilter, sellerFilter, ttHieuLuc, activeFilters, fieldSearch.key, locNC.key, laMay, taiLai]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ TỔNG KHOẢN CÓ CỦA CẢ BỘ LỌC, KHÔNG PHẢI CỦA TRANG ĐANG XEM (23/09/2026).
   *   Bản cũ cộng 50 dòng đang hiện rồi gọi là "Tổng credit" — một con số
   *   nhỏ hơn sự thật mà không có gì báo. Nay cộng bằng truy vấn riêng,
   *   cùng bộ lọc với danh sách; chạm trần hoặc lỗi thì `null` → "—".
   */
  const [tongKhoanCo, setTongKhoanCo] = useState<number | null>(null)
  /**
   * Đầu nhóm ngày trên điện thoại ("N phiếu · tổng") — đếm TRÊN MÁY CHỦ cho đúng những ngày đang hiện, cùng bộ lọc
   * với danh sách (`docThongKeNgay`, rà soát 03/10/2026). Phiếu cũ chưa có `return_date` nhóm theo ngày tạo — lọc
   * `.in("return_date")` không bắt được nó, nên khi danh sách còn phiếu như thế thì để đầu nhóm cộng các phiếu đã tải.
   */
  const [dayStatsRaw, setDayStats] = useState<{ khoa: string; data: ThongKeNgay | null } | null>(null)
  const ngayDangHien = returns.every((r) => !!(r as { return_date?: string | null }).return_date) ? cacNgayDangHien(returns as Array<{ return_date?: string | null; created_at: string }>, ngayNhomTra).join(",") : ""
  const khoaLocNgay = JSON.stringify([debouncedSearch, listSearch, reasonFilter, sellerFilter, ttHieuLuc, activeFilters, fieldSearch.key, locNC.key, taiLai])
  const dayStats = dayStatsRaw?.khoa === khoaLocNgay ? dayStatsRaw.data : null
  useEffect(() => {
    if (laMay !== false || !searchReady || !ngayDangHien) return
    let cancelled = false
    const days = ngayDangHien.split(",")
    ;(async () => {
      const kq = await docThongKeNgay<{ return_date: string; credit_note_amount: number | string | null }>(
        days,
        (from, to) =>
          apDungLoc(
            supabase
              .from("returns")
              .select("id, return_date, credit_note_amount", { count: "exact" })
              .in("return_date", days)
              .order("id")
              .range(from, to)
          ) as unknown as PromiseLike<{ data: unknown; error: { message: string } | null; count: number | null }>,
        (r) => r.return_date,
        (r) => Number(r.credit_note_amount) || 0
      )
      if (!cancelled) setDayStats({ khoa: khoaLocNgay, data: kq })
    })()
    return () => { cancelled = true }
  }, [laMay, ngayDangHien, searchReady, khoaLocNgay]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      /* Ô "Tổng tiền trả hàng" chỉ có ở máy tính. */
      if (!searchReady || laMay !== true) return
      setTongKhoanCo(null)
      const res = await fetchAllForAggregate<{ credit_note_amount: number | string | null }>((from, to) => {
        // audit-ok: lỗi đi vào nhánh `res.error` ngay dưới.
        const q = apDungLoc(
          supabase
            .from("returns")
            .select("credit_note_amount", { count: "exact" })
            .order("created_at", { ascending: false })
            .order("id")
            .range(from, to)
        )
        // Tab "Tất cả": phiếu đã huỷ không vào tổng khoản có.
        return ttHieuLuc === "all" ? q.neq("status", "cancelled") : q
      })
      if (cancelled) return
      if (res.error || res.truncated) {
        console.warn("[returns] không cộng được tổng khoản có:", res.error ?? "vượt trần")
        setTongKhoanCo(null)
        return
      }
      setTongKhoanCo(res.rows.reduce((a, r) => a + (Number(r.credit_note_amount) || 0), 0))
    })()
    return () => { cancelled = true }
  }, [debouncedSearch, listSearch, reasonFilter, sellerFilter, ttHieuLuc, activeFilters, fieldSearch.key, locNC.key, laMay, taiLai]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ĐIỆN THOẠI — SỐ TRÊN TỪNG TAB (mẫu 27/09/2026), cùng bộ lọc tìm / lý do nhưng BỎ trạng thái.
   * Một lượt `select=status,count()` (mig 206); máy chủ chưa gom nhóm được thì đếm từng trạng thái.
   */
  const [demTab, setDemTab] = useState<DemNhom | null>(null)
  useEffect(() => {
    if (!laDienThoai || !searchReady) return
    let huy = false
    ;(async () => {
      setDemTab(null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qDem = supabase.from("returns").select("status, count()" as string) as any
      const nhom = docDemNhom(await apDungLoc(qDem, true))
      let d = nhom
      if (!d) {
        const cu: DemNhom = {}
        await Promise.all(
          TAB_TRA_MOBILE.filter((t) => t.key !== "all").map(async (t) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const qHead = supabase.from("returns").select("id", { count: "exact", head: true }) as any
            const { count } = (await apDungLoc(qHead, true).eq("status", t.key)) as { count: number | null }
            cu[t.key] = count ?? 0
          })
        )
        d = cu
      }
      if (!huy) setDemTab(d)
    })()
    return () => { huy = true }
  }, [laDienThoai, searchReady, debouncedSearch, listSearch, reasonFilter, fieldSearch.key, locNC.key, taiLai]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ĐIỆN THOẠI — THẺ "CHỜ XỬ LÝ · N PHIẾU" + tổng tiền: mọi phiếu đang chờ (không theo tab / ô
   * tìm — đó là việc phải làm). Phiếu đầu tiên là chỗ "Xử lý ngay" mở ra.
   */
  const [choXuLy, setChoXuLy] = useState<{ count: number; total: number; dau: string | null } | null>(null)
  useEffect(() => {
    if (!laDienThoai) return
    let huy = false
    ;(async () => {
      const res = await fetchAllForAggregate<{ id: string; credit_note_amount: number | string | null }>((from, to) =>
        // audit-ok: lỗi đi vào nhánh `res.error` ngay dưới.
        supabase
          .from("returns")
          .select("id, credit_note_amount", { count: "exact" })
          .eq("status", "submitted")
          .order("return_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .range(from, to)
      )
      if (huy) return
      if (res.error) console.warn("[returns] không đọc được phiếu chờ xử lý:", res.error)
      setChoXuLy({
        count: res.rows.length,
        total: res.rows.reduce((a, r) => a + (Number(r.credit_note_amount) || 0), 0),
        dau: res.rows[0]?.id ?? null,
      })
    })()
    return () => { huy = true }
  }, [laDienThoai, taiLai]) // eslint-disable-line react-hooks/exhaustive-deps


  // Đã filter server-side (reason) + client-side trên page (search).
  const filtered = returns

  /**
   * XUẤT EXCEL (chủ nhà 05/10/2026) — MỌI phiếu khớp bộ lọc (tab, ô tìm, lý do, NV, lọc nâng cao: cùng `apDungLoc`
   * với danh sách), đọc đủ mọi trang, kèm từng dòng hàng (hàng đổi tách riêng, không tính tiền).
   */
  const xuatExcel = async (): Promise<KetQuaXuat> => {
    const res = await fetchAllForAggregate<PhieuTraKhach>((from, to) =>
      // audit-ok: lỗi đi vào `res.error` ngay dưới (ném → nút báo đỏ).
      apDungLoc(
        supabase
          .from("returns")
          .select(CHON_PHIEU_TRA_KHACH, { count: "exact" })
          .order("return_date", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to)
      ) as unknown as PromiseLike<{ data: unknown; error: { message: string } | null; count: number | null }>
    )
    if (res.error) throw new Error(`Không đọc được danh sách phiếu trả: ${res.error}`)
    const ids = res.rows.map((r) => r.id)
    const [dong, ma] = await Promise.all([
      napDong<DongTraKhach>(supabase, DONG_TRA_KHACH, ids),
      docMaPhieuTra(supabase, ids),
    ])
    return { sheets: xuatTraHangKhach(res.rows, dong, ma), soPhieu: res.rows.length, thieu: res.truncated }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const getReasonLabel = (reason: string | null) =>
    RETURN_REASONS.find((r) => r.value === reason)?.label || reason || "—"


  /* Thông báo tra mã chạm trần — chung cho cả hai khổ. */
  const canhBaoTran = (listSearch.truncated || fieldSearch.truncated) && !loading && (
    <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-[#7a4b00]">
      <p className="font-semibold">Kết quả tìm đang thiếu</p>
      <p className="mt-0.5">
        Có hơn {MATCH_CAP} mục khớp &ldquo;{debouncedSearch}&rdquo; — danh sách dưới chưa
        đủ. Gõ thêm cho hẹp lại.
      </p>
    </div>
  )
  const soPhieuTong = demTab ? tongDem(demTab) : null

  return (
    <div className="space-y-4">
      {/* ⚠ ĐIỆN THOẠI — theo mẫu chủ nhà 27/09/2026 (`MobileReturnsScreen`); máy tính giữ bảng. */}
      {laDienThoai && (
        <MobileReturnsScreen
          title={isSales ? "Trả hàng của tôi" : "Trả hàng"}
          subtitle={[soPhieuTong === null ? null : `${soPhieuTong} phiếu`, authUser?.full_name].filter(Boolean).join(" · ") || " "}
          userInitials={viTatTen(authUser?.full_name)}
          pending={choXuLy}
          onOpenFirstPending={() => choXuLy?.dau && setNganMo(choXuLy.dau)}
          tabs={TAB_TRA_MOBILE.map((t) => ({
            key: t.key,
            label: t.label,
            count: demTab ? (t.key === "all" ? tongDem(demTab) : demTab[t.key] ?? 0) : null,
          }))}
          isTabOn={(k) => ttHieuLuc === k}
          onPickTab={(k) => setStatusFilter(k)}
          search={search}
          onSearch={setSearch}
          reason={reasonFilter}
          onReason={setReasonFilter}
          rows={filtered}
          codes={maPhieu}
          loading={loading}
          count={pg.total}
          onLoadMore={() => pg.setPageSize(pg.pageSize + BUOC_TAI_TRA)}
          onOpen={setNganMo}
          notice={canhBaoTran}
          canCreate={!!authUser && hasPermission(authUser.role, "returns", "create")}
          dayStats={dayStats}
        />
      )}
      <MobileReturnSheet
        returnId={nganMo}
        row={nganMo ? (filtered.find((r) => r.id === nganMo) as never) ?? null : null}
        code={nganMo ? maPhieu.get(nganMo) ?? null : null}
        canApprove={!!authUser && hasPermission(authUser.role, "returns", "approve")}
        onClose={() => setNganMo(null)}
        onDone={(thongBao) => {
          setNganMo(null)
          toast({ title: thongBao })
          setTaiLai((n) => n + 1)
        }}
      />

      <div className="hidden space-y-4 lg:block">
      <PageHeader
        title={isSales ? "Trả hàng của tôi" : "Trả hàng"}
        description={`${totalCount} phiếu trả • Tra cứu thông tin`}
      >
        {/*
          ⚠ MÀN NÀY TRƯỚC ĐÂY CHỈ ĐỂ TRA CỨU — không có đường nào tạo phiếu
            trả độc lập, dù `/returns/new` đã dựng đủ. Phiếu trả độc lập là
            thứ VỪA trừ công nợ VỪA nhập kho (khách trả hàng ngoài chuyến
            giao); không có nút thì việc ấy không làm được trong phần mềm.
        */}
        {/* Mẫu NVBH chỉ XEM trả hàng (mig 208) — không có quyền tạo thì không hiện nút dẫn vào cửa bị chặn. */}
        {!!authUser && hasPermission(authUser.role, "returns", "create") && (
          <Button asChild>
            <Link href="/returns/new">
              <Plus className="mr-2 h-4 w-4" /> Tạo phiếu trả
            </Link>
          </Button>
        )}
      </PageHeader>

      {/*
        ⚠ TRA MÃ CHẠM TRẦN THÌ NÓI RA. Kết quả đang THIẾU và trông y hệt
          lúc đủ — đúng cái lỗi "chỉ tìm trang 1" vừa sửa, chỉ đổi chỗ.
      */}
      {canhBaoTran}

      {/*
        ⚠ CÂU CŨ Ở ĐÂY LÀ NGUYÊN NHÂN CỦA CẢ MỘT LỚP LỖI. Nó bảo người
        dùng "trang này chỉ để tra cứu, không cần thao tác duyệt" — đúng
        với luồng cũ, khi phiếu trả sinh ra từ bước Bàn giao lại và có
        trigger tự nhập kho. Trong v2 không có bước bàn giao nào và
        trigger đã bị gỡ: phiếu nằm ở Chờ xử lý cho tới khi CÓ NGƯỜI bấm
        Hoàn thành. Ai đọc câu cũ rồi bỏ đi là hàng trả nằm ngoài sổ.
      */}
      <Card className="border-[#fdb022]/40 bg-[#fff7e6]">
        <CardContent className="flex items-start gap-3 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#b54708]" />
          <div className="space-y-0.5 text-[#b54708]">
            <p className="font-semibold">Phiếu Chờ xử lý cần có người bấm Hoàn thành</p>
            <p className="text-xs opacity-90">
              Hàng chỉ vào kho và công nợ chỉ giảm khi phiếu được hoàn thành — mở từng phiếu, chọn
              kho nhận rồi bấm. Phiếu để quên ở Chờ xử lý là hàng trả nằm ngoài sổ.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          {/* ⚠ TAB TRẠNG THÁI, KHÔNG PHẢI BỘ LỌC NÂNG CAO — đây là điều
              hướng của một hàng đợi việc, nên nó đứng ngoài và luôn nhìn
              thấy. "Tất cả" đứng CUỐI: nó là chỗ tra cứu, không phải chỗ
              làm việc. */}
          <div
            role="group"
            aria-label="Lọc trạng thái — chọn được nhiều"
            className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0"
          >
            {RETURN_TABS.map((t) => {
              const on = dangChon(statusFilter, t.value)
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={on}
                  data-status-chip={t.value}
                  onClick={() => setStatusFilter(bamTrangThai(statusFilter, t.value, RETURN_TABS.map((x) => x.value)))}
                  className={`h-[34px] shrink-0 whitespace-nowrap rounded-full border-[1.5px] px-3 text-[13px] font-bold transition-colors ${
                    on
                      ? "border-on-surface bg-on-surface text-surface"
                      : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low"
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    {on && t.value !== "all" && <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />}
                    {t.label}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {filterActive("search") && (
              <DocSearchBox
                className="w-full sm:max-w-sm"
                value={search}
                onChange={setSearch}
                placeholder="Tìm khách / đơn / NV…"
                fields={TRUONG_TRA_HANG}
                applied={truongTim}
                onApply={setTruongTim}
              />
            )}
            {filterActive("reason") && (
              <Select value={reasonFilter} onValueChange={setReasonFilter}>
                <SelectTrigger className="h-9 sm:w-56">
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
            )}
            {filterActive("seller") && authUser?.role !== "sales" && (
              <Select value={sellerFilter} onValueChange={setSellerFilter}>
                <SelectTrigger className="h-9 sm:w-56" aria-label="Lọc theo NV">
                  <SelectValue placeholder="Lọc theo NV" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả NV</SelectItem>
                  <SelectItem value="none">Chưa gán NV</SelectItem>
                  {nhanVien.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(reasonFilter !== "all" || sellerFilter !== "all" || search.trim() !== "" || statusFilter !== MAC_DINH_TRANG_THAI) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setReasonFilter("all")
                  setSellerFilter("all")
                  setSearch("")
                  setStatusFilter(MAC_DINH_TRANG_THAI)
                }}
              >
                Xoá lọc
              </Button>
            )}
            <div className="sm:ml-auto flex items-center gap-2">
              <XuatExcelButton module="returns" tenTep="tra-hang" chuanBi={xuatExcel} disabled={loading || !searchReady || pg.total === 0} />
              <AdvancedFilter truong={LOC_TRA_HANG} value={locNC.dieuKien} onApply={locNC.apDung} />
              <FilterPicker
                available={RETURN_FILTERS}
                value={activeFilters}
                onChange={setFilters}
                onReset={resetFilters}
              />
              <ColumnPicker
                available={RETURN_COLUMNS}
                value={visibleColumns}
                onChange={setColumns}
                onReset={resetColumns}
              />
            </div>
          </div>
          <DocListTotals
            className="mb-3 rounded-xl border"
            label="Tổng tiền trả hàng"
            countText={`${pg.total} phiếu trả`}
            total={tongKhoanCo === null ? null : formatCurrency(tongKhoanCo)}
          />

          {loading ? (
            <Skeleton className="h-64" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<RotateCcw className="h-8 w-8 text-muted-foreground" />}
              title="Không có phiếu trả nào"
              description="Phiếu trả sẽ xuất hiện tự động khi xử lý bàn giao lại."
            />
          ) : (
            <>
              <div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Số phiếu</TableHead>
                      {show("date") && <TableHead>Ngày</TableHead>}
                      <TableHead>Khách hàng</TableHead>
                      {show("orderCode") && <TableHead>Đơn gốc</TableHead>}
                      {show("invoiceCode") && <TableHead>Hóa đơn gốc</TableHead>}
                      {show("reason") && <TableHead>Lý do</TableHead>}
                      {show("requester") && <TableHead>Người tạo</TableHead>}
                      {show("seller") && <TableHead>Tính cho NV</TableHead>}
                      {show("creditNote") && <TableHead className="text-right">Credit Note</TableHead>}
                      {show("status") && <TableHead>Trạng thái</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const orderCode = (r as Return & { order?: { order_code?: string } }).order?.order_code
                      const invoiceCode = (r as Return & { invoice?: { invoice_code?: string } })
                        .invoice?.invoice_code
                      return (
                        <TableRow
                          key={r.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => setXemNhanh(r.id)}
                        >
                          {/* ⚠ BẤM SỐ → CHI TIẾT, BẤM DÒNG → XEM NHANH (chủ nhà 25/09/2026, như
                              đơn / hóa đơn). */}
                          <TableCell>
                            <Link
                              href={`/returns/${r.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-mono text-xs font-bold text-primary hover:underline"
                            >
                              {tenPhieuTra(maPhieu.get(r.id))}
                            </Link>
                          </TableCell>
                          {show("date") && (
                            <TableCell className="text-sm whitespace-nowrap">
                              {formatDate(ngayPhieu(r))}
                            </TableCell>
                          )}
                          <TableCell className="font-medium">
                            {r.customer?.store_name || "—"}
                          </TableCell>
                          {show("orderCode") && (
                            <TableCell className="font-mono text-xs">
                              {orderCode || "—"}
                            </TableCell>
                          )}
                          {show("invoiceCode") && (
                            <TableCell className="font-mono text-xs">
                              {invoiceCode || "—"}
                            </TableCell>
                          )}
                          {show("reason") && <TableCell>{getReasonLabel(r.reason)}</TableCell>}
                          {show("requester") && (
                            <TableCell className="text-sm">
                              {r.requester?.full_name || "—"}
                            </TableCell>
                          )}
                          {show("seller") && (
                            <TableCell className="text-sm" data-testid="tinh-cho-nv">
                              {tenNV(r) || "—"}
                            </TableCell>
                          )}
                          {show("creditNote") && (
                            <TableCell className="text-right tabular-nums">
                              {r.credit_note_amount ? formatCurrency(r.credit_note_amount) : "—"}
                            </TableCell>
                          )}
                          {show("status") && (
                            <TableCell>
                              <StatusBadge status={r.status} type="return" />
                              {r.credit_with_invoice && (
                                <span className="ml-1.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="Phiếu tự sinh theo hóa đơn — sửa từ hóa đơn">
                                  Theo HĐ
                                </span>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              <DataPagination pg={pg} shownCount={filtered.length} />
            </>
          )}
        </div>

        {/* Reason breakdown */}
        <Card className="h-fit">
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
      <ReturnDrawer returnId={xemNhanh} onClose={() => setXemNhanh(null)} />
    </div>
  )
}
