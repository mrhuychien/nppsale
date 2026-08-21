"use client"

import { useEffect, useState } from "react"
import { usePagination } from "@/hooks/use-pagination"
import { DataPagination } from "@/components/ui/data-pagination"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient } from "@/lib/supabase/resilient"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { ProductTable } from "@/components/products/product-table"
import { ProductImportDialog } from "@/components/products/product-import-dialog"
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
import { Plus, Search, Package, PackageCheck, PackageX, Upload } from "lucide-react"
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
  const [loadError, setLoadError] = useState<string | null>(null)
  const [usedFallback, setUsedFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState<string>("all")
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [allCategories, setAllCategories] = useState<string[]>([])
  const [allSuppliers, setAllSuppliers] = useState<{ id: string; name: string }[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const pg = usePagination(50)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])
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

  // Load distinct category list + danh sách NCC (full) cho 2 dropdown.
  async function loadMeta() {
    const [catsRes, supRes] = await Promise.all([
      supabase.from("products").select("category"),
      supabase.from("suppliers").select("id, name").order("name"),
    ])
    const cats = new Set<string>()
    for (const p of (catsRes.data as Array<{ category: string | null }>) || []) {
      if (p.category) cats.add(p.category)
    }
    setAllCategories(Array.from(cats).sort())
    setAllSuppliers((supRes.data as { id: string; name: string }[]) || [])
  }
  useEffect(() => {
    loadMeta()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, categoryFilter, supplierFilter, statusFilter, activeFilters]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchProducts()
  }, [pg.from, pg.to, debouncedSearch, categoryFilter, supplierFilter, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProducts() {
    setLoading(true)
    // selectResilient: nếu DB production thiếu cột (lệch migration) thì tự
    // thử lại với '*' thay vì trả danh sách rỗng im lặng; luôn trả error
    // để hiển thị nguyên nhân cho người dùng.
    const build = (select: string) => {
      let q = supabase
        .from("products")
        .select(select, { count: "exact" })
        .order("name")
        .range(pg.from, pg.to)
      if (debouncedSearch) {
        const term = `%${debouncedSearch.replace(/[%_]/g, "\\$&")}%`
        q = q.or(`name.ilike.${term},sku.ilike.${term}`)
      }
      if (categoryFilter !== "all") q = q.eq("category", categoryFilter)
      if (supplierFilter !== "all") q = q.eq("primary_supplier_id", supplierFilter)
      if (statusFilter !== "all") q = q.eq("status", statusFilter)
      return q
    }
    const res = await selectResilient<Product>(
      build,
      "id, org_id, sku, name, category, brand, barcode, base_unit, vat_rate, shelf_life_days, status, created_at, description, warranty_info, cost_price, sell_price, track_serial, min_stock, max_stock, shelf_location, weight, weight_unit, direct_sale, images, allow_price_edit, price_edit_max_type, price_edit_max, primary_supplier_id, price_lists(*), supplier:suppliers!products_primary_supplier_id_fkey(id, name)",
      // eslint-disable-next-line no-restricted-syntax
      "*, price_lists(*), supplier:suppliers!products_primary_supplier_id_fkey(id, name)"
    )
    setProducts(res.data)
    setLoadError(res.error)
    setUsedFallback(res.usedFallback)
    pg.setTotal(res.count ?? 0)
    setLoading(false)
  }

  const filterActive = (k: ProductFilterKey) => activeFilters.includes(k)

  const categories = allCategories

  // Đã filter server-side toàn bộ — pass-through.
  const filtered = products

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
      <PageHeader title="Sản phẩm" description={`${pg.total} sản phẩm`}>
        {user && hasPermission(user.role, "products", "create") && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Nhập Excel
            </Button>
            <Button onClick={() => router.push("/products/new")}>
              <Plus className="mr-2 h-4 w-4" /> Thêm sản phẩm
            </Button>
          </div>
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
        {filterActive("supplier") && (
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Nhà cung cấp" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả nhà cung cấp</SelectItem>
              {allSuppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
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

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */}
      {loadError && !loading && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách sản phẩm</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}

      {/* Đang chạy đường dự phòng = DB thiếu cột so với ứng dụng. Trang vẫn
          dùng được nhưng đây là dấu hiệu chưa chạy đủ migration — phải báo,
          nếu không sự cố sẽ âm thầm kéo dài và các tính năng GHI dữ liệu
          vào những cột đó sẽ hỏng. */}
      {usedFallback && !loading && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <p className="font-semibold text-[#b54708]">
            Cảnh báo: cơ sở dữ liệu chưa chạy đủ migration
          </p>
          <p className="mt-0.5 text-on-surface-variant">
            Danh sách đang hiển thị bằng phương án dự phòng. Hãy chạy file
            <code className="mx-1 rounded bg-surface-container px-1 py-0.5 text-xs">
              supabase/diagnostics/check_migration_drift.sql
            </code>
            trong Supabase › SQL Editor để biết thiếu migration nào.
          </p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8 text-muted-foreground" />}
          title={loadError ? "Không tải được dữ liệu" : "Không có sản phẩm phù hợp"}
          description={
            loadError
              ? "Xem thông báo lỗi phía trên."
              : products.length === 0
                ? user?.role === "sales"
                  ? "Bạn chưa được gán nhà cung cấp nào, hoặc chưa có sản phẩm. NV bán hàng chỉ thấy sản phẩm thuộc NCC được gán — liên hệ quản lý để được gán NCC."
                  : "Bắt đầu bằng cách thêm sản phẩm đầu tiên"
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
        <>
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
          <DataPagination pg={pg} shownCount={filtered.length} />
        </>
      )}

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="sản phẩm"
      />

      <ProductImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          pg.reset()
          fetchProducts()
          loadMeta()
        }}
      />
    </div>
  )
}
