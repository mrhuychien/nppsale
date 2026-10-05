"use client"

import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_NHA_CUNG_CAP } from "@/lib/search/list-filter-fields"
import { useEffect, useMemo, useState, useRef } from "react"
import { dieuKienTim } from "@/lib/search/list-search"
import { usePagination, MAC_DINH_MOI_TRANG } from "@/hooks/use-pagination"
import { StatusChips } from "@/components/ui/status-chips"
import { DocListLayout, DocListSearch, LocNhanhField, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { apSapXep, xepDuoc, SAP_XEP_NCC, type DocSort } from "@/lib/list/sap-xep-may-chu"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { selectResilient, type ResilientResult } from "@/lib/supabase/resilient"
import { taiHaiNhip, laTaiThem, type KhoaTai } from "@/lib/supabase/hai-nhip"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { BulkActionsBar, type BulkAction } from "@/components/ui/bulk-actions-bar"
import { SupplierImportDialog } from "@/components/suppliers/supplier-import-dialog"
import { MobileSuppliersScreen } from "@/components/suppliers/mobile-suppliers-screen"
import { MergeSupplierDialog } from "@/components/suppliers/merge-supplier-dialog"
import { duocGopNcc } from "@/lib/suppliers/chi-tiet"
import { MobileFilterBar } from "@/components/ui/mobile-filter-bar"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { timTrungTen, nhanTrungTen, nhanSoNcc, type NccTen } from "@/lib/suppliers/mobile-list"
import { nhanXemThem } from "@/lib/products/mobile-list"
import { useToast } from "@/hooks/use-toast"
import { Plus, Factory, CheckCircle2, Power, PowerOff, Upload, Merge } from "lucide-react"
import type { Supplier } from "@/types"
import {
  SUPPLIER_COLUMNS,
  DEFAULT_SUPPLIER_COLUMNS,
  SUPPLIER_FILTERS,
  DEFAULT_SUPPLIER_FILTERS,
  type SupplierColumnKey,
  type SupplierFilterKey,
} from "./list-config"

export default function SuppliersPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** Vị trí lần tải trước — để "Tải thêm" không vẽ lại 20 dòng đầu (tải hai nhịp, 26/09/2026). */
  const khoaTaiRef = useRef<KhoaTai>(null)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [allCategories, setAllCategories] = useState<string[]>([])
  const [importOpen, setImportOpen] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [gopOpen, setGopOpen] = useState(false)
  const pg = usePagination()
  /** Thứ tự người dùng bấm trên tiêu đề — gửi xuống máy chủ (`SAP_XEP_NCC`). */
  const [sort, setSort] = useState<DocSort | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const locNC = useAdvancedFilter("suppliers", LOC_NHA_CUNG_CAP)
  /** Toàn bộ tên NCC — để phát hiện trùng tên (thiết kế "ds-ncc", 30/09/2026). */
  const [tatCaTen, setTatCaTen] = useState<NccTen[]>([])
  /** Bấm "Gộp" ở băng trùng tên → lọc về các NCC trùng tên; gộp thật ở nút "Gộp" khi chọn 2+ NCC (mig 232). */
  const [locTrung, setLocTrung] = useState(false)
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
    "suppliers",
    DEFAULT_SUPPLIER_COLUMNS,
    DEFAULT_SUPPLIER_FILTERS,
    SUPPLIER_COLUMNS,
    SUPPLIER_FILTERS
  )

  // Distinct categories cho dropdown (load 1 lần).
  useEffect(() => {
    async function loadCats() {
      const { data, error: dataErr } = await supabase.from("suppliers").select("category")
      if (dataErr) console.error("[app/suppliers] truy vấn lỗi:", dataErr.message)
      const set = new Set<string>()
      for (const s of (data as Array<{ category: string | null }>) || []) {
        if (s.category) set.add(s.category)
      }
      setAllCategories(Array.from(set).sort())
    }
    loadCats()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Tên của MỌI NCC (chỉ id, name) — trùng tên phải so trên cả bảng, không chỉ trang đang hiện.
  useEffect(() => {
    let huy = false
    fetchAllForAggregate<NccTen>((from, to) =>
      supabase.from("suppliers").select("id, name", { count: "exact" }).order("id").range(from, to)
    ).then((r) => {
      if (r.error) console.warn("[app/suppliers] tải tên NCC lỗi:", r.error)
      if (!huy) setTatCaTen(r.rows)
    })
    return () => { huy = true }
  }, [refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const trungTen = useMemo(() => timTrungTen(tatCaTen), [tatCaTen])
  const idsTrung = locTrung && trungTen.ids.length > 0 ? trungTen.ids : null
  const khoaIdsTrung = idsTrung ? idsTrung.join(",") : ""

  // Reset page khi filter đổi.
  useEffect(() => {
    pg.reset()
  }, [debouncedSearch, locNC.key, categoryFilter, statusFilter, activeFilters, khoaIdsTrung, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchData() {
      // Tải thêm / đổi sang trang dài hơn: giữ danh sách đang hiện trong lúc chờ.
      if (!laTaiThem(khoaTaiRef, pg.from, pg.to, false)) setLoading(true)
      // selectResilient: DB thiếu cột thì tự thử lại với '*', và luôn trả error
      // để hiển thị nguyên nhân thay vì danh sách rỗng im lặng.
      const build = (select: string, from = pg.from, to = pg.to, dem = true) => {
        /* ⚠ XẾP Ở MÁY CHỦ — xếp trong bảng là xếp trên một trang. Mốc phụ `id`: hai NCC trùng tên
           không lặp / sót giữa hai trang. */
        let q = apSapXep(
          supabase.from("suppliers").select(select, dem ? { count: "exact" } : undefined),
          sort,
          SAP_XEP_NCC,
          (x) => x.order("name").order("id")
        ).range(from, to)
        if (debouncedSearch) {
          q = q.or(dieuKienTim("suppliers", ["name", "code"], debouncedSearch))
        }
        /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
        for (const f of locNC.menhDe) q = q.or(f)
        if (categoryFilter !== "all") q = q.eq("category", categoryFilter)
        if (statusFilter !== "all") q = q.eq("is_active", statusFilter === "active")
        if (idsTrung) q = q.in("id", idsTrung)
        return q
      }
      const res = await taiHaiNhip<Supplier, ResilientResult<Supplier>>(
        (from, to, dem) => selectResilient<Supplier>((sel) => build(sel, from, to, dem),
        "id, code, name, category, contact_name, phone, address, is_verified, is_active",
        // eslint-disable-next-line no-restricted-syntax
        "*"),
        pg.from,
        pg.to,
        (dau) => {
          setSuppliers(dau.data)
          pg.setTotal(dau.count ?? 0)
          setLoading(false)
        },
        { boQuaDau: laTaiThem(khoaTaiRef, pg.from, pg.to) }
      )
      setSuppliers(res.data)
      setLoadError(res.error)
      pg.setTotal(res.count ?? 0)
      setLoading(false)
    }
    fetchData()
  }, [pg.from, pg.to, debouncedSearch, locNC.key, categoryFilter, statusFilter, refreshTick, khoaIdsTrung, sort]) // eslint-disable-line react-hooks/exhaustive-deps

  const filterActive = (k: SupplierFilterKey) => activeFilters.includes(k)
  const categories = allCategories

  // Đã filter server-side toàn bộ — pass-through.
  // Đã filter server-side toàn bộ — pass-through.
  const filtered = suppliers

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
  /* Gộp NCC (chủ nhà 05/10/2026, RPC `gop_nha_cung_cap`): Chủ NPP / Quản lý / Kế toán. */
  const canMerge = duocGopNcc(user?.role)
  const daChon = suppliers.filter((s) => selectedIds.has(s.id))
  const bulkActions: BulkAction[] = [
    ...(canMerge
      ? [{
          key: "merge",
          label: "Gộp",
          icon: Merge,
          onClick: () => setGopOpen(true),
          variant: "outline" as const,
          disabled: daChon.length < 2,
          disabledReason: "Chọn ít nhất hai nhà cung cấp để gộp",
        }]
      : []),
    ...(canEdit
    ? [
        {
          key: "activate",
          label: "Kích hoạt",
          icon: Power,
          onClick: () => setActiveBulk(true),
          loading: bulkSaving,
          variant: "default" as const,
        },
        {
          key: "deactivate",
          label: "Ngưng",
          icon: PowerOff,
          onClick: () => setActiveBulk(false),
          loading: bulkSaving,
          variant: "outline" as const,
        },
      ]
    : []),
  ]

  /* Số trên dải trạng thái — đếm ở máy chủ, cùng ô tìm + danh mục + lọc nâng cao. */
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => {
    let huy = false
    ;(async () => {
      const one = async (st: "active" | "inactive" | null) => {
        let q = supabase.from("suppliers").select("id", { count: "exact", head: true })
        if (debouncedSearch) q = q.or(dieuKienTim("suppliers", ["name", "code"], debouncedSearch))
        for (const f of locNC.menhDe) q = q.or(f)
        if (categoryFilter !== "all") q = q.eq("category", categoryFilter)
        if (st) q = q.eq("is_active", st === "active")
        if (idsTrung) q = q.in("id", idsTrung)
        const { count, error } = await q
        if (error) console.warn("[app/suppliers] đếm lỗi:", error.message)
        return count ?? 0
      }
      const [active, inactive, all] = await Promise.all([one("active"), one("inactive"), one(null)])
      if (!huy) setCounts({ active, inactive, all })
    })()
    return () => { huy = true }
  }, [debouncedSearch, locNC.key, categoryFilter, refreshTick, khoaIdsTrung]) // eslint-disable-line react-hooks/exhaustive-deps

  const [xemId, setXemId] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)

  const columns = useMemo(() => {
    const cols: Array<DocColumn<Supplier> & { k?: SupplierColumnKey }> = [
      ...(canEdit || canMerge
        ? [{
            key: "select",
            label: (
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(v) => toggleAll(!!v)}
                aria-label="Chọn tất cả"
              />
            ),
            width: "44px",
            render: (s: Supplier) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Checkbox checked={selectedIds.has(s.id)} onCheckedChange={(v) => toggleOne(s.id, !!v)} aria-label={`Chọn ${s.name}`} />
              </span>
            ),
          }]
        : []),
      { k: "code", key: "code", label: "Mã NCC", width: "120px", render: (s) => <DocCodeLink href={`/suppliers/${s.id}`}>{s.code}</DocCodeLink> },
      {
        key: "name", label: "Tên", width: "minmax(220px,1.5fr)",
        sortable: xepDuoc(SAP_XEP_NCC, "name"),
        render: (s) => <span className="block truncate text-sm font-bold">{s.name}</span>,
      },
      { k: "category", key: "category", label: "Danh mục", width: "150px", render: (s) => <DocCellText muted>{s.category}</DocCellText> },
      { k: "contact", key: "contact", label: "Liên hệ", width: "160px", render: (s) => <DocCellText muted>{s.contact_name}</DocCellText> },
      { k: "phone", key: "phone", label: "SĐT", width: "130px", render: (s) => <DocCellText muted>{s.phone}</DocCellText> },
      {
        k: "status", key: "status", label: "Trạng thái", width: "200px",
        render: (s) => (
          <span className="flex items-center gap-1.5">
            {s.is_verified && (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="h-3 w-3" />
                Đã xác minh
              </Badge>
            )}
            <Badge variant={s.is_active ? "default" : "danger"}>{s.is_active ? "Hoạt động" : "Ngưng"}</Badge>
          </span>
        ),
      },
      {
        k: "action", key: "action", label: "Hành động", width: "110px",
        render: (s) => (
          <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/suppliers/${s.id}`) }}>
            Chi tiết
          </Button>
        ),
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, canEdit, canMerge, selectedIds, allSelected, someSelected, filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? suppliers.find((s) => s.id === xemId) ?? null : null
  const categorySelect = (
    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
      <SelectTrigger aria-label="Danh mục" className="h-10 w-44 rounded-xl font-semibold">
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
  )
  const chips = [
    { key: "active", label: "Hoạt động", count: counts.active ?? 0, accent: "#22c55e" },
    { key: "inactive", label: "Ngưng", count: counts.inactive ?? 0, accent: "#ef5350" },
    { key: "all", label: "Tất cả", count: counts.all ?? 0, accent: "#181c1e" },
  ]
  const coQuyenTao = !!user && hasPermission(user.role, "inventory", "create")
  const statusSelect = (
    <Select value={statusFilter} onValueChange={setStatusFilter}>
      <SelectTrigger aria-label="Trạng thái" className="h-10 w-44 rounded-xl font-semibold">
        <SelectValue placeholder="Trạng thái" />
      </SelectTrigger>
      <SelectContent>
        {chips.map((c) => (
          <SelectItem key={c.key} value={c.key}>
            {c.label} ({c.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const soLocDienThoai = (categoryFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0) + locNC.soDangAp
  const bangTrung = nhanTrungTen(trungTen)
  const canhBao = loadError && !loading && (
    <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
      <p className="font-semibold">Không tải được danh sách nhà cung cấp</p>
      <p className="mt-0.5 break-words">{loadError}</p>
    </div>
  )
  const rong = (
    <EmptyState
      icon={<Factory className="h-8 w-8 text-muted-foreground" />}
      title={loadError ? "Không tải được dữ liệu" : pg.total === 0 && !search ? "Chưa có nhà cung cấp" : "Không tìm thấy NCC phù hợp"}
      description={loadError ? "Xem thông báo lỗi phía trên." : pg.total === 0 && !search ? "Bắt đầu bằng cách thêm nhà cung cấp đầu tiên" : "Thử điều chỉnh bộ lọc"}
    />
  )
  const nutTao = coQuyenTao && (
    <Button onClick={() => router.push("/suppliers/new")}>
      <Plus className="mr-2 h-4 w-4" /> Tạo mới
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader className="max-lg:hidden" title="Nhà cung cấp" descriptionDesktopOnly description={`${pg.total} nhà cung cấp`}>
        {coQuyenTao && (
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Nhập Excel
            </Button>
            {nutTao}
          </>
        )}
      </PageHeader>

      {filterActive("status") && (
        <StatusChips className="max-lg:hidden" active={statusFilter} onPick={setStatusFilter} chips={chips} />
      )}

      {/* Lỗi tải dữ liệu — hiện rõ thay vì im lặng ra danh sách rỗng. Điện thoại hiện trong màn riêng. */}
      {canhBao && <div className="max-lg:hidden">{canhBao}</div>}

      <MobileSuppliersScreen
        subtitle={nhanSoNcc(pg.total)}
        search={search}
        onSearch={setSearch}
        canCreate={coQuyenTao}
        filter={{ activeCount: soLocDienThoai, onOpen: () => setFilterSheet(true) }}
        trung={bangTrung ? { ...bangTrung, khoa: trungTen.khoa } : null}
        locTrung={!!idsTrung}
        onLocTrung={setLocTrung}
        items={filtered}
        loading={loading}
        empty={rong}
        moreLabel={nhanXemThem(pg.from + filtered.length, pg.total)}
        onMore={() => pg.setPageSize(pg.pageSize + MAC_DINH_MOI_TRANG)}
        onOpen={(s) => setXemId(s.id)}
        notice={canhBao}
      />
      <div className="lg:hidden">
        <MobileFilterBar
          chiNganLoc
          value={search}
          onChange={setSearch}
          activeCount={soLocDienThoai}
          onClear={() => { setCategoryFilter("all"); setStatusFilter("all"); locNC.xoa() }}
          open={filterSheet}
          onOpenChange={setFilterSheet}
        >
          <div className="grid gap-4">
            {filterActive("status") && <LocNhanhField label="Trạng thái">{statusSelect}</LocNhanhField>}
            {filterActive("category") && <LocNhanhField label="Danh mục">{categorySelect}</LocNhanhField>}
            <AdvancedFilter truong={LOC_NHA_CUNG_CAP} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
          </div>
        </MobileFilterBar>
      </div>

      <DocListLayout
        toolbar={
          <>
            {filterActive("search") && <DocListSearch value={search} onChange={setSearch} placeholder="Tìm tên, mã NCC..." />}
            {filterActive("category") && categorySelect}
            <XoaLocButton show={!!search || categoryFilter !== "all"} onClick={() => { setSearch(""); setCategoryFilter("all") }} />
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_NHA_CUNG_CAP} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={SUPPLIER_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={SUPPLIER_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        /* Danh mục, không phải chứng từ — không có tiền để cộng. */
        totals={null}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={rong}
        pg={pg}
        shownCount={filtered.length}
        table={<DocTable rows={filtered} columns={columns} activeId={xemId} onOpen={(s) => setXemId(s.id)} sort={sort} onSortChange={setSort} />}
        /* Điện thoại: màn riêng `MobileSuppliersScreen` (thiết kế "ds-ncc"). */
        cards={null}
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.name ?? "Nhà cung cấp"}
        subtitle={xem?.code ?? undefined}
        badge={xem ? <Badge variant={xem.is_active ? "default" : "danger"}>{xem.is_active ? "Hoạt động" : "Ngưng"}</Badge> : null}
        fields={xem ? [
          { label: "Danh mục", value: xem.category },
          { label: "Xác minh", value: xem.is_verified ? "Đã xác minh" : "Chưa" },
          { label: "Liên hệ", value: xem.contact_name },
          { label: "SĐT", value: xem.phone },
          { label: "Địa chỉ", value: xem.address, wide: true },
        ] : []}
        detailHref={xem ? `/suppliers/${xem.id}` : undefined}
      />

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="nhà cung cấp"
      />

      {canMerge && (
        <MergeSupplierDialog
          open={gopOpen}
          onOpenChange={setGopOpen}
          nguon={daChon.map((s) => ({ id: s.id, name: s.name, code: s.code, is_active: s.is_active }))}
          chonTrongNguon
          onDone={(vao) => router.push(`/suppliers/${vao}`)}
        />
      )}

      <SupplierImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          pg.reset()
          setRefreshTick((t) => t + 1)
        }}
      />
    </div>
  )
}
