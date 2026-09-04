"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { SegmentedScroller } from "@/components/ui/segmented-scroller"
import { MobileRecordCard } from "@/components/ui/mobile-record-card"
import { LoadMore } from "@/components/ui/load-more"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { PageHeader } from "@/components/ui/page-header"
import {
  RECEIVABLE_COLUMNS,
  DEFAULT_RECEIVABLE_COLUMNS,
  type ReceivableColumnKey,
} from "./list-config"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate, getAgingStatus, VN_TZ } from "@/lib/utils"
import {
  HandCoins, CreditCard, Eye, FileText } from "lucide-react"
import Link from "next/link"
import type { Receivable } from "@/types"

type BucketKey = "current" | "warning" | "overdue" | "critical"

/** Một dòng trả về của hàm SQL `receivables_summary()` (migration 093). */
type AgingSummary = {
  total_outstanding: number
  current_amount: number
  current_count: number
  warning_amount: number
  warning_count: number
  overdue_amount: number
  overdue_count: number
  critical_amount: number
  critical_count: number
}

export default function ReceivablesPage() {
  const { loading: authLoading } = useRoleGuard("receivables")
  const { user: authUser } = useAuth()
  const isSales = authUser?.role === "sales"
  const isDriver = authUser?.role === "driver"
  const isWarehouse = authUser?.role === "warehouse"
  // Lọc theo khoảng tuổi nợ — chỉ dùng ở bản mobile (chip dưới thanh).
  const [agingFilter, setAgingFilter] = useState<string | null>(null)
  const [receivables, setReceivables] = useState<Receivable[]>([])
  // Tổng + phân nhóm tuổi nợ do DATABASE cộng (migration 093), không tải
  // dữ liệu về trình duyệt nữa.
  const [summary, setSummary] = useState<AgingSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const pg = usePagination(50)
  const supabase = createClient()
  const router = useRouter()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("receivables", DEFAULT_RECEIVABLE_COLUMNS, [])
  const show = (k: ReceivableColumnKey) => visibleColumns.includes(k)

  // Tổng công nợ + phân nhóm tuổi nợ: một lời gọi, Postgres cộng trên TOÀN
  // BỘ dữ liệu. Không phụ thuộc phân trang, không phụ thuộc `db.max_rows`.
  useEffect(() => {
    async function loadSummary() {
      const { data, error } = await supabase.rpc("receivables_summary").maybeSingle()
      if (error) console.error("[app/receivables] receivables_summary lỗi:", error.message)
      setSummary((data as AgingSummary | null) ?? null)
    }
    loadSummary()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Paginated table query (gồm join customer + sales_user).
  useEffect(() => {
    let cancelled = false
    async function fetch() {
      setLoading(true)
      // selectResilient: DB thiếu cột → tự thử lại với '*' thay vì rỗng im lặng; luôn trả error.
      const build = (select: string) =>
        supabase
          .from("receivables")
          .select(select, { count: "exact" })
          .order("due_date")
          .range(pg.from, pg.to)
      const res = await selectResilient<Receivable>(
        build,
        "id, amount, paid, due_date, status, customer:customers(store_name), sales_user:users!receivables_sales_user_id_fkey(full_name)",
        // eslint-disable-next-line no-restricted-syntax
        "*, customer:customers(store_name), sales_user:users!receivables_sales_user_id_fkey(full_name)"
      )
      // Huỷ request khi điều hướng nhanh — không phải lỗi.
      if (cancelled || res.aborted) return
      setReceivables(res.data)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)
      setLoading(false)
    }
    fetch()
    return () => { cancelled = true }
  }, [pg.from, pg.to]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const totalOutstanding = Number(summary?.total_outstanding ?? 0)
  const agingVariant = (status: string): "success" | "warning" | "danger" | "default" => {
    switch (status) { case "current": return "success"; case "warning": return "warning"; case "overdue": return "danger"; case "critical": return "danger"; default: return "default" }
  }
  // Ngưỡng chia nhóm nằm trong hàm SQL `receivables_summary` và PHẢI khớp
  // với getAgingStatus() ở src/lib/utils.ts — sửa một bên nhớ sửa bên kia.
  const buckets: Record<BucketKey, { amount: number; count: number }> = {
    current: { amount: Number(summary?.current_amount ?? 0), count: Number(summary?.current_count ?? 0) },
    warning: { amount: Number(summary?.warning_amount ?? 0), count: Number(summary?.warning_count ?? 0) },
    overdue: { amount: Number(summary?.overdue_amount ?? 0), count: Number(summary?.overdue_count ?? 0) },
    critical: { amount: Number(summary?.critical_amount ?? 0), count: Number(summary?.critical_count ?? 0) },
  }

  const bucketConfig: Record<BucketKey, { label: string; sub: string; barClass: string; textClass: string }> = {
    current: { label: "Hiện tại", sub: "0-30 ngày", barClass: "bg-primary", textClass: "text-primary" },
    warning: { label: "Cảnh báo", sub: "31-60 ngày", barClass: "bg-[#fdb022]", textClass: "text-[#b54708]" },
    overdue: { label: "Quá hạn", sub: "61-90 ngày", barClass: "bg-[#f97316]", textClass: "text-[#c2410c]" },
    critical: { label: "Khẩn cấp", sub: ">90 ngày", barClass: "bg-error", textClass: "text-error" },
  }

  // Tổng bốn khoảng — mẫu số của thanh xếp chồng. 0 thì không chia.
  // Chip tuổi nợ chỉ lọc DANH SÁCH MOBILE — desktop có cột và bộ lọc
  // riêng, đổi chung sẽ làm hai bên hiểu khác nhau về "đang lọc gì".
  const mobileReceivables = agingFilter
    ? receivables.filter((r) => (r.due_date ? getAgingStatus(r.due_date) : "current") === agingFilter)
    : receivables

  /**
   * Số ngày quá hạn. Dùng VN_TZ cho cả hai vế — so ngày bằng giờ máy
   * chủ (UTC) thì suốt 7 tiếng đầu mỗi ngày kết quả lệch một ngày.
   */
  const daysOverdue = (due: string) => {
    const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: VN_TZ }))
    const d = new Date(due.slice(0, 10))
    return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86400000))
  }

  const totalAging =
    buckets.current.amount + buckets.warning.amount + buckets.overdue.amount + buckets.critical.amount

  const maxAmount = Math.max(
    buckets.current.amount,
    buckets.warning.amount,
    buckets.overdue.amount,
    buckets.critical.amount,
    1
  )

  const handleExportStatement = () => {
    if (typeof window !== "undefined") window.print()
  }

  return (
    <div className="space-y-4">
      <PageHeader title={isSales ? "Công nợ của tôi" : "Công nợ"} description={`Tổng công nợ: ${formatCurrency(totalOutstanding)}`}>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/receivables/aging">Sổ chi tiết</Link></Button>
          <Button variant="outline" asChild><Link href="/receivables/collect">Thu tiền</Link></Button>
        </div>
      </PageHeader>

      {(isSales || isDriver) && (
        <div className="rounded-lg bg-primary-fixed border border-primary-fixed-dim p-3 text-sm text-on-primary-fixed-variant flex items-center gap-2">
          <span className="inline-flex h-5 w-5 rounded-full bg-primary text-on-primary items-center justify-center text-xs font-bold shrink-0">i</span>
          {isSales
            ? "Bạn chỉ thấy công nợ từ các đơn do bạn tạo."
            : "Bạn thấy công nợ thuộc các đơn giao của bạn (COD)."}
        </div>
      )}

      {/* Aging Chart */}
      <Card>
        <CardContent className="p-4 lg:p-6">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h3 className="text-lg font-bold">Biểu đồ tuổi nợ</h3>
              <p className="text-xs text-muted-foreground">Phân bổ công nợ theo số ngày quá hạn</p>
            </div>
            <span className="text-xs text-muted-foreground">
              Cập nhật: {formatDate(new Date())}
            </span>
          </div>
          {/* Mobile: MỘT thanh xếp chồng ngang thay cho lưới 2 cột bốn ô
              (mỗi ô cao 200px, chữ "Hiện tại 0-30 NGÀY" xuống dòng gãy).
              Tiết kiệm ~180px và đọc nhanh hơn: tỉ lệ giữa bốn khoảng nhìn
              thấy ngay trong một thanh. ĐÚNG BỐN khoảng theo bucketConfig —
              dữ liệu tổng hợp phía DB chỉ có bốn, đừng phát minh khoảng
              thứ năm. */}
          <div className="lg:hidden">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-container">
              {(Object.keys(bucketConfig) as BucketKey[]).map((key) => {
                const cfg = bucketConfig[key]
                const pct = totalAging > 0 ? (buckets[key].amount / totalAging) * 100 : 0
                if (pct <= 0) return null
                return (
                  <div
                    key={key}
                    className={cfg.barClass}
                    style={{ width: `${pct}%` }}
                    title={`${cfg.label}: ${formatCurrency(buckets[key].amount)}`}
                  />
                )
              })}
            </div>
            <SegmentedScroller
              segments={(Object.keys(bucketConfig) as BucketKey[]).map((key) => ({
                key,
                label: bucketConfig[key].label,
                count: buckets[key].count,
              }))}
              value={agingFilter}
              onChange={setAgingFilter}
              ariaLabel="Lọc theo tuổi nợ"
            />
            {agingFilter && (
              <p className="px-1 text-xs text-on-surface-variant">
                {bucketConfig[agingFilter as BucketKey].sub} ·{" "}
                <span className="font-semibold tabular-nums">
                  {formatCurrency(buckets[agingFilter as BucketKey].amount)}
                </span>
              </p>
            )}
          </div>

          <div className="hidden lg:grid grid-cols-2 gap-4 md:grid-cols-4">
            {(Object.keys(bucketConfig) as BucketKey[]).map((key) => {
              const cfg = bucketConfig[key]
              const b = buckets[key]
              const heightPct = Math.max(4, Math.round((b.amount / maxAmount) * 100))
              return (
                <div
                  key={key}
                  className="flex flex-col rounded-lg border bg-card p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-bold">{cfg.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {cfg.sub}
                    </span>
                  </div>
                  <div className={`mt-2 text-xl font-bold ${cfg.textClass}`}>
                    {formatCurrency(b.amount)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {b.count} khoản nợ
                  </div>
                  <div className="mt-3 flex h-28 items-end">
                    <div className="h-full w-full rounded bg-muted/40 relative overflow-hidden">
                      <div
                        className={`absolute bottom-0 left-0 right-0 ${cfg.barClass} transition-all`}
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="hidden lg:flex justify-end">
        <ColumnPicker
          available={RECEIVABLE_COLUMNS}
          value={visibleColumns}
          onChange={setColumns}
          onReset={resetColumns}
        />
      </div>

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách công nợ</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-96" />
      ) : receivables.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-8 w-8 text-muted-foreground" />}
          title={loadError ? "Không tải được dữ liệu" : "Chưa có công nợ"}
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : isWarehouse
                ? "Vai trò Kho không có quyền xem công nợ phải thu. Liên hệ kế toán để đối chiếu."
                : isSales
                  ? "Bạn chỉ thấy công nợ của đơn ghi tên bạn. Công nợ từ đơn nhập liệu cũ (chưa gắn NV phụ trách) sẽ không hiển thị — nhờ kế toán gán lại NV phụ trách."
                  : isDriver
                    ? "Bạn chỉ thấy công nợ thuộc các đơn trong chuyến giao của bạn (COD). Chưa có chuyến nào được gán thì danh sách sẽ trống."
                    : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Khách hàng</TableHead>
                  {show("salesUser") && <TableHead>NV phụ trách</TableHead>}
                  {show("amount") && <TableHead className="text-right">Phải thu</TableHead>}
                  {show("paid") && <TableHead className="text-right">Đã thu</TableHead>}
                  {show("remaining") && <TableHead className="text-right">Còn lại</TableHead>}
                  {show("dueDate") && <TableHead>Hạn</TableHead>}
                  {show("status") && <TableHead>Trạng thái</TableHead>}
                  {show("action") && <TableHead className="text-right">Thao tác</TableHead>}
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivables.map((r) => {
                  const remaining = r.amount - r.paid
                  const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/receivables/${r.id}`)}
                    >
                      <TableCell className="font-medium">{r.customer?.store_name || "-"}</TableCell>
                      {show("salesUser") && <TableCell>{r.sales_user?.full_name || "-"}</TableCell>}
                      {show("amount") && <TableCell className="text-right tabular-nums">{formatCurrency(r.amount)}</TableCell>}
                      {show("paid") && <TableCell className="text-right tabular-nums">{formatCurrency(r.paid)}</TableCell>}
                      {show("remaining") && <TableCell className="text-right font-medium tabular-nums">{formatCurrency(remaining)}</TableCell>}
                      {show("dueDate") && <TableCell>{r.due_date ? formatDate(r.due_date) : "-"}</TableCell>}
                      {show("status") && <TableCell><Badge variant={agingVariant(aging)}>{r.status}</Badge></TableCell>}
                      {show("action") && (
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleExportStatement()}
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            Xuất bản kê
                          </Button>
                        </TableCell>
                      )}
                      <TableCell>
                        <Eye className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile card list */}
          <div className="lg:hidden space-y-3">
            {mobileReceivables.map((r) => {
              const remaining = r.amount - r.paid
              const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
              const overdueDays = r.due_date ? daysOverdue(r.due_date) : 0
              return (
                <MobileRecordCard
                  key={r.id}
                  href={`/receivables/${r.id}`}
                  title={r.customer?.store_name || "-"}
                  // Số CÒN NỢ là con số cần thấy, không phải số phải thu
                  // ban đầu — nó quyết định có đi thu hay không.
                  amount={formatCurrency(remaining)}
                  amountTone="danger"
                  accent={aging === "critical" ? "danger" : aging === "overdue" ? "warning" : null}
                  subtitle={
                    <>
                      {overdueDays > 0 ? (
                        <span className="font-semibold text-error">Quá hạn {overdueDays} ngày</span>
                      ) : (
                        <span>Hạn {r.due_date ? formatDate(r.due_date) : "-"}</span>
                      )}
                      <span>· Đã thu {formatCurrency(r.paid)}</span>
                      {r.sales_user?.full_name && <span>· {r.sales_user.full_name}</span>}
                    </>
                  }
                  badges={<Badge variant={agingVariant(aging)}>{r.status}</Badge>}
                  footer={
                    // "Xuất bản kê" chuyển vào màn chi tiết — trong thẻ
                    // danh sách nó chiếm chỗ của việc NVBH thật sự tới đây
                    // để làm: đi thu tiền.
                    <Button className="h-11 w-full" asChild>
                      <Link href={`/receivables/collect?receivableId=${r.id}`}>
                        <HandCoins className="mr-1.5 h-4 w-4" /> Thu tiền
                      </Link>
                    </Button>
                  }
                />
              )
            })}
            <LoadMore pg={pg} shown={receivables.length} />
          </div>
          <div className="hidden lg:block">
            <DataPagination pg={pg} shownCount={receivables.length} />
          </div>
        </>
      )}
    </div>
  )
}
