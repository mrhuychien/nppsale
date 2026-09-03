"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePagination } from "@/hooks/use-pagination"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { DataPagination } from "@/components/ui/data-pagination"
import { formatCurrency, formatDate } from "@/lib/utils"
import { buildMisaInvoiceUrl, MISA_LIST_URL } from "@/lib/misa/web-url"
import { FileText, Plus, Search, ExternalLink, CheckCircle2, Clock, AlertCircle } from "lucide-react"
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

const MISA_BADGE: Record<string, { label: string; variant: "default" | "success" | "warning" | "danger" | "secondary" }> = {
  signed: { label: "Đã ký số", variant: "success" },
  sent: { label: "Đã gửi MISA", variant: "default" },
  pending: { label: "Chờ gửi", variant: "warning" },
  error: { label: "Lỗi", variant: "danger" },
}

export default function InvoicesPage() {
  const { user, loading: authLoading } = useRoleGuard("invoices")
  const router = useRouter()
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [misaFilter, setMisaFilter] = useState("all")
  const [stats, setStats] = useState({ total: 0, signed: 0, pending: 0, error: 0 })
  const [misaCompanyId, setMisaCompanyId] = useState<string | null>(null)
  const pg = usePagination(50)
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
    DEFAULT_INVOICE_FILTERS
  )
  const show = (k: InvoiceColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: InvoiceFilterKey) => activeFilters.includes(k)

  // Tách stats query khỏi list query — gọi 1 lần khi mount, không reload theo
  // filter (số tổng vẫn chính xác).
  useEffect(() => {
    async function loadStats() {
      const [allRes, signedRes, errorRes, pendingRes] = await Promise.all([
        supabase.from("invoices").select("id", { count: "exact", head: true }),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("misa_status", "signed"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("misa_status", "error"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).or("misa_status.is.null,misa_status.eq.pending"),
      ])
      const qErr = ([allRes, signedRes, errorRes, pendingRes] as Array<{ error?: { message?: string } | null }>)
        .find((r) => r?.error)?.error
      if (qErr) console.error("[app/invoices] truy vấn lỗi:", qErr.message)
      setStats({
        total: allRes.count ?? 0,
        signed: signedRes.count ?? 0,
        error: errorRes.count ?? 0,
        pending: pendingRes.count ?? 0,
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
  }, [debouncedSearch, statusFilter, misaFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  // List query: filter + sort + pagination ở server.
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      let q = supabase
        .from("invoices")
        .select(
          // misa_error đã có sẵn trong DB từ mig 011 nhưng chưa bao giờ được
          // lấy về, nên hoá đơn trạng thái "Lỗi" không hiện được lý do —
          // kế toán không biết phải xử lý gì (NPP-15).
          "id, invoice_number, customer_name, total, status, created_at, issued_at, misa_status, misa_invoice_id, misa_ref_id, misa_inv_no, misa_inv_series, misa_invoice_url, misa_lookup_code, misa_error",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .range(pg.from, pg.to)
      if (filterActive("search") && debouncedSearch) {
        const term = `%${debouncedSearch.replace(/[%_]/g, "\\$&")}%`
        q = q.or(
          `invoice_number.ilike.${term},customer_name.ilike.${term},misa_inv_no.ilike.${term},misa_invoice_id.ilike.${term}`
        )
      }
      if (filterActive("status") && statusFilter !== "all") {
        q = q.eq("status", statusFilter)
      }
      if (filterActive("misa") && misaFilter !== "all") {
        if (misaFilter === "signed") q = q.eq("misa_status", "signed")
        else if (misaFilter === "error") q = q.eq("misa_status", "error")
        else if (misaFilter === "pending") q = q.or("misa_status.is.null,misa_status.eq.pending")
      }
      const { data, count , error: qErr } = await q
      if (qErr) console.error("[invoices] truy vấn lỗi:", qErr.message)
      if (cancelled) return
      setInvoices((data as InvoiceRow[]) || [])
      pg.setTotal(count ?? 0)
      setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, statusFilter, misaFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = invoices // đã filter server-side
  if (authLoading) return <Skeleton className="h-96" />

  const statusVariant = (s: string): "default" | "success" | "danger" | "secondary" => {
    switch (s) { case "issued": return "success"; case "cancelled": return "danger"; default: return "secondary" }
  }
  const statusLabel = (s: string) => {
    switch (s) { case "issued": return "Đã phát hành"; case "cancelled": return "Đã hủy"; default: return "Nháp" }
  }

  // Stats từ separate count queries (chính xác toàn tổng, không phụ thuộc page hiện tại)
  const totalInvoices = stats.total
  const signedCount = stats.signed
  const pendingCount = stats.pending
  const errorCount = stats.error

  return (
    <div className="space-y-6">
      <PageHeader title="Hóa đơn điện tử" description={`${totalInvoices} hóa đơn`}>
        {user && hasPermission(user.role, "invoices", "create") && (
          <Button onClick={() => router.push("/invoices/new")}><Plus className="mr-2 h-4 w-4" /> Tạo hóa đơn</Button>
        )}
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <p className="text-xs text-muted-foreground font-medium">Tổng hóa đơn</p>
          <p className="text-xl font-bold mt-1">{totalInvoices}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <div className="flex items-center gap-2 text-xs text-tertiary font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" /> Đã ký số MISA
          </div>
          <p className="text-xl font-bold mt-1 text-tertiary">{signedCount}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <div className="flex items-center gap-2 text-xs text-[#b54708] font-medium">
            <Clock className="h-3.5 w-3.5" /> Chờ gửi
          </div>
          <p className="text-xl font-bold mt-1 text-[#b54708]">{pendingCount}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border/40 p-4">
          <div className="flex items-center gap-2 text-xs text-error font-medium">
            <AlertCircle className="h-3.5 w-3.5" /> Lỗi
          </div>
          <p className="text-xl font-bold mt-1 text-error">{errorCount}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Tìm số HĐ, khách hàng, mã MISA..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        )}
        {filterActive("status") && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="draft">Nháp</SelectItem>
              <SelectItem value="issued">Đã phát hành</SelectItem>
              <SelectItem value="cancelled">Đã hủy</SelectItem>
            </SelectContent>
          </Select>
        )}
        {filterActive("misa") && (
          <Select value={misaFilter} onValueChange={setMisaFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">MISA: Tất cả</SelectItem>
              <SelectItem value="signed">Đã ký số</SelectItem>
              <SelectItem value="pending">Chờ gửi</SelectItem>
              <SelectItem value="error">Lỗi</SelectItem>
            </SelectContent>
          </Select>
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

      {loading ? (
        <Skeleton className="h-96" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8 text-muted-foreground" />}
          title={pg.total === 0 ? "Chưa có hóa đơn" : "Không tìm thấy hóa đơn"}
          description={pg.total === 0 ? "Hóa đơn được tạo từ đơn hàng đã giao" : "Thử đổi bộ lọc"}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  {show("number") && <TableHead>Số HĐ</TableHead>}
                  <TableHead>Khách hàng</TableHead>
                  {show("amount") && <TableHead className="text-right">Tổng tiền</TableHead>}
                  {show("date") && <TableHead>Ngày</TableHead>}
                  {show("status") && <TableHead>Trạng thái</TableHead>}
                  {show("misa") && <TableHead>MISA</TableHead>}
                  {show("lookup") && <TableHead>Tra cứu</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((inv) => {
                  const misa = inv.misa_status ? MISA_BADGE[inv.misa_status] : null
                  return (
                    <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/invoices/${inv.id}`)}>
                      {show("number") && (
                        <TableCell className="font-mono text-sm font-medium">
                          {inv.invoice_number || <span className="font-sans text-xs text-muted-foreground">chưa cấp số</span>}
                        </TableCell>
                      )}
                      <TableCell className="font-medium">{inv.customer_name}</TableCell>
                      {show("amount") && (
                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(inv.total)}</TableCell>
                      )}
                      {show("date") && (
                        <TableCell className="text-muted-foreground">{inv.issued_at ? formatDate(inv.issued_at) : inv.created_at ? formatDate(inv.created_at) : "-"}</TableCell>
                      )}
                      {show("status") && (
                        <TableCell>
                          <Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge>
                        </TableCell>
                      )}
                      {show("misa") && (
                        <TableCell>
                          {misa ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge variant={misa.variant}>{misa.label}</Badge>
                              {inv.misa_status === "error" && (
                                <span
                                  className="max-w-[220px] truncate text-[11px] text-destructive"
                                  title={inv.misa_error || undefined}
                                >
                                  {inv.misa_error || "Không rõ lý do — xem log MISA"}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      )}
                      {show("lookup") && (
                        <TableCell>
                          {(inv.misa_ref_id || inv.misa_lookup_code) ? (
                            <div className="flex flex-col gap-0.5">
                              <a
                                href={buildMisaInvoiceUrl(inv.misa_ref_id || inv.misa_lookup_code, misaCompanyId) || MISA_LIST_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-primary hover:underline text-xs flex items-center gap-1 font-medium"
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
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
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
            {filtered.map((inv) => {
              const misa = inv.misa_status ? MISA_BADGE[inv.misa_status] : null
              return (
                <div
                  key={inv.id}
                  className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold text-primary">
                          {inv.invoice_number || <span className="font-sans text-xs text-muted-foreground">chưa cấp số</span>}
                        </p>
                        <h3 className="font-extrabold text-base leading-tight truncate mt-0.5">
                          {inv.customer_name}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {inv.issued_at ? formatDate(inv.issued_at) : inv.created_at ? formatDate(inv.created_at) : "-"}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge variant={statusVariant(inv.status)}>{statusLabel(inv.status)}</Badge>
                        {misa && <Badge variant={misa.variant}>{misa.label}</Badge>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t">
                      <span className="text-xs text-muted-foreground">Tổng tiền</span>
                      <span className="font-bold text-base">{formatCurrency(inv.total)}</span>
                    </div>
                    {(inv.misa_ref_id || inv.misa_lookup_code) && (
                      <div className="flex items-center gap-3 mt-2">
                        <a
                          href={buildMisaInvoiceUrl(inv.misa_ref_id || inv.misa_lookup_code, misaCompanyId) || MISA_LIST_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-primary hover:underline text-xs flex items-center gap-1 font-medium"
                        >
                          Mở MISA <ExternalLink className="h-3 w-3" />
                        </a>
                        {inv.misa_invoice_url && (
                          <a
                            href={inv.misa_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[11px] text-muted-foreground hover:underline"
                          >
                            Tra cứu công khai
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <DataPagination pg={pg} shownCount={filtered.length} />
        </>
      )}
    </div>
  )
}
