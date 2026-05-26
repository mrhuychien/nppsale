"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { BulkActionsBar, type BulkAction } from "@/components/ui/bulk-actions-bar"
import { useToast } from "@/hooks/use-toast"
import { Plus, Search, Factory, CheckCircle2, Phone, MapPin, Power, PowerOff } from "lucide-react"
import type { Supplier } from "@/types"
import {
  SUPPLIER_COLUMNS,
  DEFAULT_SUPPLIER_COLUMNS,
  SUPPLIER_FILTERS,
  DEFAULT_SUPPLIER_FILTERS,
  type SupplierFilterKey,
} from "./list-config"

export default function SuppliersPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
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
    "suppliers",
    DEFAULT_SUPPLIER_COLUMNS,
    DEFAULT_SUPPLIER_FILTERS
  )

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      const { data } = await supabase
        .from("suppliers")
        .select("*")
        .order("name")
      setSuppliers((data as Supplier[]) || [])
      setLoading(false)
    }
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filterActive = (k: SupplierFilterKey) => activeFilters.includes(k)
  const show = (k: (typeof SUPPLIER_COLUMNS)[number]["key"]) => visibleColumns.includes(k)

  const categories = useMemo(() => {
    const set = new Set<string>()
    suppliers.forEach((s) => s.category && set.add(s.category))
    return Array.from(set).sort()
  }, [suppliers])

  const filtered = useMemo(() => {
    return suppliers.filter((s) => {
      if (filterActive("search") && search) {
        const q = search.toLowerCase()
        const matches =
          s.name.toLowerCase().includes(q) ||
          (s.code && s.code.toLowerCase().includes(q))
        if (!matches) return false
      }
      if (filterActive("category") && categoryFilter !== "all" && s.category !== categoryFilter)
        return false
      if (filterActive("status") && statusFilter !== "all") {
        const isActive = statusFilter === "active"
        if (s.is_active !== isActive) return false
      }
      return true
    })
  }, [suppliers, search, categoryFilter, statusFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleOne = (id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (next) s.add(id)
      else s.delete(id)
      return s
    })
  }
  const toggleAll = (next: boolean) => {
    setSelectedIds(next ? new Set(filtered.map((s) => s.id)) : new Set())
  }
  const clearSelection = () => setSelectedIds(new Set())

  const allSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id))
  const someSelected = filtered.some((s) => selectedIds.has(s.id))

  const setActiveBulk = async (next: boolean) => {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    const ids = Array.from(selectedIds)
    const { error } = await supabase
      .from("suppliers")
      .update({ is_active: next })
      .in("id", ids)
    setBulkSaving(false)
    if (error) {
      toast({ title: "Lỗi cập nhật trạng thái", description: error.message, variant: "destructive" })
      return
    }
    setSuppliers((prev) =>
      prev.map((s) => (selectedIds.has(s.id) ? { ...s, is_active: next } : s))
    )
    clearSelection()
    toast({
      title: next ? `Đã kích hoạt ${ids.length} NCC` : `Đã ngưng ${ids.length} NCC`,
    })
  }

  const canEdit = !!user && hasPermission(user.role, "inventory", "update")
  const bulkActions: BulkAction[] = canEdit
    ? [
        {
          key: "activate",
          label: "Kích hoạt",
          icon: Power,
          onClick: () => setActiveBulk(true),
          loading: bulkSaving,
          variant: "default",
        },
        {
          key: "deactivate",
          label: "Ngưng",
          icon: PowerOff,
          onClick: () => setActiveBulk(false),
          loading: bulkSaving,
          variant: "outline",
        },
      ]
    : []

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Nhà cung cấp" description={`${suppliers.length} nhà cung cấp`}>
        {user && hasPermission(user.role, "inventory", "create") && (
          <Button onClick={() => router.push("/suppliers/new")}>
            <Plus className="mr-2 h-4 w-4" /> Tạo mới
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm tên, mã NCC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
        {filterActive("category") && (
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Danh mục" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả danh mục</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterActive("status") && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Trạng thái" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="active">Hoạt động</SelectItem>
              <SelectItem value="inactive">Ngưng</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FilterPicker
            available={SUPPLIER_FILTERS}
            value={activeFilters}
            onChange={setFilters}
            onReset={resetFilters}
          />
          <ColumnPicker
            available={SUPPLIER_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Factory className="h-8 w-8 text-muted-foreground" />}
          title={suppliers.length === 0 ? "Chưa có nhà cung cấp" : "Không tìm thấy NCC phù hợp"}
          description={
            suppliers.length === 0
              ? "Bắt đầu bằng cách thêm nhà cung cấp đầu tiên"
              : "Thử điều chỉnh bộ lọc"
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {canEdit && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected ? true : someSelected ? "indeterminate" : false}
                        onCheckedChange={(v) => toggleAll(!!v)}
                        aria-label="Chọn tất cả"
                      />
                    </TableHead>
                  )}
                  {show("code") && <TableHead>Mã NCC</TableHead>}
                  <TableHead>Tên</TableHead>
                  {show("category") && <TableHead>Danh mục</TableHead>}
                  {show("contact") && <TableHead>Liên hệ</TableHead>}
                  {show("phone") && <TableHead>SĐT</TableHead>}
                  {show("status") && <TableHead>Trạng thái</TableHead>}
                  {show("action") && <TableHead>Hành động</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => {
                  const checked = selectedIds.has(s.id)
                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => router.push(`/suppliers/${s.id}`)}
                    >
                      {canEdit && (
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleOne(s.id, !!v)}
                            aria-label={`Chọn ${s.name}`}
                          />
                        </TableCell>
                      )}
                      {show("code") && (
                        <TableCell className="font-mono text-xs font-bold text-primary">
                          {s.code}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="font-semibold">{s.name}</div>
                      </TableCell>
                      {show("category") && (
                        <TableCell className="text-muted-foreground">
                          {s.category || "-"}
                        </TableCell>
                      )}
                      {show("contact") && (
                        <TableCell className="text-muted-foreground">
                          {s.contact_name || "-"}
                        </TableCell>
                      )}
                      {show("phone") && (
                        <TableCell className="text-muted-foreground">
                          {s.phone || "-"}
                        </TableCell>
                      )}
                      {show("status") && (
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {s.is_verified && (
                              <Badge variant="success" className="gap-1">
                                <CheckCircle2 className="h-3 w-3" />
                                Đã xác minh
                              </Badge>
                            )}
                            <Badge variant={s.is_active ? "default" : "danger"}>
                              {s.is_active ? "Hoạt động" : "Ngưng"}
                            </Badge>
                          </div>
                        </TableCell>
                      )}
                      {show("action") && (
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              router.push(`/suppliers/${s.id}`)
                            }}
                          >
                            Chi tiết
                          </Button>
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
            {filtered.map((s) => {
              const checked = selectedIds.has(s.id)
              return (
                <div
                  key={s.id}
                  className="relative rounded-xl border border-outline-variant/60 bg-surface-container-lowest shadow-card overflow-hidden active:scale-[0.99] transition-transform"
                >
                  <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-r ${s.is_active ? "bg-primary" : "bg-danger"}`} />
                  <div className="p-4 pl-5">
                    <div className="flex justify-between items-start gap-3 mb-2">
                      {canEdit && (
                        <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => toggleOne(s.id, !!v)}
                            aria-label={`Chọn ${s.name}`}
                          />
                        </div>
                      )}
                      <div
                        className="min-w-0 flex-1 cursor-pointer"
                        onClick={() => router.push(`/suppliers/${s.id}`)}
                      >
                        <p className="text-[10px] font-bold text-primary/80 font-mono">{s.code}</p>
                        <h3 className="font-extrabold text-base leading-tight truncate">{s.name}</h3>
                        {s.contact_name && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{s.contact_name}</p>
                        )}
                        {s.phone && (
                          <div className="flex items-center gap-1 text-muted-foreground mt-1">
                            <Phone className="h-3 w-3 shrink-0" />
                            <p className="text-xs">{s.phone}</p>
                          </div>
                        )}
                        {s.address && (
                          <div className="flex items-center gap-1 text-muted-foreground mt-1">
                            <MapPin className="h-3 w-3 shrink-0" />
                            <p className="text-xs truncate">{s.address}</p>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {s.is_verified && (
                          <Badge variant="success" className="gap-1 whitespace-nowrap">
                            <CheckCircle2 className="h-3 w-3" />
                            Xác minh
                          </Badge>
                        )}
                        <Badge variant={s.is_active ? "default" : "danger"}>
                          {s.is_active ? "Hoạt động" : "Ngưng"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="nhà cung cấp"
      />
    </div>
  )
}
