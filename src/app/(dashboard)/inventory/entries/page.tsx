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
import { hasPermission, xemDuocGiaVon } from "@/lib/permissions"
import { XuatExcelButton, type KetQuaXuat } from "@/components/ui/xuat-excel-button"
import { napDong } from "@/lib/xuat-excel/nap"
import { DONG_KHO, xuatPhieuKho, type DongKho, type PhieuKhoXuat } from "@/lib/xuat-excel/cac-man"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DocListLayout, DocListSearch, LocNhanhField, XoaLocButton } from "@/components/ui/doc-list-layout"
import { DocTable, DocCodeLink, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { sapXepTaiCho, type BangSoSanh, type DocSort } from "@/lib/list/sap-xep-may-chu"
import { PhieuKhoDienThoai } from "@/components/inventory/phieu-kho-dien-thoai"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import { vnTime } from "@/lib/orders/status-tone"
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
import { viMatchAllWords } from "@/lib/search"
import { STOCK_ENTRY_TYPES } from "@/lib/constants"
import { StatusChips, type StatusChip } from "@/components/ui/status-chips"
import { cancelStockEntry, cancelEntryMessage } from "@/lib/inventory/cancel-entry"
import { ghiSoPhieuNhap } from "@/lib/inventory/approve-entry"
import {
  ClipboardList, Plus, Eye, Trash2, MoreHorizontal,
  ArrowDownToLine, ArrowUpFromLine, ClipboardCheck,
  CheckCircle2, CircleX,
} from "lucide-react"
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

/**
 * So sánh của các cột xếp được — xếp CẢ danh sách đã lọc rồi mới chia trang (`sapXepTaiCho`).
 * ⚠ Đừng để bảng tự xếp `trang`: đó là xếp trên 20 dòng đang xem.
 */
const SO_SANH_PHIEU_KHO: BangSoSanh<StockEntry> = {
  date: (a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""),
}

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
        if (!viMatchAllWords(search, e.entry_code, e.notes)) return false
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
  /** Băng "N phiếu kiểm kê chờ duyệt" của màn điện thoại — duyệt ở /inventory/adjustments. */
  const choDuyetKiemKe = entries.filter((e) => e.type === "stocktake" && (e.status || "posted") === "draft").length

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


  const [xemId, setXemId] = useState<string | null>(null)
  const [filterSheet, setFilterSheet] = useState(false)
  /** Thứ tự người dùng bấm trên tiêu đề — xếp cả `filtered` TRƯỚC khi chia trang. */
  const [sort, setSort] = useState<DocSort | null>(null)
  const daXep = useMemo(() => sapXepTaiCho(filtered, sort, SO_SANH_PHIEU_KHO), [filtered, sort])
  const { pg, trang } = usePhanTrangTaiCho(daXep, JSON.stringify([search, typeFilter, statusFilter, activeFilters, locNC.key, sort]))
  const trangThai = (e: StockEntry) => e.status || "posted"

  /** Việc làm được với một phiếu — dùng chung cho menu ⋮ của lưới và ngăn xem nhanh. */
  const hanhDong = (e: StockEntry) => ({
    duyet: !!canUpdate && trangThai(e) === "draft" && e.type !== "stocktake",
    duyetKiemKe: trangThai(e) === "draft" && e.type === "stocktake",
    huy: !!canUpdate && trangThai(e) === "posted",
    xoa: !!canDelete && trangThai(e) === "draft",
  })

  const columns = useMemo(() => {
    const cols: Array<DocColumn<StockEntry> & { k?: StockEntryColumnKey }> = [
      ...(canUpdate
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
            render: (e: StockEntry) => (
              <span onClick={(ev) => ev.stopPropagation()}>
                <Checkbox
                  checked={selectedIds.has(e.id)}
                  onCheckedChange={(v) => toggleOne(e.id, !!v)}
                  aria-label={`Chọn ${e.entry_code}`}
                />
              </span>
            ),
          }]
        : []),
      { key: "code", label: "Mã phiếu", width: "150px", render: (e) => <DocCodeLink href={`/inventory/entries/${e.id}`}>{e.entry_code}</DocCodeLink> },
      { k: "type", key: "type", label: "Loại", width: "130px", render: (e) => <Badge variant={getTypeVariant(e.type)}>{getTypeLabel(e.type)}</Badge> },
      {
        k: "status", key: "status", label: "Trạng thái", width: "120px",
        render: (e) => {
          const s = getStatusMeta(trangThai(e))
          return <Badge variant={s.variant}>{s.label}</Badge>
        },
      },
      { k: "creator", key: "creator", label: "Người tạo", width: "160px", render: (e) => <DocCellText>{e.creator?.full_name}</DocCellText> },
      { k: "notes", key: "notes", label: "Ghi chú", width: "minmax(200px,1.5fr)", render: (e) => <DocCellText muted title={e.notes ?? undefined}>{e.notes}</DocCellText> },
      {
        k: "date", key: "date", label: "Ngày", width: "110px",
        sortable: true,
        render: (e) => <DocCellDate date={formatDate(e.created_at)} time={e.created_at ? vnTime(e.created_at) : null} />,
      },
      {
        key: "actions", label: "Thao tác", width: "80px", align: "right",
        render: (e) => {
          const hd = hanhDong(e)
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Thao tác ${e.entry_code}`} onClick={(ev) => ev.stopPropagation()}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(ev) => { ev.stopPropagation(); router.push(`/inventory/entries/${e.id}`) }}>
                  <Eye className="mr-2 h-4 w-4" /> Xem / Sửa
                </DropdownMenuItem>
                {hd.duyet && (
                  <DropdownMenuItem onClick={(ev) => { ev.stopPropagation(); handleApprove(e) }}>
                    <CheckCircle2 className="mr-2 h-4 w-4 text-tertiary" /> Duyệt
                  </DropdownMenuItem>
                )}
                {hd.duyetKiemKe && (
                  <DropdownMenuItem onClick={(ev) => { ev.stopPropagation(); router.push(`/inventory/adjustments`) }}>
                    <CheckCircle2 className="mr-2 h-4 w-4 text-tertiary" /> Duyệt tại trang điều chỉnh
                  </DropdownMenuItem>
                )}
                {hd.huy && (
                  <DropdownMenuItem onClick={(ev) => { ev.stopPropagation(); handleCancel(e) }}>
                    <CircleX className="mr-2 h-4 w-4 text-[#b54708]" /> Hủy phiếu
                  </DropdownMenuItem>
                )}
                {hd.xoa && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={(ev) => { ev.stopPropagation(); setDeleteTarget(e) }}>
                      <Trash2 className="mr-2 h-4 w-4" /> Xóa
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, canUpdate, canDelete, selectedIds, allSelected, someSelected, filtered]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * XUẤT EXCEL (chủ nhà 05/10/2026) — MỌI phiếu khớp loại / trạng thái / ô tìm / lọc nâng cao, theo thứ tự đang xếp
   * (`daXep`), kèm từng dòng (SL theo đơn vị cơ sở `qty_in_base_uom`, lô). Giá vốn chỉ khi xem được giá vốn.
   */
  const xuatExcel = async (): Promise<KetQuaXuat> => {
    const phieu = daXep as unknown as PhieuKhoXuat[]
    const dong = await napDong<DongKho>(supabase, DONG_KHO, phieu.map((e) => e.id))
    return { sheets: xuatPhieuKho(phieu, dong, xemDuocGiaVon(user?.role)), soPhieu: phieu.length, thieu: truncated }
  }

  if (authLoading) return <Skeleton className="h-96" />

  const xem = xemId ? entries.find((e) => e.id === xemId) ?? null : null
  const xemHd = xem ? hanhDong(xem) : null
  const typeSelect = (
    <Select value={typeFilter} onValueChange={setTypeFilter}>
      <SelectTrigger aria-label="Loại phiếu" className="h-10 w-40 rounded-xl font-semibold"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tất cả loại</SelectItem>
        {STOCK_ENTRY_TYPES.map((t) => (
          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const statusSelect = (
    <Select value={statusFilter} onValueChange={setStatusFilter}>
      <SelectTrigger aria-label="Trạng thái phiếu" className="h-10 w-40 rounded-xl font-semibold"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tất cả trạng thái</SelectItem>
        <SelectItem value="draft">Nháp</SelectItem>
        <SelectItem value="posted">Đã duyệt</SelectItem>
        <SelectItem value="cancelled">Đã hủy</SelectItem>
      </SelectContent>
    </Select>
  )

  const nutTao = canCreate && (
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
  )

  const trongRong = (
    <EmptyState
      icon={<ClipboardList className="h-8 w-8 text-muted-foreground" />}
      title={entries.length === 0 ? "Chưa có phiếu kho" : "Không tìm thấy phiếu"}
      description={entries.length === 0 ? "Tạo phiếu đầu tiên bằng nút 'Tạo phiếu'" : "Thử đổi bộ lọc"}
    />
  )

  return (
    <div className="space-y-4">
      <PhieuKhoDienThoai
        rows={filtered}
        chips={typeChips}
        activeType={typeFilter}
        onType={setTypeFilter}
        search={search}
        onSearch={setSearch}
        canCreate={!!canCreate}
        choDuyetKiemKe={choDuyetKiemKe}
        loading={loading}
        loadError={loadError}
        truncatedNote={truncated ? truncationWarning() : null}
        onOpen={(e) => setXemId(e.id)}
        filter={{
          activeCount: (statusFilter !== "all" ? 1 : 0) + locNC.soDangAp,
          onClear: () => { setStatusFilter("all"); locNC.xoa() },
          open: filterSheet,
          onOpenChange: setFilterSheet,
          sheet: (
            <>
              {filterActive("status") && <LocNhanhField label="Trạng thái">{statusSelect}</LocNhanhField>}
              <AdvancedFilter truong={LOC_PHIEU_KHO} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
            </>
          ),
        }}
        empty={trongRong}
      />
      <PageHeader
        className="max-lg:hidden"
        title="Phiếu kho"
        descriptionDesktopOnly
        description={`${entries.length} phiếu • ${draftCount} chờ duyệt`}
        backHref="/inventory"
      >
        {nutTao}
      </PageHeader>

      {/* Lỗi tải / số thiếu — nói ra, không để danh sách trông như đủ. */}
      {loadError && (
        <div className="max-lg:hidden rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được danh sách phiếu kho</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}
      {truncated && (
        <div className="max-lg:hidden rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
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
      <StatusChips className="max-lg:hidden" chips={typeChips} active={typeFilter} onPick={setTypeFilter} />

      <DocListLayout
        toolbar={
          <>
            {filterActive("search") && (
              <DocListSearch value={search} onChange={setSearch} placeholder="Tìm mã phiếu hoặc ghi chú..." />
            )}
            {filterActive("type") && typeSelect}
            {filterActive("status") && statusSelect}
            <XoaLocButton
              show={!!search || statusFilter !== "all" || typeFilter !== "all"}
              onClick={() => { setSearch(""); setStatusFilter("all"); setTypeFilter("all") }}
            />
          </>
        }
        toolbarEnd={
          <>
            <XuatExcelButton module="inventory" tenTep="phieu-kho" chuanBi={xuatExcel} disabled={loading || filtered.length === 0} />
            <AdvancedFilter truong={LOC_PHIEU_KHO} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={STOCK_ENTRY_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={STOCK_ENTRY_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        /* Điện thoại: `PhieuKhoDienThoai` ở đầu trang (thiết kế 30/09/2026) — không dùng đầu xanh chung. */
        totals={{ label: "Số phiếu kho", countText: `${draftCount} phiếu chờ duyệt`, total: `${filtered.length} phiếu` }}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={trongRong}
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(e) => setXemId(e.id)} sort={sort} onSortChange={setSort} />}
        cards={null}
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.entry_code ?? "Phiếu kho"}
        subtitle={xem ? formatDate(xem.created_at) : undefined}
        badge={xem ? (() => { const s = getStatusMeta(trangThai(xem)); return <Badge variant={s.variant}>{s.label}</Badge> })() : null}
        fields={xem ? [
          { label: "Loại", value: getTypeLabel(xem.type) },
          { label: "Người tạo", value: xem.creator?.full_name },
          { label: "Ghi chú", value: xem.notes, wide: true },
        ] : []}
        detailHref={xem ? `/inventory/entries/${xem.id}` : undefined}
        actions={xem && xemHd ? (
          <>
            {xemHd.duyet && (
              <Button variant="outline" className="h-11 flex-1" onClick={() => handleApprove(xem)}>
                <CheckCircle2 className="mr-1.5 h-4 w-4 text-tertiary" /> Duyệt
              </Button>
            )}
            {xemHd.huy && (
              <Button variant="outline" className="h-11 flex-1" onClick={() => handleCancel(xem)}>
                <CircleX className="mr-1.5 h-4 w-4 text-[#b54708]" /> Hủy phiếu
              </Button>
            )}
            {xemHd.xoa && (
              <Button variant="outline" className="h-11 flex-1 text-destructive" onClick={() => setDeleteTarget(xem)}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Xóa
              </Button>
            )}
          </>
        ) : null}
      />

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
