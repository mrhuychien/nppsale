"use client"

/**
 * DANH SÁCH PHIẾU NHẬP HÀNG — ba trạng thái, lọc bằng dải viên thuốc.
 *
 * (23/09/2026: chủ nhà xin thêm dòng "Tổng tiền · N phiếu" cho mọi danh
 * sách chứng từ — đó là `DocListTotals`, một dòng, không phải khung thẻ
 * thống kê cũ nói dưới đây.)
 *
 * ⚠ DÙNG `StatusChips`, KHÔNG DỰNG KHUNG THỐNG KÊ RIÊNG. Chủ nhà đã
 * chốt dải viên thuốc cho danh sách đơn hàng (20/09/2026: "cho về đơn
 * giản dễ nhìn thôi, không cần làm khung như cũ nữa"), và bài học kèm
 * theo là khung ô cố định ÉP SỐ TRẠNG THÁI — chính nó từng làm đơn
 * `partially_invoiced` biến mất khỏi mọi tab.
 */

import { useLuuTrangThai } from "@/hooks/use-luu-trang-thai"
import { useCallback, useEffect, useMemo, useState } from "react"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { tongChungTu } from "@/lib/orders/list-summary"
import Link from "@/components/ui/link"
import { PackagePlus, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { DocListLayout, DocListSearch, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { sapXepTaiCho, type BangSoSanh, type DocSort } from "@/lib/list/sap-xep-may-chu"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import {
  PURCHASE_RECEIPT_COLUMNS, PURCHASE_RECEIPT_FILTERS,
  DEFAULT_PURCHASE_RECEIPT_COLUMNS, DEFAULT_PURCHASE_RECEIPT_FILTERS,
  ZONE_LABEL, type PurchaseReceiptColumnKey,
} from "./list-config"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusChips } from "@/components/ui/status-chips"
import { trangThaiCuaChon, tachTrangThai } from "@/lib/list/status-multi"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { useRefreshOnFocus } from "@/hooks/use-refresh-on-focus"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { khopLoc } from "@/lib/search/advanced-filter"
import { LOC_HOA_DON_MUA } from "@/lib/search/list-filter-fields"
import {
  RECEIPT_STATUS, receiptStatusLabel, receiptStatusTone,
} from "@/lib/purchasing/receipt-status"
import { XuatExcelButton, type KetQuaXuat } from "@/components/ui/xuat-excel-button"
import { napDong, napTenNguoi } from "@/lib/xuat-excel/nap"
import { DONG_NHAP, xuatPhieuNhap, type DongNhap } from "@/lib/xuat-excel/cac-man"

interface Row {
  id: string
  receipt_code: string | null
  invoice_number: string | null
  invoice_date: string | null
  status: string
  total: number | null
  warehouse_zone: string | null
  /* Chỉ để lọc nâng cao ở trình duyệt. */
  subtotal: number | null
  vat: number | null
  vat_override: number | null
  notes: string | null
  /* Cho tệp Excel (chủ nhà 05/10/2026). */
  discount?: number | null
  created_by?: string | null
  created_at: string
  completed_at: string | null
  supplier?: { name?: string | null; code?: string | null } | null
}

/**
 * So sánh của các cột xếp được — xếp CẢ danh sách đã lọc rồi mới chia trang (`sapXepTaiCho`).
 * ⚠ Đừng để bảng tự xếp `trang`: đó là xếp trên 20 dòng đang xem.
 */
const SO_SANH_PHIEU_NHAP: BangSoSanh<Row> = {
  supplier: (a, b) => (a.supplier?.name ?? "").localeCompare(b.supplier?.name ?? "", "vi"),
  date: (a, b) => (a.invoice_date ?? "").localeCompare(b.invoice_date ?? ""),
  total: (a, b) => Number(a.total) - Number(b.total),
}

export default function PurchaseReceiptsPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const supabase = createClient()
  const focusTick = useRefreshOnFocus()

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  /** Chạm trần / lỗi đọc — tổng không đủ thì nói ra, không in số hụt. */
  const [canhBao, setCanhBao] = useState<string | null>(null)
  const [q, setQ] = useState("")
  /** "" = chưa chạm tab nào → hiện tất cả. */
  /* ⚠ Nhớ qua lần tải lại (chủ nhà 25/09/2026) — `useLuuTrangThai`. */
  const [tab, setTab] = useLuuTrangThai("purchase-receipts", "")
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). Màn tải hết nên lọc ở trình duyệt bằng `khopLoc`. */
  const locNC = useAdvancedFilter("purchasing-receipts", LOC_HOA_DON_MUA)
  const [filterSheet, setFilterSheet] = useState(false)
  const [xemId, setXemId] = useState<string | null>(null)
  const {
    columns: visibleColumns, filters: activeFilters,
    setColumns, setFilters, resetColumns, resetFilters,
  } = useListViewPrefs(
    "purchase-receipts",
    DEFAULT_PURCHASE_RECEIPT_COLUMNS,
    DEFAULT_PURCHASE_RECEIPT_FILTERS,
    PURCHASE_RECEIPT_COLUMNS,
    PURCHASE_RECEIPT_FILTERS
  )

  const load = useCallback(async () => {
    if (!user?.org_id) return
    setLoading(true)
    /* ⚠ ĐỌC ĐỦ, KHÔNG `.limit(500)`. Bản cũ cắt ngầm ở 500 phiếu: phiếu thứ
       501 không hiện, không tìm được, và số đếm trên các nhãn trạng thái
       hụt theo — không có gì báo. */
    const res = await fetchAllForAggregate<Row>((from, to) =>
      // audit-ok: lỗi đi vào `res.error` ngay dưới.
      supabase
        .from("purchase_invoices")
        .select("id, receipt_code, invoice_number, invoice_date, status, total, warehouse_zone, subtotal, vat, vat_override, discount, notes, created_by, created_at, completed_at, supplier:suppliers(name, code)", { count: "exact" })
        .eq("org_id", user.org_id)
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    )
    if (res.error) console.error("[purchasing/receipts] truy vấn lỗi:", res.error)
    setCanhBao(res.error ? `Không đọc được danh sách phiếu nhập — ${res.error}` : res.truncated ? truncationWarning() : null)
    setRows(res.rows)
    setLoading(false)
  }, [user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load, focusTick])

  /* Số trên dải trạng thái đếm theo đúng bộ lọc nâng cao đang áp. */
  const locRows = useMemo(
    () => (locNC.dieuKien.length ? rows.filter((r) => khopLoc(r, LOC_HOA_DON_MUA, locNC.dieuKien)) : rows),
    [rows, locNC.dieuKien]
  )

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: locRows.length }
    for (const s of RECEIPT_STATUS) c[s] = 0
    for (const r of locRows) if (c[r.status] !== undefined) c[r.status] += 1
    return c
  }, [locRows])

  const shown = useMemo(() => {
    const term = q.trim()
    return locRows.filter((r) => {
      /* Chọn nhiều trạng thái (chủ nhà 25/09/2026). */
      const chon = trangThaiCuaChon(tab)
      if (chon && !chon.includes(r.status)) return false
      if (!term) return true
      return viMatchAllWords(term, r.receipt_code, r.invoice_number, r.supplier?.name, r.supplier?.code)
    })
  }, [locRows, q, tab])

  const tongPhieu = tongChungTu(
    shown,
    (r) => r.total,
    // Đang xem tab "Đã huỷ" thì cộng chính các phiếu huỷ ấy.
    (r) => !tachTrangThai(tab).includes("cancelled") && r.status === "cancelled",
    !canhBao
  )


  /** Thứ tự người dùng bấm trên tiêu đề — xếp cả `shown` TRƯỚC khi chia trang. */
  const [sort, setSort] = useState<DocSort | null>(null)
  const daXep = useMemo(() => sapXepTaiCho(shown, sort, SO_SANH_PHIEU_NHAP), [shown, sort])
  const { pg, trang } = usePhanTrangTaiCho(daXep, JSON.stringify([tab, q, locNC.key, sort]))

  const columns = useMemo(() => {
    const cols: Array<DocColumn<Row> & { k?: PurchaseReceiptColumnKey }> = [
      {
        key: "code", label: "Mã phiếu", width: "150px",
        render: (r) => <DocCodeLink href={`/purchasing/receipts/${r.id}`}>{r.receipt_code || "(chưa cấp mã)"}</DocCodeLink>,
      },
      {
        k: "supplier", key: "supplier", label: "Nhà cung cấp", width: "minmax(200px,1.5fr)",
        sortable: true,
        render: (r) => <span className="block truncate text-sm font-bold">{r.supplier?.name || "—"}</span>,
      },
      { k: "invoiceNumber", key: "invoiceNumber", label: "Số HĐ", width: "130px", render: (r) => <DocCellText muted>{r.invoice_number}</DocCellText> },
      {
        k: "date", key: "date", label: "Ngày", width: "110px",
        sortable: true,
        render: (r) => <DocCellDate date={r.invoice_date ? formatDate(r.invoice_date) : "—"} />,
      },
      { k: "zone", key: "zone", label: "Kho", width: "140px", render: (r) => <DocCellText muted>{r.warehouse_zone ? (ZONE_LABEL[r.warehouse_zone] ?? r.warehouse_zone) : null}</DocCellText> },
      {
        k: "total", key: "total", label: "Cần trả NCC", width: "150px", align: "right",
        sortable: true,
        render: (r) => formatCurrency(Number(r.total || 0)),
      },
      { k: "status", key: "status", label: "Trạng thái", width: "130px", render: (r) => <Badge variant="secondary">{receiptStatusLabel(r.status)}</Badge> },
      { k: "notes", key: "notes", label: "Ghi chú", width: "minmax(160px,1fr)", render: (r) => <DocCellText muted title={r.notes ?? undefined}>{r.notes}</DocCellText> },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns])

  /**
   * XUẤT EXCEL (chủ nhà 05/10/2026) — MỌI phiếu khớp bộ lọc / ô tìm / tab, theo đúng thứ tự đang xếp (`daXep`,
   * không phải trang đang xem), kèm từng dòng hàng.
   */
  const xuatExcel = async (): Promise<KetQuaXuat> => {
    const phieu = daXep
    const [dong, ten] = await Promise.all([
      napDong<DongNhap>(supabase, DONG_NHAP, phieu.map((r) => r.id)),
      napTenNguoi(supabase, phieu.map((r) => r.created_by)),
    ])
    return { sheets: xuatPhieuNhap(phieu, dong, ten), soPhieu: phieu.length, thieu: !!canhBao }
  }
  const nutXuat = (cls?: string) => (
    <XuatExcelButton module="inventory" tenTep="phieu-nhap-hang" chuanBi={xuatExcel} disabled={loading || shown.length === 0} className={cls} />
  )

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? rows.find((r) => r.id === xemId) ?? null : null
  const khongTinhHuy = !tachTrangThai(tab).includes("cancelled") && (trangThaiCuaChon(tab) === null || tab.includes(","))

  const chips = [
    { key: "all", label: "Tất cả", count: counts.all, accent: "#64748b" },
    ...RECEIPT_STATUS.map((s) => ({
      key: s, label: receiptStatusLabel(s), count: counts[s] ?? 0, accent: receiptStatusTone(s),
    })),
  ]
  const nutTao = (
    <Button asChild>
      <Link href="/purchasing/receipts/new"><Plus className="mr-1.5 h-4 w-4" /> Tạo phiếu</Link>
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader className="max-lg:hidden" title="Phiếu nhập hàng" descriptionDesktopOnly description="Nhập hàng từ nhà cung cấp — hoàn thành là nhập kho và ghi công nợ.">
        {nutTao}
      </PageHeader>

      <StatusChips className="max-lg:hidden" chips={chips} multi active={tab || "all"} onPick={setTab} />

      {canhBao && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{canhBao}</p>
      )}

      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={q} onChange={setQ} placeholder="Mã phiếu, số hoá đơn, tên NCC…" />
            <XoaLocButton show={!!q.trim()} onClick={() => setQ("")} />
          </>
        }
        toolbarEnd={
          <>
            {nutXuat()}
            <AdvancedFilter truong={LOC_HOA_DON_MUA} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={PURCHASE_RECEIPT_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={PURCHASE_RECEIPT_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        mobileHead={{
          title: "Phiếu nhập hàng",
          search: q,
          onSearch: setQ,
          searchPlaceholder: "Mã phiếu, số hoá đơn, tên NCC…",
          chips: { chips, active: tab || "all", onPick: setTab, multi: true },
          filter: {
            activeCount: locNC.soDangAp,
            onClear: locNC.xoa,
            open: filterSheet,
            onOpenChange: setFilterSheet,
            sheet: <AdvancedFilter truong={LOC_HOA_DON_MUA} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />,
          },
          actions: <>{nutTao}{nutXuat("h-11")}</>,
        }}
        totals={{
          label: "Tổng tiền phiếu nhập",
          countText: `${tongPhieu.soPhieu} phiếu nhập${khongTinhHuy ? " · không tính phiếu huỷ" : ""}`,
          total: tongPhieu.tong === null ? null : formatCurrency(tongPhieu.tong),
        }}
        loading={loading}
        isEmpty={shown.length === 0}
        empty={
          <EmptyState
            icon={<PackagePlus className="h-8 w-8 text-muted-foreground" />}
            /* ⚠ "Chưa có phiếu nào" là một KẾT LUẬN màn hình không có cơ sở để rút ra: 0 dòng
               cũng là thứ ta nhận được khi RLS chặn. */
            title={q.trim() || tab || locNC.soDangAp ? "Không có phiếu nào khớp bộ lọc." : "Chưa thấy phiếu nhập nào."}
            description={q.trim() || tab || locNC.soDangAp ? "Sửa hoặc bỏ bớt điều kiện lọc." : "Bấm Tạo phiếu để bắt đầu."}
          />
        }
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(r) => setXemId(r.id)} sort={sort} onSortChange={setSort} />}
        cards={
          <DocCardList
            items={trang}
            onOpen={(r) => setXemId(r.id)}
            card={(r) => ({
              accent: receiptStatusTone(r.status),
              title: r.supplier?.name || "—",
              total: formatCurrency(Number(r.total || 0)),
              meta: [r.invoice_date ? formatDate(r.invoice_date) : null, r.receipt_code || "(chưa cấp mã)"].filter(Boolean).join(" · "),
              payment: r.invoice_number ? `HĐ ${r.invoice_number}` : "",
              badge: r.status === "completed" ? null : { label: receiptStatusLabel(r.status), bg: "#fff4e0", fg: "#8a5a00" },
            })}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.receipt_code || "Phiếu nhập"}
        subtitle={xem?.invoice_date ? formatDate(xem.invoice_date) : undefined}
        badge={xem ? <Badge variant="secondary">{receiptStatusLabel(xem.status)}</Badge> : null}
        fields={xem ? [
          { label: "Nhà cung cấp", value: xem.supplier?.name, wide: true },
          { label: "Số HĐ", value: xem.invoice_number },
          { label: "Kho", value: xem.warehouse_zone ? (ZONE_LABEL[xem.warehouse_zone] ?? xem.warehouse_zone) : null },
          { label: "Tạm tính", value: xem.subtotal == null ? null : formatCurrency(Number(xem.subtotal)) },
          { label: "VAT", value: formatCurrency(Number(xem.vat_override ?? xem.vat ?? 0)) },
          { label: "Ghi chú", value: xem.notes, wide: true },
        ] : []}
        total={xem ? { label: "Cần trả NCC", value: formatCurrency(Number(xem.total || 0)) } : undefined}
        detailHref={xem ? `/purchasing/receipts/${xem.id}` : undefined}
      />
    </div>
  )
}
