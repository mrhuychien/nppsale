"use client"

/**
 * HOÁ ĐƠN MUA HÀNG (tra cứu) — danh sách phiếu nhập kho từ NCC kèm công nợ NCC.
 *
 * ⚠ KHUÔN DANH SÁCH CHUNG (chủ nhà 27/09/2026: "Làm chung form hiển thị danh sách cho toàn
 *   bộ các danh sách theo form đang dùng cho Đơn hàng, hóa đơn, trả hàng"): dải lọc công nợ
 *   có số đếm, một thẻ gồm thanh công cụ · lưới · phân trang 20/trang, thẻ trên điện thoại,
 *   bấm dòng mở xem nhanh, bấm mã sang phiếu nhập.
 */

import { useEffect, useMemo, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { useSearchParams } from "next/navigation"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useAuth } from "@/hooks/use-auth"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { StatusChips } from "@/components/ui/status-chips"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { DocListLayout, DocListSearch, KetQuaThieu, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { formatCurrency, formatDate } from "@/lib/utils"
import { useListSearch } from "@/hooks/use-list-search"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_PHIEU_NHAP_MUA } from "@/lib/search/list-filter-fields"
import { FileText, Plus } from "lucide-react"
import type { ListViewOption } from "@/components/ui/list-view-toolbar"

const COLUMNS = [
  { key: "supplier", label: "Nhà cung cấp" },
  { key: "invoice_number", label: "Số HĐ" },
  { key: "date", label: "Ngày nhập" },
  { key: "total", label: "Tổng tiền" },
  { key: "paid", label: "Đã trả" },
  { key: "remaining", label: "Còn nợ" },
  { key: "debt_status", label: "Trạng thái nợ" },
] as const satisfies readonly ListViewOption<string>[]
type ColKey = (typeof COLUMNS)[number]["key"]
const DEFAULT_COLS: ColKey[] = ["supplier", "date", "total", "remaining", "debt_status"]

interface ImportRow {
  id: string
  entry_code: string
  posted_at: string | null
  created_at: string
  supplier?: { name: string; code: string | null } | null
  payable?: { id: string; amount: number; paid: number; status: string; invoice_number: string | null } | null
}

const DEBT_FILTERS = [
  { value: "open", label: "Còn nợ", accent: "#fdb022" },
  { value: "paid", label: "Đã trả đủ", accent: "#22c55e" },
  { value: "no_supplier", label: "Không gắn NCC", accent: "#98a2b3" },
  { value: "all", label: "Tất cả", accent: "#181c1e" },
]

const DEBT_LABEL: Record<string, { label: string; variant: "secondary" | "success" | "warning" | "danger" }> = {
  open: { label: "Còn nợ", variant: "warning" },
  partial: { label: "Trả 1 phần", variant: "warning" },
  overdue: { label: "Quá hạn", variant: "danger" },
  paid: { label: "Đã trả đủ", variant: "success" },
}

const conNo = (r: ImportRow) => Math.max(0, (r.payable?.amount ?? 0) - (r.payable?.paid ?? 0))

export default function PurchaseInvoicesLookupPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [rows, setRows] = useState<ImportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [debtFilter, setDebtFilter] = useState(() => searchParams.get("debt") || "all")
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [filterSheet, setFilterSheet] = useState(false)
  const [xemId, setXemId] = useState<string | null>(null)
  const pg = usePagination()
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("purchasing-invoices", LOC_PHIEU_NHAP_MUA)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
  const { columns: visibleColumns, setColumns, resetColumns } = useListViewPrefs(
    "purchasing-invoices", DEFAULT_COLS, [], COLUMNS, []
  )

  const canCreate = !!user && hasPermission(user.role, "inventory", "update")

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, debtFilter, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ⚠ HAI LƯỢT TRA RIÊNG. Tên NCC nằm ở `suppliers`; SỐ HOÁ ĐƠN nằm ở
   *   `payables` và phải lấy ra `stock_entry_id` — khoá ngoại TRỎ
   *   NGƯỢC về bảng đang liệt kê. PostgREST không cho `or` bắc qua
   *   bảng nhúng nên cả hai đều phải tra trước.
   */
  const listSearch = useListSearch(
    supabase, debouncedSearch, user?.org_id, ["entry_code"],
    [
      { column: "supplier_id", table: "suppliers", columns: ["name", "code"] },
      {
        column: "id", table: "payables", columns: ["invoice_number"],
        idColumn: "stock_entry_id",
      },
    ],
    "stock_entries"
  )

  /**
   * ⚠ LỌC CÔNG NỢ Ở MÁY CHỦ BẰNG PHÉP NỐI `!inner`. Bản cũ nạp một trang rồi mới hỏi
   *   `payables` và lọc ở trình duyệt — "còn nợ" chỉ lọc trong 50 dòng đang hiện, còn phân
   *   trang vẫn hứa theo tổng CHƯA lọc. Phần nối này CHỈ để lọc; phần hiển thị vẫn đọc riêng
   *   để giữ nguyên hình dạng dữ liệu. Một hàm cho cả danh sách lẫn phép đếm.
   */
  const taoTruyVan = (loc: string, cot: string, opts: { count: "exact"; head?: boolean }) => {
    const joinDebt = loc === "open" || loc === "paid"
    let q = supabase
      .from("stock_entries")
      .select(cot + (joinDebt ? ", debt:payables!inner(status)" : ""), opts)
      .eq("type", "import")
    /**
     * ⚠ TÌM CẢ SỔ, KHÔNG CHỈ TRANG ĐANG XEM (chủ nhà báo 21/09/2026).
     *   Bản cũ chỉ `ilike("entry_code")` trên máy chủ rồi lọc thêm
     *   theo TÊN NCC và SỐ HOÁ ĐƠN ở trình duyệt.
     */
    if (listSearch.filter) q = q.or(listSearch.filter)
    for (const f of locNC.menhDe) q = q.or(f)
    if (loc === "open") q = q.neq("debt.status", "paid")
    else if (loc === "paid") q = q.eq("debt.status", "paid")
    else if (loc === "no_supplier") q = q.is("supplier_id", null)
    return q
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      /* ⚠ CHỜ LƯỢT TRA MÃ — xem `useListSearch`. */
      if (!listSearch.ready) return
      const { data: entriesData, count, error: qErr } = await taoTruyVan(
        debtFilter, "id, entry_code, posted_at, created_at, supplier:suppliers(name, code)", { count: "exact" }
      )
        .order("created_at", { ascending: false })
        // ⚠ Mốc phụ duy nhất — hai phiếu cùng giờ không lặp / sót giữa hai trang.
        .order("id")
        .range(pg.from, pg.to)
      if (qErr) console.error("[purchasing/invoices] truy vấn lỗi:", qErr.message)
      if (cancelled) return

      const entries = (entriesData as unknown as Array<Omit<ImportRow, "payable">>) || []
      const ids = entries.map((e) => e.id)

      // Load payables CHỈ cho entries trên page hiện tại.
      const payByEntry = new Map<string, ImportRow["payable"]>()
      if (ids.length > 0) {
        const { data: payData, error: payDataErr } = await supabase
          .from("payables")
          .select("id, stock_entry_id, amount, paid, status, invoice_number")
          .in("stock_entry_id", ids)
        if (payDataErr) console.error("[purchasing/invoices] truy vấn lỗi:", payDataErr.message)
        for (const p of (payData as Array<{ id: string; stock_entry_id: string; amount: number; paid: number; status: string; invoice_number: string | null }>) || []) {
          payByEntry.set(p.stock_entry_id, { id: p.id, amount: p.amount, paid: p.paid, status: p.status, invoice_number: p.invoice_number })
        }
      }
      if (cancelled) return

      /* ⚠ KHÔNG LỌC LẠI Ở TRÌNH DUYỆT — máy chủ đã lọc cả ô tìm lẫn
         trạng thái công nợ. Lọc sau phân trang là chỉ lọc trang đang xem. */
      setRows(entries.map((e) => ({ ...e, payable: payByEntry.get(e.id) || null })))
      pg.setTotal(count ?? 0)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [pg.from, pg.to, debouncedSearch, listSearch, debtFilter, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /* Số trên dải lọc công nợ — đếm ở máy chủ, cùng ô tìm + lọc nâng cao. */
  useEffect(() => {
    if (!listSearch.ready) return
    let huy = false
    ;(async () => {
      const so = await Promise.all(DEBT_FILTERS.map(async (f) => {
        const { count, error } = await taoTruyVan(f.value, "id", { count: "exact", head: true })
        if (error) console.warn("[purchasing/invoices] đếm lỗi:", error.message)
        return [f.value, count ?? 0] as const
      }))
      if (!huy) setCounts(Object.fromEntries(so))
    })()
    return () => { huy = true }
  }, [debouncedSearch, listSearch, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => {
    const cols: Array<DocColumn<ImportRow> & { k?: ColKey }> = [
      { key: "entry_code", label: "Mã phiếu nhập", width: "150px", render: (r) => <DocCodeLink href={`/inventory/entries/${r.id}`}>{r.entry_code}</DocCodeLink> },
      {
        k: "supplier", key: "supplier", label: "Nhà cung cấp", width: "minmax(200px,1.5fr)",
        sort: (a, b) => (a.supplier?.name ?? "").localeCompare(b.supplier?.name ?? "", "vi"),
        render: (r) => <span className="block truncate text-sm font-bold">{r.supplier?.name || "—"}</span>,
      },
      { k: "invoice_number", key: "invoice_number", label: "Số HĐ", width: "130px", render: (r) => <DocCellText muted>{r.payable?.invoice_number}</DocCellText> },
      {
        k: "date", key: "date", label: "Ngày nhập", width: "110px",
        sort: (a, b) => (a.posted_at || a.created_at).localeCompare(b.posted_at || b.created_at),
        render: (r) => <DocCellDate date={formatDate(r.posted_at || r.created_at)} />,
      },
      { k: "total", key: "total", label: "Tổng tiền", width: "130px", align: "right", render: (r) => (r.payable ? formatCurrency(r.payable.amount) : "—") },
      { k: "paid", key: "paid", label: "Đã trả", width: "130px", align: "right", render: (r) => (r.payable ? formatCurrency(r.payable.paid) : "—") },
      {
        k: "remaining", key: "remaining", label: "Còn nợ", width: "130px", align: "right",
        sort: (a, b) => conNo(a) - conNo(b),
        render: (r) => (r.payable ? <span className={conNo(r) > 0 ? "text-error" : ""}>{formatCurrency(conNo(r))}</span> : "—"),
      },
      {
        k: "debt_status", key: "debt_status", label: "Trạng thái nợ", width: "140px",
        render: (r) => {
          if (!r.payable) return <Badge variant="secondary">Không gắn NCC</Badge>
          const m = DEBT_LABEL[r.payable.status] || { label: r.payable.status, variant: "secondary" as const }
          return <Badge variant={m.variant}>{m.label}</Badge>
        },
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns])

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? rows.find((r) => r.id === xemId) ?? null : null
  const xemNo = xem?.payable ? (DEBT_LABEL[xem.payable.status] || { label: xem.payable.status, variant: "secondary" as const }) : null

  return (
    <div className="space-y-4">
      <PageHeader
        title="Hoá đơn mua hàng (tra cứu)"
        descriptionDesktopOnly
        description="Danh sách phiếu nhập kho từ nhà cung cấp. Việc tạo / sửa hàng nhập + công nợ NCC làm ở phiếu nhập."
        backHref="/purchasing"
      >
        {canCreate && (
          <Button asChild>
            {/* Cửa phiếu nhập hàng — máy tính mở POS (`posTargetFor`). */}
            <Link href="/purchasing/receipts/new"><Plus className="h-4 w-4 mr-1.5" /> Tạo phiếu nhập hàng</Link>
          </Button>
        )}
      </PageHeader>

      <StatusChips
        active={debtFilter}
        onPick={setDebtFilter}
        chips={DEBT_FILTERS.map((f) => ({ key: f.value, label: f.label, count: counts[f.value] ?? 0, accent: f.accent }))}
      />

      <KetQuaThieu show={listSearch.truncated && !loading} term={debouncedSearch} />

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm mã phiếu, NCC, số HĐ…"
        activeCount={locNC.soDangAp}
        onClear={locNC.xoa}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <AdvancedFilter truong={LOC_PHIEU_NHAP_MUA} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
      </MobileFilterBar>

      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={search} onChange={setSearch} placeholder="Tìm mã phiếu, NCC, số HĐ…" />
            <XoaLocButton show={!!search} onClick={() => setSearch("")} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_PHIEU_NHAP_MUA} value={locNC.dieuKien} onApply={locNC.apDung} />
            <ColumnPicker available={COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        /* Màn tra cứu, không cộng tiền: tổng công nợ NCC nằm ở màn Công nợ NCC. */
        totals={null}
        loading={loading}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            icon={<FileText className="h-8 w-8 text-muted-foreground" />}
            title={search || debtFilter !== "all" || locNC.soDangAp ? "Không có phiếu nhập nào khớp bộ lọc" : "Chưa có phiếu nhập kho nào"}
            description="Tạo phiếu nhập hàng để nhập hàng từ nhà cung cấp."
          />
        }
        pg={pg}
        shownCount={rows.length}
        table={<DocTable rows={rows} columns={columns} activeId={xemId} onOpen={(r) => setXemId(r.id)} />}
        cards={
          <DocCardList
            items={rows}
            onOpen={(r) => setXemId(r.id)}
            card={(r) => ({
              accent: !r.payable ? "#98a2b3" : r.payable.status === "paid" ? "#22c55e" : "#fdb022",
              title: r.supplier?.name || "— Không gắn NCC —",
              total: r.payable ? formatCurrency(conNo(r)) : "—",
              meta: [formatDate(r.posted_at || r.created_at), r.entry_code].join(" · "),
              payment: r.payable?.invoice_number ? `HĐ ${r.payable.invoice_number}` : "",
              summary: r.payable ? `Còn nợ / tổng ${formatCurrency(r.payable.amount)}` : undefined,
              badge: !r.payable
                ? { label: "Không gắn NCC", bg: "#eef1f5", fg: "#565a67" }
                : r.payable.status === "paid" ? null : { label: DEBT_LABEL[r.payable.status]?.label ?? r.payable.status, bg: "#fff4e0", fg: "#8a5a00" },
            })}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.entry_code ?? "Phiếu nhập"}
        subtitle={xem ? formatDate(xem.posted_at || xem.created_at) : undefined}
        badge={xem ? (xemNo ? <Badge variant={xemNo.variant}>{xemNo.label}</Badge> : <Badge variant="secondary">Không gắn NCC</Badge>) : null}
        fields={xem ? [
          { label: "Nhà cung cấp", value: xem.supplier?.name, wide: true },
          { label: "Số HĐ", value: xem.payable?.invoice_number },
          { label: "Tổng tiền", value: xem.payable ? formatCurrency(xem.payable.amount) : null },
          { label: "Đã trả", value: xem.payable ? formatCurrency(xem.payable.paid) : null },
        ] : []}
        total={xem?.payable ? { label: "Còn nợ", value: formatCurrency(conNo(xem)) } : undefined}
        detailHref={xem ? `/inventory/entries/${xem.id}` : undefined}
      />
    </div>
  )
}
