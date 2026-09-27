"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { khopLoc } from "@/lib/search/advanced-filter"
import { LOC_KHUYEN_MAI } from "@/lib/search/list-filter-fields"
import { useToast } from "@/hooks/use-toast"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusChips } from "@/components/ui/status-chips"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { DocListLayout, DocListSearch, LocNhanhField, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/ui/empty-state"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { BulkActionsBar, type BulkAction } from "@/components/ui/bulk-actions-bar"
import { formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { PROMOTION_TYPES } from "@/lib/constants"
import { Tag, Plus, Trophy, Power, PowerOff } from "lucide-react"
import type { Promotion } from "@/types"
import {
  PROMOTION_COLUMNS,
  DEFAULT_PROMOTION_COLUMNS,
  PROMOTION_FILTERS,
  DEFAULT_PROMOTION_FILTERS,
  type PromotionColumnKey,
  type PromotionFilterKey,
} from "./list-config"

export default function PromotionsPage() {
  const { user, loading: authLoading } = useRoleGuard("promotions")
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const { toast } = useToast()

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "promotions",
    DEFAULT_PROMOTION_COLUMNS,
    DEFAULT_PROMOTION_FILTERS,
    PROMOTION_COLUMNS,
    PROMOTION_FILTERS
  )
  const filterActive = (k: PromotionFilterKey) => activeFilters.includes(k)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). Màn tải hết → lọc ở trình duyệt. */
  const locNC = useAdvancedFilter("promotions", LOC_KHUYEN_MAI)

  useEffect(() => {
    async function fetch() {
      const { data, error: dataErr } = await supabase
        .from("promotions")
        .select("id, name, type, priority, starts_at, ends_at, is_active, created_at")
        .order("priority", { ascending: false })
      if (dataErr) console.error("[app/promotions] truy vấn lỗi:", dataErr.message)
      setPromotions((data as Promotion[]) || [])
      setLoading(false)
    }
    fetch()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const getTypeLabel = (type: string) =>
    PROMOTION_TYPES.find((t) => t.value === type)?.label || type

  const filtered = useMemo(() => {
    return promotions.filter((p) => {
      if (filterActive("search") && search) {
        if (!viMatchAllWords(search, p.name)) return false
      }
      if (filterActive("type") && typeFilter !== "all" && p.type !== typeFilter)
        return false
      if (filterActive("status") && statusFilter !== "all") {
        const isActive = statusFilter === "active"
        if (p.is_active !== isActive) return false
      }
      if (!khopLoc(p, LOC_KHUYEN_MAI, locNC.dieuKien)) return false
      return true
    })
  }, [promotions, search, typeFilter, statusFilter, activeFilters, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const topPromos = [...promotions]
    .filter((p) => p.is_active)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)


  const toggleOne = (id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (next) s.add(id)
      else s.delete(id)
      return s
    })
  }
  const toggleAll = (next: boolean) => {
    setSelectedIds(next ? new Set(filtered.map((p) => p.id)) : new Set())
  }
  const clearSelection = () => setSelectedIds(new Set())

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id))
  const someSelected = filtered.some((p) => selectedIds.has(p.id))

  const setActiveBulk = async (next: boolean) => {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    const ids = Array.from(selectedIds)
    const { error } = await supabase
      .from("promotions")
      .update({ is_active: next })
      .in("id", ids)
    setBulkSaving(false)
    if (error) {
      toast({ title: "Lỗi cập nhật", description: error.message, variant: "destructive" })
      return
    }
    setPromotions((prev) =>
      prev.map((p) => (selectedIds.has(p.id) ? { ...p, is_active: next } : p))
    )
    clearSelection()
    toast({
      title: next ? `Đã bật ${ids.length} chương trình` : `Đã ngừng ${ids.length} chương trình`,
    })
  }

  const canEdit = !!user && hasPermission(user.role, "promotions", "update")
  const bulkActions: BulkAction[] = canEdit
    ? [
        {
          key: "activate",
          label: "Đang chạy",
          icon: Power,
          onClick: () => setActiveBulk(true),
          loading: bulkSaving,
          variant: "default",
        },
        {
          key: "deactivate",
          label: "Ngừng",
          icon: PowerOff,
          onClick: () => setActiveBulk(false),
          loading: bulkSaving,
          variant: "outline",
        },
      ]
    : []

  const [xemId, setXemId] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)

  /* Số trên dải trạng thái — đếm trên mọi bộ lọc TRỪ trạng thái. */
  const counts = useMemo(() => {
    const c = { active: 0, inactive: 0, all: 0 }
    for (const p of promotions) {
      if (filterActive("search") && search && !viMatchAllWords(search, p.name)) continue
      if (filterActive("type") && typeFilter !== "all" && p.type !== typeFilter) continue
      if (!khopLoc(p, LOC_KHUYEN_MAI, locNC.dieuKien)) continue
      c.all += 1
      c[p.is_active ? "active" : "inactive"] += 1
    }
    return c
  }, [promotions, search, typeFilter, activeFilters, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const { pg, trang } = usePhanTrangTaiCho(filtered, JSON.stringify([search, typeFilter, statusFilter, activeFilters, locNC.key]))
  const thoiGian = (p: Promotion) => `${p.starts_at ? formatDate(p.starts_at) : "?"} - ${p.ends_at ? formatDate(p.ends_at) : "∞"}`

  const columns = useMemo(() => {
    const cols: Array<DocColumn<Promotion> & { k?: PromotionColumnKey }> = [
      ...(canEdit
        ? [{
            key: "select",
            label: (
              <Checkbox
                checked={allSelected ? true : someSelected && !allSelected ? "indeterminate" : false}
                onCheckedChange={(v) => toggleAll(!!v)}
                aria-label="Chọn tất cả"
              />
            ),
            width: "44px",
            render: (p: Promotion) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={(v) => toggleOne(p.id, !!v)} aria-label={`Chọn ${p.name}`} />
              </span>
            ),
          }]
        : []),
      {
        key: "name", label: "Tên chương trình", width: "minmax(240px,2fr)",
        sort: (a, b) => (a.name ?? "").localeCompare(b.name ?? "", "vi"),
        render: (p) => <DocCodeLink href={`/promotions/${p.id}`}>{p.name}</DocCodeLink>,
      },
      { k: "type", key: "type", label: "Loại", width: "160px", render: (p) => <Badge variant="outline">{getTypeLabel(p.type)}</Badge> },
      { k: "priority", key: "priority", label: "Ưu tiên", width: "100px", align: "right", sort: (a, b) => a.priority - b.priority, render: (p) => p.priority },
      { k: "period", key: "period", label: "Thời gian", width: "200px", render: (p) => <DocCellText muted>{thoiGian(p)}</DocCellText> },
      {
        k: "status", key: "status", label: "Trạng thái", width: "120px",
        render: (p) => <Badge variant={p.is_active ? "success" : "secondary"}>{p.is_active ? "Đang chạy" : "Ngừng"}</Badge>,
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, canEdit, selectedIds, allSelected, someSelected, filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? promotions.find((p) => p.id === xemId) ?? null : null
  const typeSelect = (
    <Select value={typeFilter} onValueChange={setTypeFilter}>
      <SelectTrigger aria-label="Loại KM" className="h-10 w-44 rounded-xl font-semibold"><SelectValue placeholder="Loại KM" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tất cả loại</SelectItem>
        {PROMOTION_TYPES.map((t) => (
          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  /* "So sánh ROI" cũ — top 3 theo ưu tiên — gọn thành một dòng phụ dưới dòng thống kê. */
  const topNote = topPromos.length > 0 ? (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold text-on-surface-variant">
      <span className="inline-flex items-center gap-1"><Trophy className="h-3.5 w-3.5 text-[#b54708]" /> Ưu tiên cao nhất:</span>
      {topPromos.map((p) => (
        <button key={p.id} type="button" onClick={() => setXemId(p.id)} className="font-bold text-on-surface hover:underline">
          {p.name} <span className="text-on-surface-variant">P{p.priority}</span>
        </button>
      ))}
    </p>
  ) : null

  return (
    <div className="space-y-4">
      <PageHeader title="Khuyến mãi" descriptionDesktopOnly description={`${promotions.length} chương trình`}>
        {user && hasPermission(user.role, "promotions", "create") && (
          <Button onClick={() => router.push("/promotions/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo KM
          </Button>
        )}
      </PageHeader>

      {filterActive("status") && (
        <StatusChips
          active={statusFilter}
          onPick={setStatusFilter}
          chips={[
            { key: "active", label: "Đang chạy", count: counts.active, accent: "#22c55e" },
            { key: "inactive", label: "Ngừng", count: counts.inactive, accent: "#98a2b3" },
            { key: "all", label: "Tất cả", count: counts.all, accent: "#181c1e" },
          ]}
        />
      )}

      <MobileFilterBar
        value={search}
        onChange={setSearch}
        placeholder="Tìm tên chương trình..."
        activeCount={(typeFilter !== "all" ? 1 : 0) + locNC.soDangAp}
        onClear={() => { setTypeFilter("all"); locNC.xoa() }}
        open={filterSheet}
        onOpenChange={setFilterSheet}
      >
        <div className="grid gap-4">
          {filterActive("type") && <LocNhanhField label="Loại KM">{typeSelect}</LocNhanhField>}
          <AdvancedFilter truong={LOC_KHUYEN_MAI} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
        </div>
      </MobileFilterBar>

      <DocListLayout
        toolbar={
          <>
            {filterActive("search") && <DocListSearch value={search} onChange={setSearch} placeholder="Tìm tên chương trình..." />}
            {filterActive("type") && typeSelect}
            <XoaLocButton show={!!search || typeFilter !== "all"} onClick={() => { setSearch(""); setTypeFilter("all") }} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_KHUYEN_MAI} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={PROMOTION_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={PROMOTION_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        totals={null}
        totalsNote={topNote}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={
          <EmptyState
            icon={<Tag className="h-8 w-8 text-muted-foreground" />}
            title={promotions.length === 0 ? "Chưa có chương trình khuyến mãi" : "Không có KM phù hợp"}
          />
        }
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(p) => setXemId(p.id)} />}
        cards={
          <DocCardList
            items={trang}
            onOpen={(p) => setXemId(p.id)}
            select={canEdit ? { checked: (p) => selectedIds.has(p.id), onChange: (p, v) => toggleOne(p.id, v) } : undefined}
            card={(p) => ({
              accent: p.is_active ? "#22c55e" : "#98a2b3",
              title: p.name,
              total: `P${p.priority}`,
              meta: thoiGian(p),
              payment: getTypeLabel(p.type),
              badge: p.is_active ? null : { label: "Ngừng", bg: "#eef1f5", fg: "#565a67" },
            })}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.name ?? "Khuyến mãi"}
        subtitle={xem ? thoiGian(xem) : undefined}
        badge={xem ? <Badge variant={xem.is_active ? "success" : "secondary"}>{xem.is_active ? "Đang chạy" : "Ngừng"}</Badge> : null}
        fields={xem ? [
          { label: "Loại", value: getTypeLabel(xem.type) },
          { label: "Ưu tiên", value: `P${xem.priority}` },
          { label: "Bắt đầu", value: xem.starts_at ? formatDate(xem.starts_at) : "?" },
          { label: "Kết thúc", value: xem.ends_at ? formatDate(xem.ends_at) : "∞" },
        ] : []}
        detailHref={xem ? `/promotions/${xem.id}` : undefined}
      />

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="chương trình"
      />
    </div>
  )
}
