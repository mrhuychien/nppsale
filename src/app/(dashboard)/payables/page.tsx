"use client"

import { useEffect, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { PageHeader } from "@/components/ui/page-header"
import {
  PAYABLE_COLUMNS,
  DEFAULT_PAYABLE_COLUMNS,
  type PayableColumnKey,
} from "./list-config"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate, getAgingStatus, daysOverdueOf, agingLabel } from "@/lib/utils"
import { MATCH_CAP } from "@/lib/search/list-search"
import { useListSearch } from "@/hooks/use-list-search"
import { Factory, Plus, Search } from "lucide-react"
import Link from "next/link"
import type { Payable, PayableStatus } from "@/types"

type StatusFilter = "all" | "open" | "partial" | "overdue" | "paid"

const PAYABLE_STATUS_MAP: Record<PayableStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" }> = {
  open: { label: "Chưa trả", variant: "secondary" },
  partial: { label: "Trả một phần", variant: "warning" },
  paid: { label: "Đã trả đủ", variant: "success" },
  overdue: { label: "Quá hạn", variant: "danger" },
}

export default function PayablesPage() {
  const { user, loading: authLoading } = useRoleGuard("receivables")
  const [payables, setPayables] = useState<Payable[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Lỗi / chạm trần của phép đọc cho bốn ô tổng đầu trang. */
  const [statsError, setStatsError] = useState<string | null>(null)
  const [statsTruncated, setStatsTruncated] = useState(false)
  const [allOpen, setAllOpen] = useState<Array<Pick<Payable, "amount" | "paid" | "due_date" | "supplier_id" | "status">>>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("payables", DEFAULT_PAYABLE_COLUMNS, [], PAYABLE_COLUMNS, [])
  const show = (k: PayableColumnKey) => visibleColumns.includes(k)

  // Stats: load all UNPAID light fields cho aging summary.
  useEffect(() => {
    async function loadOpen() {
      /**
       * ⚠ ĐỌC ĐỦ MỌI TRANG. Bản cũ đọc trơn: quá 1.000 khoản chưa trả là
       *   PostgREST cắt im lặng, bốn ô tổng THIẾU; đọc hỏng thì `[]` → cả
       *   bốn ô hiện 0 như "không nợ NCC nào". Nay lỗi / chạm trần đều hiện.
       * ⚠ Không có RPC nào chia sẵn "trong hạn / quá hạn" theo `due_date`
       *   (`payables_summary` chỉ trả tổng) nên vẫn phải cộng ở đây.
       */
      const res = await fetchAllForAggregate<Pick<Payable, "amount" | "paid" | "due_date" | "supplier_id" | "status">>(
        (from, to) =>
          supabase
            .from("payables")
            .select("amount, paid, due_date, supplier_id, status", { count: "exact" })
            .neq("status", "paid")
            .order("id")
            .range(from, to)
      )
      setStatsError(res.error)
      setStatsTruncated(res.truncated)
      setAllOpen(res.rows)
    }
    loadOpen()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ TÊN NCC PHẢI TRA RIÊNG: PostgREST không cho `or` bắc qua bảng
   *   nhúng. Phần nối dây ở `useListSearch`.
   */
  const listSearch = useListSearch(
    supabase, debouncedSearch, user?.org_id, ["invoice_number"],
    [{ column: "supplier_id", table: "suppliers", columns: ["name", "code"] }]
  )

  // Paginated table query.
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      setLoading(true)
      /* ⚠ CHỜ LƯỢT TRA MÃ NCC — xem `useListSearch`. */
      if (!listSearch.ready) return
      // selectResilient: DB thiếu cột thì tự thử lại với '*', và luôn trả error
      // để hiển thị nguyên nhân thay vì danh sách rỗng im lặng.
      const build = (select: string) => {
        let q = supabase
          .from("payables")
          .select(select, { count: "exact" })
          .order("due_date")
          // ⚠ Mốc phụ `id`: cả chục khoản cùng hạn, thiếu mốc duy nhất
          //   là một dòng hiện ở hai trang, dòng khác không trang nào.
          .order("id")
          .range(pg.from, pg.to)
        /**
         * ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM (chủ nhà báo 21/09/2026).
         *   Bản cũ chỉ `ilike("invoice_number")` trên máy chủ rồi lọc
         *   thêm theo TÊN NCC ở trình duyệt — gõ tên NCC là chỉ tìm
         *   trong 50 dòng đang hiện, còn `pg.setTotal(count)` vẫn ghi
         *   tổng của phép đếm chưa lọc.
         */
        if (listSearch.filter) q = q.or(listSearch.filter)
        if (statusFilter !== "all") q = q.eq("status", statusFilter)
        return q
      }
      const res = await selectResilient<Payable>(
        build,
        "id, invoice_number, amount, paid, due_date, status, supplier:suppliers(name, code)",
        // eslint-disable-next-line no-restricted-syntax
        "*, supplier:suppliers(name, code)"
      )
      if (cancelled) return
      setPayables(res.data)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)
      setLoading(false)
    }
    fetchData()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, listSearch, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT. Máy chủ đã lọc cả số hoá đơn lẫn
   * NCC (xem `listSearch`). Chú thích cũ nói "cross-table join filter
   * không trực tiếp được trên server-side với Supabase" — đúng một
   * nửa: `or` không bắc qua bảng nhúng được, nhưng tra mã NCC trước
   * rồi lọc `supplier_id.in.(…)` thì được.
   */
  const filtered = payables

  if (authLoading) return <Skeleton className="h-96" />

  /**
   * ⚠ KẸP VỀ 0 TỪNG DÒNG. Một khoản trả dư (`paid > amount`) mà chưa kịp
   *   sang `paid` thì hiệu âm TRỪ THẲNG vào nợ của khoản khác — tổng nhỏ
   *   hơn thật, không lỗi nào bắn ra. Cùng quy tắc với `payables_summary`
   *   (`GREATEST(0, amount - paid)`).
   */
  const conNo = (p: { amount: number; paid: number }) => Math.max(0, Number(p.amount) - Number(p.paid))
  const totalOutstanding = allOpen.reduce((sum, p) => sum + conNo(p), 0)
  const totalInTerm = allOpen
    .filter((p) => !p.due_date || getAgingStatus(p.due_date) === "current")
    .reduce((sum, p) => sum + conNo(p), 0)
  const totalOverdue = allOpen
    .filter((p) => p.due_date && getAgingStatus(p.due_date) !== "current")
    .reduce((sum, p) => sum + conNo(p), 0)
  const suppliersWithDebt = new Set(allOpen.map((p) => p.supplier_id)).size

  const agingVariant = (status: string): "success" | "warning" | "danger" | "default" => {
    switch (status) {
      case "current": return "success"
      case "warning": return "warning"
      case "overdue": return "danger"
      case "critical": return "danger"
      default: return "default"
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Công nợ nhà cung cấp" description={`Tổng phải trả: ${formatCurrency(totalOutstanding)}`}>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/payables/by-supplier">Theo NCC</Link>
          </Button>
          <Button asChild className="bg-primary text-on-primary shadow-card">
            <Link href="/payables/new"><Plus className="mr-2 h-4 w-4" />Tạo công nợ NCC</Link>
          </Button>
        </div>
      </PageHeader>

      {/*
        ⚠ TRA MÃ CHẠM TRẦN THÌ NÓI RA. Kết quả đang THIẾU và trông y hệt
          lúc đủ — đúng cái lỗi "chỉ tìm trang 1" vừa sửa, chỉ đổi chỗ.
      */}
      {listSearch.truncated && !loading && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/60 px-4 py-3 text-sm text-[#7a4b00]">
          <p className="font-semibold">Kết quả tìm đang thiếu</p>
          <p className="mt-0.5">
            Có hơn {MATCH_CAP} nhà cung cấp khớp &ldquo;{debouncedSearch}&rdquo; — danh sách dưới
            chưa đủ. Gõ thêm cho hẹp lại.
          </p>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tổng phải trả</p>
            <p className="text-xl font-black mt-1">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Trong hạn</p>
            <p className="text-xl font-black mt-1 text-tertiary">{formatCurrency(totalInTerm)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Quá hạn</p>
            <p className="text-xl font-black mt-1 text-destructive">{formatCurrency(totalOverdue)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Số NCC đang nợ</p>
            <p className="text-xl font-black mt-1">{suppliersWithDebt}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filter */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Tìm theo NCC, mã hóa đơn..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {(["all", "open", "partial", "overdue", "paid"] as StatusFilter[]).map((f) => {
                const labels: Record<StatusFilter, string> = {
                  all: "Tất cả",
                  open: "Chưa trả",
                  partial: "Trả 1 phần",
                  overdue: "Quá hạn",
                  paid: "Đã trả",
                }
                return (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      statusFilter === f
                        ? "bg-primary text-on-primary"
                        : "bg-surface-low text-muted-foreground hover:bg-surface-container"
                    }`}
                  >
                    {labels[f]}
                  </button>
                )
              })}
            </div>
            <ColumnPicker
              available={PAYABLE_COLUMNS}
              value={visibleColumns}
              onChange={setColumns}
              onReset={resetColumns}
            />
          </div>
        </CardContent>
      </Card>

      {/* Bốn ô tổng đọc hỏng / thiếu — nói ra, không để 0 trông như "không nợ". */}
      {statsError && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tính được tổng công nợ nhà cung cấp</p>
          <p className="mt-0.5 break-words">{statsError}</p>
        </div>
      )}
      {statsTruncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Số tổng chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách công nợ nhà cung cấp</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <Skeleton className="h-96" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Factory className="h-8 w-8 text-muted-foreground" />}
          title={loadError ? "Không tải được dữ liệu" : "Chưa có công nợ NCC"}
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : search || statusFilter !== "all"
                ? "Thử thay đổi bộ lọc"
                : payables.length === 0 &&
                    (user?.role === "sales" || user?.role === "driver" || user?.role === "warehouse")
                  ? "Vai trò của bạn không có quyền xem công nợ nhà cung cấp (giá vốn nhập). Đây là dữ liệu tài chính chỉ dành cho Chủ, Quản lý và Kế toán — liên hệ kế toán nếu cần đối chiếu."
                  : "Tạo công nợ nhà cung cấp đầu tiên"
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden lg:block">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nhà cung cấp</TableHead>
                      {show("invoiceNumber") && <TableHead>Mã HĐ</TableHead>}
                      {show("amount") && <TableHead className="text-right">Số tiền</TableHead>}
                      {show("paid") && <TableHead className="text-right">Đã trả</TableHead>}
                      {show("remaining") && <TableHead className="text-right">Còn lại</TableHead>}
                      {show("dueDate") && <TableHead>Hạn trả</TableHead>}
                      {show("aging") && <TableHead>Tuổi nợ</TableHead>}
                      {show("status") && <TableHead>Trạng thái</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const remaining = p.amount - p.paid
                      const aging = p.due_date ? getAgingStatus(p.due_date) : "current"
                      const daysOverdue = daysOverdueOf(p.due_date)
                      const statusCfg = PAYABLE_STATUS_MAP[p.status as PayableStatus] || { label: p.status, variant: "default" as const }
                      return (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer"
                          onClick={() => router.push(`/payables/${p.id}`)}
                        >
                          <TableCell className="font-medium">{p.supplier?.name || "-"}</TableCell>
                          {show("invoiceNumber") && <TableCell className="font-mono text-xs">{p.invoice_number || "-"}</TableCell>}
                          {show("amount") && <TableCell className="text-right tabular-nums">{formatCurrency(p.amount)}</TableCell>}
                          {show("paid") && <TableCell className="text-right tabular-nums">{formatCurrency(p.paid)}</TableCell>}
                          {show("remaining") && <TableCell className="text-right font-bold tabular-nums">{formatCurrency(remaining)}</TableCell>}
                          {show("dueDate") && <TableCell>{p.due_date ? formatDate(p.due_date) : "-"}</TableCell>}
                          {show("aging") && (
                            <TableCell>
                              {p.status !== "paid" && p.due_date ? (
                                <Badge variant={agingVariant(aging)}>{agingLabel(daysOverdue)}</Badge>
                              ) : (
                                "-"
                              )}
                            </TableCell>
                          )}
                          {show("status") && (
                            <TableCell>
                              <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                            </TableCell>
                          )}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {filtered.map((p) => {
              const remaining = p.amount - p.paid
              const aging = p.due_date ? getAgingStatus(p.due_date) : "current"
              const daysOverdue = daysOverdueOf(p.due_date)
              const statusCfg = PAYABLE_STATUS_MAP[p.status as PayableStatus] || { label: p.status, variant: "default" as const }
              return (
                <div
                  key={p.id}
                  className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                  onClick={() => router.push(`/payables/${p.id}`)}
                >
                  <div className="p-4">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-base leading-tight truncate">
                          {p.supplier?.name || "-"}
                        </h3>
                        {p.invoice_number && (
                          <p className="font-mono text-xs text-muted-foreground mt-0.5 truncate">
                            HĐ: {p.invoice_number}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Hạn: {p.due_date ? formatDate(p.due_date) : "-"}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
                        {p.status !== "paid" && p.due_date && (
                          <Badge variant={agingVariant(aging)}>{agingLabel(daysOverdue)}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 pt-2 mt-2 border-t text-xs">
                      <div>
                        <p className="text-muted-foreground">Số tiền</p>
                        <p className="font-medium">{formatCurrency(p.amount)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Đã trả</p>
                        <p className="font-medium">{formatCurrency(p.paid)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Còn lại</p>
                        <p className="font-bold text-destructive">{formatCurrency(remaining)}</p>
                      </div>
                    </div>
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
