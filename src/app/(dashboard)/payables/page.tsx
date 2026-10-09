"use client"

import { useEffect, useMemo, useState, useRef } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { StatusChips } from "@/components/ui/status-chips"
import { CheDoCongNoNcc } from "@/components/payables/che-do-cong-no-ncc"
import { DocListLayout, DocListSearch, KetQuaThieu, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, type DocColumn } from "@/components/ui/doc-table"
import { apSapXep, xepDuoc, SAP_XEP_CONG_NO_NCC, type DocSort } from "@/lib/list/sap-xep-may-chu"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { createClient } from "@/lib/supabase/client"
import { selectResilient, type ResilientResult } from "@/lib/supabase/resilient"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_CONG_NO_PHAI_TRA } from "@/lib/search/list-filter-fields"
import { PageHeader } from "@/components/ui/page-header"
import {
  PAYABLE_COLUMNS,
  DEFAULT_PAYABLE_COLUMNS,
  type PayableColumnKey,
} from "./list-config"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { formatCurrency, formatDate, getAgingStatus, daysOverdueOf, agingLabel } from "@/lib/utils"
import { useListSearch } from "@/hooks/use-list-search"
import { Factory, Plus } from "lucide-react"
import Link from "@/components/ui/link"
import type { Payable, PayableStatus } from "@/types"
import { docChungTuNoNcc, type ChungTuNo } from "@/lib/payables/so-no-ncc"

type StatusFilter = "all" | "open" | "partial" | "overdue" | "paid"

const PAYABLE_STATUS_MAP: Record<PayableStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "danger" }> = {
  open: { label: "Chưa trả", variant: "secondary" },
  partial: { label: "Trả một phần", variant: "warning" },
  paid: { label: "Đã trả đủ", variant: "success" },
  overdue: { label: "Quá hạn", variant: "danger" },
}

/** Dải trạng thái — cùng `StatusChips` với đơn / hóa đơn (khuôn danh sách chung, 27/09/2026). */
const TABS: Array<{ key: StatusFilter; label: string; accent: string }> = [
  { key: "open", label: "Chưa trả", accent: "#b9c4d6" },
  { key: "partial", label: "Trả 1 phần", accent: "#fdb022" },
  { key: "overdue", label: "Quá hạn", accent: "#ef5350" },
  { key: "paid", label: "Đã trả", accent: "#22c55e" },
  { key: "all", label: "Tất cả", accent: "#181c1e" },
]

/** Trạng thái hiện ra — dòng trả trước của phiếu chi NCC (mig 242) là tiền NCC đang giữ, không phải "Chưa trả". */
function nhanTrangThaiNo(p: Pick<Payable, "id" | "status">, chungTu: ReadonlyMap<string, ChungTuNo>) {
  return chungTu.get(p.id)?.loai === "tra-truoc"
    ? { label: "Tiền trả trước", variant: "success" as const }
    : PAYABLE_STATUS_MAP[p.status as PayableStatus] || { label: p.status, variant: "default" as const }
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
  /** Vị trí lần tải trước — để "Tải thêm" không vẽ lại 20 dòng đầu (tải hai nhịp, 26/09/2026). */
  const khoaTaiRef = useRef<KhoaTai>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  /** Thứ tự người dùng bấm trên tiêu đề — gửi xuống máy chủ (`SAP_XEP_CONG_NO_NCC`). */
  const [sort, setSort] = useState<DocSort | null>(null)
  const pg = usePagination()
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const supabase = createClient()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs("payables", DEFAULT_PAYABLE_COLUMNS, [], PAYABLE_COLUMNS, [])
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("payables", LOC_CONG_NO_PHAI_TRA)

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
  }, [debouncedSearch, statusFilter, locNC.key, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ TÊN NCC PHẢI TRA RIÊNG: PostgREST không cho `or` bắc qua bảng
   *   nhúng. Phần nối dây ở `useListSearch`.
   */
  const listSearch = useListSearch(
    supabase, debouncedSearch, user?.org_id, ["invoice_number"],
    [
      { column: "supplier_id", table: "suppliers", columns: ["name", "code"] },
      /* Mã phiếu nhập PN- / phiếu trả PTNCC- (chủ nhà 08/10/2026) — khoá ngoại trỏ NGƯỢC về `payables.id`. */
      { column: "id", table: "purchase_invoices", columns: ["receipt_code"], idColumn: "payable_id" },
      { column: "id", table: "supplier_returns", columns: ["return_code"], idColumn: "payable_credit_id" },
    ],
    "payables"
  )

  // Paginated table query.
  useEffect(() => {
    let cancelled = false
    async function fetchData() {
      // Tải thêm / đổi sang trang dài hơn: giữ danh sách đang hiện trong lúc chờ.
      if (!laTaiThem(khoaTaiRef, pg.from, pg.to, false)) setLoading(true)
      /* ⚠ CHỜ LƯỢT TRA MÃ NCC — xem `useListSearch`. */
      const searchReady = listSearch.ready && locNC.ready
      if (!searchReady) return
      // selectResilient: DB thiếu cột thì tự thử lại với '*', và luôn trả error
      // để hiển thị nguyên nhân thay vì danh sách rỗng im lặng.
      const build = (select: string, from = pg.from, to = pg.to, dem = true) => {
        /* ⚠ XẾP Ở MÁY CHỦ — cột người dùng bấm đứng trước; xếp trong bảng là xếp trên một trang. */
        let q = apSapXep(
          supabase.from("payables").select(select, dem ? { count: "exact" } : undefined),
          sort,
          SAP_XEP_CONG_NO_NCC,
          (x) => x
            .order("due_date")
            // ⚠ Mốc phụ `id`: cả chục khoản cùng hạn, thiếu mốc duy nhất
            //   là một dòng hiện ở hai trang, dòng khác không trang nào.
            .order("id")
        ).range(from, to)
        /**
         * ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM (chủ nhà báo 21/09/2026).
         *   Bản cũ chỉ `ilike("invoice_number")` trên máy chủ rồi lọc
         *   thêm theo TÊN NCC ở trình duyệt — gõ tên NCC là chỉ tìm
         *   trong 50 dòng đang hiện, còn `pg.setTotal(count)` vẫn ghi
         *   tổng của phép đếm chưa lọc.
         */
        if (listSearch.filter) q = q.or(listSearch.filter)
        for (const f of locNC.menhDe) q = q.or(f)
        if (statusFilter !== "all") q = q.eq("status", statusFilter)
        return q
      }
      const res = await taiHaiNhip<Payable, ResilientResult<Payable>>(
        (from, to, dem) => selectResilient<Payable>((sel) => build(sel, from, to, dem),
        "id, invoice_number, amount, paid, due_date, status, opening_balance, supplier:suppliers(name, code)",
        // eslint-disable-next-line no-restricted-syntax
        "*, supplier:suppliers(name, code)"),
        pg.from,
        pg.to,
        (dau) => {
          if (cancelled) return; setPayables(dau.data)
          pg.setTotal(dau.count ?? 0)
          setLoading(false)
        },
        { boQuaDau: laTaiThem(khoaTaiRef, pg.from, pg.to) }
      )
      if (cancelled) return
      setPayables(res.data)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)
      setLoading(false)
    }
    fetchData()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, listSearch, statusFilter, locNC.ready, locNC.key, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT. Máy chủ đã lọc cả số hoá đơn lẫn
   * NCC (xem `listSearch`). Chú thích cũ nói "cross-table join filter
   * không trực tiếp được trên server-side với Supabase" — đúng một
   * nửa: `or` không bắc qua bảng nhúng được, nhưng tra mã NCC trước
   * rồi lọc `supplier_id.in.(…)` thì được.
   */
  const filtered = payables

  /**
   * CHỨNG TỪ GỐC của từng khoản đang hiện — chủ nhà 08/10/2026: "sao cột mã HĐ ko có mã phiếu nhập nhỉ".
   * `invoice_number` là SỐ HOÁ ĐƠN CỦA NCC (gõ tay, hay trống), không phải mã phiếu nhập: dòng của phiếu nhập hiện
   * PN-, phiếu trả hiện PTNCC-, nợ đầu kỳ hiện "Nợ đầu kỳ"; số HĐ NCC (nếu có) thành dòng phụ.
   */
  const [chungTu, setChungTu] = useState<Map<string, ChungTuNo>>(new Map())
  useEffect(() => {
    let huy = false
    void docChungTuNoNcc(supabase, payables).then((m) => { if (!huy) setChungTu(m) })
    return () => { huy = true }
  }, [payables]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * SỐ ĐẾM TRÊN DẢI TRẠNG THÁI — đếm ở máy chủ, cùng ô tìm + lọc nâng cao với danh sách
   * (khuôn danh sách chung, 27/09/2026). ⚠ Không đếm từ `payables` (một trang).
   */
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!listSearch.ready || !locNC.ready) return
    let huy = false
    ;(async () => {
      const one = async (st: string | null) => {
        let q = supabase.from("payables").select("id", { count: "exact", head: true })
        if (listSearch.filter) q = q.or(listSearch.filter)
        for (const f of locNC.menhDe) q = q.or(f)
        if (st) q = q.eq("status", st)
        const { count, error } = await q
        if (error) console.warn("[payables] đếm theo trạng thái lỗi:", error.message)
        return count ?? 0
      }
      const keys = TABS.filter((t) => t.key !== "all").map((t) => t.key)
      const so = await Promise.all([...keys.map((k) => one(k)), one(null)])
      if (huy) return
      const c: Record<string, number> = { all: so[so.length - 1] }
      keys.forEach((k, i) => { c[k] = so[i] })
      setCounts(c)
    })()
    return () => { huy = true }
  }, [debouncedSearch, listSearch, locNC.ready, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const [xemId, setXemId] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)

  const columns = useMemo(() => {
    const cols: Array<DocColumn<Payable> & { k?: PayableColumnKey }> = [
      {
        key: "supplier", label: "Nhà cung cấp", width: "minmax(200px,1.5fr)",
        sortable: xepDuoc(SAP_XEP_CONG_NO_NCC, "supplier"),
        render: (p) => <span className="block truncate text-sm font-bold">{p.supplier?.name || "-"}</span>,
      },
      {
        k: "invoiceNumber", key: "invoiceNumber", label: "Chứng từ", width: "150px",
        render: (p) => {
          const c = chungTu.get(p.id)
          return (
            <>
              <DocCodeLink href={`/payables/${p.id}`}>{c?.ma ?? (p.invoice_number || "-")}</DocCodeLink>
              {c?.soHdNcc && <span className="block text-[11px] text-muted-foreground" data-testid="so-hd-ncc">HĐ NCC {c.soHdNcc}</span>}
            </>
          )
        },
      },
      { k: "amount", key: "amount", label: "Số tiền", width: "130px", align: "right", sortable: xepDuoc(SAP_XEP_CONG_NO_NCC, "amount"), render: (p) => formatCurrency(p.amount) },
      { k: "paid", key: "paid", label: "Đã trả", width: "130px", align: "right", render: (p) => formatCurrency(p.paid) },
      /* ⚠ "Còn lại" KHÔNG XẾP: amount − paid tính ở trình duyệt, sổ không có cột ấy. */
      { k: "remaining", key: "remaining", label: "Còn lại", width: "140px", align: "right", render: (p) => formatCurrency(p.amount - p.paid) },
      {
        k: "dueDate", key: "dueDate", label: "Hạn trả", width: "110px",
        sortable: xepDuoc(SAP_XEP_CONG_NO_NCC, "dueDate"),
        render: (p) => <DocCellDate date={p.due_date ? formatDate(p.due_date) : "-"} />,
      },
      {
        k: "aging", key: "aging", label: "Tuổi nợ", width: "130px",
        render: (p) => {
          const aging = p.due_date ? getAgingStatus(p.due_date) : "current"
          return p.status !== "paid" && p.due_date
            ? <Badge variant={agingVariant(aging)}>{agingLabel(daysOverdueOf(p.due_date))}</Badge>
            : "-"
        },
      },
      {
        k: "status", key: "status", label: "Trạng thái", width: "130px",
        render: (p) => {
          const statusCfg = nhanTrangThaiNo(p, chungTu)
          return <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
        },
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, chungTu])

  if (authLoading) return <Skeleton className="h-96" />

  /**
   * ⚠ KHÔNG KẸP VỀ 0 TỪNG DÒNG (chủ nhà 05/10/2026, mig 231): phiếu trả NCC ghi dòng ÂM — khoản NCC hoàn lại mình
   *   — phải trừ vào tổng, như công nợ âm phía khách (CLAUDE.md, mig 186). Cùng số với `payables_summary`,
   *   `payables_by_supplier` và màn chi tiết NCC (`tongNoNcc`).
   */
  const conNo = (p: { amount: number; paid: number }) => (Number(p.amount) || 0) - (Number(p.paid) || 0)
  const totalOutstanding = allOpen.reduce((sum, p) => sum + conNo(p), 0)
  const totalInTerm = allOpen
    .filter((p) => !p.due_date || getAgingStatus(p.due_date) === "current")
    .reduce((sum, p) => sum + conNo(p), 0)
  const totalOverdue = allOpen
    .filter((p) => p.due_date && getAgingStatus(p.due_date) !== "current")
    .reduce((sum, p) => sum + conNo(p), 0)
  const suppliersWithDebt = new Set(allOpen.map((p) => p.supplier_id)).size

  const xem = xemId ? filtered.find((p) => p.id === xemId) ?? null : null
  const xemChungTu = xem ? chungTu.get(xem.id) ?? null : null
  const xemStatus = xem ? nhanTrangThaiNo(xem, chungTu) : null
  const tongNote = (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-on-surface-variant">
      <span>Trong hạn <b className="tabular-data text-tertiary">{formatCurrency(totalInTerm)}</b></span>
      <span>Quá hạn <b className="tabular-data text-destructive">{formatCurrency(totalOverdue)}</b></span>
      <span>Số NCC đang nợ <b className="tabular-data text-on-surface">{suppliersWithDebt}</b></span>
    </p>
  )

  const chips = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? 0, accent: t.accent }))
  const chonTab = (k: string) => setStatusFilter(k as StatusFilter)
  // Nút của màn — máy tính ở PageHeader, điện thoại ở đầu xanh.
  const nutTao = (
    <>
      <Button asChild className="bg-primary text-on-primary shadow-card">
        <Link href="/payables/new"><Plus className="mr-2 h-4 w-4" />Tạo công nợ NCC</Link>
      </Button>
    </>
  )

  return (
    <div className="space-y-4">
      <PageHeader className="max-lg:hidden" title="Công nợ nhà cung cấp" descriptionDesktopOnly description={`Tổng phải trả: ${formatCurrency(totalOutstanding)}`}>
        <div className="flex gap-2">{nutTao}</div>
      </PageHeader>

      {/* Từng khoản / theo NCC (chủ nhà 05/10/2026). */}
      <CheDoCongNoNcc dangXem="khoan" className="max-lg:hidden" />
      <StatusChips className="max-lg:hidden" active={statusFilter} onPick={chonTab} chips={chips} />

      <KetQuaThieu show={listSearch.truncated && !loading} term={debouncedSearch} />

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

      {/* ⚠ KHUÔN DANH SÁCH CHUNG (chủ nhà 27/09/2026). "Tổng phải trả" là của các khoản CHƯA
          TRẢ trên toàn sổ (bốn ô tổng cũ), không phải của trang. */}
      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={search} onChange={setSearch} placeholder="Tìm theo NCC, mã phiếu nhập, số HĐ…" />
            <XoaLocButton show={!!search} onClick={() => setSearch("")} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_CONG_NO_PHAI_TRA} value={locNC.dieuKien} onApply={locNC.apDung} />
            <ColumnPicker
              available={PAYABLE_COLUMNS}
              value={visibleColumns}
              onChange={setColumns}
              onReset={resetColumns}
            />
          </>
        }
        totals={{
          label: "Tổng phải trả (toàn sổ)",
          countText: `${pg.total} khoản nợ NCC`,
          total: statsError || statsTruncated ? null : formatCurrency(totalOutstanding),
        }}
        mobileHead={{
          title: "Công nợ NCC",
          search,
          onSearch: setSearch,
          searchPlaceholder: "Tìm theo NCC, mã phiếu nhập, số HĐ…",
          chips: { chips, active: statusFilter, onPick: chonTab },
          filter: {
            activeCount: locNC.soDangAp,
            onClear: locNC.xoa,
            open: filterSheet,
            onOpenChange: setFilterSheet,
            sheet: <AdvancedFilter truong={LOC_CONG_NO_PHAI_TRA} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />,
          },
          /* Điện thoại: đầu xanh không có chỗ cho thanh chuyển — nút "Theo NCC" đứng đầu hàng nút. */
          actions: (
            <>
              <Button variant="outline" asChild>
                <Link href="/payables/by-supplier">Theo NCC</Link>
              </Button>
              {nutTao}
            </>
          ),
        }}
        totalsNote={statsError ? null : tongNote}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={
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
        }
        pg={pg}
        shownCount={filtered.length}
        table={<DocTable rows={filtered} columns={columns} activeId={xemId} onOpen={(p) => setXemId(p.id)} sort={sort} onSortChange={setSort} />}
        cards={
          <DocCardList
            items={filtered}
            onOpen={(p) => setXemId(p.id)}
            card={(p) => {
              const aging = p.due_date ? getAgingStatus(p.due_date) : "current"
              const statusCfg = nhanTrangThaiNo(p, chungTu)
              const traTruoc = chungTu.get(p.id)?.loai === "tra-truoc"
              return {
                accent: p.status === "paid" ? "#22c55e" : aging === "current" ? "#b9c4d6" : "#ef5350",
                title: p.supplier?.name || "-",
                total: formatCurrency(p.amount - p.paid),
                meta: [
                  chungTu.get(p.id)?.ma ?? (p.invoice_number ? `HĐ ${p.invoice_number}` : null),
                  chungTu.get(p.id)?.soHdNcc ? `HĐ NCC ${chungTu.get(p.id)?.soHdNcc}` : null,
                  `Hạn ${p.due_date ? formatDate(p.due_date) : "-"}`,
                ].filter(Boolean).join(" · "),
                payment: p.status !== "paid" && p.due_date ? agingLabel(daysOverdueOf(p.due_date)) : "",
                paymentCredit: p.status !== "paid" && aging !== "current",
                summary: `Số tiền ${formatCurrency(p.amount)} · Đã trả ${formatCurrency(p.paid)}`,
                badge: traTruoc
                  ? { label: statusCfg.label, bg: "#ecfdf3", fg: "#067647" }
                  : statusCfg && p.status !== "paid" ? { label: statusCfg.label, bg: p.status === "overdue" ? "#fdecec" : "#fff4e0", fg: p.status === "overdue" ? "#b00020" : "#8a5a00" } : null,
              }
            }}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={(xem && chungTu.get(xem.id)?.ma) || xem?.invoice_number || "Công nợ NCC"}
        subtitle={xem?.supplier?.name || undefined}
        badge={xemStatus ? <Badge variant={xemStatus.variant}>{xemStatus.label}</Badge> : null}
        fields={xem ? [
          { label: "Nhà cung cấp", value: xem.supplier?.name, wide: true },
          {
            label: "Chứng từ gốc",
            value: xemChungTu && xemChungTu.href !== `/payables/${xem.id}`
              ? <Link href={xemChungTu.href} className="font-semibold text-primary hover:underline">{xemChungTu.ma} →</Link>
              : xemChungTu?.ma ?? null,
          },
          { label: "Số HĐ NCC", value: xemChungTu?.soHdNcc ?? null },
          { label: "Số tiền", value: formatCurrency(xem.amount) },
          { label: "Đã trả", value: formatCurrency(xem.paid) },
          { label: "Hạn trả", value: xem.due_date ? formatDate(xem.due_date) : null },
          { label: "Tuổi nợ", value: xem.status !== "paid" && xem.due_date ? agingLabel(daysOverdueOf(xem.due_date)) : null },
        ] : []}
        total={xem ? { label: "Còn lại", value: formatCurrency(xem.amount - xem.paid) } : undefined}
        detailHref={xem ? `/payables/${xem.id}` : undefined}
      />
    </div>
  )
}

function agingVariant(status: string): "success" | "warning" | "danger" | "default" {
  switch (status) {
    case "current": return "success"
    case "warning": return "warning"
    case "overdue": return "danger"
    case "critical": return "danger"
    default: return "default"
  }
}
