"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useToast } from "@/hooks/use-toast"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
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
import { PROMOTION_TYPES } from "@/lib/constants"
import { Tag, Plus, TrendingUp, Trophy, Search, Power, PowerOff } from "lucide-react"
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
    DEFAULT_PROMOTION_FILTERS
  )
  const show = (k: PromotionColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: PromotionFilterKey) => activeFilters.includes(k)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("promotions")
        .select("*")
        .order("priority", { ascending: false })
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
        if (!p.name.toLowerCase().includes(search.toLowerCase())) return false
      }
      if (filterActive("type") && typeFilter !== "all" && p.type !== typeFilter)
        return false
      if (filterActive("status") && statusFilter !== "all") {
        const isActive = statusFilter === "active"
        if (p.is_active !== isActive) return false
      }
      return true
    })
  }, [promotions, search, typeFilter, statusFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  const topPromos = [...promotions]
    .filter((p) => p.is_active)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)

  const medalColors = ["bg-[#fff4ed] text-[#b54708]", "bg-surface-container-low text-on-surface-variant", "bg-[#fff4ed] text-[#c2410c]"]

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

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Khuyến mãi" description={`${promotions.length} chương trình`}>
        {user && hasPermission(user.role, "promotions", "create") && (
          <Button onClick={() => router.push("/promotions/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo KM
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm tên chương trình..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
        {filterActive("type") && (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Loại KM" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả loại</SelectItem>
              {PROMOTION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterActive("status") && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36"><SelectValue placeholder="Trạng thái" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="active">Đang chạy</SelectItem>
              <SelectItem value="inactive">Ngừng</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FilterPicker
            available={PROMOTION_FILTERS}
            value={activeFilters}
            onChange={setFilters}
            onReset={resetFilters}
          />
          <ColumnPicker
            available={PROMOTION_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div>
          {filtered.length === 0 ? (
            <EmptyState
              icon={<Tag className="h-8 w-8 text-muted-foreground" />}
              title={
                promotions.length === 0
                  ? "Chưa có chương trình khuyến mãi"
                  : "Không có KM phù hợp"
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto rounded-2xl border bg-card shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      {canEdit && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allSelected ? true : someSelected && !allSelected ? "indeterminate" : false}
                            onCheckedChange={(v) => toggleAll(!!v)}
                            aria-label="Chọn tất cả"
                          />
                        </TableHead>
                      )}
                      <TableHead>Tên chương trình</TableHead>
                      {show("type") && <TableHead>Loại</TableHead>}
                      {show("priority") && <TableHead>Ưu tiên</TableHead>}
                      {show("period") && <TableHead>Thời gian</TableHead>}
                      {show("status") && <TableHead>Trạng thái</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((p) => {
                      const checked = selectedIds.has(p.id)
                      return (
                        <TableRow
                          key={p.id}
                          className="cursor-pointer hover:bg-muted/40"
                          onClick={() => router.push(`/promotions/${p.id}`)}
                        >
                          {canEdit && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggleOne(p.id, !!v)}
                                aria-label={`Chọn ${p.name}`}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-medium">{p.name}</TableCell>
                          {show("type") && (
                            <TableCell>
                              <Badge variant="outline">{getTypeLabel(p.type)}</Badge>
                            </TableCell>
                          )}
                          {show("priority") && <TableCell>{p.priority}</TableCell>}
                          {show("period") && (
                            <TableCell className="text-sm">
                              {p.starts_at ? formatDate(p.starts_at) : "?"} -{" "}
                              {p.ends_at ? formatDate(p.ends_at) : "∞"}
                            </TableCell>
                          )}
                          {show("status") && (
                            <TableCell>
                              <Badge variant={p.is_active ? "success" : "secondary"}>
                                {p.is_active ? "Đang chạy" : "Ngừng"}
                              </Badge>
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
                {filtered.map((p) => {
                  const checked = selectedIds.has(p.id)
                  return (
                    <div
                      key={p.id}
                      className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden active:scale-[0.99] transition-transform"
                    >
                      <div className="p-4">
                        <div className="flex justify-between items-start gap-3 mb-2">
                          {canEdit && (
                            <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggleOne(p.id, !!v)}
                                aria-label={`Chọn ${p.name}`}
                              />
                            </div>
                          )}
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => router.push(`/promotions/${p.id}`)}
                          >
                            <h3 className="font-extrabold text-base leading-tight">
                              {p.name}
                            </h3>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              <Badge variant="outline" className="text-xs">{getTypeLabel(p.type)}</Badge>
                              <Badge variant="outline" className="text-xs">Ưu tiên: P{p.priority}</Badge>
                            </div>
                          </div>
                          <div className="shrink-0">
                            <Badge variant={p.is_active ? "success" : "secondary"}>
                              {p.is_active ? "Đang chạy" : "Ngừng"}
                            </Badge>
                          </div>
                        </div>
                        <div className="pt-2 mt-2 border-t text-xs text-muted-foreground">
                          {p.starts_at ? formatDate(p.starts_at) : "?"} - {p.ends_at ? formatDate(p.ends_at) : "∞"}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* ROI sidebar */}
        <Card className="rounded-xl shadow-card h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-primary" />
              So sánh ROI
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Top 3 chương trình theo độ ưu tiên
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {topPromos.length === 0 ? (
              <div className="text-sm text-muted-foreground italic">
                Chưa có chương trình hoạt động
              </div>
            ) : (
              topPromos.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border p-3 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => router.push(`/promotions/${p.id}`)}
                >
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${medalColors[i]}`}
                  >
                    <Trophy className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {getTypeLabel(p.type)}
                    </div>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    P{p.priority}
                  </Badge>
                </div>
              ))
            )}
            <div className="pt-2 text-xs text-muted-foreground border-t">
              Dữ liệu lượt áp dụng sắp cập nhật
            </div>
          </CardContent>
        </Card>
      </div>

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="chương trình"
      />
    </div>
  )
}
