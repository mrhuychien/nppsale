"use client"

import { useEffect, useMemo, useState } from "react"
import { LEGACY_V2_HREFS } from "@/lib/nav/nav-permission"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import Link from "next/link"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/ui/empty-state"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { StockBalanceTable } from "@/components/inventory/stock-balance-table"
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardCheck,
  ClipboardList,
  Search,
  MoreVertical,
  Package,
  AlertTriangle,
  Clock,
  Wallet,
  Eye,
} from "lucide-react"
import type { Batch, Product } from "@/types"

type BatchWithProduct = Batch & { product?: Product }

/** Các cột đủ để tính ba thẻ đầu trang — không hơn. */
type StatsBatch = Pick<Batch, "qty_on_hand" | "unit_cost" | "expires_at"> & {
  location?: string | null
  product?: { shelf_life_days?: number | null; brand?: string | null } | null
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function getBatchExpiryState(
  expiresAt: string,
  shelfLifeDays?: number | null
): "expired" | "critical" | "push" | "safe" {
  const days = daysUntil(expiresAt)
  if (days < 0) return "expired"
  if (days < 30) return "critical"
  if (shelfLifeDays && days < shelfLifeDays / 3) return "push"
  return "safe"
}

export default function InventoryPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [batches, setBatches] = useState<BatchWithProduct[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState("current")
  const [search, setSearch] = useState("")
  const [brandFilter, setBrandFilter] = useState<string>("all")
  const [locationFilter, setLocationFilter] = useState<string>("all")
  const [now, setNow] = useState<Date>(new Date())
  const [statsBatches, setStatsBatches] = useState<StatsBatch[]>([])
  // Lỗi của truy vấn số liệu. Phải giữ lại để MÀN HÌNH nói ra — ghi vào
  // console thôi thì người dùng chỉ thấy ba số 0 trông như thật.
  const [statsError, setStatsError] = useState<string | null>(null)
  const [statsTruncated, setStatsTruncated] = useState(false)
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const supabase = createClient()

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // Số liệu cho ba thẻ đầu trang.
  //
  // ⚠ Truy vấn này từng hỏi cột `avg_price` — một cột KHÔNG TỒN TẠI trong
  // bất kỳ migration nào. PostgREST trả lỗi, `data` về null, và cả ba thẻ
  // hiện 0: "Sắp hết hạn 0", "Cần đẩy hàng 0", "Tổng giá trị tồn kho 0đ"
  // — trong khi bảng ngay bên dưới hiện 434 triệu. Lỗi chỉ được ghi ra
  // console, còn màn hình thì đưa ra ba con số trông hoàn toàn bình
  // thường. `unit_cost` vốn ĐÃ là giá vốn bình quân theo đơn vị cơ bản
  // (mig 016), nên `avg_price` không những không có mà còn không cần.
  //
  // ⚠ Và nó không phân trang. Supabase chặn 1.000 dòng mỗi request mà
  // KHÔNG báo lỗi — quá 1.000 lô là giá trị tồn kho tự nhiên thiếu đi một
  // khúc, vẫn trông như số thật. Dùng `fetchAllForAggregate` như mọi chỗ
  // cộng tiền khác trong dự án.
  useEffect(() => {
    async function loadStatsData() {
      const [statsRes, pendingRes] = await Promise.all([
        fetchAllForAggregate<StatsBatch>((from, to) =>
          supabase
            .from("batches")
            .select(
              "qty_on_hand, unit_cost, expires_at, location, product:products(shelf_life_days, brand)",
              { count: "exact" }
            )
            .gt("qty_on_hand", 0)
            .range(from, to)
        ),
        supabase
          .from("stock_entries")
          .select("id", { count: "exact", head: true })
          .eq("status", "draft"),
      ])
      if (statsRes.error) {
        console.error("[app/inventory] truy vấn lỗi:", statsRes.error)
        setStatsError(statsRes.error)
        setStatsBatches([])
      } else {
        setStatsError(null)
        setStatsBatches(statsRes.rows)
        // Chạm trần thì con số cộng ra THIẾU — phải nói, không được để nó
        // đi ra như một con số đầy đủ.
        setStatsTruncated(statsRes.truncated)
      }
      if (pendingRes.error) console.error("[app/inventory] truy vấn lỗi:", pendingRes.error.message)
      setPendingCount(pendingRes.count ?? 0)
    }
    loadStatsData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, brandFilter, locationFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ TÊN / SKU SẢN PHẨM PHẢI TRA RIÊNG: PostgREST không cho `or` bắc
   *   qua bảng nhúng. Phần nối dây ở `useListSearch`.
   */
  const listSearch = useListSearch(
    supabase, debouncedSearch, user?.org_id, ["batch_code"],
    [{ column: "product_id", table: "products", columns: ["name", "sku", "barcode"] }]
  )

  // Paginated batches list.
  useEffect(() => {
    let cancelled = false
    async function fetchBatchesList() {
      setLoading(true)
      /* ⚠ CHỜ LƯỢT TRA MÃ SẢN PHẨM — xem `useListSearch`. */
      if (!listSearch.ready) return
      // selectResilient: DB thiếu cột thì tự thử lại với '*' thay vì rỗng im lặng.
      const build = (select: string) => {
        let q = supabase
          .from("batches")
          .select(select, { count: "exact" })
          .gt("qty_on_hand", 0)
          .order("expires_at")
          .range(pg.from, pg.to)
        /**
         * ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM (chủ nhà báo 21/09/2026).
         *   Bản cũ chỉ `ilike("batch_code")` trên máy chủ rồi lọc thêm
         *   theo TÊN / SKU sản phẩm ở trình duyệt — gõ tên hàng là chỉ
         *   tìm trong trang đang hiện, còn `pg.setTotal(count)` vẫn ghi
         *   tổng của phép đếm chưa lọc.
         */
        if (listSearch.filter) q = q.or(listSearch.filter)
        if (locationFilter !== "all") q = q.eq("location", locationFilter)
        /**
         * ⚠ LỌC NHÃN HÀNG CŨNG PHẢI Ở MÁY CHỦ. Nó lọc trên bảng NHÚNG
         *   nên phần nhúng phải là `!inner` — không thì PostgREST vẫn
         *   trả lô về và chỉ bỏ trống phần sản phẩm.
         */
        if (brandFilter !== "all") q = q.eq("product.brand", brandFilter)
        return q
      }
      const prod = brandFilter !== "all" ? "product:products!inner(*)" : "product:products(*)"
      const res = await selectResilient<BatchWithProduct>(
        build,
        `id, batch_code, qty_on_hand, expires_at, manufactured_at, location, ${prod}`,
        // eslint-disable-next-line no-restricted-syntax
        `*, ${prod}`
      )
      if (cancelled) return
      /* ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT — máy chủ đã lọc cả ô tìm lẫn
         nhãn hàng. Lọc sau khi phân trang là chỉ lọc trang đang xem. */
      setBatches(res.data)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)
      setLoading(false)
    }
    fetchBatchesList()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, listSearch, brandFilter, locationFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    let expiringSoon = 0
    let needsPush = 0
    let totalValue = 0
    for (const b of statsBatches) {
      const state = getBatchExpiryState(b.expires_at, b.product?.shelf_life_days ?? undefined)
      if (state === "critical" || state === "expired") expiringSoon++
      if (state === "push") needsPush++
      // `unit_cost` LÀ giá vốn bình quân theo đơn vị cơ bản (mig 016) —
      // không có cột nào khác để lùi về.
      totalValue += (Number(b.qty_on_hand) || 0) * (Number(b.unit_cost) || 0)
    }
    return { expiringSoon, needsPush, totalValue }
  }, [statsBatches])

  const brands = useMemo(() => {
    const set = new Set<string>()
    statsBatches.forEach((b) => {
      if (b.product?.brand) set.add(b.product.brand)
    })
    return Array.from(set)
  }, [statsBatches])

  const locations = useMemo(() => {
    const set = new Set<string>()
    statsBatches.forEach((b) => {
      if (b.location) set.add(b.location)
    })
    return Array.from(set)
  }, [statsBatches])

  // Đã filter ở effect trên — pass-through.
  const filteredBatches = batches

  // T-09: legacy single-column summary replaced by StockBalanceTable
  // (split by zone + drill-down). Keep computation removed.

  const timeLabel = now.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  })

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-6">
      {/*
        ⚠ TRA MÃ CHẠM TRẦN THÌ NÓI RA. Kết quả đang THIẾU và trông y hệt
          lúc đủ — đúng cái lỗi "chỉ tìm trang 1" vừa sửa, chỉ đổi chỗ.
      */}
      {listSearch.truncated && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-[#7a4b00]">
          <p className="font-semibold">Kết quả tìm đang thiếu</p>
          <p className="mt-0.5">
            Có hơn {MATCH_CAP} mặt hàng khớp &ldquo;{debouncedSearch}&rdquo; — danh sách dưới
            chưa đủ. Gõ thêm cho hẹp lại.
          </p>
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-2xl font-bold tracking-tight text-foreground">
            Quản lý Kho hàng
          </h1>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ecfdf3] px-3 py-1 text-xs font-semibold text-tertiary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tertiary opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-tertiary"></span>
            </span>
            <Activity className="h-3 w-3" />
            Hệ thống ổn định • Cập nhật cuối: {timeLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/inventory/stock-in">
              <ArrowDownToLine className="mr-2 h-4 w-4" />
              Nhập kho
            </Link>
          </Button>
          {/* ⚠ HAI Ô CỦA LUỒNG CŨ ĐÃ ẨN Ở P7: "Xuất kho" (soạn hàng) và
              "Chờ xử lý". Workflow v2 không có bước soạn hàng —
              `complete_order` tự dựng phiếu xuất khi nhà phân phối bấm
              Xuất hàng ở màn đơn hàng.
              ⚠ Ẩn khỏi menu mà để lại ô ở đây thì vẫn bấm tới được, nên
              hai chỗ phải đọc CÙNG một danh sách `LEGACY_V2_HREFS`. */}
          {!LEGACY_V2_HREFS.has("/inventory/stock-out") && (
            <Button variant="outline" asChild>
              <Link href="/inventory/stock-out">
                <ArrowUpFromLine className="mr-2 h-4 w-4" />
                Xuất kho
              </Link>
            </Button>
          )}
          {!LEGACY_V2_HREFS.has("/inventory/pending") && (
            <Button variant="outline" asChild className="relative">
              <Link href="/inventory/pending">
                <Clock className="mr-2 h-4 w-4" />
                Chờ xử lý
                {pendingCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center rounded-full bg-[#fdb022] text-white text-[10px] font-bold h-5 min-w-[20px] px-1">
                    {pendingCount}
                  </span>
                )}
              </Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href="/inventory/entries">
              <ClipboardList className="mr-2 h-4 w-4" />
              Danh sách phiếu
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/inventory/stocktake-adjust">
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Kiểm kê
            </Link>
          </Button>
          <Button asChild>
            <Link href="/inventory/adjustments">
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Duyệt điều chỉnh
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/inventory/audit">
              <Search className="mr-2 h-4 w-4" />
              Tra soát
            </Link>
          </Button>
        </div>
      </div>

      {/* ⚠ Không có dải này thì lỗi truy vấn đi ra màn hình dưới dạng ba
          con số 0 — trông y hệt "kho đang trống", và không ai đi tìm lỗi
          vì không có gì báo là có lỗi. Dấu "—" trên thẻ nói rằng KHÔNG
          BIẾT; dải này nói vì sao không biết. */}
      {statsError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Không đọc được số liệu tồn kho.</strong> Ba thẻ dưới đây hiện &quot;—&quot; vì
            chưa có số, không phải vì kho trống. Bảng &quot;Tồn kho hiện tại&quot; bên dưới đọc từ
            nguồn khác nên vẫn đúng. Lỗi: {statsError}
          </span>
        </div>
      )}

      {/* Thống kê tồn kho — luôn hiển thị (mọi tab) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="border-l-4 border-l-destructive">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Sắp hết hạn
                </div>
                <div className="mt-2 text-2xl font-bold text-destructive">
                  {statsError ? "—" : stats.expiringSoon}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Lô có HSD &lt; 30 ngày
                </div>
              </div>
              <div className="rounded-xl bg-destructive/10 p-3 text-destructive">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-primary">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cần đẩy hàng
                </div>
                <div className="mt-2 text-2xl font-bold text-primary">
                  {statsError ? "—" : stats.needsPush}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  HSD còn &lt; 1/3 tuổi thọ
                </div>
              </div>
              <div className="rounded-xl bg-primary/10 p-3 text-primary">
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tổng giá trị tồn kho
                </div>
                <div className="mt-2 text-xl font-bold text-tertiary">
                  {statsError ? "—" : formatCurrency(stats.totalValue)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {statsTruncated
                    ? "⚠ Quá nhiều lô — con số này còn THIẾU"
                    : "Tính theo giá vốn trung bình"}
                </div>
              </div>
              <div className="rounded-xl bg-[#ecfdf3] p-3 text-tertiary">
                <Wallet className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <div className="sticky top-0 z-10 -mx-2 bg-background/80 px-2 py-2 backdrop-blur">
          <TabsList className="w-full overflow-x-auto justify-start gap-1 h-auto flex-wrap">
            <TabsTrigger value="current">Tồn kho hiện tại</TabsTrigger>
            <TabsTrigger value="fefo">Theo lô hàng (FEFO)</TabsTrigger>
          </TabsList>
        </div>

        {/* Tab 1: T-09 — Tồn kho hiện tại split by Kho bán / Kho date + drill-down */}
        <TabsContent value="current" className="mt-4">
          <StockBalanceTable />
        </TabsContent>

        {/* Tab 2: FEFO batches */}
        <TabsContent value="fefo" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm theo SKU, tên sản phẩm hoặc mã lô..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="Thương hiệu" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả thương hiệu</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder="Vị trí" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tất cả vị trí</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
          {loadError && !loading && (
            <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
              <p className="font-semibold">Không tải được danh sách lô hàng</p>
              <p className="mt-0.5 break-words">{loadError}</p>
            </div>
          )}

          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6">
                  <Skeleton className="h-48" />
                </div>
              ) : filteredBatches.length === 0 ? (
                <EmptyState
                  icon={<Package className="h-8 w-8 text-muted-foreground" />}
                  title={loadError ? "Không tải được dữ liệu" : "Không có lô hàng phù hợp"}
                  description={
                    loadError
                      ? "Xem thông báo lỗi phía trên."
                      : user?.role === "sales" &&
                          (debouncedSearch !== "" || brandFilter !== "all")
                        ? "NV bán hàng chỉ xem được sản phẩm thuộc NCC mình phụ trách, nên lô của SP ngoài phạm vi không lọc/tìm được theo tên, SKU hay thương hiệu. Liên hệ quản lý để được gán NCC tại Cài đặt › Người dùng."
                        : "Thử điều chỉnh bộ lọc để xem thêm kết quả"
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>Mã lô</TableHead>
                      <TableHead>NSX / HSD</TableHead>
                      <TableHead>Trạng thái HSD</TableHead>
                      <TableHead>Vị trí</TableHead>
                      <TableHead className="text-right">Tồn thực tế</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBatches.map((b) => {
                      const state = getBatchExpiryState(
                        b.expires_at,
                        b.product?.shelf_life_days ?? undefined
                      )
                      const days = daysUntil(b.expires_at)
                      const expiryColor =
                        state === "expired" || state === "critical"
                          ? "text-destructive"
                          : state === "push"
                            ? "text-primary"
                            : "text-foreground"
                      const statusBadge =
                        state === "expired" ? (
                          <Badge variant="danger">
                            Đã hết hạn {Math.abs(days)} ngày
                          </Badge>
                        ) : state === "critical" ? (
                          <Badge variant="danger">
                            Hết hạn trong {days} ngày
                          </Badge>
                        ) : state === "push" ? (
                          <Badge variant="warning">
                            Cần đẩy hàng (&lt;1/3)
                          </Badge>
                        ) : (
                          <Badge variant="success">An toàn</Badge>
                        )
                      return (
                        <TableRow key={b.id}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/30 text-muted-foreground">
                                <Package className="h-5 w-5" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-semibold truncate">
                                  {b.product?.name || "—"}
                                </div>
                                <div className="font-mono text-xs text-muted-foreground">
                                  {b.product?.sku}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center rounded-md bg-muted/30 px-2 py-1 font-mono text-xs">
                              {b.batch_code}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="text-xs text-muted-foreground">
                              NSX:{" "}
                              {b.manufactured_at
                                ? formatDate(b.manufactured_at)
                                : "—"}
                            </div>
                            <div className={`text-sm font-semibold ${expiryColor}`}>
                              HSD: {formatDate(b.expires_at)}
                            </div>
                          </TableCell>
                          <TableCell>{statusBadge}</TableCell>
                          <TableCell>
                            <div className="font-medium">{b.location || "—"}</div>
                            <div className="text-xs text-muted-foreground">
                              Khu vực kho
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-bold">{b.qty_on_hand}</div>
                            <div className="text-xs text-muted-foreground">
                              {b.product?.base_unit || ""}
                            </div>
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link href={`/inventory/batches/${b.id}`}>
                                    <Eye className="mr-2 h-4 w-4" /> Xem chi
                                    tiết
                                  </Link>
                                </DropdownMenuItem>
                                {/*
                                  ⚠ XEM NHANH GIAO DỊCH CỦA MÃ HÀNG từ ngay
                                    danh sách tồn kho (chủ nhà chốt
                                    20/09/2026). Trước đây muốn xem mã này
                                    nhập của ai, xuất cho ai thì phải đi
                                    vòng qua màn Tra soát rồi gõ tìm lại
                                    đúng mã đang đứng trước mặt.
                                */}
                                {b.product?.id && (
                                  <DropdownMenuItem asChild>
                                    <Link href={`/inventory/stock-card/${b.product.id}`}>
                                      <ClipboardList className="mr-2 h-4 w-4" /> Thẻ kho — nhập/xuất của mã này
                                    </Link>
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
              <DataPagination pg={pg} shownCount={filteredBatches.length} />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  )
}
