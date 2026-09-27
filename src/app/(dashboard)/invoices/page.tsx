"use client"

/**
 * HÓA ĐƠN ĐIỆN TỬ (MISA) — danh sách.
 *
 * ⚠ KHUÔN DANH SÁCH CHUNG (chủ nhà 27/09/2026: "Làm chung form hiển thị danh sách cho toàn
 *   bộ các danh sách theo form đang dùng cho Đơn hàng, hóa đơn, trả hàng"): bốn ô thống kê cũ
 *   thành dải trạng thái MISA có số đếm; một thẻ gồm thanh công cụ · lưới · phân trang; thẻ
 *   trên điện thoại; bấm dòng mở xem nhanh.
 */
import { useEffect, useMemo, useState, useRef } from "react"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { coTimKd, dieuKienTim } from "@/lib/search/list-search"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePagination } from "@/hooks/use-pagination"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StatusChips } from "@/components/ui/status-chips"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { DocListLayout, DocListSearch, LocNhanhField, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_HOA_DON_DIEN_TU } from "@/lib/search/list-filter-fields"
import { formatCurrency, formatDate } from "@/lib/utils"
import { buildMisaInvoiceUrl, MISA_LIST_URL } from "@/lib/misa/web-url"
import Link from "@/components/ui/link"
import { misaStatusBadge } from "@/lib/misa/labels"
import { FileText, Plus, ExternalLink } from "lucide-react"
import type { Invoice } from "@/types"
import {
  INVOICE_COLUMNS,
  DEFAULT_INVOICE_COLUMNS,
  INVOICE_FILTERS,
  DEFAULT_INVOICE_FILTERS,
  type InvoiceColumnKey,
  type InvoiceFilterKey,
} from "./list-config"

type InvoiceRow = Pick<
  Invoice,
  | "id"
  | "invoice_number"
  | "customer_name"
  | "total"
  | "status"
  | "created_at"
  | "issued_at"
  | "misa_status"
  | "misa_invoice_id"
  | "misa_ref_id"
  | "misa_inv_no"
  | "misa_inv_series"
  | "misa_invoice_url"
  | "misa_lookup_code"
  | "misa_error"
>



export default function InvoicesPage() {
  const { user, loading: authLoading } = useRoleGuard("invoices")
  const router = useRouter()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  /** Vị trí lần tải trước — để "Tải thêm" không vẽ lại 20 dòng đầu (tải hai nhịp, 26/09/2026). */
  const khoaTaiRef = useRef<KhoaTai>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [misaFilter, setMisaFilter] = useState("all")
  const [stats, setStats] = useState({ total: 0, signed: 0, pending: 0, error: 0, attention: 0 })
  const [misaCompanyId, setMisaCompanyId] = useState<string | null>(null)
  const pg = usePagination()
  const supabase = createClient()

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "invoices",
    DEFAULT_INVOICE_COLUMNS,
    DEFAULT_INVOICE_FILTERS,
    INVOICE_COLUMNS,
    INVOICE_FILTERS
  )
  const filterActive = (k: InvoiceFilterKey) => activeFilters.includes(k)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("invoices", LOC_HOA_DON_DIEN_TU)

  // Tách stats query khỏi list query — gọi 1 lần khi mount, không reload theo
  // filter (số tổng vẫn chính xác).
  useEffect(() => {
    async function loadStats() {
      const [allRes, signedRes, errorRes, pendingRes, attentionRes] = await Promise.all([
        supabase.from("invoices").select("id", { count: "exact", head: true }),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("misa_status", "signed"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("misa_status", "error"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).or("misa_status.is.null,misa_status.eq.pending"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).in("misa_status", ["replaced", "cancelled", "amount_mismatch", "waiting_code"]),
      ])
      const qErr = ([allRes, signedRes, errorRes, pendingRes, attentionRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[app/invoices] truy vấn lỗi:", qErr.message)
      setStats({
        total: allRes.count ?? 0,
        signed: signedRes.count ?? 0,
        error: errorRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        attention: attentionRes.count ?? 0,
      })
    }
    loadStats()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load MISA companyId 1 lần để build deep-link tới HĐ trên MISA web.
  useEffect(() => {
    (async () => {
      const { data, error: dataErr } = await supabase
        .from("company_einvoice_config")
        .select("misa_company_id")
        .maybeSingle()
      if (dataErr) console.error("[app/invoices] truy vấn lỗi:", dataErr.message)
      setMisaCompanyId(data?.misa_company_id ?? null)
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search để tránh hit Supabase mỗi keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset về trang 1 khi filter/search đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, statusFilter, misaFilter, activeFilters, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // List query: filter + sort + pagination ở server.
  useEffect(() => {
    if (!locNC.ready) return
    let cancelled = false
    async function fetch() {
      // Tải thêm / đổi sang trang dài hơn: giữ danh sách đang hiện trong lúc chờ.
      if (!laTaiThem(khoaTaiRef, pg.from, pg.to, false)) setLoading(true)
      const timKd = debouncedSearch ? await coTimKd(supabase, "invoices") : false
      if (cancelled) return
      /* Tải HAI NHỊP (chủ nhà 26/09/2026): 20 dòng đầu vẽ ngay, phần còn lại về sau. */
      const taoQ = (from: number, to: number, dem: boolean) => {
        let q = supabase
          .from("invoices")
          .select(
            // misa_error đã có sẵn trong DB từ mig 011 nhưng chưa bao giờ được
            // lấy về, nên hoá đơn trạng thái "Lỗi" không hiện được lý do —
            // kế toán không biết phải xử lý gì (NPP-15).
            "id, invoice_number, customer_name, total, status, created_at, issued_at, misa_status, misa_invoice_id, misa_ref_id, misa_inv_no, misa_inv_series, misa_invoice_url, misa_lookup_code, misa_error",
            dem ? { count: "exact" } : undefined
          )
          .order("created_at", { ascending: false })
          .range(from, to)
        if (filterActive("search") && debouncedSearch) {
          /* Từng từ, không dấu, số HĐ viết liền (mig 205) — xem `dieuKienTim`. */
          q = q.or(dieuKienTim("invoices", ["invoice_number", "customer_name", "misa_inv_no", "misa_invoice_id"], debouncedSearch, timKd))
        }
        for (const f of locNC.menhDe) q = q.or(f)
        if (filterActive("status") && statusFilter !== "all") {
          q = q.eq("status", statusFilter)
        }
        if (filterActive("misa") && misaFilter !== "all") {
          if (misaFilter === "signed") q = q.eq("misa_status", "signed")
          else if (misaFilter === "error") q = q.eq("misa_status", "error")
          else if (misaFilter === "pending") q = q.or("misa_status.is.null,misa_status.eq.pending")
          // Không có bộ lọc này thì hoá đơn bị huỷ / bị thay thế / lệch tiền
          // nằm lẫn trong danh sách và không ai tìm ra chúng.
          else if (misaFilter === "attention") {
            q = q.in("misa_status", ["replaced", "cancelled", "amount_mismatch", "waiting_code"])
          }
        }
        return q as unknown as PromiseLike<{ data: InvoiceRow[] | null; count: number | null; error: { message: string } | null }>
      }
      const { data, count , error: qErr } = await taiHaiNhip(taoQ, pg.from, pg.to, (dau) => {
        if (cancelled) return; setInvoices(dau.data ?? [])
        pg.setTotal(dau.count ?? 0)
        setLoading(false)
      }, { boQuaDau: laTaiThem(khoaTaiRef, pg.from, pg.to) })
      if (qErr) console.error("[invoices] truy vấn lỗi:", qErr.message)
      if (cancelled) return
      setInvoices((data as InvoiceRow[]) || [])
      pg.setTotal(count ?? 0)
      setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, statusFilter, misaFilter, activeFilters, locNC.ready, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps


  const filtered = invoices // đã filter server-side
  const [xemId, setXemId] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)

  const statusVariant = (s: string): "default" | "success" | "danger" | "secondary" => {
    switch (s) { case "issued": return "success"; case "cancelled": return "danger"; default: return "secondary" }
  }
  const statusLabel = (s: string) => {
    switch (s) { case "issued": return "Đã phát hành"; case "cancelled": return "Đã hủy"; default: return "Nháp" }
  }
  const misaLinks = (inv: InvoiceRow) =>
    inv.misa_ref_id || inv.misa_lookup_code ? (
      <span className="flex flex-col gap-0.5">
        <a
          href={buildMisaInvoiceUrl(inv.misa_ref_id || inv.misa_lookup_code, misaCompanyId) || MISA_LIST_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Mở MISA <ExternalLink className="h-3 w-3" />
        </a>
        {inv.misa_invoice_url && (
          <a
            href={inv.misa_invoice_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-muted-foreground hover:underline"
          >
            Tra cứu công khai
          </a>
        )}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    )
  const misaCell = (inv: InvoiceRow) => {
    const misa = misaStatusBadge(inv.misa_status)
    return misa ? (
      <span className="flex flex-col gap-0.5">
        <Badge variant={misa.variant}>{misa.label}</Badge>
        {inv.misa_status === "error" && (
          <span className="max-w-[220px] truncate text-[11px] text-destructive" title={inv.misa_error || undefined}>
            {inv.misa_error || "Không rõ lý do — xem log MISA"}
          </span>
        )}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    )
  }
  const ngay = (inv: InvoiceRow) => (inv.issued_at ? formatDate(inv.issued_at) : inv.created_at ? formatDate(inv.created_at) : "-")

  const columns = useMemo(() => {
    const cols: Array<DocColumn<InvoiceRow> & { k?: InvoiceColumnKey }> = [
      {
        k: "number", key: "number", label: "Số HĐ", width: "150px",
        render: (inv) => (
          <DocCodeLink href={`/invoices/${inv.id}`}>
            {inv.invoice_number || <span className="font-sans text-xs font-normal text-muted-foreground">chưa cấp số</span>}
          </DocCodeLink>
        ),
      },
      {
        key: "customer", label: "Khách hàng", width: "minmax(200px,1.5fr)",
        sort: (a, b) => (a.customer_name ?? "").localeCompare(b.customer_name ?? "", "vi"),
        render: (inv) => <span className="block truncate text-sm font-bold">{inv.customer_name}</span>,
      },
      { k: "amount", key: "amount", label: "Tổng tiền", width: "140px", align: "right", sort: (a, b) => Number(a.total) - Number(b.total), render: (inv) => formatCurrency(inv.total) },
      { k: "date", key: "date", label: "Ngày", width: "110px", render: (inv) => <DocCellDate date={ngay(inv)} /> },
      { k: "status", key: "status", label: "Trạng thái", width: "130px", render: (inv) => <Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge> },
      { k: "misa", key: "misa", label: "MISA", width: "minmax(150px,1fr)", render: misaCell },
      { k: "lookup", key: "lookup", label: "Tra cứu", width: "130px", render: misaLinks },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, misaCompanyId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? filtered.find((i) => i.id === xemId) ?? null : null
  /* Dải MISA — thay bốn ô thống kê cũ; số đếm là của TOÀN sổ (đếm riêng lúc mở màn). */
  const MISA_CHIPS = [
    { key: "signed", label: "Đã ký số MISA", count: stats.signed, accent: "#22c55e" },
    { key: "pending", label: "Chờ gửi", count: stats.pending, accent: "#fdb022" },
    { key: "error", label: "Lỗi", count: stats.error, accent: "#ef5350" },
    { key: "attention", label: "Cần xử lý", count: stats.attention, accent: "#f97316" },
    { key: "all", label: "Tất cả", count: stats.total, accent: "#181c1e" },
  ]
  const statusSelect = (
    <Select value={statusFilter} onValueChange={setStatusFilter}>
      <SelectTrigger aria-label="Trạng thái hóa đơn" className="h-10 w-40 rounded-xl font-semibold"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Mọi trạng thái</SelectItem>
        <SelectItem value="draft">Nháp</SelectItem>
        <SelectItem value="issued">Đã phát hành</SelectItem>
        <SelectItem value="cancelled">Đã hủy</SelectItem>
      </SelectContent>
    </Select>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Hóa đơn điện tử" descriptionDesktopOnly description={`${stats.total} hóa đơn`}>
        {/* Đối soát hai chiều: rổ "chỉ có trên MISA" không hiện được ở
            danh sách này vì những tờ đó KHÔNG CÓ trong bảng invoices. */}
        <Button variant="outline" asChild>
          <Link href="/invoices/reconcile">Đối soát MISA</Link>
        </Button>
        {user && hasPermission(user.role, "invoices", "create") && (
          <Button onClick={() => router.push("/invoices/new")}><Plus className="mr-2 h-4 w-4" /> Tạo hóa đơn</Button>
        )}
      </PageHeader>

      {filterActive("misa") && (
        <StatusChips active={misaFilter} onPick={setMisaFilter} chips={MISA_CHIPS} />
      )}

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm số HĐ, khách hàng, mã MISA..."
        activeCount={(statusFilter !== "all" ? 1 : 0) + locNC.soDangAp}
        onClear={() => { setStatusFilter("all"); locNC.xoa() }}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <div className="grid gap-4">
          {filterActive("status") && <LocNhanhField label="Trạng thái">{statusSelect}</LocNhanhField>}
          <AdvancedFilter truong={LOC_HOA_DON_DIEN_TU} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
        </div>
      </MobileFilterBar>

      <DocListLayout
        toolbar={
          <>
            {filterActive("search") && (
              <DocListSearch value={search} onChange={setSearch} placeholder="Tìm số HĐ, khách hàng, mã MISA..." />
            )}
            {filterActive("status") && statusSelect}
            <XoaLocButton show={!!search || statusFilter !== "all"} onClick={() => { setSearch(""); setStatusFilter("all") }} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_HOA_DON_DIEN_TU} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={INVOICE_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={INVOICE_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        /* Hóa đơn điện tử là bản khai với MISA, không phải sổ doanh thu (doanh thu theo hóa
           đơn bán ghi sổ) — màn này không cộng tiền để khỏi đọc nhầm thành doanh thu. */
        totals={null}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={
          <EmptyState
            icon={<FileText className="h-8 w-8 text-muted-foreground" />}
            title={pg.total === 0 ? "Chưa có hóa đơn" : "Không tìm thấy hóa đơn"}
            description={pg.total === 0 ? "Hóa đơn được tạo từ đơn hàng đã giao" : "Thử đổi bộ lọc"}
          />
        }
        pg={pg}
        shownCount={filtered.length}
        table={<DocTable rows={filtered} columns={columns} activeId={xemId} onOpen={(inv) => setXemId(inv.id)} />}
        cards={
          <DocCardList
            items={filtered}
            onOpen={(inv) => setXemId(inv.id)}
            card={(inv) => {
              const misa = misaStatusBadge(inv.misa_status)
              return {
                accent: inv.status === "cancelled" ? "#ef5350" : inv.misa_status === "signed" ? "#22c55e" : inv.misa_status === "error" ? "#ef5350" : "#fdb022",
                title: inv.customer_name || "—",
                total: formatCurrency(inv.total),
                meta: [ngay(inv), inv.invoice_number || "chưa cấp số"].join(" · "),
                payment: statusLabel(inv.status),
                summary: inv.misa_status === "error" ? (inv.misa_error || "Lỗi MISA — xem log") : undefined,
                badge: misa && inv.misa_status !== "signed" ? { label: misa.label, bg: "#fff4e0", fg: "#8a5a00" } : null,
              }
            }}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.invoice_number || "Hóa đơn (chưa cấp số)"}
        subtitle={xem ? ngay(xem) : undefined}
        badge={xem ? <Badge variant={statusVariant(xem.status)}>{statusLabel(xem.status)}</Badge> : null}
        fields={xem ? [
          { label: "Khách hàng", value: xem.customer_name, wide: true },
          { label: "MISA", value: misaCell(xem) },
          { label: "Tra cứu", value: misaLinks(xem) },
        ] : []}
        total={xem ? { label: "Tổng tiền", value: formatCurrency(xem.total) } : undefined}
        detailHref={xem ? `/invoices/${xem.id}` : undefined}
      />
    </div>
  )
}
