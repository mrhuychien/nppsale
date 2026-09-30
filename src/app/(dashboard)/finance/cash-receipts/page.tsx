"use client"

/**
 * PHIẾU THU — danh sách.
 *
 * ⚠ CHỦ NHÀ 27/09/2026: "Làm danh sách Phiếu thu format giống Danh sách đơn hàng / Hóa đơn
 *   đi, giờ đang 1 mình 1 format." Nay đi đúng khuôn màn hóa đơn: dải trạng thái có số đếm,
 *   MỘT thẻ gồm thanh công cụ (ô tìm + tìm theo trường · kỳ · Lọc nhanh | lọc nâng cao ·
 *   chọn bộ lọc · chọn cột) → dòng "Tổng tiền · N phiếu" → lưới → phân trang 20/trang; điện
 *   thoại có dải tóm tắt + thẻ; bấm dòng mở XEM NHANH, bấm mã sang chi tiết.
 *
 * ⚠ LỌC Ở MÁY CHỦ, PHÂN TRANG Ở MÁY CHỦ. Bản cũ tải HẾT phiếu rồi vẽ một cột thẻ dài vô tận;
 *   nay mọi bộ lọc đi vào MỘT hàm `applyFilters` dùng chung cho danh sách, phép đếm và phép
 *   cộng tổng — ba con số trên cùng một màn không được lệch nhau.
 * ⚠ CHỈ ĐỌC. Tiền chỉ đổi qua RPC ở trang lập / chi tiết phiếu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Receipt } from "lucide-react"
import { useLuuTrangThai } from "@/hooks/use-luu-trang-thai"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus"
import { usePagination } from "@/hooks/use-pagination"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useFieldSearch } from "@/hooks/use-field-search"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { createClient } from "@/lib/supabase/client"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { hasPermission } from "@/lib/permissions"
import { formatCurrency, formatDate } from "@/lib/utils"
import { vnTime } from "@/lib/orders/status-tone"
import { periodFrom, nextPeriod, kyDangLoc, type ListPeriod } from "@/lib/orders/list-summary"
import { trangThaiCuaChon } from "@/lib/list/status-multi"
import { soTruongDangTim } from "@/lib/search/field-search"
import { LOC_PHIEU_THU } from "@/lib/search/list-filter-fields"
import {
  CASH_RECEIPT_SOURCE_LABEL, CASH_RECEIPT_STATUS, CASH_RECEIPT_STATUS_LABEL, CASH_RECEIPT_STATUS_VARIANT,
  COT_DONG_PHIEU_THU, TIM_NHANH_PHIEU_THU, TRUONG_PHIEU_THU,
  boPhieuHuyKhoiTong, cashReceiptBadge, cashReceiptTone, nhanNhieu, tomTatDongPhieuThu,
  type DongPhieuThuTom, type TomTatPhieuThu,
} from "@/lib/finance/cash-receipt-list"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusChips } from "@/components/ui/status-chips"
import { PeriodSelect } from "@/components/ui/period-select"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { DocSearchBox, DocFieldInputs } from "@/components/ui/doc-search-box"
import {
  DocListLayout, KetQuaThieu, LocNhanhButton, LocNhanhField, XoaLocButton,
} from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { CashReceiptDrawer } from "@/components/finance/cash-receipt-drawer"
import {
  CASH_RECEIPT_COLUMNS, CASH_RECEIPT_FILTERS,
  DEFAULT_CASH_RECEIPT_COLUMNS, DEFAULT_CASH_RECEIPT_FILTERS,
  type CashReceiptColumnKey, type CashReceiptFilterKey,
} from "./list-config"

interface ReceiptRow {
  id: string
  receipt_code: string
  receipt_date: string
  created_at: string | null
  status: string
  source_type: string | null
  expected_amount: number | null
  submitted_amount: number | null
  notes: string | null
  collector?: { full_name?: string | null } | null
  creator?: { full_name?: string | null } | null
  receiver?: { full_name?: string | null } | null
}

const COT =
  "id, receipt_code, receipt_date, created_at, status, source_type, expected_amount, submitted_amount, notes, " +
  "collector:users!cash_receipts_collected_by_fkey(full_name), creator:users!cash_receipts_created_by_fkey(full_name), " +
  "receiver:users!cash_receipts_received_by_fkey(full_name)"

type KQ = { data: ReceiptRow[] | null; count: number | null; error: { message: string } | null }

const TABS = [
  ...CASH_RECEIPT_STATUS.map((s) => ({ key: s, label: CASH_RECEIPT_STATUS_LABEL[s], accent: cashReceiptTone(s).accent })),
  { key: "all", label: "Tất cả", accent: "#181c1e" },
]

/** Lọc một hay NHIỀU trạng thái (chủ nhà 25/09/2026) — xem `status-multi.ts`. */
function locTrangThai<Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q }>(q: Q, v: string): Q {
  const ds = trangThaiCuaChon(v)
  if (!ds) return q
  return ds.length === 1 ? q.eq("status", ds[0]) : q.in("status", ds)
}

export default function CashReceiptsListPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const router = useRouter()
  const { user } = useAuth()
  /**
   * ⚠ ĐÚNG TÊN QUYỀN RPC KIỂM. `create_cash_receipt` hỏi `receivables.create` (migration
   * 120) — gài nút bằng một quyền khác là nút hiện ra rồi RPC ném FORBIDDEN sau khi người
   * dùng nhập xong cả phiếu.
   */
  const canCreate = !!user && hasPermission(user.role, "receivables", "create")
  const supabase = createClient()
  const pg = usePagination()
  const focusTick = useRefreshOnFocus()

  const {
    columns: visibleColumns, filters: activeFilters,
    setColumns, setFilters, resetColumns, resetFilters,
  } = useListViewPrefs(
    "cash-receipts",
    DEFAULT_CASH_RECEIPT_COLUMNS,
    DEFAULT_CASH_RECEIPT_FILTERS,
    CASH_RECEIPT_COLUMNS,
    CASH_RECEIPT_FILTERS
  )
  const filterActive = (k: CashReceiptFilterKey) => activeFilters.includes(k)

  const [rows, setRows] = useState<ReceiptRow[]>([])
  const [loading, setLoading] = useState(true)
  /** Khách / hóa đơn của từng phiếu đang hiện — `undefined` = chưa đọc được. */
  const [tomTat, setTomTat] = useState<Record<string, TomTatPhieuThu>>()
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  /* ⚠ Nhớ qua lần tải lại (chủ nhà 25/09/2026) — `useLuuTrangThai`. */
  const [status, setStatus] = useLuuTrangThai("cash-receipts", "all")
  /* Kỳ mặc định "Tháng này" (chủ nhà 23/09/2026) — cùng luật mọi danh sách có thời gian. */
  const [period, setPeriod] = useState<ListPeriod>("month")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [collectorFilter, setCollectorFilter] = useState("all")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const kyLoc = kyDangLoc(period, !!(dateFrom || dateTo))
  const [amountMin, setAmountMin] = useState("")
  const [amountMax, setAmountMax] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filterSheet, setFilterSheet] = useState(false)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [nguoiThu, setNguoiThu] = useState<Array<{ id: string; full_name: string | null }>>([])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    let huy = false
    supabase.from("users").select("id, full_name").order("full_name").then(({ data, error }) => {
      if (huy) return
      if (error) console.error("[finance/cash-receipts] không đọc được danh sách người thu:", error.message)
      setNguoiThu((data as Array<{ id: string; full_name: string | null }>) ?? [])
    })
    return () => { huy = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ Ô TÌM HỎI MÁY CHỦ, KHÔNG LỌC TRANG ĐANG XEM (chủ nhà 21/09/2026). Khách và hóa đơn không
   *   nằm trên đầu phiếu → tra theo chuỗi bảng (`TIM_NHANH_PHIEU_THU`).
   */
  const timNhanh = useMemo(() => ({ q: debouncedSearch }), [debouncedSearch])
  const quickSearch = useFieldSearch(supabase, user?.org_id, TIM_NHANH_PHIEU_THU, timNhanh)
  /* ⚠ TÌM THEO TỪNG TRƯỜNG (mẫu 23/09/2026) — ghép "VÀ". Trễ 350 ms cho tấm lọc điện thoại. */
  const [truongTim, setTruongTim] = useState<Record<string, string>>({})
  const [truongTimTre, setTruongTimTre] = useState<Record<string, string>>({})
  useEffect(() => {
    const t = setTimeout(() => setTruongTimTre(truongTim), 350)
    return () => clearTimeout(t)
  }, [truongTim])
  const fieldSearch = useFieldSearch(supabase, user?.org_id, TRUONG_PHIEU_THU, truongTimTre)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026), ghép VÀ như tìm theo trường. */
  const locNC = useAdvancedFilter("cash-receipts", LOC_PHIEU_THU)
  const searchReady = quickSearch.ready && fieldSearch.ready && locNC.ready
  const searchTruncated = quickSearch.truncated || fieldSearch.truncated

  /**
   * Bộ lọc DÙNG CHUNG cho danh sách, phép đếm và phép cộng tổng.
   * ⚠ MỘT HÀM, KHÔNG CHÉP HAI LẦN — xem cùng khối ở màn hóa đơn.
   */
  const applyFilters = useCallback(
    <T extends { eq: (c: string, v: unknown) => T; gte: (c: string, v: unknown) => T; lte: (c: string, v: unknown) => T; or: (f: string) => T }>(q: T): T => {
      let x = q
      for (const f of quickSearch.filters) x = x.or(f)
      // Mỗi trường là MỘT `.or` — PostgREST ghép các `or=` bằng "VÀ".
      for (const f of fieldSearch.filters) x = x.or(f)
      for (const f of locNC.menhDe) x = x.or(f)
      if (collectorFilter !== "all") x = x.eq("collected_by", collectorFilter)
      if (dateFrom) x = x.gte("receipt_date", dateFrom)
      if (dateTo) x = x.lte("receipt_date", dateTo)
      if (amountMin) x = x.gte("expected_amount", Number(amountMin))
      if (amountMax) x = x.lte("expected_amount", Number(amountMax))
      /* Kỳ đi chung một đường với bộ lọc ngày — `receipt_date` là DATE, `periodFrom` theo giờ VN. */
      const pFrom = periodFrom(kyLoc)
      if (pFrom) x = x.gte("receipt_date", pFrom)
      return x
    },
    [quickSearch, fieldSearch, locNC.menhDe, collectorFilter, dateFrom, dateTo, amountMin, amountMax, kyLoc]
  )

  /** Lượt cũ về sau không được ghi đè lượt mới — mỗi phép giữ một số thứ tự. */
  const luotRef = useRef({ ds: 0, tong: 0, dem: 0 })
  const khoaTaiRef = useRef<KhoaTai>(null)

  const fetchData = useCallback(async () => {
    if (!laTaiThem(khoaTaiRef, [applyFilters, status, pg.from], pg.to, false)) setLoading(true)
    /* ⚠ CHỜ LƯỢT TRA MÃ — giữ "đang nạp" chứ không vẽ một danh sách thiếu. */
    if (!searchReady) return
    const luot = ++luotRef.current.ds
    const taoQ = (dem: boolean) => {
      let q = supabase
        .from("cash_receipts")
        .select(COT, dem ? { count: "exact" } : undefined)
        .order("receipt_date", { ascending: false })
        .order("created_at", { ascending: false })
        /* ⚠ Mốc phụ duy nhất — hai phiếu cùng giờ tạo không được lặp / sót giữa hai trang. */
        .order("id")
      q = locTrangThai(q, status)
      return applyFilters(q as never) as typeof q
    }
    /* Tải HAI NHỊP (chủ nhà 26/09/2026): 20 phiếu đầu vẽ ngay, phần còn lại về sau. */
    const taiThem = laTaiThem(khoaTaiRef, [applyFilters, status, pg.from], pg.to)
    let daVeDu = false
    const { data, error, count } = await taiHaiNhip<ReceiptRow, KQ>(
      (from, to, dem) => taoQ(dem).range(from, to) as unknown as PromiseLike<KQ>,
      pg.from,
      pg.to,
      (dau) => {
        if (daVeDu || luot !== luotRef.current.ds) return
        setRows(dau.data ?? [])
        pg.setTotal(dau.count ?? 0)
        setLoading(false)
      },
      { boQuaDau: taiThem }
    )
    if (luot !== luotRef.current.ds) return
    if (error) console.error("[finance/cash-receipts] truy vấn lỗi:", error.message)
    const list = data ?? []
    daVeDu = true
    setRows(list)
    pg.setTotal(count ?? 0)
    setLoading(false)

    /**
     * Khách + hóa đơn của từng phiếu đang hiện (đầu phiếu không có cột khách).
     * ⚠ ĐỌC HỎNG THÌ GIỮ `undefined` — ô hiện "—", không nói "không có khách".
     */
    const ids = list.map((r) => r.id)
    if (ids.length === 0) return
    const res = await fetchAllForAggregate<DongPhieuThuTom>((from, to) =>
      supabase
        .from("cash_receipt_lines")
        .select(COT_DONG_PHIEU_THU, { count: "exact" })
        .in("receipt_id", ids)
        .order("id")
        .range(from, to)
    )
    if (luot !== luotRef.current.ds) return
    if (res.error) console.warn("[finance/cash-receipts] không đọc được dòng phiếu:", res.error)
    else setTomTat((prev) => ({ ...prev, ...tomTatDongPhieuThu(res.rows) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, applyFilters, searchReady, pg.from, pg.to])

  /**
   * Tổng tiền của CẢ bộ lọc. ⚠ KHÔNG CỘNG `rows` (một trang); chạm trần / lỗi → `null` → "—".
   */
  const fetchTotal = useCallback(async () => {
    setFilteredTotal(null)
    if (!searchReady) return
    const luot = ++luotRef.current.tong
    const res = await fetchAllForAggregate<{ expected_amount: number | string | null }>((from, to) => {
      let q = supabase.from("cash_receipts").select("expected_amount", { count: "exact" })
      q = locTrangThai(q, status)
      if (boPhieuHuyKhoiTong(status)) q = q.neq("status", "voided")
      return (applyFilters(q as never) as typeof q).order("id").range(from, to)
    })
    if (luot !== luotRef.current.tong) return
    if (res.error || res.truncated) {
      console.warn("[finance/cash-receipts] không cộng được tổng:", res.error ?? "vượt trần")
      setFilteredTotal(null)
      return
    }
    setFilteredTotal(Math.round(res.rows.reduce((a, r) => a + (Number(r.expected_amount) || 0), 0)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, applyFilters, searchReady])

  /** ⚠ ĐẾM Ở MÁY CHỦ, KHÔNG ĐẾM TỪ `rows` (một trang). */
  const fetchCounts = useCallback(async () => {
    if (!searchReady) return
    const luot = ++luotRef.current.dem
    const one = async (st: string | null) => {
      let q = supabase.from("cash_receipts").select("id", { count: "exact", head: true })
      if (st) q = q.eq("status", st)
      const { count, error } = (await applyFilters(q as never)) as unknown as { count: number | null; error: unknown }
      if (error) console.error("[finance/cash-receipts] đếm lỗi")
      return count ?? 0
    }
    const [pending, received, voided, all] = await Promise.all([one("pending"), one("received"), one("voided"), one(null)])
    if (luot !== luotRef.current.dem) return
    setCounts({ pending, received, voided, all })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFilters, searchReady])

  /* Quay về tab này thì đọc lại — nút ở ngăn xem nhanh mở TAB MỚI. */
  useEffect(() => { if (!authLoading) fetchData() }, [authLoading, fetchData, focusTick])
  useEffect(() => { if (!authLoading) fetchTotal() }, [authLoading, fetchTotal, focusTick])
  useEffect(() => { if (!authLoading) fetchCounts() }, [authLoading, fetchCounts, focusTick])

  /** Đổi bộ lọc thì về trang 1. */
  useEffect(() => {
    pg.setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, collectorFilter, dateFrom, dateTo, amountMin, amountMax, debouncedSearch, kyLoc, fieldSearch.key, locNC.key])

  const clearAdvanced = () => {
    setCollectorFilter("all")
    setDateFrom(""); setDateTo(""); setAmountMin(""); setAmountMax("")
    setTruongTim({})
  }
  const activeFilterCount =
    (collectorFilter !== "all" ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) +
    (amountMin || amountMax ? 1 : 0) + soTruongDangTim(truongTim)

  const advancedFilterFields = (
    <>
      {filterActive("date") && (
        <>
          <LocNhanhField label="Từ ngày">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </LocNhanhField>
          <LocNhanhField label="Đến ngày">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </LocNhanhField>
        </>
      )}
      {filterActive("collector") && (
        <LocNhanhField label="Người thu">
          <Select value={collectorFilter} onValueChange={setCollectorFilter}>
            <SelectTrigger aria-label="Lọc theo người thu"><SelectValue placeholder="Tất cả" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả người thu</SelectItem>
              {nguoiThu.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.full_name || "—"}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LocNhanhField>
      )}
      {filterActive("amount") && (
        <>
          <LocNhanhField label="Số tiền từ">
            <MoneyInput placeholder="0" value={amountMin} onChange={(n) => setAmountMin(n ? String(n) : "")} />
          </LocNhanhField>
          <LocNhanhField label="Số tiền đến">
            <MoneyInput placeholder="VD: 50.000.000" value={amountMax} onChange={(n) => setAmountMax(n ? String(n) : "")} />
          </LocNhanhField>
        </>
      )}
      <div className="flex justify-end md:col-span-3">
        <Button variant="ghost" size="sm" onClick={clearAdvanced}>Xóa bộ lọc</Button>
      </div>
    </>
  )

  const columns = useMemo(() => {
    const cols: Array<DocColumn<ReceiptRow> & { k?: CashReceiptColumnKey }> = [
      {
        key: "code", label: "Số phiếu", width: "150px",
        render: (r) => <DocCodeLink href={`/finance/cash-receipts/${r.id}`}>{r.receipt_code}</DocCodeLink>,
      },
      {
        k: "customer", key: "customer", label: "Khách hàng", width: "minmax(200px,1.5fr)",
        sort: (a, b) => (nhanNhieu(tomTat?.[a.id]?.khach) ?? "").localeCompare(nhanNhieu(tomTat?.[b.id]?.khach) ?? "", "vi"),
        render: (r) => (
          <span className="block truncate text-sm font-bold">
            {tomTat ? (nhanNhieu(tomTat[r.id]?.khach) ?? "—") : "…"}
          </span>
        ),
      },
      {
        k: "invoices", key: "invoices", label: "Hóa đơn", width: "160px",
        render: (r) => {
          const t = tomTat?.[r.id]
          const nhan = nhanNhieu(t?.hoaDon) ?? (t?.don.length ? `Đơn ${nhanNhieu(t.don)}` : null)
          return <span className="block truncate font-mono text-xs">{tomTat ? (nhan ?? "—") : "…"}</span>
        },
      },
      { k: "collector", key: "collector", label: "Người thu", width: "150px", render: (r) => <DocCellText>{r.collector?.full_name}</DocCellText> },
      { k: "createdBy", key: "createdBy", label: "Người tạo", width: "150px", render: (r) => <DocCellText muted>{r.creator?.full_name}</DocCellText> },
      { k: "receiver", key: "receiver", label: "Người nhận", width: "150px", render: (r) => <DocCellText muted>{r.receiver?.full_name}</DocCellText> },
      {
        k: "source", key: "source", label: "Nguồn", width: "140px",
        render: (r) => <DocCellText muted>{CASH_RECEIPT_SOURCE_LABEL[r.source_type ?? ""] ?? r.source_type}</DocCellText>,
      },
      {
        k: "date", key: "date", label: "Ngày thu", width: "110px",
        sort: (a, b) => (a.receipt_date ?? "").localeCompare(b.receipt_date ?? ""),
        render: (r) => <DocCellDate date={formatDate(r.receipt_date)} time={r.created_at ? vnTime(r.created_at) : null} />,
      },
      {
        k: "submitted", key: "submitted", label: "Đã nộp", width: "130px", align: "right",
        sort: (a, b) => Number(a.submitted_amount) - Number(b.submitted_amount),
        render: (r) => formatCurrency(Number(r.submitted_amount || 0)),
      },
      {
        k: "total", key: "total", label: "Số tiền", width: "140px", align: "right",
        sort: (a, b) => Number(a.expected_amount) - Number(b.expected_amount),
        render: (r) => {
          const lech = Number(r.submitted_amount || 0) - Number(r.expected_amount || 0)
          return (
            <>
              {formatCurrency(Number(r.expected_amount || 0))}
              {/* Phiếu chờ xác nhận nộp lệch thì nói ngay trên dòng. */}
              {r.status === "pending" && Math.abs(lech) > 0.5 && (
                <span className={`block text-[11px] font-semibold ${lech < 0 ? "text-error" : "text-[#8a5a00]"}`}>
                  {lech < 0 ? "Thiếu " : "Dư "}{formatCurrency(Math.abs(lech))}
                </span>
              )}
            </>
          )
        },
      },
      {
        k: "status", key: "status", label: "Trạng thái", width: "140px",
        render: (r) => (
          <Badge variant={CASH_RECEIPT_STATUS_VARIANT[r.status] ?? "secondary"}>
            {CASH_RECEIPT_STATUS_LABEL[r.status] ?? r.status}
          </Badge>
        ),
      },
      { k: "notes", key: "notes", label: "Ghi chú", width: "minmax(160px,1fr)", render: (r) => <DocCellText muted title={r.notes ?? undefined}>{r.notes}</DocCellText> },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [tomTat, visibleColumns])

  if (authLoading) return <Skeleton className="h-96" />

  const coLoc = activeFilterCount + (search ? 1 : 0) + locNC.soDangAp > 0
  const empty = (
    <EmptyState
      icon={<Receipt className="h-8 w-8 text-muted-foreground" />}
      title={coLoc ? "Không có phiếu thu nào khớp bộ lọc" : "Chưa có phiếu thu"}
      description={coLoc ? "Sửa hoặc bỏ bớt điều kiện lọc." : "Phiếu thu sinh ra khi thu tiền công nợ của khách."}
    >
      {canCreate && (
        <Button size="sm" onClick={() => router.push("/finance/cash-receipts/new")}>
          <Plus className="mr-2 h-4 w-4" /> Lập phiếu thu
        </Button>
      )}
    </EmptyState>
  )
  const khongTinhHuy = boPhieuHuyKhoiTong(status)
  const countText = `${pg.total} phiếu thu${khongTinhHuy ? " · không tính phiếu huỷ" : ""}`
  const tongText = filteredTotal === null ? null : formatCurrency(filteredTotal)

  const chips = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? 0, accent: t.accent }))
  const nutTao = canCreate && (
    <Button onClick={() => router.push("/finance/cash-receipts/new")}>
      <Plus className="mr-2 h-4 w-4" /> Lập phiếu thu
    </Button>
  )

  return (
    <div className="space-y-4">
      {/* ⚠ Workflow v2 không có bước quyết toán chuyến — phiếu thu là chứng từ độc lập. */}
      <PageHeader
        className="max-lg:hidden"
        title="Phiếu thu"
        descriptionDesktopOnly
        description="Chứng từ thu tiền công nợ của khách — trừ nợ theo từng hóa đơn."
      >
        {nutTao}
      </PageHeader>

      <StatusChips className="max-lg:hidden" multi active={status} onPick={setStatus} chips={chips} />

      <KetQuaThieu show={searchTruncated && !loading} term={debouncedSearch} />

      <DocListLayout
        toolbar={
          <>
            {filterActive("search") && (
              <DocSearchBox
                className="min-w-[260px] max-w-md flex-1"
                value={search}
                onChange={setSearch}
                placeholder="Tìm số phiếu, khách, hóa đơn…"
                fields={TRUONG_PHIEU_THU}
                applied={truongTim}
                onApply={setTruongTim}
                onExpand={() => setShowAdvanced(true)}
              />
            )}
            <PeriodSelect
              value={dateFrom || dateTo ? "custom" : period}
              onChange={(k) => { setDateFrom(""); setDateTo(""); setPeriod(k) }}
            />
            <XoaLocButton show={activeFilterCount + (search ? 1 : 0) > 0} onClick={() => { clearAdvanced(); setSearch("") }} />
            {(filterActive("date") || filterActive("collector") || filterActive("amount")) && (
              <LocNhanhButton open={showAdvanced} onToggle={() => setShowAdvanced((v) => !v)} />
            )}
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_PHIEU_THU} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={CASH_RECEIPT_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={CASH_RECEIPT_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        advanced={showAdvanced ? advancedFilterFields : null}
        totals={{ label: "Tổng tiền phiếu thu", countText, total: tongText }}
        mobileHead={{
          title: "Phiếu thu",
          search,
          onSearch: setSearch,
          searchPlaceholder: "Tìm số phiếu, khách, hóa đơn…",
          chips: { chips, active: status, onPick: setStatus, multi: true },
          ky: { period, onCycle: () => setPeriod((p) => nextPeriod(p)) },
          filter: {
            activeCount: activeFilterCount,
            onClear: () => { clearAdvanced(); setPeriod("month") },
            open: filterSheet,
            onOpenChange: setFilterSheet,
            sheet: (
              <div className="grid gap-4">
                <DocFieldInputs fields={TRUONG_PHIEU_THU} values={truongTim} onChange={setTruongTim} />
                <AdvancedFilter truong={LOC_PHIEU_THU} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
                {advancedFilterFields}
              </div>
            ),
          },
          actions: nutTao || undefined,
        }}
        loading={loading}
        isEmpty={rows.length === 0}
        empty={empty}
        pg={pg}
        shownCount={rows.length}
        table={<DocTable rows={rows} columns={columns} activeId={drawerId} onOpen={(r) => setDrawerId(r.id)} rowTestId="dong-phieu-thu" />}
        cards={
          <DocCardList
            items={rows}
            unit="phiếu thu"
            getDate={(r) => r.receipt_date}
            getTotal={(r) => (r.status === "voided" ? 0 : Number(r.expected_amount || 0))}
            onOpen={(r) => setDrawerId(r.id)}
            card={(r) => {
              const t = tomTat?.[r.id]
              return {
                accent: cashReceiptTone(r.status).accent,
                title: nhanNhieu(t?.khach) ?? (r.collector?.full_name ? `Thu bởi ${r.collector.full_name}` : "Phiếu thu"),
                total: formatCurrency(Number(r.expected_amount || 0)),
                meta: [r.created_at ? vnTime(r.created_at) : null, r.receipt_code].filter(Boolean).join(" · "),
                payment: r.collector?.full_name ?? "",
                summary: nhanNhieu(t?.hoaDon) ?? undefined,
                badge: cashReceiptBadge(r.status),
              }
            }}
          />
        }
      />

      <CashReceiptDrawer receiptId={drawerId} onClose={() => setDrawerId(null)} />
    </div>
  )
}
