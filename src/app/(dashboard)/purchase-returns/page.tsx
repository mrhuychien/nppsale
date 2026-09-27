"use client"

/**
 * TRẢ HÀNG NCC — danh sách.
 *
 * ⚠ KHUÔN DANH SÁCH CHUNG (chủ nhà 27/09/2026: "Làm chung form hiển thị danh sách cho toàn
 *   bộ các danh sách theo form đang dùng cho Đơn hàng, hóa đơn, trả hàng"): dải trạng thái có
 *   số đếm, một thẻ gồm thanh công cụ · dòng tổng · lưới · phân trang 20/trang, thẻ trên điện
 *   thoại, bấm dòng mở xem nhanh, bấm mã sang chi tiết.
 *
 * ⚠ TẢI ĐỦ (tổng phải đủ) rồi lọc trạng thái / tìm tại chỗ — số trên dải trạng thái đếm
 *   theo đúng bộ lọc nâng cao đang áp.
 */

import { useLuuTrangThai } from "@/hooks/use-luu-trang-thai"
import { useEffect, useMemo, useState } from "react"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { tongChungTu } from "@/lib/orders/list-summary"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Plus, RotateCcw } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import type { SupplierReturn, Supplier } from "@/types"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_TRA_HANG_NCC } from "@/lib/search/list-filter-fields"
import { trangThaiCuaChon, tachTrangThai } from "@/lib/list/status-multi"
import { StatusChips } from "@/components/ui/status-chips"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { DocListLayout, DocListSearch, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import {
  PURCHASE_RETURN_COLUMNS,
  DEFAULT_PURCHASE_RETURN_COLUMNS,
  type PurchaseReturnColumnKey,
} from "./list-config"

/** "all" hoặc các trạng thái nối dấu phẩy — chọn nhiều (chủ nhà 25/09/2026). */
const TRANG_THAI_NCC = ["draft", "completed", "cancelled", "all"] as const

const STATUS_LABEL: Record<string, { label: string; variant: "secondary" | "success" | "warning"; accent: string }> = {
  draft: { label: "Nháp", variant: "warning", accent: "#fdb022" },
  completed: { label: "Đã gửi", variant: "success", accent: "#22c55e" },
  cancelled: { label: "Đã huỷ", variant: "secondary", accent: "#98a2b3" },
}

const ZONE_LABEL: Record<string, string> = {
  sale: "Kho hàng bán",
  date: "Kho hàng date",
}

type Row = Omit<SupplierReturn, "supplier"> & {
  supplier?: Pick<Supplier, "id" | "name" | "code"> | undefined
}

/**
 * Mã phiếu chỉ được sinh khi GỬI cho NCC, nên phiếu nháp chưa có mã — đó là thiết kế, không
 * phải lỗi. Nhưng để "—" thì trông y như dữ liệu bị mất.
 */
const maPhieu = (r: Row) => r.return_code || "chưa sinh mã"

export default function PurchaseReturnsPage() {
  const { loading: authLoading } = useRoleGuard("inventory")
  const { user } = useAuth()
  const supabase = createClient()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  /** Chạm trần / lỗi đọc — tổng không đủ thì nói ra, không in số hụt. */
  const [canhBao, setCanhBao] = useState<string | null>(null)
  /* ⚠ Nhớ qua lần tải lại (chủ nhà 25/09/2026) — `useLuuTrangThai`. */
  const [filter, setFilter] = useLuuTrangThai("purchase-returns", "all")
  const [search, setSearch] = useState("")
  const [filterSheet, setFilterSheet] = useState(false)
  const [xemId, setXemId] = useState<string | null>(null)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("purchase-returns", LOC_TRA_HANG_NCC)
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs(
    "purchase-returns",
    DEFAULT_PURCHASE_RETURN_COLUMNS,
    [],
    PURCHASE_RETURN_COLUMNS,
    []
  )

  useEffect(() => {
    async function fetch() {
      if (!user?.org_id) return
      setLoading(true)
      /* ⚠ ĐỌC ĐỦ. Bản cũ một lệnh đọc không phân trang — PostgREST cắt ngầm
         ở 1.000 dòng, phiếu thứ 1.001 không hiện và tổng hụt theo. */
      const res = await fetchAllForAggregate<Row>((from, to) => {
        // audit-ok: lỗi đi vào `res.error` ngay dưới.
        let q = supabase
          .from("supplier_returns")
          .select("id, return_code, return_date, warehouse_zone, total, status, reason, notes, supplier:suppliers(id, name, code)", { count: "exact" })
          .eq("org_id", user.org_id)
          .order("created_at", { ascending: false })
          .order("id")
        for (const f of locNC.menhDe) q = q.or(f)
        return q.range(from, to)
      })
      if (res.error) console.error("[purchase-returns] truy vấn lỗi:", res.error)
      setCanhBao(res.error ? `Không đọc được danh sách phiếu trả NCC — ${res.error}` : res.truncated ? truncationWarning() : null)
      setRows(res.rows)
      setLoading(false)
    }
    fetch()
  }, [user?.org_id, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Mọi bộ lọc TRỪ trạng thái — để dải trạng thái đếm đúng. */
  const locRows = useMemo(() => {
    const t = search.trim()
    return t ? rows.filter((r) => viMatchAllWords(t, r.return_code, r.supplier?.name, r.supplier?.code)) : rows
  }, [rows, search])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: locRows.length, draft: 0, completed: 0, cancelled: 0 }
    for (const r of locRows) if (c[r.status] !== undefined) c[r.status] += 1
    return c
  }, [locRows])
  const shown = useMemo(() => {
    /* Chọn nhiều trạng thái (chủ nhà 25/09/2026). */
    const chon = trangThaiCuaChon(filter)
    return chon ? locRows.filter((r) => chon.includes(r.status)) : locRows
  }, [locRows, filter])

  const { pg, trang } = usePhanTrangTaiCho(shown, JSON.stringify([filter, search, locNC.key]))
  const tongPhieu = tongChungTu(shown, (r) => r.total, (r) => !tachTrangThai(filter).includes("cancelled") && r.status === "cancelled", !canhBao)

  const columns = useMemo(() => {
    const cols: Array<DocColumn<Row> & { k?: PurchaseReturnColumnKey }> = [
      {
        key: "code", label: "Mã phiếu", width: "150px",
        render: (r) => (r.return_code
          ? <DocCodeLink href={`/purchase-returns/${r.id}`}>{r.return_code}</DocCodeLink>
          : <span className="text-xs text-muted-foreground">chưa sinh mã</span>),
      },
      {
        k: "date", key: "date", label: "Ngày", width: "110px",
        sort: (a, b) => (a.return_date ?? "").localeCompare(b.return_date ?? ""),
        render: (r) => <DocCellDate date={formatDate(r.return_date)} />,
      },
      {
        k: "supplier", key: "supplier", label: "NCC", width: "minmax(200px,1.5fr)",
        sort: (a, b) => (a.supplier?.name ?? "").localeCompare(b.supplier?.name ?? "", "vi"),
        render: (r) => <span className="block truncate text-sm font-bold">{r.supplier?.name || "—"}</span>,
      },
      { k: "warehouse", key: "warehouse", label: "Kho xuất", width: "140px", render: (r) => <DocCellText muted>{ZONE_LABEL[r.warehouse_zone] || r.warehouse_zone}</DocCellText> },
      {
        k: "total", key: "total", label: "Tổng tiền", width: "140px", align: "right",
        sort: (a, b) => Number(a.total) - Number(b.total),
        render: (r) => formatCurrency(r.total),
      },
      {
        k: "status", key: "status", label: "Trạng thái", width: "120px",
        render: (r) => {
          const st = STATUS_LABEL[r.status] || STATUS_LABEL.draft
          return <Badge variant={st.variant}>{st.label}</Badge>
        },
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns])

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? rows.find((r) => r.id === xemId) ?? null : null
  const khongTinhHuy = !tachTrangThai(filter).includes("cancelled") && filter !== "draft" && filter !== "completed"

  return (
    <div className="space-y-4">
      <PageHeader title="Trả hàng NCC" descriptionDesktopOnly description="Hoàn trả hàng cho nhà cung cấp — xuất kho + giảm công nợ" backHref="/purchasing">
        <Button asChild>
          <Link href="/purchase-returns/new">
            <Plus className="h-4 w-4 mr-1.5" /> Tạo phiếu trả
          </Link>
        </Button>
      </PageHeader>

      <StatusChips
        multi
        active={filter}
        onPick={setFilter}
        chips={TRANG_THAI_NCC.map((f) => ({
          key: f,
          label: f === "all" ? "Tất cả" : STATUS_LABEL[f]?.label || f,
          count: counts[f] ?? 0,
          accent: f === "all" ? "#181c1e" : STATUS_LABEL[f].accent,
        }))}
      />

      {canhBao && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{canhBao}</p>
      )}

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Mã phiếu, tên NCC…"
        activeCount={locNC.soDangAp}
        onClear={locNC.xoa}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <AdvancedFilter truong={LOC_TRA_HANG_NCC} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
      </MobileFilterBar>

      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={search} onChange={setSearch} placeholder="Mã phiếu, tên NCC…" />
            <XoaLocButton show={!!search.trim()} onClick={() => setSearch("")} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_TRA_HANG_NCC} value={locNC.dieuKien} onApply={locNC.apDung} />
            <ColumnPicker available={PURCHASE_RETURN_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        totals={{
          label: "Tổng tiền trả NCC",
          countText: `${tongPhieu.soPhieu} phiếu trả${khongTinhHuy ? " · không tính phiếu huỷ" : ""}`,
          total: tongPhieu.tong === null ? null : formatCurrency(tongPhieu.tong),
        }}
        loading={loading}
        isEmpty={shown.length === 0}
        empty={
          <EmptyState
            icon={<RotateCcw className="h-8 w-8 text-muted-foreground" />}
            title={locNC.soDangAp || search.trim() ? "Không có phiếu nào khớp bộ lọc" : "Chưa có phiếu trả NCC nào"}
            description='Bấm "Tạo phiếu trả" để hoàn trả hàng cho NCC. Khi gửi phiếu hệ thống tự xuất kho và giảm công nợ.'
          />
        }
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(r) => setXemId(r.id)} />}
        cards={
          <DocCardList
            items={trang}
            unit="phiếu trả"
            getDate={(r) => r.return_date}
            getTotal={(r) => (r.status === "cancelled" ? 0 : Number(r.total) || 0)}
            onOpen={(r) => setXemId(r.id)}
            card={(r) => ({
              accent: (STATUS_LABEL[r.status] || STATUS_LABEL.draft).accent,
              title: r.supplier?.name || "—",
              total: formatCurrency(r.total),
              meta: maPhieu(r),
              payment: ZONE_LABEL[r.warehouse_zone] || r.warehouse_zone,
              badge: r.status === "completed" ? null : {
                label: (STATUS_LABEL[r.status] || STATUS_LABEL.draft).label,
                bg: r.status === "cancelled" ? "#fdecec" : "#fff4e0",
                fg: r.status === "cancelled" ? "#b00020" : "#8a5a00",
              },
            })}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem ? maPhieu(xem) : "Phiếu trả NCC"}
        subtitle={xem ? formatDate(xem.return_date) : undefined}
        badge={xem ? <Badge variant={(STATUS_LABEL[xem.status] || STATUS_LABEL.draft).variant}>{(STATUS_LABEL[xem.status] || STATUS_LABEL.draft).label}</Badge> : null}
        fields={xem ? [
          { label: "Nhà cung cấp", value: xem.supplier?.name, wide: true },
          { label: "Kho xuất", value: ZONE_LABEL[xem.warehouse_zone] || xem.warehouse_zone },
          { label: "Lý do", value: xem.reason },
          { label: "Ghi chú", value: xem.notes, wide: true },
        ] : []}
        total={xem ? { label: "Tổng tiền", value: formatCurrency(xem.total) } : undefined}
        detailHref={xem ? `/purchase-returns/${xem.id}` : undefined}
      />
    </div>
  )
}
