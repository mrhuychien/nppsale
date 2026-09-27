"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "@/components/ui/link"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusChips } from "@/components/ui/status-chips"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { DocListLayout, DocListSearch, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import { viMatchAllWords } from "@/lib/search"
import { useToast } from "@/hooks/use-toast"
import { formatDate, getExpiryStatus } from "@/lib/utils"
import { BoxesIcon, Plus, AlertTriangle, Clock, RefreshCw } from "lucide-react"
import type { Batch, Product } from "@/types"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { khopLoc } from "@/lib/search/advanced-filter"
import { LOC_LO_HANG } from "@/lib/search/list-filter-fields"
import { ColumnPicker } from "@/components/ui/list-view-toolbar"
import {
  BATCH_COLUMNS,
  DEFAULT_BATCH_COLUMNS,
  type BatchColumnKey,
} from "./list-config"
import { errorMessage } from "@/lib/errors"

type BatchRow = Batch & { product?: Product }

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

export default function BatchesPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const { toast } = useToast()
  const [batches, setBatches] = useState<(Batch & { product?: Product })[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState("all")
  const supabase = createClient()
  const {
    columns: visibleColumns,
    setColumns,
    resetColumns,
  } = useListViewPrefs(
    "inventory-batches",
    DEFAULT_BATCH_COLUMNS,
    [],
    BATCH_COLUMNS,
    []
  )
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). Màn tải hết → lọc ở trình duyệt. */
  const locNC = useAdvancedFilter("inventory-batches", LOC_LO_HANG)

  /**
   * ⚠ ĐỌC ĐỦ MỌI TRANG. Bản cũ đọc trơn, sắp `expires_at` tăng dần —
   *   PostgREST cắt ở 1.000 dòng, nên chỉ 1.000 lô CŨ NHẤT (phần lớn đã
   *   xuất hết, tồn 0) hiện ra; lô mới nhập không thấy đâu, và mọi bộ đếm
   *   ("Tất cả (N)", "Sắp hết hạn") sai mà không báo.
   * ⚠ Khoá phụ `id`: cả trăm lô cùng hạn dùng, trang song song thiếu khoá
   *   duy nhất là lặp / sót lô.
   * ⚠ Vẫn giữ đường dự phòng `*` như `selectResilient` cũ: DB thiếu cột
   *   (migration chưa chạy) thì thử lại thay vì ra danh sách rỗng.
   */
  async function loadBatches() {
    const load = (select: string) =>
      fetchAllForAggregate<Batch & { product?: Product }>((from, to) =>
        supabase
          .from("batches")
          .select(select, { count: "exact" })
          .order("expires_at")
          .order("id")
          .range(from, to)
      )
    let res = await load(
      "id, org_id, product_id, batch_code, manufactured_at, expires_at, location, qty_initial, qty_on_hand, unit_cost, status, warehouse_zone, zone_moved_at, zone_moved_by, received_at, created_at, product:products(*)"
    )
    if (res.error) {
      // eslint-disable-next-line no-restricted-syntax
      const fb = await load("*, product:products(*)")
      if (!fb.error) res = fb
    }
    setBatches(res.rows)
    setLoadError(res.error)
    setTruncated(res.truncated)
  }

  useEffect(() => {
    async function fetch() {
      await loadBatches()
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* Mọi thẻ / tab đọc từ đây — bộ lọc nâng cao áp lên cả bộ đếm. */
  const locBatches = useMemo(
    () => batches.filter((b) => khopLoc(b, LOC_LO_HANG, locNC.dieuKien)),
    [batches, locNC.key] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const expiring = useMemo(
    () => locBatches.filter((b) => daysUntil(b.expires_at) < 30 && daysUntil(b.expires_at) >= 0),
    [locBatches]
  )

  const saleBatches = useMemo(
    () => locBatches.filter((b) => b.warehouse_zone !== "date"),
    [locBatches]
  )
  const dateBatches = useMemo(
    () => locBatches.filter((b) => b.warehouse_zone === "date"),
    [locBatches]
  )

  const fefoBatches = useMemo(
    () => [...locBatches].sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime()),
    [locBatches]
  )

  /* ⚠ ĐÃ GỠ NÚT "→ Date / → Bán" (chủ nhà chốt 23/09/2026: "bỏ cái đó.
     Đã có phiếu chuyển kho rồi"). Nút ấy dời cả lô sang vùng khác bằng một
     lệnh sửa thẳng, không có phiếu chuyển kho — thẻ kho theo vùng lệch tồn
     thật. Chuyển vùng đi qua `/inventory/stock-issue` (phiếu chuyển kho). */

  const refreshZones = async () => {
    if (!user?.org_id) return
    setRefreshing(true)
    try {
      const { data, error } = await supabase.rpc("refresh_warehouse_zones", {
        p_org_id: user.org_id,
      })
      if (error) throw error
      const moved = Number(data ?? 0)
      toast({ title: `Đã rà soát kho`, description: `${moved} lô chuyển sang kho date` })
      await loadBatches()
    } catch (err) {
      toast({
        title: "Lỗi",
        description: errorMessage(err, "Không thể rà soát"),
        variant: "destructive",
      })
    } finally {
      setRefreshing(false)
    }
  }

  /* Dải lọc (thay cho các tab cũ) — cùng `StatusChips` với đơn / hóa đơn. */
  const [search, setSearch] = useState("")
  const [xemId, setXemId] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)
  const theoTab = useMemo(() => {
    const ds = tab === "sale" ? saleBatches : tab === "date" ? dateBatches : tab === "fefo" ? fefoBatches : tab === "expiring" ? expiring : locBatches
    const t = search.trim()
    return t ? ds.filter((b) => viMatchAllWords(t, b.product?.name, b.batch_code, b.location)) : ds
  }, [tab, search, locBatches, saleBatches, dateBatches, fefoBatches, expiring])
  const { pg, trang } = usePhanTrangTaiCho(theoTab, JSON.stringify([tab, search, locNC.key]))
  const demNguoc = tab === "date" || tab === "fefo" || tab === "expiring"

  const columns = useMemo(() => {
    const cols: Array<DocColumn<BatchRow> & { k?: BatchColumnKey; khi?: boolean }> = [
      {
        key: "product", label: "Sản phẩm", width: "minmax(220px,2fr)",
        sort: (a, b) => (a.product?.name ?? "").localeCompare(b.product?.name ?? "", "vi"),
        render: (b) => <span className="block truncate text-sm font-bold">{b.product?.name}</span>,
      },
      { k: "batchCode", key: "batchCode", label: "Mã lô", width: "140px", render: (b) => <DocCodeLink href={`/inventory/batches/${b.id}`}>{b.batch_code}</DocCodeLink> },
      {
        k: "zone", key: "zone", label: "Kho", width: "90px",
        render: (b) => <Badge variant={b.warehouse_zone === "date" ? "warning" : "success"} className="font-semibold">{b.warehouse_zone === "date" ? "Date" : "Bán"}</Badge>,
      },
      { k: "location", key: "location", label: "Vị trí", width: "120px", render: (b) => <DocCellText muted>{b.location}</DocCellText> },
      { k: "qtyInitial", key: "qtyInitial", label: "Ban đầu", width: "100px", align: "right", render: (b) => b.qty_initial },
      { k: "qtyOnHand", key: "qtyOnHand", label: "Tồn", width: "100px", align: "right", sort: (a, b) => Number(a.qty_on_hand) - Number(b.qty_on_hand), render: (b) => b.qty_on_hand },
      { k: "manufacturedAt", key: "manufacturedAt", label: "NSX", width: "110px", render: (b) => <DocCellDate date={b.manufactured_at ? formatDate(b.manufactured_at) : "-"} /> },
      {
        k: "expiresAt", key: "expiresAt", label: "HSD", width: "130px",
        sort: (a, b) => (a.expires_at ?? "").localeCompare(b.expires_at ?? ""),
        render: (b) => {
          const status = getExpiryStatus(b.expires_at, b.product?.shelf_life_days ?? undefined)
          return <Badge variant={status === "danger" ? "danger" : status === "warning" ? "warning" : "success"}>{formatDate(b.expires_at)}</Badge>
        },
      },
      {
        key: "countdown", label: "Còn lại", width: "130px", khi: demNguoc,
        render: (b) => {
          const days = daysUntil(b.expires_at)
          return (
            <span className={`inline-flex items-center gap-1 text-xs font-semibold ${days < 30 ? "text-error" : days < 90 ? "text-[#b54708]" : "text-muted-foreground"}`}>
              <Clock className="h-3 w-3" />
              {days < 0 ? `Đã hết hạn ${Math.abs(days)}d` : `${days} ngày`}
            </span>
          )
        },
      },
    ]
    return cols.filter((c) => (c.khi ?? true) && (!c.k || visibleColumns.includes(c.k)))
  }, [visibleColumns, demNguoc])

  if (authLoading) return <Skeleton className="h-96" />

  const canCreate =
    user && ["warehouse", "owner"].includes(user.role) && hasPermission(user.role, "inventory", "create")

  const xem = xemId ? batches.find((b) => b.id === xemId) ?? null : null
  const GOI_Y: Record<string, string> = {
    sale: "Hàng còn xa hạn — bán theo giá list bình thường.",
    date: "Hàng gần hạn — gom lại bán xả với giá ưu đãi. Tự động chuyển khi ≤ ngưỡng cấu hình ở Cài đặt giá.",
    fefo: "Lô xếp theo hạn sử dụng tăng dần - ưu tiên xuất trước (First Expiry First Out)",
  }
  const RONG: Record<string, { title: string; description: string }> = {
    sale: { title: "Kho hàng bán trống", description: "Tất cả lô hiện tại đều thuộc kho date" },
    date: { title: "Chưa có hàng date", description: "Chưa có lô nào gần hạn — tất cả đang ở kho hàng bán" },
    expiring: { title: "Không có lô sắp hết hạn", description: "Tất cả lô hàng còn hạn trên 30 ngày" },
  }
  const rong = batches.length === 0
    ? {
        title: loadError ? "Không tải được dữ liệu" : "Chưa có lô hàng",
        description: loadError ? "Xem thông báo lỗi phía trên." : "Lô hàng sẽ được tạo khi nhập kho hoặc bằng nút 'Tạo lô mới'",
      }
    : search.trim()
      ? { title: "Không có lô nào khớp", description: "Thử từ khoá khác." }
      : RONG[tab] ?? { title: "Không có lô phù hợp", description: "Thử đổi bộ lọc." }

  return (
    <div className="space-y-4">
      <PageHeader title="Quản lý lô hàng" descriptionDesktopOnly description={`${batches.length} lô hàng`} backHref="/inventory">
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button variant="outline" size="sm" onClick={refreshZones} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              Rà soát kho date
            </Button>
          )}
          {canCreate && (
            <Button asChild>
              <Link href="/inventory/batches/new">
                <Plus className="mr-2 h-4 w-4" /> Tạo lô mới
              </Link>
            </Button>
          )}
        </div>
      </PageHeader>

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách lô hàng</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}
      {truncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Danh sách lô chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}

      {expiring.length > 0 && (
        <Card
          className="rounded-2xl border-error/40 bg-gradient-to-r from-error-container to-error-container/40 shadow-card cursor-pointer"
          onClick={() => setTab("expiring")}
        >
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="rounded-xl bg-error-container p-3 text-error">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-error">
                {expiring.length} lô sắp hết hạn (&lt; 30 ngày)
              </div>
              <div className="text-xs text-error">
                Nhấn để xem danh sách và ưu tiên xuất trước
              </div>
            </div>
            <Button size="sm" variant="outline" className="border-error/40 text-error">
              Xem ngay
            </Button>
          </CardContent>
        </Card>
      )}

      <StatusChips
        active={tab}
        onPick={setTab}
        chips={[
          { key: "all", label: "Tất cả", count: locBatches.length, accent: "#181c1e" },
          { key: "sale", label: "Kho hàng bán", count: saleBatches.length, accent: "#22c55e" },
          { key: "date", label: "Kho hàng date", count: dateBatches.length, accent: "#fdb022" },
          { key: "fefo", label: "FEFO (ưu tiên xuất)", count: fefoBatches.length, accent: "#2563eb" },
          { key: "expiring", label: "Sắp hết hạn", count: expiring.length, accent: "#ef5350" },
        ]}
      />

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm sản phẩm, mã lô, vị trí…"
        activeCount={locNC.soDangAp}
        onClear={locNC.xoa}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <AdvancedFilter truong={LOC_LO_HANG} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
      </MobileFilterBar>

      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={search} onChange={setSearch} placeholder="Tìm sản phẩm, mã lô, vị trí…" />
            <XoaLocButton show={!!search} onClick={() => setSearch("")} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_LO_HANG} value={locNC.dieuKien} onApply={locNC.apDung} />
            <ColumnPicker available={BATCH_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        /* Tồn của các lô là số lượng của nhiều mặt hàng khác đơn vị — cộng lại là vô nghĩa. */
        totals={null}
        totalsNote={GOI_Y[tab] ? <p className="text-xs text-muted-foreground">{GOI_Y[tab]}</p> : null}
        loading={loading}
        isEmpty={theoTab.length === 0}
        empty={
          <EmptyState
            icon={tab === "date" ? <Clock className="h-8 w-8 text-muted-foreground" /> : tab === "expiring" ? <AlertTriangle className="h-8 w-8 text-muted-foreground" /> : <BoxesIcon className="h-8 w-8 text-muted-foreground" />}
            title={rong.title}
            description={rong.description}
          />
        }
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(b) => setXemId(b.id)} />}
        cards={
          <DocCardList
            items={trang}
            onOpen={(b) => setXemId(b.id)}
            card={(b) => {
              const days = daysUntil(b.expires_at)
              const isDateZone = b.warehouse_zone === "date"
              return {
                accent: days < 30 ? "#ef5350" : isDateZone ? "#fdb022" : "#22c55e",
                title: b.product?.name ?? "—",
                total: `Tồn ${b.qty_on_hand}`,
                meta: [`Lô ${b.batch_code}`, b.location ? `Vị trí ${b.location}` : null].filter(Boolean).join(" · "),
                payment: `HSD ${formatDate(b.expires_at)}`,
                paymentCredit: days < 90,
                summary: `${isDateZone ? "Kho date" : "Kho bán"} · Ban đầu ${b.qty_initial}${b.manufactured_at ? ` · NSX ${formatDate(b.manufactured_at)}` : ""}`,
                badge: days < 0
                  ? { label: `Hết hạn ${Math.abs(days)}d`, bg: "#fdecec", fg: "#b00020" }
                  : days < 30 ? { label: `Còn ${days} ngày`, bg: "#fdecec", fg: "#b00020" } : null,
              }
            }}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.batch_code ?? "Lô hàng"}
        subtitle={xem?.product?.name}
        badge={xem ? <Badge variant={xem.warehouse_zone === "date" ? "warning" : "success"}>{xem.warehouse_zone === "date" ? "Kho date" : "Kho bán"}</Badge> : null}
        fields={xem ? [
          { label: "Sản phẩm", value: xem.product?.name, wide: true },
          { label: "Tồn", value: String(xem.qty_on_hand) },
          { label: "Ban đầu", value: String(xem.qty_initial) },
          { label: "NSX", value: xem.manufactured_at ? formatDate(xem.manufactured_at) : null },
          { label: "HSD", value: formatDate(xem.expires_at) },
          { label: "Vị trí", value: xem.location },
          { label: "Còn lại", value: daysUntil(xem.expires_at) < 0 ? `Đã hết hạn ${Math.abs(daysUntil(xem.expires_at))} ngày` : `${daysUntil(xem.expires_at)} ngày` },
        ] : []}
        detailHref={xem ? `/inventory/batches/${xem.id}` : undefined}
      />
    </div>
  )
}
