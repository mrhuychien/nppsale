"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { ProductTable } from "@/components/products/product-table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ColumnPicker,
  FilterPicker,
} from "@/components/ui/list-view-toolbar"
import {
  BulkActionsBar,
  type BulkAction,
} from "@/components/ui/bulk-actions-bar"
import { useToast } from "@/hooks/use-toast"
import { Plus, Search, Package, PackageCheck, PackageX } from "lucide-react"
import type { Product } from "@/types"
import {
  PRODUCT_COLUMNS,
  DEFAULT_PRODUCT_COLUMNS,
  PRODUCT_FILTERS,
  DEFAULT_PRODUCT_FILTERS,
  type ProductFilterKey,
} from "./list-config"

export default function ProductsPage() {
  const { user, loading: authLoading } = useRoleGuard("products")
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [brandFilter, setBrandFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
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
    "products",
    DEFAULT_PRODUCT_COLUMNS,
    DEFAULT_PRODUCT_FILTERS
  )

  useEffect(() => {
    fetchProducts()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProducts() {
    setLoading(true)
    const { data } = await supabase
      .from("products")
      .select("*, price_lists(*)")
      .order("name")
    setProducts((data as Product[]) || [])
    setLoading(false)
  }

  const filterActive = (k: ProductFilterKey) => activeFilters.includes(k)

  const categories = useMemo(() => {
    const set = new Set<string>()
    products.forEach((p) => p.category && set.add(p.category))
    return Array.from(set).sort()
  }, [products])

  const brands = useMemo(() => {
    const set = new Set<string>()
    products.forEach((p) => p.brand && set.add(p.brand))
    return Array.from(set).sort()
  }, [products])

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (
        filterActive("search") &&
        search &&
        !(
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase()) ||
          (p.brand || "").toLowerCase().includes(search.toLowerCase())
        )
      )
        return false
      if (filterActive("category") && categoryFilter !== "all" && p.category !== categoryFilter)
        return false
      if (filterActive("brand") && brandFilter !== "all" && p.brand !== brandFilter)
        return false
      if (filterActive("status") && statusFilter !== "all" && p.status !== statusFilter)
        return false
      return true
    })
  }, [products, search, categoryFilter, brandFilter, statusFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const setStatusBulk = async (next: "active" | "inactive") => {
    if (selectedIds.size === 0) return
    setBulkSaving(true)
    const ids = Array.from(selectedIds)
    const { error } = await supabase
      .from("products")
      .update({ status: next })
      .in("id", ids)
    setBulkSaving(false)
    if (error) {
      toast({
        title: "Lỗi cập nhật trạng thái",
        description: error.message,
        variant: "destructive",
      })
      return
    }
    setProducts((prev) =>
      prev.map((p) => (selectedIds.has(p.id) ? { ...p, status: next } : p))
    )
    clearSelection()
    toast({
      title:
        next === "active"
          ? `Đã chuyển ${ids.length} SP sang Đang bán`
          : `Đã ngừng bán ${ids.length} SP`,
    })
  }

  const canEdit = !!user && hasPermission(user.role, "products", "update")
  const bulkActions: BulkAction[] = canEdit
    ? [
        {
          key: "active",
          label: "Đang bán",
          icon: PackageCheck,
          onClick: () => setStatusBulk("active"),
          loading: bulkSaving,
          variant: "default",
        },
        {
          key: "inactive",
          label: "Ngừng bán",
          icon: PackageX,
          onClick: () => setStatusBulk("inactive"),
          loading: bulkSaving,
          variant: "outline",
        },
      ]
    : []

  if (authLoading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader title="Sản phẩm" description={`${products.length} sản phẩm`}>
        {user && hasPermission(user.role, "products", "create") && (
          <Button onClick={() => router.push("/products/new")}>
            <Plus className="mr-2 h-4 w-4" /> Thêm sản phẩm
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm theo tên, SKU, nhãn hàng..."
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
        {filterActive("brand") && (
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Nhãn hàng" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả nhãn hàng</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
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
              <SelectItem value="all">Tất cả trạng thái</SelectItem>
              <SelectItem value="active">Đang bán</SelectItem>
              <SelectItem value="inactive">Ngừng bán</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <FilterPicker
            available={PRODUCT_FILTERS}
            value={activeFilters}
            onChange={setFilters}
            onReset={resetFilters}
          />
          <ColumnPicker
            available={PRODUCT_COLUMNS}
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
          icon={<Package className="h-8 w-8 text-muted-foreground" />}
          title="Không có sản phẩm phù hợp"
          description={
            products.length === 0
              ? "Bắt đầu bằng cách thêm sản phẩm đầu tiên"
              : "Thử điều chỉnh bộ lọc"
          }
        >
          {products.length === 0 &&
            user &&
            hasPermission(user.role, "products", "create") && (
              <Button onClick={() => router.push("/products/new")}>
                <Plus className="mr-2 h-4 w-4" /> Thêm sản phẩm
              </Button>
            )}
        </EmptyState>
      ) : (
        <ProductTable
          products={filtered}
          visibleColumns={visibleColumns}
          selectable={canEdit}
          selectedIds={selectedIds}
          onToggleSelect={toggleOne}
          onToggleSelectAll={toggleAll}
          allSelected={allSelected}
          someSelected={someSelected && !allSelected}
        />
      )}

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="sản phẩm"
      />
    </div>
  )
}
