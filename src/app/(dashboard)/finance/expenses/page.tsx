"use client"

/**
 * CHI PHÍ — danh sách.
 *
 * ⚠ KHUÔN DANH SÁCH CHUNG (chủ nhà 27/09/2026: "Làm chung form hiển thị danh sách cho toàn
 *   bộ các danh sách theo form đang dùng cho Đơn hàng, hóa đơn, trả hàng"): dải trạng thái có
 *   số đếm, một thẻ gồm thanh công cụ · dòng tổng · lưới · phân trang 20/trang, thẻ trên điện
 *   thoại, bấm dòng mở xem nhanh. Bốn thẻ thống kê cũ gộp vào dòng tổng + dòng phụ.
 *
 * ⚠ SỔ TẢI ĐỦ TRONG KỲ (tổng chi phí phải đủ) rồi lọc / phân trang tại chỗ — tổng là của CẢ
 *   bộ lọc, không phải của trang.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { PeriodSelect } from "@/components/ui/period-select"
import { AdvancedFilter } from "@/components/ui/advanced-filter"
import { useAdvancedFilter } from "@/hooks/use-advanced-filter"
import { LOC_CHI_PHI } from "@/lib/search/list-filter-fields"
import { khoangKy, kyCuaKhoang } from "@/lib/orders/list-summary"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { useLuuTrangThai } from "@/hooks/use-luu-trang-thai"
import { useListViewPrefs } from "@/hooks/use-list-view-prefs"
import { usePhanTrangTaiCho } from "@/hooks/use-phan-trang-tai-cho"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MoneyInput } from "@/components/ui/money-input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { StatusChips } from "@/components/ui/status-chips"
import { ColumnPicker, FilterPicker } from "@/components/ui/list-view-toolbar"
import {
  DocListLayout, DocListSearch, LocNhanhButton, LocNhanhField, XoaLocButton,
} from "@/components/ui/doc-list-layout"
import { DocTable, DocCellDate, DocCellText, type DocColumn } from "@/components/ui/doc-table"
import { DocCardList } from "@/components/ui/doc-card-list"
import { DocQuickView } from "@/components/ui/doc-quick-view"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { viMatchAllWords } from "@/lib/search"
import { trangThaiCuaChon } from "@/lib/list/status-multi"
import { Plus, Trash2, Wallet } from "lucide-react"
import type { Expense, ExpenseCategory, ExpenseBucket } from "@/types"
import { errorMessage } from "@/lib/errors"
import { ghiPhaiTrungDong } from "@/lib/db/must-write"
import {
  EXPENSE_COLUMNS, EXPENSE_FILTERS, DEFAULT_EXPENSE_COLUMNS, DEFAULT_EXPENSE_FILTERS,
  type ExpenseColumnKey, type ExpenseFilterKey,
} from "./list-config"
import { useLuuKy } from "@/hooks/use-luu-ky"

const BUCKET_LABEL: Record<ExpenseBucket, { label: string; color: string }> = {
  cogs: { label: "Giá vốn", color: "text-error bg-error-container" },
  operating: { label: "Vận hành", color: "text-[#175cd3] bg-[#eff8ff]" },
  hr: { label: "Nhân sự", color: "text-[#6941c6] bg-[#f4f3ff]" },
  financial: { label: "Tài chính", color: "text-[#b54708] bg-[#fff4ed]" },
  tax: { label: "Thuế", color: "text-on-surface-variant bg-surface-container" },
  other: { label: "Khác", color: "text-muted-foreground bg-muted" },
}

const PAYMENT_LABEL: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", ewallet: "Ví điện tử" }

/** Dải trạng thái: đã trả / chưa trả. Khoá lưu là chữ, `is_paid` là cờ. */
const TABS = [
  { key: "paid", label: "Đã trả", accent: "#22c55e" },
  { key: "unpaid", label: "Chưa trả", accent: "#fdb022" },
  { key: "all", label: "Tất cả", accent: "#181c1e" },
] as const
const trangThaiChiPhi = (e: Expense) => (e.is_paid ? "paid" : "unpaid")

export default function ExpensesPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const today = new Date()

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("all")
  /* ⚠ Mặc định THÁNG NÀY theo giờ Việt Nam (chủ nhà chốt 23/09/2026) — xem `khoangKy`. */
  const [dateFrom, setDateFrom] = useState(() => khoangKy("month").from)
  const [dateTo, setDateTo] = useState(() => khoangKy("month").to)
  /* Kỳ nhớ theo tài khoản (chủ nhà 01/10/2026): nạp được kỳ đã lưu thì đổi luôn hai ô ngày. */
  const [, luuKy] = useLuuKy("chi-phi", "month", (ky) => { const r = khoangKy(ky); setDateFrom(r.from); setDateTo(r.to) })
  /* ⚠ Nhớ qua lần tải lại (chủ nhà 25/09/2026) — `useLuuTrangThai`. */
  const [status, setStatus] = useLuuTrangThai("expenses", "all")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [filterSheet, setFilterSheet] = useState(false)
  const [xemId, setXemId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  /* ⚠ LỌC NÂNG CAO — trường bất kỳ (chủ nhà 24/09/2026). */
  const locNC = useAdvancedFilter("expenses", LOC_CHI_PHI)

  const {
    columns: visibleColumns, filters: activeFilters,
    setColumns, setFilters, resetColumns, resetFilters,
  } = useListViewPrefs("expenses", DEFAULT_EXPENSE_COLUMNS, DEFAULT_EXPENSE_FILTERS, EXPENSE_COLUMNS, EXPENSE_FILTERS)
  const filterActive = (k: ExpenseFilterKey) => activeFilters.includes(k)

  // Form state
  const [formDate, setFormDate] = useState(today.toISOString().slice(0, 10))
  const [formCategoryId, setFormCategoryId] = useState("")
  const [formAmount, setFormAmount] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formReference, setFormReference] = useState("")
  const [formIsPaid, setFormIsPaid] = useState(true)
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>("cash")

  const fetch = useCallback(async () => {
    /* Chờ đọc xong điều kiện lọc đã lưu — khỏi một lượt chưa lọc về sau đè lên. */
    if (!user?.org_id || !locNC.ready) return
    setLoading(true)
    const [expensesRes, categoriesRes] = await Promise.all([
      // Cộng tổng chi phí trong kỳ → phải lấy đủ.
      fetchAllForAggregate((from, to) => {
        let q = supabase
          .from("expenses")
          .select(
            "id, category_id, expense_date, amount, description, reference_code, source_type, is_paid, payment_method, category:expense_categories(*)",
            { count: "exact" }
          )
          .eq("org_id", user.org_id)
          .gte("expense_date", dateFrom)
          .lte("expense_date", dateTo)
        /* Lọc ở máy chủ → tổng thẻ trên (tính từ `filtered`) khớp danh sách. */
        for (const f of locNC.menhDe) q = q.or(f)
        return q
          .order("expense_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, to)
      }),
      supabase
        .from("expense_categories")
        .select("id, name, bucket")
        .eq("org_id", user.org_id)
        .eq("is_active", true)
        .order("bucket")
        .order("code"),
    ])
    if (expensesRes.error) console.error("[finance/expenses] truy vấn lỗi:", expensesRes.error)
    const qErr = ([categoriesRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[finance/expenses] truy vấn lỗi:", qErr.message)
    setExpenses(expensesRes.rows as unknown as Expense[])
    setCategories((categoriesRes.data as ExpenseCategory[]) || [])
    setLoading(false)
  }, [user?.org_id, dateFrom, dateTo, locNC.ready, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetch() }, [fetch])

  /** Mọi bộ lọc TRỪ trạng thái — để dải trạng thái đếm đúng theo bộ lọc đang áp. */
  const locRows = useMemo(() => {
    return expenses.filter((e) => {
      if (categoryFilter !== "all" && e.category_id !== categoryFilter) return false
      if (search) {
        if (!viMatchAllWords(search, e.reference_code, e.description, e.category?.name)) {
          return false
        }
      }
      return true
    })
  }, [expenses, categoryFilter, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: locRows.length, paid: 0, unpaid: 0 }
    for (const e of locRows) c[trangThaiChiPhi(e)] += 1
    return c
  }, [locRows])

  const filtered = useMemo(() => {
    const chon = trangThaiCuaChon(status)
    return chon ? locRows.filter((e) => chon.includes(trangThaiChiPhi(e))) : locRows
  }, [locRows, status])

  const totals = useMemo(() => {
    const byBucket: Record<string, number> = {}
    let total = 0
    let paid = 0
    let unpaid = 0
    for (const e of filtered) {
      const bucket = e.category?.bucket || "other"
      byBucket[bucket] = (byBucket[bucket] || 0) + Number(e.amount)
      total += Number(e.amount)
      if (e.is_paid) paid += Number(e.amount)
      else unpaid += Number(e.amount)
    }
    return { byBucket, total, paid, unpaid }
  }, [filtered])

  const { pg, trang } = usePhanTrangTaiCho(filtered, JSON.stringify([status, categoryFilter, search, dateFrom, dateTo, locNC.key]))

  const resetForm = () => {
    setFormDate(today.toISOString().slice(0, 10))
    setFormCategoryId(categories[0]?.id || "")
    setFormAmount("")
    setFormDescription("")
    setFormReference("")
    setFormIsPaid(true)
    setFormPaymentMethod("cash")
  }

  const openAdd = () => {
    resetForm()
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!user?.org_id || !user.id) return
    if (!formAmount || !formDate) {
      toast({ title: "Vui lòng nhập số tiền và ngày", variant: "destructive" })
      return
    }
    const amount = parseFloat(formAmount.replace(/[^\d.]/g, ""))
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Số tiền không hợp lệ", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from("expenses").insert({
        org_id: user.org_id,
        category_id: formCategoryId || null,
        expense_date: formDate,
        amount,
        description: formDescription || null,
        reference_code: formReference || null,
        is_paid: formIsPaid,
        paid_at: formIsPaid ? new Date().toISOString() : null,
        payment_method: formIsPaid ? formPaymentMethod : null,
        created_by: user.id,
      })
      if (error) throw error
      toast({ title: "Đã thêm chi phí" })
      setDialogOpen(false)
      fetch()
    } catch (err) {
      const message = errorMessage(err, "Lỗi khi lưu")
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Xóa chi phí này?")) return
    setDeleting(id)
    try {
      await ghiPhaiTrungDong(supabase.from("expenses").delete().eq("id", id))
      toast({ title: "Đã xóa" })
      setExpenses((prev) => prev.filter((e) => e.id !== id))
      setXemId((cur) => (cur === id ? null : cur))
    } catch (err) {
      const message = errorMessage(err, "Lỗi")
      toast({ title: "Lỗi", description: message, variant: "destructive" })
    } finally {
      setDeleting(null)
    }
  }

  const canEdit = user && ["owner", "manager", "accountant"].includes(user.role)
  // ⚠ XOÁ hẹp hơn SỬA: `expenses_delete` chỉ cho chủ + quản lý. Kế toán
  //   thấy nút xoá là bị mời bấm vào một thao tác chắc chắn bị từ chối.
  const canDelete = user && ["owner", "manager"].includes(user.role)
  /* Chi phí tự sinh (`source_type`) không xoá tay — xoá ở chứng từ gốc. */
  const xoaDuoc = (e: Expense) => !!canDelete && e.source_type === null

  const columns = useMemo(() => {
    const cols: Array<DocColumn<Expense> & { k?: ExpenseColumnKey }> = [
      {
        key: "date", label: "Ngày chi", width: "120px",
        sort: (a, b) => (a.expense_date ?? "").localeCompare(b.expense_date ?? ""),
        render: (e) => <DocCellDate date={formatDate(e.expense_date)} />,
      },
      { k: "category", key: "category", label: "Danh mục", width: "minmax(160px,1fr)", render: (e) => <DocCellText>{e.category?.name}</DocCellText> },
      {
        k: "bucket", key: "bucket", label: "Phân loại", width: "120px",
        render: (e) => {
          const m = BUCKET_LABEL[(e.category?.bucket || "other") as ExpenseBucket] ?? BUCKET_LABEL.other
          return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${m.color}`}>{m.label}</span>
        },
      },
      {
        k: "description", key: "description", label: "Mô tả", width: "minmax(200px,1.5fr)",
        render: (e) => (
          <>
            <DocCellText muted title={e.description ?? undefined}>{e.description}</DocCellText>
            {e.source_type && <span className="block text-[11px] italic text-on-surface-variant">tự sinh: {e.source_type}</span>}
          </>
        ),
      },
      { k: "reference", key: "reference", label: "Mã tham chiếu", width: "140px", render: (e) => <span className="block truncate font-mono text-xs">{e.reference_code || "—"}</span> },
      { k: "method", key: "method", label: "Hình thức", width: "120px", render: (e) => <DocCellText muted>{e.payment_method ? (PAYMENT_LABEL[e.payment_method] ?? e.payment_method) : null}</DocCellText> },
      {
        k: "total", key: "total", label: "Số tiền", width: "140px", align: "right",
        sort: (a, b) => Number(a.amount) - Number(b.amount),
        render: (e) => formatCurrency(e.amount),
      },
      {
        k: "status", key: "status", label: "Trạng thái", width: "120px",
        render: (e) => (e.is_paid ? <Badge variant="success">Đã trả</Badge> : <Badge variant="warning">Chưa trả</Badge>),
      },
      {
        key: "actions", label: "", width: "56px",
        render: (e) =>
          xoaDuoc(e) ? (
            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              aria-label="Xoá chi phí"
              onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id) }}
              disabled={deleting === e.id}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          ) : null,
      },
    ]
    return cols.filter((c) => !c.k || visibleColumns.includes(c.k))
  }, [visibleColumns, deleting, canDelete]) // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) return <Skeleton className="h-96" />

  const ky = kyCuaKhoang(dateFrom, dateTo)
  const macDinh = khoangKy("month")
  const coLocKhac = categoryFilter !== "all" || dateFrom !== macDinh.from || dateTo !== macDinh.to
  const clearAdvanced = () => {
    setCategoryFilter("all")
    luuKy("month")
    setDateFrom(macDinh.from)
    setDateTo(macDinh.to)
  }
  const activeFilterCount = (categoryFilter !== "all" ? 1 : 0) + (dateFrom !== macDinh.from || dateTo !== macDinh.to ? 1 : 0)
  const xem = xemId ? expenses.find((e) => e.id === xemId) ?? null : null

  const categorySelect = (
    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
      <SelectTrigger aria-label="Danh mục" className="h-10 w-[180px] rounded-xl font-semibold"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tất cả danh mục</SelectItem>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
  const dateFields = (
    <>
      <LocNhanhField label="Từ ngày">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
      </LocNhanhField>
      <LocNhanhField label="Đến ngày">
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
      </LocNhanhField>
    </>
  )
  const bucketNote = (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-semibold text-on-surface-variant">
      <span>Đã trả <b className="tabular-data text-tertiary">{formatCurrency(totals.paid)}</b></span>
      <span>Chưa trả <b className="tabular-data text-[#b54708]">{formatCurrency(totals.unpaid)}</b></span>
      {(Object.entries(totals.byBucket) as Array<[ExpenseBucket, number]>)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([bucket, amount]) => (
          <span key={bucket}>{BUCKET_LABEL[bucket]?.label || bucket} <b className="tabular-data text-on-surface">{formatCurrency(amount)}</b></span>
        ))}
    </p>
  )

  const chips = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? 0, accent: t.accent }))
  const nutTao = canEdit && (
    <Button onClick={openAdd}>
      <Plus className="h-4 w-4 mr-1.5" /> Thêm chi phí
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader className="max-lg:hidden" title="Chi phí" descriptionDesktopOnly description={`${formatDate(dateFrom)} → ${formatDate(dateTo)}`}>
        {nutTao}
      </PageHeader>

      <StatusChips className="max-lg:hidden" multi active={status} onPick={setStatus} chips={chips} />

      <DocListLayout
        toolbar={
          <>
            <DocListSearch value={search} onChange={setSearch} placeholder="Tìm mô tả, mã tham chiếu…" />
            {filterActive("category") && categorySelect}
            <PeriodSelect value={ky} onChange={(k) => { luuKy(k); const r = khoangKy(k); setDateFrom(r.from); setDateTo(r.to) }} />
            <XoaLocButton show={coLocKhac || !!search} onClick={() => { clearAdvanced(); setSearch("") }} />
            {filterActive("date") && <LocNhanhButton open={showAdvanced} onToggle={() => setShowAdvanced((v) => !v)} />}
          </>
        }
        toolbarEnd={
          <>
            <AdvancedFilter truong={LOC_CHI_PHI} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={EXPENSE_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={EXPENSE_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        advanced={showAdvanced && filterActive("date") ? dateFields : null}
        totals={{ label: "Tổng chi phí", countText: `${filtered.length} khoản chi`, total: formatCurrency(totals.total) }}
        mobileHead={{
          title: "Chi phí",
          search,
          onSearch: setSearch,
          searchPlaceholder: "Tìm mô tả, mã tham chiếu…",
          chips: { chips, active: status, onPick: setStatus, multi: true },
          filter: {
            activeCount: activeFilterCount,
            onClear: clearAdvanced,
            open: filterSheet,
            onOpenChange: setFilterSheet,
            sheet: (
              <div className="grid gap-4">
                <LocNhanhField label="Kỳ">
                  <PeriodSelect className="w-full" value={ky} onChange={(k) => { luuKy(k); const r = khoangKy(k); setDateFrom(r.from); setDateTo(r.to) }} />
                </LocNhanhField>
                {dateFields}
                <LocNhanhField label="Danh mục">{categorySelect}</LocNhanhField>
                <AdvancedFilter truong={LOC_CHI_PHI} value={locNC.dieuKien} onApply={locNC.apDung} className="w-full justify-start" />
              </div>
            ),
          },
          actions: nutTao || undefined,
        }}
        totalsNote={filtered.length > 0 ? bucketNote : null}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={
          <EmptyState
            icon={<Wallet className="h-8 w-8 text-muted-foreground" />}
            title={expenses.length === 0 ? "Chưa có chi phí" : "Không có chi phí khớp bộ lọc"}
            description={expenses.length === 0 ? "Thêm chi phí đầu tiên" : "Thử đổi khoảng thời gian hoặc danh mục"}
          />
        }
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(e) => setXemId(e.id)} />}
        cards={
          <DocCardList
            items={trang}
            unit="khoản chi"
            getDate={(e) => e.expense_date}
            getTotal={(e) => Number(e.amount) || 0}
            onOpen={(e) => setXemId(e.id)}
            card={(e) => ({
              accent: e.is_paid ? "#22c55e" : "#fdb022",
              title: e.category?.name || e.description || "Chi phí",
              total: formatCurrency(e.amount),
              meta: [BUCKET_LABEL[(e.category?.bucket || "other") as ExpenseBucket]?.label, e.reference_code].filter(Boolean).join(" · "),
              payment: e.payment_method ? (PAYMENT_LABEL[e.payment_method] ?? e.payment_method) : "",
              summary: e.category?.name && e.description ? e.description : undefined,
              badge: e.is_paid ? null : { label: "Chưa trả", bg: "#fff4e0", fg: "#8a5a00" },
            })}
          />
        }
      />

      <DocQuickView
        open={!!xem}
        onClose={() => setXemId(null)}
        title={xem?.category?.name || "Chi phí"}
        subtitle={xem ? formatDate(xem.expense_date) : undefined}
        badge={xem ? (xem.is_paid ? <Badge variant="success">Đã trả</Badge> : <Badge variant="warning">Chưa trả</Badge>) : null}
        fields={xem ? [
          { label: "Phân loại", value: BUCKET_LABEL[(xem.category?.bucket || "other") as ExpenseBucket]?.label },
          { label: "Hình thức", value: xem.payment_method ? (PAYMENT_LABEL[xem.payment_method] ?? xem.payment_method) : null },
          { label: "Mã tham chiếu", value: xem.reference_code },
          { label: "Nguồn", value: xem.source_type ? `Tự sinh: ${xem.source_type}` : "Nhập tay" },
          { label: "Mô tả", value: xem.description, wide: true },
        ] : []}
        total={xem ? { label: "Số tiền", value: formatCurrency(xem.amount) } : undefined}
        actions={xem && xoaDuoc(xem) ? (
          <Button variant="outline" className="h-11 flex-1 text-destructive" onClick={() => handleDelete(xem.id)} disabled={deleting === xem.id}>
            <Trash2 className="mr-2 h-4 w-4" /> Xoá
          </Button>
        ) : null}
      />

      {/* Add dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm chi phí</DialogTitle>
            <DialogDescription>Ghi nhận một khoản chi phí phát sinh</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Danh mục *</Label>
              <Select value={formCategoryId} onValueChange={setFormCategoryId}>
                <SelectTrigger><SelectValue placeholder="Chọn danh mục" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} <span className="text-muted-foreground">• {BUCKET_LABEL[c.bucket].label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Ngày *</Label>
                <Input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Số tiền *</Label>
                <MoneyInput
                  value={formAmount}
                  onChange={(n) => setFormAmount(n ? String(n) : "")}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Mô tả</Label>
              <Textarea
                rows={2}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Chi tiết khoản chi..."
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mã tham chiếu</Label>
              <Input
                value={formReference}
                onChange={(e) => setFormReference(e.target.value)}
                placeholder="Số hóa đơn, mã chứng từ..."
              />
            </div>
            <div className="rounded-xl border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label>Đã thanh toán</Label>
                <input
                  type="checkbox"
                  checked={formIsPaid}
                  onChange={(e) => setFormIsPaid(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
              {formIsPaid && (
                <div className="space-y-1.5">
                  <Label>Hình thức</Label>
                  <Select value={formPaymentMethod} onValueChange={setFormPaymentMethod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Tiền mặt</SelectItem>
                      <SelectItem value="transfer">Chuyển khoản</SelectItem>
                      <SelectItem value="ewallet">Ví điện tử</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
