"use client"

import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_SAN_PHAM } from "@/lib/search/list-filter-fields"
import { useEffect, useState, useRef } from "react"
import { dieuKienTim } from "@/lib/search/list-search"
import { usePagination, MAC_DINH_MOI_TRANG } from "@/hooks/use-pagination"
import { StatusChips } from "@/components/ui/status-chips"
import { DocListLayout, DocListSearch, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient, type ResilientResult } from "@/lib/supabase/resilient"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { ProductTable, giaMacDinh, type ProductRow } from "@/components/products/product-table"
import { ProductImportDialog } from "@/components/products/product-import-dialog"
import { Button } from "@/components/ui/button"
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
import { useKhoMay } from "@/hooks/use-is-desktop"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { MobileProductsScreen } from "@/components/products/mobile-products-screen"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import {
  NCC_CHUA_GAN,
  NHAN_SAP_XEP_SP,
  chipNcc,
  demNccTuDong,
  docDemNcc,
  nhanSoSanPham,
  nhanXemThem,
  sapXepTiepTheo,
  soDangBan,
  type DemNccDong,
  type SapXepSanPham,
} from "@/lib/products/mobile-list"
import { Plus, Package, PackageCheck, PackageX, Upload } from "lucide-react"
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
  /** Vị trí lần tải trước — để "Tải thêm" không vẽ lại 20 dòng đầu (tải hai nhịp, 26/09/2026). */
  const khoaTaiRef = useRef<KhoaTai>(null)
  const [search, setSearch] = useState("")
  const [supplierFilter, setSupplierFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [allSuppliers, setAllSuppliers] = useState<{ id: string; name: string }[]>([])
  const [importOpen, setImportOpen] = useState(false)
  /** Điện thoại: "Tên A–Z" / "Tên Z–A" (máy tính luôn A–Z). */
  const [sapXep, setSapXep] = useState<SapXepSanPham>("name_asc")
  /** Điện thoại: chế độ "Chọn" nhiều thẻ (thao tác hàng loạt Đang bán / Ngừng bán). */
  const [dangChon, setDangChon] = useState(false)
  const laMay = useKhoMay()
  /** Tăng sau khi đổi trạng thái hàng loạt / nhập Excel — đếm lại chip NCC. */
  const [taiLaiDem, setTaiLaiDem] = useState(0)
  const pg = usePagination()
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const locNC = useAdvancedFilter("products", LOC_SAN_PHAM)
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
    DEFAULT_PRODUCT_FILTERS,
    PRODUCT_COLUMNS,
    PRODUCT_FILTERS
  )

  /* Danh sách NCC (full) cho ô lọc NCC.
     ⚠ BỎ TRƯỜNG NHÓM HÀNG / DANH MỤC (chủ nhà 03/10/2026, Update 3.10 mục 2: "gộp Nhóm hàng vào
     NCC" → "Bỏ luôn trường nhóm hàng"). Cột `products.category` vẫn giữ trong DB (dữ liệu cũ không
     mất) nhưng không còn ô lọc / cột / ô xem nhanh nào đọc nó — hàng được nhóm theo NCC. */
  async function loadMeta() {
    const supRes = await supabase.from("suppliers").select("id, name").order("name")
    if (supRes.error) console.error("[app/products] truy vấn lỗi:", supRes.error.message)
    setAllSuppliers((supRes.data as { id: string; name: string }[]) || [])
  }
  useEffect(() => {
    loadMeta()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, locNC.key, supplierFilter, statusFilter, activeFilters, sapXep]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchProducts()
  }, [pg.from, pg.to, debouncedSearch, locNC.key, supplierFilter, statusFilter, sapXep]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProducts() {
    // Tải thêm / đổi sang trang dài hơn: giữ danh sách đang hiện trong lúc chờ.
    if (!laTaiThem(khoaTaiRef, pg.from, pg.to, false)) setLoading(true)
    // selectResilient: nếu DB production thiếu cột (lệch migration) thì tự
    // thử lại với '*' thay vì trả danh sách rỗng im lặng; luôn trả error
    // để hiển thị nguyên nhân cho người dùng.
    const build = (select: string, from = pg.from, to = pg.to, dem = true) => {
      let q = supabase
        .from("products")
        .select(select, dem ? { count: "exact" } : undefined)
        .order("name", { ascending: sapXep === "name_asc" })
        /* Mốc phụ `id`: hai sản phẩm trùng tên không lặp / sót giữa hai trang. */
        .order("id")
        .range(from, to)
      if (debouncedSearch) {
        q = q.or(dieuKienTim("products", ["name", "sku"], debouncedSearch))
      }
      /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
      for (const f of locNC.menhDe) q = q.or(f)
      if (supplierFilter === NCC_CHUA_GAN) q = q.is("primary_supplier_id", null)
      else if (supplierFilter !== "all") q = q.eq("primary_supplier_id", supplierFilter)
      if (statusFilter !== "all") q = q.eq("status", statusFilter)
      return q
    }
    const res = await taiHaiNhip<Product, ResilientResult<Product>>(
      (from, to, dem) => selectResilient<Product>((sel) => build(sel, from, to, dem),
      "id, org_id, sku, name, category, brand, barcode, base_unit, vat_rate, shelf_life_days, status, created_at, description, warranty_info, cost_price, sell_price, track_serial, min_stock, max_stock, shelf_location, weight, weight_unit, direct_sale, images, allow_price_edit, price_edit_max_type, price_edit_max, primary_supplier_id, price_lists(*), supplier:suppliers!products_primary_supplier_id_fkey(id, name)",
      // eslint-disable-next-line no-restricted-syntax
      "*, price_lists(*), supplier:suppliers!products_primary_supplier_id_fkey(id, name)"),
      pg.from,
      pg.to,
      (dau) => {
        setProducts(dau.data)
        pg.setTotal(dau.count ?? 0)
        setLoading(false)
      },
      { boQuaDau: laTaiThem(khoaTaiRef, pg.from, pg.to) }
    )
    setProducts(res.data)
    setLoadError(res.error)
    setUsedFallback(res.usedFallback)
    pg.setTotal(res.count ?? 0)
    setLoading(false)
  }

  const filterActive = (k: ProductFilterKey) => activeFilters.includes(k)

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
    setTaiLaiDem((n) => n + 1)
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


  /* Số trên dải trạng thái — đếm ở máy chủ, cùng mọi bộ lọc khác của danh sách. */
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let huy = false
    ;(async () => {
      const one = async (st: string | null) => {
        let q = supabase.from("products").select("id", { count: "exact", head: true })
        if (debouncedSearch) q = q.or(dieuKienTim("products", ["name", "sku"], debouncedSearch))
        for (const f of locNC.menhDe) q = q.or(f)
        if (supplierFilter === NCC_CHUA_GAN) q = q.is("primary_supplier_id", null)
        else if (supplierFilter !== "all") q = q.eq("primary_supplier_id", supplierFilter)
        if (st) q = q.eq("status", st)
        const { count, error } = await q
        if (error) console.warn("[app/products] đếm lỗi:", error.message)
        return count ?? 0
      }
      const [active, inactive, all] = await Promise.all([one("active"), one("inactive"), one(null)])
      if (!huy) setCounts({ active, inactive, all })
    })()
    return () => { huy = true }
  }, [debouncedSearch, locNC.key, supplierFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * ĐIỆN THOẠI — SỐ TRÊN CHIP NCC (thiết kế "ds-san-pham" 30/09/2026): theo NCC chính của SP, cùng
   * ô tìm / lọc nâng cao nhưng BỎ NCC (chip là bộ lọc NCC) và BỎ trạng thái (lọc ở máy
   * khách để còn đếm "N đang bán"). Một lượt gom nhóm (mig 206); máy chủ chưa gom được thì tải hết
   * hai cột rồi đếm.
   */
  const [demNcc, setDemNcc] = useState<DemNccDong[] | null>(null)
  useEffect(() => {
    if (laMay !== false) return
    let huy = false
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loc = (q: any) => {
        if (debouncedSearch) q = q.or(dieuKienTim("products", ["name", "sku"], debouncedSearch))
        for (const f of locNC.menhDe) q = q.or(f)
        return q
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let d = docDemNcc(await loc(supabase.from("products").select("primary_supplier_id, status, count()" as string) as any))
      if (!d) {
        const kq = await fetchAllForAggregate<{ primary_supplier_id: string | null; status: string }>((from, to) =>
          loc(supabase.from("products").select("primary_supplier_id, status", { count: "exact" })).order("id").range(from, to)
        )
        if (kq.error) console.warn("[app/products] đếm theo NCC lỗi:", kq.error)
        d = kq.error ? null : demNccTuDong(kq.rows)
      }
      if (!huy) setDemNcc(d)
    })()
    return () => { huy = true }
  }, [laMay, debouncedSearch, locNC.key, taiLaiDem]) // eslint-disable-line react-hooks/exhaustive-deps

  const [xemId, setXemId] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? (products as ProductRow[]).find((p) => p.id === xemId) ?? null : null
  const supplierSelect = (
    <Select value={supplierFilter} onValueChange={setSupplierFilter}>
      <SelectTrigger aria-label="Nhà cung cấp" className="h-10 w-48 rounded-xl font-semibold">
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
  )
  const soLocKhac = supplierFilter !== "all" ? 1 : 0
  const xoaLocKhac = () => setSupplierFilter("all")
  const chips = [
    { key: "active", label: "Đang bán", count: counts.active ?? 0, accent: "#22c55e" },
    { key: "inactive", label: "Ngừng bán", count: counts.inactive ?? 0, accent: "#98a2b3" },
    { key: "all", label: "Tất cả", count: counts.all ?? 0, accent: "#181c1e" },
  ]
  const coQuyenTao = !!user && hasPermission(user.role, "products", "create")
  const nutTao = coQuyenTao && (
    <Button onClick={() => router.push("/products/new")}>
      <Plus className="mr-2 h-4 w-4" /> Thêm sản phẩm
    </Button>
  )

  /* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. */
  const canhBao = (
    <>
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
    </>
  )
  /* Điện thoại: NCC đã là hàng chip — nút lọc đếm lọc nâng cao. */
  const soLocDienThoai = locNC.soDangAp
  const chipsNcc = demNcc ? chipNcc(demNcc, allSuppliers, statusFilter) : [{ key: "all", label: "Tất cả", count: pg.total }]

  const rong = (
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
  )

  return (
    <div className="space-y-4">
      <PageHeader className="max-lg:hidden" title="Sản phẩm" descriptionDesktopOnly description={`${pg.total} sản phẩm`}>
        {coQuyenTao && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Nhập Excel
            </Button>
            {nutTao}
          </div>
        )}
      </PageHeader>

      {filterActive("status") && (
        <StatusChips className="max-lg:hidden" active={statusFilter} onPick={setStatusFilter} chips={chips} />
      )}

      {/* Lỗi tải / cảnh báo migration — điện thoại hiện trong màn riêng (ngay trên danh sách). */}
      <div className="space-y-4 max-lg:hidden empty:hidden">{canhBao}</div>

      <MobileProductsScreen
        subtitle={demNcc ? `${soDangBan(demNcc).toLocaleString("vi-VN")} đang bán` : `${pg.total.toLocaleString("vi-VN")} sản phẩm`}
        search={search}
        onSearch={setSearch}
        canCreate={coQuyenTao}
        filter={{ activeCount: soLocDienThoai, onOpen: () => setFilterSheet(true) }}
        status={filterActive("status") && (counts.inactive ?? 0) > 0 ? { chips, active: statusFilter, onPick: setStatusFilter } : null}
        chips={chipsNcc}
        ncc={supplierFilter}
        onPickNcc={setSupplierFilter}
        countText={nhanSoSanPham(pg.total)}
        sortLabel={NHAN_SAP_XEP_SP[sapXep]}
        onToggleSort={() => setSapXep(sapXepTiepTheo)}
        selectable={canEdit}
        selecting={dangChon}
        onToggleSelecting={() => { setDangChon((v) => !v); clearSelection() }}
        selectedIds={selectedIds}
        onToggleSelect={toggleOne}
        items={filtered as ProductRow[]}
        loading={loading}
        empty={rong}
        moreLabel={nhanXemThem(pg.from + filtered.length, pg.total)}
        onMore={() => pg.setPageSize(pg.pageSize + MAC_DINH_MOI_TRANG)}
        onOpen={(p) => setXemId(p.id)}
        notice={canhBao}
      />
      <div className="lg:hidden">
        <MobileFilterBar
          chiNganLoc
          value={search}
          onChange={setSearch}
          activeCount={soLocDienThoai}
          onClear={() => locNC.xoa()}
          open={filterSheet}
          onOpenChange={setFilterSheet}
        >
          <div className="grid gap-4">
            <AdvancedFilter truong={LOC_SAN_PHAM} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
          </div>
        </MobileFilterBar>
      </div>

      <DocListLayout
        toolbar={
          <>
            {filterActive("search") && <DocListSearch value={search} onChange={setSearch} placeholder="Tìm theo tên, SKU, nhãn hàng..." />}
            {filterActive("supplier") && supplierSelect}
            <XoaLocButton show={!!search || soLocKhac > 0} onClick={() => { setSearch(""); xoaLocKhac() }} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_SAN_PHAM} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={PRODUCT_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={PRODUCT_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        /* Danh mục hàng, không phải chứng từ — không có tiền để cộng. */
        totals={null}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={rong}
        pg={pg}
        shownCount={filtered.length}
        table={
          <ProductTable
            products={filtered}
            visibleColumns={visibleColumns}
            selectable={canEdit}
            selectedIds={selectedIds}
            onToggleSelect={toggleOne}
            onToggleSelectAll={toggleAll}
            allSelected={allSelected}
            someSelected={someSelected && !allSelected}
            activeId={xemId}
            onOpen={(p) => setXemId(p.id)}
            /* Bấm "Tên" trên lưới = cùng nút "Tên A–Z / Z–A" của điện thoại — xếp ở máy chủ. */
            sort={{ key: "name", dir: sapXep === "name_asc" ? "asc" : "desc" }}
            onSortChange={(s) => setSapXep(s.dir === "asc" ? "name_asc" : "name_desc")}
          />
        }
        /* Điện thoại: màn riêng theo thiết kế "ds-san-pham" (`MobileProductsScreen`). */
        cards={null}
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.sku ?? "Sản phẩm"}
        subtitle={xem?.name}
        badge={xem ? <Badge variant={xem.status === "active" ? "success" : "secondary"}>{xem.status === "active" ? "Đang bán" : "Ngừng"}</Badge> : null}
        fields={xem ? [
          { label: "Tên sản phẩm", value: xem.name, wide: true },
          { label: "Nhà cung cấp", value: xem.supplier?.name },
          { label: "ĐVT", value: xem.base_unit },
          { label: "Mã vạch", value: xem.barcode },
        ] : []}
        total={xem ? { label: "Giá bán", value: giaMacDinh(xem) > 0 ? formatCurrency(giaMacDinh(xem)) : "-" } : undefined}
        detailHref={xem ? `/products/${xem.id}` : undefined}
      />

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
          setTaiLaiDem((n) => n + 1)
        }}
      />
    </div>
  )
}
