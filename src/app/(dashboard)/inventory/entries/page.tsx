"use client"

import { useLuuTrangThai } from "@/hooks/use-luu-trang-thai"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { khopLoc } from "@/lib/search/advanced-filter"
import { LOC_PHIEU_KHO } from "@/lib/search/list-filter-fields"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import { BulkActionsBar, type BulkAction } from "@/components/ui/bulk-actions-bar"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"
import { viIncludes, viNormalize } from "@/lib/search"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import { StatusChips, type StatusChip } from "@/components/ui/status-chips"
import { cancelStockEntry, cancelEntryMessage } from "@/lib/inventory/cancel-entry"
import { ghiSoPhieuNhap } from "@/lib/inventory/approve-entry"
import {
  ClipboardList, Plus, Eye, Trash2, MoreHorizontal, Search,
  ArrowDownToLine, ArrowUpFromLine, ClipboardCheck,
  CheckCircle2, CircleX,
} from "lucide-react"
import Link from "@/components/ui/link"
import type { StockEntry } from "@/types"
import {
  STOCK_ENTRY_COLUMNS,
  DEFAULT_STOCK_ENTRY_COLUMNS,
  STOCK_ENTRY_FILTERS,
  DEFAULT_STOCK_ENTRY_FILTERS,
  type StockEntryColumnKey,
  type StockEntryFilterKey,
} from "./list-config"
import { errorMessage } from "@/lib/errors"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"

export default function StockEntriesPage() {
  const { user, loading: authLoading } = useRoleGuard("inventory")
  const [entries, setEntries] = useState<StockEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [search, setSearch] = useState("")
  /* ⚠ Nhớ qua lần tải lại (chủ nhà 25/09/2026) — `useLuuTrangThai`. */
  const [typeFilter, setTypeFilter] = useLuuTrangThai("stock-entries-type", "all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [deleteTarget, setDeleteTarget] = useState<StockEntry | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const {
    columns: visibleColumns,
    filters: activeFilters,
    setColumns,
    setFilters,
    resetColumns,
    resetFilters,
  } = useListViewPrefs(
    "stock-entries",
    DEFAULT_STOCK_ENTRY_COLUMNS,
    DEFAULT_STOCK_ENTRY_FILTERS,
    STOCK_ENTRY_COLUMNS,
    STOCK_ENTRY_FILTERS
  )
  const show = (k: StockEntryColumnKey) => visibleColumns.includes(k)
  const filterActive = (k: StockEntryFilterKey) => activeFilters.includes(k)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). Màn tải hết → lọc ở trình duyệt. */
  const locNC = useAdvancedFilter("inventory-entries", LOC_PHIEU_KHO)

  const fetchData = async () => {
    setLoading(true)
    // ⚠ ĐỌC ĐỦ MỌI TRANG. Đọc trơn thì PostgREST cắt ở 1.000 phiếu MỚI
    //   NHẤT: phiếu nháp cũ hơn biến mất khỏi danh sách (không ai duyệt /
    //   xoá được nữa) và ô "N chờ duyệt" đếm thiếu mà không báo.
    // ⚠ Khoá phụ `id` — nhiều phiếu cùng giờ tạo, trang song song thiếu
    //   khoá duy nhất là lặp / sót. Lỗi thì HIỆN, không ra danh sách rỗng.
    const res = await fetchAllForAggregate<StockEntry>((from, to) =>
      supabase
        .from("stock_entries")
        .select(
          "id, entry_code, type, status, notes, created_at, posted_at, issue_reason, warehouse_zone, dest_warehouse_zone, creator:users!stock_entries_created_by_fkey(*)",
          { count: "exact" }
        )
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to)
    )
    setLoadError(res.error)
    setTruncated(res.truncated)
    setEntries(res.rows)
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      // Chỉ phiếu NHÁP — phiếu đã ghi sổ dùng Huỷ phiếu để hàng về lại kho (mig 170).
      await ghiPhaiTrungDong(
        supabase.from("stock_entries").delete().eq("id", deleteTarget.id).eq("status", "draft"),
        "Chỉ xoá được phiếu NHÁP. Phiếu đã ghi sổ thì dùng Huỷ phiếu để hàng về lại kho."
      )
      toast({ title: `Đã xóa phiếu ${deleteTarget.entry_code}` })
      setDeleteTarget(null)
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  const handleApprove = async (e: StockEntry) => {
    if (!confirm(`Duyệt phiếu ${e.entry_code}?`)) return
    try {
      // ⚠ Đi qua RPC đúng loại phiếu — xem `ghiSoPhieuNhap`. Update thẳng
      //   trạng thái là ghi sổ mà kho không đổi (lỗi NPP-01, và phiếu
      //   chuyển kho đo được đúng như thế).
      const r = await ghiSoPhieuNhap(supabase, e)
      toast({
        title: r.posted ? `Đã duyệt phiếu ${e.entry_code}` : "Phiếu đã được ghi sổ từ trước",
        description: r.canhBao,
        variant: r.canhBao ? "destructive" : undefined,
      })
      fetchData()
      return
      toast({ title: `Đã duyệt phiếu ${e.entry_code}` })
      fetchData()
    } catch (err) {
      toast({ title: "Lỗi", description: errorMessage(err), variant: "destructive" })
    }
  }

  /**
   * ⚠ HUỶ ĐI QUA RPC `cancel_stock_entry`, KHÔNG UPDATE THẲNG. Bản cũ
   *   ghi thẳng `status = 'cancelled'` nên kho KHÔNG đổi — huỷ phiếu
   *   nhập đã ghi sổ là giữ lại hàng chưa từng có thật. Xem
   *   `@/lib/inventory/cancel-entry`.
   */
  const handleCancel = async (e: StockEntry) => {
    if (!confirm(`Hủy phiếu ${e.entry_code}? Hàng của phiếu sẽ được hoàn lại kho. Không hoàn tác được.`)) return
    try {
      const r = await cancelStockEntry(supabase, e.id, "Huỷ từ danh sách phiếu")
      toast({ title: cancelEntryMessage(e.entry_code, r) })
      fetchData()
    } catch (err) {
      toast({ title: "Không huỷ được phiếu", description: errorMessage(err), variant: "destructive" })
    }
  }

  const getTypeLabel = (type: string) => STOCK_ENTRY_TYPES.find((t) => t.value === type)?.label || type
  const getTypeVariant = (type: string): "default" | "success" | "warning" | "secondary" => {
    switch (type) {
      case "import": return "success"
      case "export": return "warning"
      case "transfer": return "default"
      default: return "secondary"
    }
  }

  const canCreate = user && hasPermission(user.role, "inventory", "create")
  const canUpdate = user && hasPermission(user.role, "inventory", "update")
  const canDelete = user && hasPermission(user.role, "inventory", "delete")

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterActive("search") && search) {
        const q = viNormalize(search)
        const matches =
          viIncludes(e.entry_code, q) ||
          viIncludes((e.notes || ""), q)
        if (!matches) return false
      }
      /**
       * ⚠ KHÔNG GÁC SAU `filterActive("type")` NỮA. Dải viên thuốc LUÔN
       *   hiện, nên nó phải LUÔN lọc — gác sau ô bật/tắt của
       *   `FilterPicker` là người dùng tắt bộ lọc "Loại" đi rồi bấm một
       *   viên và không có gì xảy ra, không lời giải thích nào.
       */
      if (typeFilter !== "all" && e.type !== typeFilter) return false
      if (filterActive("status") && statusFilter !== "all" && (e.status || "posted") !== statusFilter)
        return false
      if (!khopLoc(e, LOC_PHIEU_KHO, locNC.dieuKien)) return false
      return true
    })
  }, [entries, search, typeFilter, statusFilter, activeFilters, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const draftCount = entries.filter((e) => (e.status || "posted") === "draft").length

  /**
   * DẢI VIÊN THUỐC THEO LOẠI PHIẾU — bấm được, thay cho bốn thẻ số to.
   *
   * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "Thống kê các loại phiếu ở đầu cho nhỏ
   *   gọn như ở danh sách Đơn hàng (bấm được vào từng loại)". Dùng
   *   đúng `StatusChips` của màn đơn hàng, không dựng bản thứ hai.
   *
   * ⚠ DỰNG TỪ `STOCK_ENTRY_TYPES`, KHÔNG GÕ TAY TỪNG VIÊN. Bản cũ gõ
   *   tay BA thẻ — nhập, xuất, kiểm kê — và bỏ quên `transfer`, nên
   *   phiếu chuyển kho không được đếm ở đâu cả. Đúng cái bẫy đã làm đơn
   *   `partially_invoiced` biến mất khỏi màn đơn hàng: danh sách trên
   *   màn hẹp hơn tập giá trị thật của cột.
   *
   * ⚠ CÓ VIÊN "TẤT CẢ" ĐỨNG ĐẦU. Không có nó thì bấm vào một loại rồi
   *   không có đường quay lại xem hết.
   */
  const TYPE_ACCENT: Record<string, string> = {
    import: "#12b76a",
    export: "#f79009",
    transfer: "#2563eb",
    stocktake: "#7a5af8",
  }
  const typeChips: StatusChip[] = useMemo(
    () => [
      { key: "all", label: "Tất cả", count: entries.length, accent: "#98a2b3" },
      ...STOCK_ENTRY_TYPES.map((t) => ({
        key: t.value,
        label: t.label,
        count: entries.filter((e) => e.type === t.value).length,
        accent: TYPE_ACCENT[t.value] ?? "#98a2b3",
      })),
    ],
    [entries] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const getStatusMeta = (status: string): { label: string; variant: "success" | "warning" | "secondary" | "danger" } => {
    switch (status) {
      case "draft": return { label: "Nháp", variant: "warning" }
      case "posted": return { label: "Đã duyệt", variant: "success" }
      case "cancelled": return { label: "Đã hủy", variant: "secondary" }
      default: return { label: status, variant: "secondary" }
    }
  }

  const toggleOne = (id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const s = new Set(prev)
      if (next) s.add(id)
      else s.delete(id)
      return s
    })
  }
  const toggleAll = (next: boolean) => {
    setSelectedIds(next ? new Set(filtered.map((e) => e.id)) : new Set())
  }
  const clearSelection = () => setSelectedIds(new Set())

  const allSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id))
  const someSelected = filtered.some((e) => selectedIds.has(e.id))

  const approveBulk = async () => {
    if (selectedIds.size === 0) return
    // Chỉ duyệt phiếu nháp + không phải stocktake (stocktake duyệt ở /inventory/adjustments)
    const ids = entries
      .filter((e) => selectedIds.has(e.id) && (e.status || "posted") === "draft" && e.type !== "stocktake")
      .map((e) => e.id)
    if (ids.length === 0) {
      toast({ title: "Không có phiếu nháp phù hợp để duyệt", variant: "destructive" })
      return
    }
    setBulkSaving(true)
    const selected = entries.filter((e) => ids.includes(e.id))

    let okCount = 0
    const failures: string[] = []

    // Từng phiếu một, KHÔNG gom thành một lệnh: mỗi phiếu là một giao
    // dịch riêng, nên một phiếu thiếu tồn chỉ làm hỏng chính nó. Gom lại
    // thì một phiếu hỏng kéo đổ cả lô, và người dùng không biết phiếu nào.
    for (const e of selected) {
      const code = e.entry_code || e.id.slice(0, 8)
      try {
        const r = await ghiSoPhieuNhap(supabase, e)
        if (r.posted) okCount++
        else failures.push(`${code}: đã ghi sổ từ trước`)
      } catch (err) {
        failures.push(`${code}: ${errorMessage(err)}`)
      }
    }

    setBulkSaving(false)
    toast({
      title: `Đã duyệt ${okCount}/${ids.length} phiếu`,
      // Không nuốt phiếu hỏng. Báo "đã duyệt 5 phiếu" trong khi 2 phiếu
      // trượt là để người ta tưởng hàng đã trừ khỏi kho.
      description: failures.length > 0 ? failures.join(" · ") : undefined,
      variant: failures.length > 0 ? "destructive" : undefined,
    })
    clearSelection()
    fetchData()
  }

  /**
   * ⚠ HUỶ HÀNG LOẠT CŨNG PHẢI ĐI QUA RPC, VÀ ĐI TỪNG PHIẾU MỘT. Bản cũ
   *   chạy một lệnh `UPDATE ... IN (ids)`: kho không đổi, và một phiếu
   *   không huỷ được cũng bị đánh dấu đã huỷ như mọi phiếu khác.
   *
   * ⚠ HỎNG MỘT PHIẾU THÌ VẪN LÀM NỐT PHẦN CÒN LẠI, rồi BÁO RA từng
   *   phiếu hỏng kèm lý do. Dừng cả loạt vì một phiếu là bắt người dùng
   *   tự đoán phiếu nào đã chạy; im lặng bỏ qua còn tệ hơn.
   */
  const cancelBulk = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`Hủy ${selectedIds.size} phiếu đã chọn? Hàng của các phiếu đã ghi sổ sẽ được hoàn lại kho. Không hoàn tác được.`)) return
    setBulkSaving(true)
    const ids = Array.from(selectedIds)
    let ok = 0
    const failed: string[] = []
    for (const id of ids) {
      const code = entries.find((e) => e.id === id)?.entry_code ?? id
      try {
        await cancelStockEntry(supabase, id, "Huỷ hàng loạt từ danh sách phiếu")
        ok += 1
      } catch (err) {
        failed.push(`${code}: ${errorMessage(err)}`)
      }
    }
    setBulkSaving(false)
    if (ok > 0) toast({ title: `Đã huỷ ${ok}/${ids.length} phiếu và hoàn kho` })
    if (failed.length > 0) {
      toast({
        title: `${failed.length} phiếu KHÔNG huỷ được`,
        description: failed.join(" · "),
        variant: "destructive",
      })
    }
    clearSelection()
    fetchData()
  }

  const bulkActions: BulkAction[] = canUpdate
    ? [
        {
          key: "approve",
          label: "Duyệt",
          icon: CheckCircle2,
          onClick: approveBulk,
          loading: bulkSaving,
          variant: "default",
        },
        {
          key: "cancel",
          label: "Hủy",
          icon: CircleX,
          onClick: cancelBulk,
          loading: bulkSaving,
          variant: "outline",
        },
      ]
    : []

  if (authLoading || loading) return <Skeleton className="h-96" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Phiếu kho"
        description={`${entries.length} phiếu • ${draftCount} chờ duyệt`}
        backHref="/inventory"
      >
        {canCreate && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" /> Tạo phiếu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => router.push("/inventory/stock-in")}>
                <ArrowDownToLine className="mr-2 h-4 w-4 text-tertiary" />
                Nhập kho
              </DropdownMenuItem>
              {/*
                ⚠ ĐÂY LÀ `/inventory/stock-issue`, KHÔNG PHẢI
                  `/inventory/stock-out` (chủ nhà chốt 20/09/2026: "Nút
                  tạo phiếu ở màn Phiếu kho thêm phần Phiếu xuất kho").
                  `stock-out` là màn SOẠN HÀNG của luồng cũ, đã khoá ghi
                  ở P7 — dẫn vào đó là dẫn tới một nút bấm không làm gì.
                  `stock-issue` là phiếu xuất lẻ thật: FIFO qua RPC
                  `post_stock_issue`, có vết lấy lô, huỷ được.
              */}
              <DropdownMenuItem onClick={() => router.push("/inventory/stock-issue")}>
                <ArrowUpFromLine className="mr-2 h-4 w-4 text-[#b54708]" />
                Xuất kho
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push("/inventory/stocktake-adjust")}>
                <ClipboardCheck className="mr-2 h-4 w-4 text-primary" />
                Kiểm kê
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push("/inventory/adjustments")}>
                <ClipboardCheck className="mr-2 h-4 w-4 text-[#b54708]" />
                Duyệt điều chỉnh kiểm kê
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </PageHeader>

      {/* Lỗi tải / số thiếu — nói ra, không để danh sách trông như đủ. */}
      {loadError && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách phiếu kho</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}
      {truncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Danh sách phiếu chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}

      {/*
        ⚠ VIÊN THUỐC ĐIỀU KHIỂN CHÍNH `typeFilter` mà ô chọn "Tất cả
          loại" đang dùng — MỘT trạng thái, không phải hai. Cho dải này
          một ô nhớ riêng là hai thứ trên cùng màn nói hai chuyện khác
          nhau về cùng một bộ lọc.
      */}
      <StatusChips chips={typeChips} active={typeFilter} onPick={setTypeFilter} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        {filterActive("search") && (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Tìm mã phiếu hoặc ghi chú..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
        )}
        {filterActive("type") && (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả loại</SelectItem>
              {STOCK_ENTRY_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {filterActive("status") && (
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả trạng thái</SelectItem>
              <SelectItem value="draft">Nháp</SelectItem>
              <SelectItem value="posted">Đã duyệt</SelectItem>
              <SelectItem value="cancelled">Đã hủy</SelectItem>
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
          <AdvancedFilter truong={LOC_PHIEU_KHO} value={locNC.dieuKien} onApply={locNC.apDung} />
          <FilterPicker
            available={STOCK_ENTRY_FILTERS}
            value={activeFilters}
            onChange={setFilters}
            onReset={resetFilters}
          />
          <ColumnPicker
            available={STOCK_ENTRY_COLUMNS}
            value={visibleColumns}
            onChange={setColumns}
            onReset={resetColumns}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
          title={entries.length === 0 ? "Chưa có phiếu kho" : "Không tìm thấy phiếu"}
          description={entries.length === 0 ? "Tạo phiếu đầu tiên bằng nút 'Tạo phiếu'" : "Thử đổi bộ lọc"}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                {canUpdate && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected ? true : someSelected && !allSelected ? "indeterminate" : false}
                      onCheckedChange={(v) => toggleAll(!!v)}
                      aria-label="Chọn tất cả"
                    />
                  </TableHead>
                )}
                <TableHead>Mã phiếu</TableHead>
                {show("type") && <TableHead>Loại</TableHead>}
                {show("status") && <TableHead>Trạng thái</TableHead>}
                {show("creator") && <TableHead>Người tạo</TableHead>}
                {show("notes") && <TableHead>Ghi chú</TableHead>}
                {show("date") && <TableHead>Ngày</TableHead>}
                <TableHead className="w-20 text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => {
                const checked = selectedIds.has(e.id)
                return (
                  <TableRow
                    key={e.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(`/inventory/entries/${e.id}`)}
                  >
                    {canUpdate && (
                      <TableCell onClick={(ev) => ev.stopPropagation()}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => toggleOne(e.id, !!v)}
                          aria-label={`Chọn ${e.entry_code}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <Link
                        href={`/inventory/entries/${e.id}`}
                        className="font-mono text-sm text-primary font-bold hover:underline"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        {e.entry_code}
                      </Link>
                    </TableCell>
                    {show("type") && (
                      <TableCell><Badge variant={getTypeVariant(e.type)}>{getTypeLabel(e.type)}</Badge></TableCell>
                    )}
                    {show("status") && (
                      <TableCell>
                        {(() => {
                          const s = getStatusMeta(e.status || "posted")
                          return <Badge variant={s.variant}>{s.label}</Badge>
                        })()}
                      </TableCell>
                    )}
                    {show("creator") && <TableCell>{e.creator?.full_name || "-"}</TableCell>}
                    {show("notes") && <TableCell className="text-muted-foreground truncate max-w-xs">{e.notes || "-"}</TableCell>}
                    {show("date") && <TableCell>{formatDate(e.created_at)}</TableCell>}
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(ev) => {
                              ev.stopPropagation()
                              router.push(`/inventory/entries/${e.id}`)
                            }}
                          >
                            <Eye className="mr-2 h-4 w-4" /> Xem / Sửa
                          </DropdownMenuItem>
                          {canUpdate && (e.status || "posted") === "draft" && e.type !== "stocktake" && (
                            <DropdownMenuItem
                              onClick={(ev) => {
                                ev.stopPropagation()
                                handleApprove(e)
                              }}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4 text-tertiary" /> Duyệt
                            </DropdownMenuItem>
                          )}
                          {(e.status || "posted") === "draft" && e.type === "stocktake" && (
                            <DropdownMenuItem
                              onClick={(ev) => {
                                ev.stopPropagation()
                                router.push(`/inventory/adjustments`)
                              }}
                            >
                              <CheckCircle2 className="mr-2 h-4 w-4 text-tertiary" /> Duyệt tại trang điều chỉnh
                            </DropdownMenuItem>
                          )}
                          {canUpdate && (e.status || "posted") === "posted" && (
                            <DropdownMenuItem
                              onClick={(ev) => {
                                ev.stopPropagation()
                                handleCancel(e)
                              }}
                            >
                              <CircleX className="mr-2 h-4 w-4 text-[#b54708]" /> Hủy phiếu
                            </DropdownMenuItem>
                          )}
                          {canDelete && (e.status || "posted") === "draft" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  setDeleteTarget(e)
                                }}
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Xóa
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Xóa phiếu ${deleteTarget?.entry_code}?`}
        description="Phiếu và toàn bộ dòng chi tiết sẽ bị xóa vĩnh viễn. Không thể khôi phục."
        variant="destructive"
        confirmLabel="Xóa vĩnh viễn"
        onConfirm={handleDelete}
        loading={deleting}
      />

      <BulkActionsBar
        count={selectedIds.size}
        onClear={clearSelection}
        actions={bulkActions}
        entityLabel="phiếu"
      />
    </div>
  )
}
