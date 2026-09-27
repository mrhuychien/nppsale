"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { selectResilient, type ResilientResult } from "@/lib/supabase/resilient"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { errorMessage } from "@/lib/errors"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePagination } from "@/hooks/use-pagination"
import { DocListLayout } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { SegmentedScroller } from "@/components/ui/segmented-scroller"
import { MobileRecordCard } from "@/components/ui/mobile-record-card"
import { LoadMore } from "@/components/ui/load-more"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_CONG_NO_PHAI_THU } from "@/lib/search/list-filter-fields"
import { PageHeader } from "@/components/ui/page-header"
import {
  RECEIVABLE_COLUMNS,
  DEFAULT_RECEIVABLE_COLUMNS,
  type ReceivableColumnKey,
} from "./list-config"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import {
  formatCurrency, formatDate, getAgingStatus, daysOverdueOf, AGING_RANGE,
} from "@/lib/utils"
import {
  HandCoins, CreditCard, FileText } from "lucide-react"
import Link from "@/components/ui/link"
import type { Receivable } from "@/types"
import {
  remainingOf, creditOf,
  receivableStateLabel as rowStateLabel,
  receivableStateVariant as rowStateVariant,
} from "@/lib/receivables/credit"

type BucketKey = "current" | "warning" | "overdue" | "critical"

/**
 * Nhãn của một khoản nợ = MÃ HÓA ĐƠN (CLAUDE.md, chủ nhà 24/09/2026: công nợ theo hóa đơn).
 * Không có hóa đơn: nợ đầu kỳ, hoặc dư có của phiếu trả tự lập (mig 191).
 */
function nhanKhoanNo(r: Receivable): string {
  if (r.invoice?.invoice_code) return r.invoice.invoice_code
  if (r.opening_balance) return "Nợ đầu kỳ"
  if ((r as Receivable & { return_id?: string | null }).return_id) return "Phiếu trả (dư có)"
  return "—"
}

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
  // ⚠ Lỗi RIÊNG của phần tổng, tách khỏi `loadError` (lỗi danh sách): hai
  // lượt đọc độc lập, gộp chung thì lượt này xoá lỗi của lượt kia.
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Vị trí lần tải trước — để "Tải thêm" không vẽ lại 20 dòng đầu (tải hai nhịp, 26/09/2026). */
  const khoaTaiRef = useRef<KhoaTai>(null)
  const pg = usePagination()
  const supabase = createClient()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("receivables", DEFAULT_RECEIVABLE_COLUMNS, [], RECEIVABLE_COLUMNS, [])
  /** Khoản nợ đang mở ở ngăn xem nhanh (khuôn danh sách chung, 27/09/2026). */
  const [xemId, setXemId] = useState<string | null>(null)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("receivables", LOC_CONG_NO_PHAI_THU)

  // Tổng công nợ + phân nhóm tuổi nợ: một lời gọi, Postgres cộng trên TOÀN
  // BỘ dữ liệu. Không phụ thuộc phân trang, không phụ thuộc `db.max_rows`.
  useEffect(() => {
    async function loadSummary() {
      const { data, error } = await supabase.rpc("receivables_summary").maybeSingle()
      /* ⚠ LỖI THÌ NÓI RA, KHÔNG VẼ 0đ. Bản cũ chỉ `console.error` rồi để
         `summary` null — tiêu đề ghi "Tổng công nợ: 0 ₫" và bốn ô tuổi nợ
         đều 0, trông y hệt một sổ sạch nợ. Máy chủ chưa chạy migration 093
         (PGRST202) cũng rơi đúng vào đây. */
      if (error) {
        console.error("[app/receivables] receivables_summary lỗi:", error.message)
        setSummary(null)
        setSummaryError(errorMessage(error, "Không tải được tổng công nợ"))
        return
      }
      setSummaryError(null)
      setSummary((data as AgingSummary | null) ?? null)
    }
    loadSummary()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi bộ lọc nâng cao đổi.
  useEffect(() => {
    pg.reset()
  }, [locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // Paginated table query (gồm join customer + sales_user).
  useEffect(() => {
    if (!locNC.ready) return
    let cancelled = false
    async function fetch() {
      // Tải thêm / đổi sang trang dài hơn: giữ danh sách đang hiện trong lúc chờ.
      if (!laTaiThem(khoaTaiRef, pg.from, pg.to, false)) setLoading(true)
      // selectResilient: DB thiếu cột → tự thử lại với '*' thay vì rỗng im lặng; luôn trả error.
      const build = (select: string, from = pg.from, to = pg.to, dem = true) => {
        let q = supabase
          .from("receivables")
          .select(select, dem ? { count: "exact" } : undefined)
          // Hạn cũ nhất TRƯỚC = quá hạn nhiều ngày nhất trước. NVBH đi
          // thu cần biết khoản nào gấp nhất, không phải khoản nào mới tạo.
          // nullsFirst: false để khoản KHÔNG đặt hạn xuống cuối — không có
          // hạn thì không thể là khoản gấp nhất.
          .order("due_date", { ascending: true, nullsFirst: false })
          // ⚠ Mốc phụ `id`: nhiều khoản cùng một hạn — thiếu nó thì ranh
          // giới trang do máy chủ tự quyết, khoản nợ lặp / sót giữa hai trang.
          .order("id")
          .range(from, to)
        for (const f of locNC.menhDe) q = q.or(f)
        return q
      }
      const res = await taiHaiNhip<Receivable, ResilientResult<Receivable>>(
        (from, to, dem) => selectResilient<Receivable>((sel) => build(sel, from, to, dem),
        "id, amount, paid, due_date, status, opening_balance, invoice_id, customer:customers(store_name), sales_user:users!receivables_sales_user_id_fkey(full_name), invoice:sales_invoices(id, invoice_code, invoice_date)",
        // eslint-disable-next-line no-restricted-syntax
        "*, customer:customers(store_name), sales_user:users!receivables_sales_user_id_fkey(full_name), invoice:sales_invoices(id, invoice_code, invoice_date)"),
        pg.from,
        pg.to,
        (dau) => {
          if (cancelled) return; setReceivables(dau.data)
          pg.setTotal(dau.count ?? 0)
          setLoading(false)
        },
        { boQuaDau: laTaiThem(khoaTaiRef, pg.from, pg.to) }
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
  }, [pg.from, pg.to, locNC.ready, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => {
    const cols: Array<DocColumn<Receivable> & { k?: ReceivableColumnKey }> = [
      {
        key: "customer", label: "Khách hàng", width: "minmax(200px,1.5fr)",
        sort: (a, b) => (a.customer?.store_name ?? "").localeCompare(b.customer?.store_name ?? "", "vi"),
        render: (r) => <span className="block truncate text-sm font-bold">{r.customer?.store_name || "-"}</span>,
      },
      {
        k: "invoice", key: "invoice", label: "Hóa đơn", width: "150px",
        render: (r) => (r.invoice_id
          ? <DocCodeLink href={`/sales-invoices/${r.invoice_id}`}>{nhanKhoanNo(r)}</DocCodeLink>
          : <span className="text-xs text-on-surface-variant">{nhanKhoanNo(r)}</span>),
      },
      { k: "salesUser", key: "salesUser", label: "NV phụ trách", width: "150px", render: (r) => <DocCellText>{r.sales_user?.full_name}</DocCellText> },
      { k: "amount", key: "amount", label: "Phải thu", width: "130px", align: "right", sort: (a, b) => Number(a.amount) - Number(b.amount), render: (r) => formatCurrency(r.amount) },
      { k: "paid", key: "paid", label: "Đã thu", width: "130px", align: "right", render: (r) => formatCurrency(r.paid) },
      {
        k: "remaining", key: "remaining", label: "Còn lại", width: "150px", align: "right",
        sort: (a, b) => remainingOf(a) - creditOf(a) - (remainingOf(b) - creditOf(b)),
        render: (r) => {
          /* ⚠ KẸP VỀ 0 VÀ GỌI TÊN PHẦN DƯ. Truy vấn của màn này KHÔNG lọc trạng thái, nên
             dòng đã thu dư (Q11) / công nợ âm (mig 186) vẫn nằm đây; `amount - paid` trần trụi
             in ra số ÂM bằng màu đỏ — trông y hệt một khoản nợ khẩn cấp, trong khi sự thật là
             nhà phân phối đang giữ tiền của khách. */
          const remaining = remainingOf(r)
          const credit = creditOf(r)
          return credit > 0 ? <span className="text-tertiary">Dư có {formatCurrency(credit)}</span> : formatCurrency(remaining)
        },
      },
      {
        k: "dueDate", key: "dueDate", label: "Hạn", width: "110px",
        sort: (a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""),
        render: (r) => <DocCellDate date={r.due_date ? formatDate(r.due_date) : "-"} />,
      },
      {
        k: "status", key: "status", label: "Trạng thái", width: "140px",
        /* ⚠ Nhãn + màu cùng một nguồn (`rowStateLabel` / `rowStateVariant`) — không lấy chữ
           từ `r.status` (cột thanh toán do RPC ghi, không ai tính lại mỗi ngày). */
        render: (r) => <Badge variant={rowStateVariant(r)}>{rowStateLabel(r)}</Badge>,
      },
      {
        k: "action", key: "action", label: "Thao tác", width: "140px", align: "right",
        render: () => (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); if (typeof window !== "undefined") window.print() }}
          >
            <FileText className="mr-1 h-3.5 w-3.5" />
            Xuất bản kê
          </Button>
        ),
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns])

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? receivables.find((r) => r.id === xemId) ?? null : null

  const totalOutstanding = Number(summary?.total_outstanding ?? 0)
  // Ngưỡng chia nhóm nằm trong hàm SQL `receivables_summary` và PHẢI khớp
  // với getAgingStatus() ở src/lib/utils.ts — sửa một bên nhớ sửa bên kia.
  const buckets: Record<BucketKey, { amount: number; count: number }> = {
    current: { amount: Number(summary?.current_amount ?? 0), count: Number(summary?.current_count ?? 0) },
    warning: { amount: Number(summary?.warning_amount ?? 0), count: Number(summary?.warning_count ?? 0) },
    overdue: { amount: Number(summary?.overdue_amount ?? 0), count: Number(summary?.overdue_count ?? 0) },
    critical: { amount: Number(summary?.critical_amount ?? 0), count: Number(summary?.critical_count ?? 0) },
  }

  const bucketConfig: Record<BucketKey, { label: string; sub: string; barClass: string; textClass: string }> = {
    /* ⚠ PHỤ ĐỀ LẤY TỪ `AGING_RANGE`, ĐỪNG GÕ TAY. Bản cũ ghi
       "0-30 / 31-60 / 61-90 / >90" — lệch hẳn một bậc so với ngưỡng thật
       (`getAgingStatus`), nên một khoản quá hạn 2 ngày hiện dưới nhãn
       "31-60 NGÀY" và người đọc tưởng khách nợ quá hạn cả tháng. */
    current: { label: "Trong hạn", sub: AGING_RANGE.current, barClass: "bg-primary", textClass: "text-primary" },
    warning: { label: "Cảnh báo", sub: AGING_RANGE.warning, barClass: "bg-[#fdb022]", textClass: "text-[#b54708]" },
    overdue: { label: "Quá hạn", sub: AGING_RANGE.overdue, barClass: "bg-[#f97316]", textClass: "text-[#c2410c]" },
    critical: { label: "Khẩn cấp", sub: AGING_RANGE.critical, barClass: "bg-error", textClass: "text-error" },
  }

  // Tổng bốn khoảng — mẫu số của thanh xếp chồng. 0 thì không chia.
  // Chip tuổi nợ chỉ lọc DANH SÁCH MOBILE — desktop có cột và bộ lọc
  // riêng, đổi chung sẽ làm hai bên hiểu khác nhau về "đang lọc gì".
  const mobileReceivables = agingFilter
    ? receivables.filter((r) => (r.due_date ? getAgingStatus(r.due_date) : "current") === agingFilter)
    : receivables

  const totalAging =
    buckets.current.amount + buckets.warning.amount + buckets.overdue.amount + buckets.critical.amount

  const maxAmount = Math.max(
    buckets.current.amount,
    buckets.warning.amount,
    buckets.overdue.amount,
    buckets.critical.amount,
    1
  )

  return (
    <div className="space-y-4">
      <PageHeader title={isSales ? "Công nợ của tôi" : "Công nợ"} description={summaryError ? "Tổng công nợ: không tải được" : `Tổng công nợ: ${formatCurrency(totalOutstanding)}`}>
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

      {summaryError && (
        <div
          role="alert"
          className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container"
        >
          <p className="font-semibold">Không tải được tổng công nợ và tuổi nợ</p>
          <p className="mt-0.5 break-words">{summaryError}</p>
        </div>
      )}

      {/* Aging Chart — ẩn khi phần tổng đọc hỏng: bốn ô 0đ là số sai. */}
      <Card className={summaryError ? "hidden" : undefined}>
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

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách công nợ</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {/* ⚠ KHUÔN DANH SÁCH CHUNG (chủ nhà 27/09/2026) — một thẻ: thanh công cụ · dòng tổng ·
          lưới · phân trang; bấm dòng mở xem nhanh. Điện thoại giữ thẻ có nút "Thu tiền" +
          "Tải thêm": NVBH mở màn này để đi thu. */}
      <DocListLayout
        toolbar={<span className="text-sm font-bold text-on-surface">Các khoản công nợ</span>}
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_CONG_NO_PHAI_THU} value={locNC.dieuKien} onApply={locNC.apDung} />
            <ColumnPicker
              available={RECEIVABLE_COLUMNS}
              value={visibleColumns}
              onChange={setColumns}
              onReset={resetColumns}
            />
          </>
        }
        totals={{
          label: "Tổng công nợ (toàn sổ)",
          countText: `${pg.total} khoản nợ${locNC.soDangAp ? " khớp bộ lọc" : ""}`,
          total: summaryError ? null : formatCurrency(totalOutstanding),
        }}
        mobileSummary={
          <div className="flex justify-end">
            <AdvancedFilter truong={LOC_CONG_NO_PHAI_THU} value={locNC.dieuKien} onApply={locNC.apDung} />
          </div>
        }
        loading={loading}
        isEmpty={receivables.length === 0}
        empty={
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
        }
        pg={pg}
        shownCount={receivables.length}
        table={<DocTable rows={receivables} columns={columns} activeId={xemId} onOpen={(r) => setXemId(r.id)} />}
        mobilePager={<LoadMore pg={pg} shown={receivables.length} />}
        cards={
          <div className="space-y-3">
            {mobileReceivables.map((r) => {
              const remaining = remainingOf(r)
              const credit = creditOf(r)
              const aging = r.due_date ? getAgingStatus(r.due_date) : "current"
              const overdueDays = daysOverdueOf(r.due_date)
              return (
                <MobileRecordCard
                  key={r.id}
                  href={`/receivables/${r.id}`}
                  title={r.customer?.store_name || "-"}
                  // Số CÒN NỢ là con số cần thấy, không phải số phải thu
                  // ban đầu — nó quyết định có đi thu hay không.
                  amount={credit > 0 ? `+${formatCurrency(credit)}` : formatCurrency(remaining)}
                  /* Dư có KHÔNG phải nợ — tô đỏ là báo động nhầm chiều. */
                  amountTone={credit > 0 ? "success" : "danger"}
                  accent={aging === "critical" ? "danger" : aging === "overdue" ? "warning" : null}
                  subtitle={
                    <>
                      <span className="font-mono">{nhanKhoanNo(r)}</span>
                      {overdueDays > 0 ? (
                        <span className="font-semibold text-error">· Quá hạn {overdueDays} ngày</span>
                      ) : (
                        <span>· Hạn {r.due_date ? formatDate(r.due_date) : "-"}</span>
                      )}
                      <span>· Đã thu {formatCurrency(r.paid)}</span>
                      {r.sales_user?.full_name && <span>· {r.sales_user.full_name}</span>}
                    </>
                  }
                  badges={<Badge variant={rowStateVariant(r)}>{rowStateLabel(r)}</Badge>}
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
          </div>
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem ? nhanKhoanNo(xem) : "Khoản nợ"}
        subtitle={xem?.customer?.store_name || undefined}
        badge={xem ? <Badge variant={rowStateVariant(xem)}>{rowStateLabel(xem)}</Badge> : null}
        fields={xem ? [
          { label: "Khách hàng", value: xem.customer?.store_name, wide: true },
          { label: "NV phụ trách", value: xem.sales_user?.full_name },
          { label: "Hạn", value: xem.due_date ? formatDate(xem.due_date) : null },
          { label: "Phải thu", value: formatCurrency(xem.amount) },
          { label: "Đã thu", value: formatCurrency(xem.paid) },
        ] : []}
        total={xem ? (creditOf(xem) > 0
          ? { label: "Dư có của khách", value: formatCurrency(creditOf(xem)) }
          : { label: "Còn lại", value: formatCurrency(remainingOf(xem)) }) : undefined}
        detailHref={xem ? `/receivables/${xem.id}` : undefined}
        actions={xem && creditOf(xem) <= 0 && remainingOf(xem) > 0 ? (
          <Button variant="outline" className="h-11 flex-1" asChild>
            <Link href={`/receivables/collect?receivableId=${xem.id}`}>
              <HandCoins className="mr-1.5 h-4 w-4" /> Thu tiền
            </Link>
          </Button>
        ) : null}
      />
    </div>
  )
}
