"use client"

import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_TRA_HANG } from "@/lib/search/list-filter-fields"
import { useEffect, useState } from "react"
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
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { DocListTotals } from "@/components/ui/doc-list-totals"
import { DocSearchBox } from "@/components/ui/doc-search-box"
import { useFieldSearch } from "@/hooks/use-field-search"
import { TRUONG_TRA_HANG } from "@/lib/search/doc-fields"
import { RETURN_REASONS } from "@/lib/constants"
import { RotateCcw, PieChart, Info, Plus, Check } from "lucide-react"
import { bamTrangThai, dangChon, trangThaiCuaChon } from "@/lib/list/status-multi"
import Link from "next/link"
import type { Return } from "@/types"
import { ReturnDrawer } from "@/components/returns/return-drawer"

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

export default function ReturnsPage() {
  const { loading: authLoading } = useRoleGuard("returns")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const [returns, setReturns] = useState<Return[]>([])
  /** Phiếu đang mở ở ngăn xem nhanh — `null` là đóng (chủ nhà 25/09/2026). */
  const [xemNhanh, setXemNhanh] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [statusFilter, setStatusFilter] = useState<string>(MAC_DINH_TRANG_THAI)
  const [search, setSearch] = useState("")
  const [totalCount, setTotalCount] = useState(0)
  const [reasonCounts, setReasonCounts] = useState<Record<string, number>>({})
  const pg = usePagination(50)
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [debouncedSearch, reasonFilter, sellerFilter, statusFilter, activeFilters, fieldSearch.key, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ TÌM CHÉO BA BẢNG. Phiếu trả tra theo tên điểm bán, tên người đề
   *   nghị và mã đơn gốc — cả ba đều là bảng nhúng, mà PostgREST không
   *   cho `or` bắc qua bảng nhúng.
   */
  const listSearch = useListSearch(
    supabase, debouncedSearch, authUser?.org_id, [],
    [
      { column: "customer_id", table: "customers", columns: ["store_name", "owner_name", "phone"] },
      { column: "requested_by", table: "users", columns: ["full_name"] },
      { column: "order_id", table: "sales_orders", columns: ["order_code"] },
    ]
  )

  /* Chờ cả hai lượt tra — ô tìm nhanh và các trường. */
  const searchReady = listSearch.ready && fieldSearch.ready && locNC.ready

  /**
   * MỘT bộ lọc cho cả danh sách lẫn phép cộng tổng — hai đường lọc riêng là
   * hai con số cạnh nhau không khớp nhau.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apDungLoc = <Q extends { or: (f: string) => any; eq: (c: string, v: string) => any; in: (c: string, v: string[]) => any; is: (c: string, v: null) => any }>(q: Q): Q => {
    let x = q
    if (listSearch.filter) x = x.or(listSearch.filter)
    for (const f of fieldSearch.filters) x = x.or(f)
    for (const f of locNC.menhDe) x = x.or(f)
    if (filterActive("reason") && reasonFilter !== "all") x = x.eq("reason", reasonFilter)
    /* ⚠ CHỌN NHIỀU TRẠNG THÁI (chủ nhà 25/09/2026) — xem `status-multi.ts`. */
    const ttChon = trangThaiCuaChon(statusFilter)
    if (ttChon) x = ttChon.length === 1 ? x.eq("status", ttChon[0]) : x.in("status", ttChon)
    if (filterActive("seller") && sellerFilter === "none") x = x.is("sales_user_id", null)
    else if (filterActive("seller") && sellerFilter !== "all") x = x.eq("sales_user_id", sellerFilter)
    return x
  }

  /* Danh sách NV để lọc — cùng tập người `assign_doc_seller` nhận (mig 178). */
  useEffect(() => {
    let huy = false
    supabase.from("users").select("id, full_name").in("role", ["sales", "manager", "owner"]).order("full_name")
      .then(({ data, error }) => {
        if (huy) return
        if (error) console.error("[returns] không đọc được danh sách NV:", error.message)
        setNhanVien((data as Array<{ id: string; full_name: string | null }>) ?? [])
      })
    return () => { huy = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      /* ⚠ CHỜ LƯỢT TRA MÃ — xem `useListSearch`. */
      if (!searchReady) return
      let q = supabase
        .from("returns")
        .select(
          "id, created_at, reason, status, credit_note_amount, credit_with_invoice, customer:customers(store_name), requester:users!returns_requested_by_fkey(full_name), seller:users!returns_sales_user_id_fkey(full_name), order:sales_orders(order_code), invoice:sales_invoices(invoice_code)",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(pg.from, pg.to)
      /**
       * ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM (chủ nhà báo 21/09/2026).
       *   Bản cũ đọc một trang rồi `raw.filter(...)` ở trình duyệt —
       *   gõ tên khách của một phiếu ở trang 3 là ra rỗng, và
       *   `pg.setTotal(count)` vẫn ghi tổng của phép đếm CHƯA lọc, nên
       *   phân trang hứa 8 trang trong khi chỉ có vài dòng hiện ra.
       */
      q = apDungLoc(q)
      const { data, count , error: qErr } = await q
      if (qErr) console.error("[returns] truy vấn lỗi:", qErr.message)
      if (cancelled) return
      /* ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT — máy chủ đã lọc. Lọc hai lần
         theo hai luật khác nhau là dòng máy chủ vừa trả về lại bị trình
         duyệt giấu đi, và số trên phân trang không khớp số dòng thấy. */
      setReturns((data as unknown as Return[]) || [])
      pg.setTotal(count ?? 0)
      setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, listSearch, reasonFilter, sellerFilter, statusFilter, activeFilters, fieldSearch.key, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ TỔNG KHOẢN CÓ CỦA CẢ BỘ LỌC, KHÔNG PHẢI CỦA TRANG ĐANG XEM (23/09/2026).
   *   Bản cũ cộng 50 dòng đang hiện rồi gọi là "Tổng credit" — một con số
   *   nhỏ hơn sự thật mà không có gì báo. Nay cộng bằng truy vấn riêng,
   *   cùng bộ lọc với danh sách; chạm trần hoặc lỗi thì `null` → "—".
   */
  const [tongKhoanCo, setTongKhoanCo] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!searchReady) return
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
        return statusFilter === "all" ? q.neq("status", "cancelled") : q
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
  }, [debouncedSearch, listSearch, reasonFilter, sellerFilter, statusFilter, activeFilters, fieldSearch.key, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Đã filter server-side (reason) + client-side trên page (search).
  const filtered = returns

  if (authLoading) return <Skeleton className="h-96" />

  const getReasonLabel = (reason: string | null) =>
    RETURN_REASONS.find((r) => r.value === reason)?.label || reason || "—"


  return (
    <div className="space-y-4">
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
        <Button asChild>
          <Link href="/returns/new">
            <Plus className="mr-2 h-4 w-4" /> Tạo phiếu trả
          </Link>
        </Button>
      </PageHeader>

      {/*
        ⚠ TRA MÃ CHẠM TRẦN THÌ NÓI RA. Kết quả đang THIẾU và trông y hệt
          lúc đủ — đúng cái lỗi "chỉ tìm trang 1" vừa sửa, chỉ đổi chỗ.
      */}
      {(listSearch.truncated || fieldSearch.truncated) && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-[#7a4b00]">
          <p className="font-semibold">Kết quả tìm đang thiếu</p>
          <p className="mt-0.5">
            Có hơn {MATCH_CAP} mục khớp &ldquo;{debouncedSearch}&rdquo; — danh sách dưới chưa
            đủ. Gõ thêm cho hẹp lại.
          </p>
        </div>
      )}

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
              {/* Desktop table */}
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
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
                          {show("date") && (
                            <TableCell className="text-sm whitespace-nowrap">
                              {formatDate(r.created_at)}
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

              {/* Mobile card list */}
              <div className="lg:hidden space-y-3">
                {filtered.map((r) => {
                  const orderCode = (r as Return & { order?: { order_code?: string } }).order?.order_code
                  const invoiceCode = (r as Return & { invoice?: { invoice_code?: string } })
                    .invoice?.invoice_code
                  return (
                    <div
                      key={r.id}
                      className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                      onClick={() => setXemNhanh(r.id)}
                    >
                      <div className="p-4">
                        <div className="flex justify-between items-start gap-3 mb-2">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-extrabold text-base leading-tight truncate">
                              {r.customer?.store_name || "—"}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Lý do:{" "}
                              <span className="font-medium text-foreground">
                                {getReasonLabel(r.reason)}
                              </span>
                            </p>
                            {orderCode && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                Đơn gốc: <span className="font-mono">{orderCode}</span>
                              </p>
                            )}
                            {invoiceCode && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                Hóa đơn gốc: <span className="font-mono">{invoiceCode}</span>
                              </p>
                            )}
                            {r.requester?.full_name && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                Người tạo: {r.requester.full_name}
                              </p>
                            )}
                            {tenNV(r) && (
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                Tính cho NV: {tenNV(r)}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatDate(r.created_at)}
                            </p>
                          </div>
                          <div className="shrink-0">
                            <StatusBadge status={r.status} type="return" />
                            {r.credit_with_invoice && (
                                <span className="ml-1.5 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700" title="Phiếu tự sinh theo hóa đơn — sửa từ hóa đơn">
                                  Theo HĐ
                                </span>
                              )}
                          </div>
                        </div>
                        {r.credit_note_amount ? (
                          <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                            <span className="text-xs text-muted-foreground">Credit Note</span>
                            <span className="font-bold text-base">
                              {formatCurrency(r.credit_note_amount)}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
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
      <ReturnDrawer returnId={xemNhanh} onClose={() => setXemNhanh(null)} />
    </div>
  )
}
