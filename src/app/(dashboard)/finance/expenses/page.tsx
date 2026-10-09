"use client"

/**
 * PHIẾU CHI — danh sách phiếu chi (đường dẫn cũ /finance/expenses). Menu, tiêu đề tên "Phiếu chi" — cạnh "Phiếu thu",
 *   đúng cách chủ nhà gọi ("Trong quỹ tiền mặt có phiếu thu và phiếu chi"; đổi tên: chủ nhà 09/10/2026 "có").
 *
 * ⚠ PHIẾU CHI CÓ HAI LOẠI (mig 242, chủ nhà 09/10/2026: "phiếu chi thêm phần chi cho ncc và chọn NCC là xong … có
 *   thể chi trả ncc 1 cục 200 triệu, nhiều hóa đơn nợ"): "Chi phí" (bảng `expenses`, vào lãi lỗ) và "Trả NCC"
 *   (bảng `supplier_payments` — trả nợ, KHÔNG vào lãi lỗ; máy chủ tự trừ vào các khoản nợ cũ nhất). Danh sách gộp
 *   cả hai; phiếu Trả NCC không xoá — huỷ qua RPC.
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
import { homNayVNKey } from "@/lib/analytics/period"
import { createClient } from "@/lib/supabase/client"
import { fetchAllForAggregate, truncationWarning } from "@/lib/supabase/aggregate"
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
import { sapXepTaiCho, type BangSoSanh, type DocSort } from "@/lib/list/sap-xep-may-chu"
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
import { XuatExcelButton, type KetQuaXuat } from "@/components/ui/xuat-excel-button"
import { napTenNguoi } from "@/lib/xuat-excel/nap"
import { xuatChiPhi } from "@/lib/xuat-excel/cac-man"
import { XuatExcelPhieu } from "@/components/ui/xuat-excel-phieu"
import { duocXuatFile } from "@/lib/permissions"
import Link from "@/components/ui/link"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PhieuChiNccFields } from "@/components/finance/phieu-chi-ncc"
import {
  napPhieuChiNcc, lapPhieuChiNcc, huyPhieuChiNcc, thongBaoChiNcc, duocChiTraNcc, nhanHinhThucChiNcc,
  dongChiCuaPhieuNcc, giaTriChiNccMoi, kiemPhieuChiNcc, type DongChi, type GiaTriChiNcc, type PhieuChiNcc,
} from "@/lib/payables/phieu-chi-ncc"

const BUCKET_LABEL: Record<ExpenseBucket, { label: string; color: string }> = {
  cogs: { label: "Giá vốn", color: "text-error bg-error-container" },
  operating: { label: "Vận hành", color: "text-[#175cd3] bg-[#eff8ff]" },
  hr: { label: "Nhân sự", color: "text-[#6941c6] bg-[#f4f3ff]" },
  financial: { label: "Tài chính", color: "text-[#b54708] bg-[#fff4ed]" },
  tax: { label: "Thuế", color: "text-on-surface-variant bg-surface-container" },
  other: { label: "Khác", color: "text-muted-foreground bg-muted" },
}

const PAYMENT_LABEL: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", ewallet: "Ví điện tử" }

/** Ô lọc danh mục "Trả NCC" — phiếu chi trả nhà cung cấp, không phải danh mục chi phí. */
const LOC_TRA_NCC = "__tra_ncc__"
const MAU_TRA_NCC = "text-[#067647] bg-[#ecfdf3]"
const nhanNhom = (bucket: string) => (bucket === "ncc" ? "Trả NCC" : BUCKET_LABEL[bucket as ExpenseBucket]?.label || bucket)

/** Dải trạng thái: đã trả / chưa trả. Khoá lưu là chữ, `is_paid` là cờ. */
const TABS = [
  { key: "paid", label: "Đã trả", accent: "#22c55e" },
  { key: "unpaid", label: "Chưa trả", accent: "#fdb022" },
  { key: "all", label: "Tất cả", accent: "#181c1e" },
] as const
const trangThaiChiPhi = (e: Expense) => (e.is_paid ? "paid" : "unpaid")

/**
 * So sánh của các cột xếp được — xếp CẢ danh sách đã lọc rồi mới chia trang (`sapXepTaiCho`).
 * ⚠ Đừng để bảng tự xếp `trang`: đó là xếp trên 20 dòng đang xem.
 */
const SO_SANH_CHI_PHI: BangSoSanh<DongChi> = {
  date: (a, b) => (a.expense_date ?? "").localeCompare(b.expense_date ?? ""),
  total: (a, b) => Number(a.amount) - Number(b.amount),
}

export default function ExpensesPage() {
  const { loading: authLoading } = useRoleGuard("settings")
  const { user } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  const [expenses, setExpenses] = useState<Expense[]>([])
  /** Phiếu chi trả NCC còn hiệu lực trong kỳ (mig 242) — gộp vào danh sách thành dòng "Trả NCC". */
  const [phieuNcc, setPhieuNcc] = useState<PhieuChiNcc[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
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

  // Form state — ⚠ ngày mặc định là HÔM NAY GIỜ VN (`toISOString` là giờ UTC: 0h–7h sáng ra ngày hôm qua).
  const [formDate, setFormDate] = useState(() => homNayVNKey())
  const [formCategoryId, setFormCategoryId] = useState("")
  const [formAmount, setFormAmount] = useState("")
  const [formDescription, setFormDescription] = useState("")
  const [formReference, setFormReference] = useState("")
  const [formIsPaid, setFormIsPaid] = useState(true)
  const [formPaymentMethod, setFormPaymentMethod] = useState<string>("cash")
  /* Loại phiếu chi đang lập: chi phí, hay trả NCC (chỉ Chủ NPP / Kế toán — như ghi trả tiền NCC). */
  const [loaiPhieu, setLoaiPhieu] = useState<"chi-phi" | "ncc">("chi-phi")
  const [nccForm, setNccForm] = useState<GiaTriChiNcc>(() => giaTriChiNccMoi())
  const [dsNcc, setDsNcc] = useState<Array<{ id: string; name: string; code: string | null }>>([])
  /* Huỷ phiếu chi trả NCC — hỏi lại, kèm lý do. */
  const [huyNcc, setHuyNcc] = useState<PhieuChiNcc | null>(null)
  const [lyDoHuy, setLyDoHuy] = useState("")
  const [dangHuy, setDangHuy] = useState(false)

  const fetch = useCallback(async () => {
    /* Chờ đọc xong điều kiện lọc đã lưu — khỏi một lượt chưa lọc về sau đè lên. */
    if (!user?.org_id || !locNC.ready) return
    setLoading(true)
    /* ⚠ Lọc nâng cao là điều kiện trên cột của `expenses` — đang lọc thì không gộp phiếu trả NCC (không áp được cùng
       điều kiện), khỏi lẫn dòng không khớp vào danh sách đã lọc. */
    const coLocNC = locNC.menhDe.length > 0
    const [expensesRes, categoriesRes, nccRes] = await Promise.all([
      // Cộng tổng chi phí trong kỳ → phải lấy đủ.
      fetchAllForAggregate((from, to) => {
        let q = supabase
          .from("expenses")
          .select(
            "id, category_id, expense_date, amount, description, reference_code, source_type, is_paid, payment_method, created_by, category:expense_categories(*)",
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
          // ⚠ Mốc phụ `id` (rà soát 03/10/2026): các trang đọc SONG SONG — hai phiếu cùng ngày, cùng giờ tạo mà
          //   không có khoá duy nhất thì phiếu lặp / sót giữa hai trang, tổng chi phí lệch im lặng.
          .order("id")
          .range(from, to)
      }),
      supabase
        .from("expense_categories")
        .select("id, name, bucket")
        .eq("org_id", user.org_id)
        .eq("is_active", true)
        .order("bucket")
        .order("code"),
      coLocNC ? Promise.resolve({ ds: [] as PhieuChiNcc[], loi: null, truncated: false }) : napPhieuChiNcc(supabase, user.org_id, dateFrom, dateTo),
    ])
    if (expensesRes.error) console.error("[finance/expenses] truy vấn lỗi:", expensesRes.error)
    const qErr = ([categoriesRes] as Array<{ error?: { message?: string } | null }>)
      .find((r) => r?.error)?.error
    if (qErr) console.error("[finance/expenses] truy vấn lỗi:", qErr.message)
    setExpenses(expensesRes.rows as unknown as Expense[])
    setPhieuNcc(nccRes.ds)
    setLoadError(expensesRes.error ?? qErr?.message ?? nccRes.loi ?? null)
    setTruncated(expensesRes.truncated || nccRes.truncated)
    setCategories((categoriesRes.data as ExpenseCategory[]) || [])
    setLoading(false)
  }, [user?.org_id, dateFrom, dateTo, locNC.ready, locNC.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetch() }, [fetch])

  /** Khoản chi phí + phiếu chi trả NCC, mới trước (theo ngày chi rồi lúc lập). */
  const dongChi = useMemo<DongChi[]>(() => {
    const ds: DongChi[] = [...expenses, ...phieuNcc.map(dongChiCuaPhieuNcc)]
    return ds.sort((a, b) => (b.expense_date ?? "").localeCompare(a.expense_date ?? "") || (b.created_at ?? "").localeCompare(a.created_at ?? ""))
  }, [expenses, phieuNcc])

  /** Mọi bộ lọc TRỪ trạng thái — để dải trạng thái đếm đúng theo bộ lọc đang áp. */
  const locRows = useMemo(() => {
    return dongChi.filter((e) => {
      if (categoryFilter === LOC_TRA_NCC ? !e.ncc : categoryFilter !== "all" && e.category_id !== categoryFilter) return false
      if (search) {
        if (!viMatchAllWords(search, e.reference_code, e.description, e.category?.name, e.ncc ? "Trả NCC" : null, e.ncc?.supplier?.code, e.ncc?.reference_code)) {
          return false
        }
      }
      return true
    })
  }, [dongChi, categoryFilter, search])

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
      const bucket = e.ncc ? "ncc" : e.category?.bucket || "other"
      byBucket[bucket] = (byBucket[bucket] || 0) + Number(e.amount)
      total += Number(e.amount)
      if (e.is_paid) paid += Number(e.amount)
      else unpaid += Number(e.amount)
    }
    return { byBucket, total, paid, unpaid }
  }, [filtered])

  /** Thứ tự người dùng bấm trên tiêu đề — xếp cả `filtered` TRƯỚC khi chia trang. */
  const [sort, setSort] = useState<DocSort | null>(null)
  const daXep = useMemo(() => sapXepTaiCho(filtered, sort, SO_SANH_CHI_PHI), [filtered, sort])
  const { pg, trang } = usePhanTrangTaiCho(daXep, JSON.stringify([status, categoryFilter, search, dateFrom, dateTo, locNC.key, sort]))

  const resetForm = () => {
    setFormDate(homNayVNKey())
    setFormCategoryId(categories[0]?.id || "")
    setFormAmount("")
    setFormDescription("")
    setFormReference("")
    setFormIsPaid(true)
    setFormPaymentMethod("cash")
  }

  const openAdd = () => {
    resetForm()
    setLoaiPhieu("chi-phi")
    setNccForm(giaTriChiNccMoi())
    setDialogOpen(true)
  }

  // Danh sách NCC cho ô chọn — đọc khi lần đầu chọn loại "Trả NCC".
  useEffect(() => {
    if (!dialogOpen || loaiPhieu !== "ncc" || dsNcc.length > 0 || !user?.org_id) return
    let huy = false
    fetchAllForAggregate<{ id: string; name: string; code: string | null }>((from, to) =>
      supabase.from("suppliers").select("id, name, code", { count: "exact" })
        .eq("org_id", user.org_id).eq("is_active", true).order("name").order("id").range(from, to)
    ).then((r) => {
      if (r.error) console.error("[finance/expenses] đọc NCC lỗi:", r.error)
      if (!huy) setDsNcc(r.rows)
    })
    return () => { huy = true }
  }, [dialogOpen, loaiPhieu, user?.org_id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Phiếu chi trả NCC — RPC `chi_tra_ncc` (máy chủ tự trừ vào các khoản nợ cũ nhất). */
  const handleSaveNcc = async () => {
    const loi = kiemPhieuChiNcc(nccForm)
    if (loi) {
      toast({ title: loi, variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const k = await lapPhieuChiNcc(supabase, {
        supplierId: nccForm.supplierId, amount: nccForm.amount, paidDate: nccForm.date,
        method: nccForm.method, notes: nccForm.notes, reference: nccForm.reference,
      })
      toast(thongBaoChiNcc(k))
      setDialogOpen(false)
      fetch()
    } catch (err) {
      toast({ title: "Không lập được phiếu chi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const handleHuyNcc = async () => {
    if (!huyNcc) return
    setDangHuy(true)
    try {
      await huyPhieuChiNcc(supabase, huyNcc.id, lyDoHuy)
      toast({ title: `Đã huỷ phiếu chi ${huyNcc.code}`, description: "Các khoản nợ NCC đã về đúng số trước khi chi." })
      setHuyNcc(null)
      setXemId(null)
      fetch()
    } catch (err) {
      toast({ title: "Không huỷ được phiếu chi", description: errorMessage(err), variant: "destructive" })
    } finally {
      setDangHuy(false)
    }
  }

  const handleSave = async () => {
    if (!user?.org_id || !user.id) return
    if (loaiPhieu === "ncc") return handleSaveNcc()
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
  /* Chi phí tự sinh (`source_type`) không xoá tay — xoá ở chứng từ gốc. Phiếu trả NCC không xoá — huỷ (RPC). */
  const xoaDuoc = (e: DongChi) => !!canDelete && e.source_type === null && !e.ncc
  /* Lập / huỷ phiếu chi trả NCC: Chủ NPP, Kế toán (như ghi trả tiền NCC, mig 167 / 242). */
  const chiNccDuoc = duocChiTraNcc(user?.role)

  const columns = useMemo(() => {
    const cols: Array<DocColumn<DongChi> & { k?: ExpenseColumnKey }> = [
      {
        key: "date", label: "Ngày chi", width: "120px",
        sortable: true,
        render: (e) => <DocCellDate date={formatDate(e.expense_date)} />,
      },
      { k: "category", key: "category", label: "Danh mục", width: "minmax(160px,1fr)", render: (e) => <DocCellText>{e.ncc ? "Trả nhà cung cấp" : e.category?.name}</DocCellText> },
      {
        k: "bucket", key: "bucket", label: "Phân loại", width: "120px",
        render: (e) => {
          const m = e.ncc ? { label: "Trả NCC", color: MAU_TRA_NCC } : BUCKET_LABEL[(e.category?.bucket || "other") as ExpenseBucket] ?? BUCKET_LABEL.other
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
        sortable: true,
        render: (e) => formatCurrency(e.amount),
      },
      {
        k: "status", key: "status", label: "Trạng thái", width: "120px",
        render: (e) => (e.ncc ? <Badge variant="success">Đã chi</Badge> : e.is_paid ? <Badge variant="success">Đã trả</Badge> : <Badge variant="warning">Chưa trả</Badge>),
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

  /**
   * XUẤT EXCEL (chủ nhà 05/10/2026) — MỌI khoản chi khớp kỳ / bộ lọc / ô tìm / tab, theo thứ tự đang xếp (`daXep`).
   * Khoản chi không có dòng hàng → một sheet.
   * ⚠ Quyền: ô "Xuất file" của mô-đun BÁO CÁO — màn này gác bằng `settings` (không có ô xuất file nào); người xem
   *   được chi phí (chủ / quản lý / kế toán) đều có ô ấy mặc định.
   */
  const xuatExcel = async (): Promise<KetQuaXuat> => {
    const ten = await napTenNguoi(supabase, daXep.map((e) => e.created_by))
    // Phiếu trả NCC: danh mục "Trả nhà cung cấp", nhóm "Trả NCC" — không lẫn vào nhóm chi phí nào.
    const dong = daXep.map((e) => (e.ncc ? { ...e, category: { name: "Trả nhà cung cấp", bucket: "ncc" } } : e))
    return { sheets: xuatChiPhi(dong, ten), soPhieu: daXep.length, thieu: truncated }
  }
  const nutXuat = (cls?: string) => (
    <XuatExcelButton module="reports" tenTep="chi-phi" chuanBi={xuatExcel} disabled={loading || filtered.length === 0} className={cls} />
  )

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
  const xem = xemId ? dongChi.find((e) => e.id === xemId) ?? null : null

  const categorySelect = (
    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
      <SelectTrigger aria-label="Danh mục" className="h-10 w-[180px] rounded-xl font-semibold"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Tất cả danh mục</SelectItem>
        <SelectItem value={LOC_TRA_NCC}>Trả nhà cung cấp</SelectItem>
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
      {Object.entries(totals.byBucket)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([bucket, amount]) => (
          <span key={bucket}>{nhanNhom(bucket)} <b className="tabular-data text-on-surface">{formatCurrency(amount)}</b></span>
        ))}
    </p>
  )

  const chips = TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] ?? 0, accent: t.accent }))
  const nutTao = canEdit && (
    <Button onClick={openAdd}>
      <Plus className="h-4 w-4 mr-1.5" /> Lập phiếu chi
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader className="max-lg:hidden" title="Phiếu chi" descriptionDesktopOnly description={`${formatDate(dateFrom)} → ${formatDate(dateTo)}`}>
        {nutTao}
      </PageHeader>

      {/* Lỗi tải / số thiếu — nói ra, không để tổng chi phí trông như đúng. */}
      {loadError && (
        <div className="rounded-xl border border-error/40 bg-error-container px-4 py-3 text-sm text-on-error-container">
          <p className="font-semibold">Không tải được chi phí</p>
          <p className="mt-0.5 break-words">{loadError}</p>
        </div>
      )}
      {truncated && (
        <div className="rounded-xl border border-warning/40 bg-warning-container px-4 py-3 text-sm text-on-warning-container">
          <p className="font-semibold">Số liệu chưa đầy đủ</p>
          <p className="mt-0.5 break-words">{truncationWarning()}</p>
        </div>
      )}

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
            {nutXuat()}
            <AdvancedFilter truong={LOC_CHI_PHI} value={locNC.dieuKien} onApply={locNC.apDung} />
            <FilterPicker available={EXPENSE_FILTERS} value={activeFilters} onChange={setFilters} onReset={resetFilters} />
            <ColumnPicker available={EXPENSE_COLUMNS} value={visibleColumns} onChange={setColumns} onReset={resetColumns} />
          </>
        }
        advanced={showAdvanced && filterActive("date") ? dateFields : null}
        totals={{ label: "Tổng chi", countText: `${filtered.length} phiếu chi`, total: formatCurrency(totals.total) }}
        mobileHead={{
          title: "Phiếu chi",
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
          actions: <>{nutTao}{nutXuat("h-11")}</>,
        }}
        totalsNote={filtered.length > 0 ? bucketNote : null}
        loading={loading}
        isEmpty={filtered.length === 0}
        empty={
          <EmptyState
            icon={<Wallet className="h-8 w-8 text-muted-foreground" />}
            /* Đếm cả phiếu trả NCC: kỳ chỉ có phiếu trả NCC mà đang lọc ra hết thì là "không khớp", không phải "chưa có". */
            title={dongChi.length === 0 ? "Chưa có phiếu chi" : "Không có phiếu chi khớp bộ lọc"}
            description={dongChi.length === 0 ? "Bấm Lập phiếu chi để ghi khoản chi đầu tiên" : "Thử đổi khoảng thời gian hoặc danh mục"}
          />
        }
        pg={pg}
        shownCount={trang.length}
        table={<DocTable rows={trang} columns={columns} activeId={xemId} onOpen={(e) => setXemId(e.id)} sort={sort} onSortChange={setSort} />}
        cards={
          <DocCardList
            items={trang}
            unit="khoản chi"
            getDate={(e) => e.expense_date}
            getTotal={(e) => Number(e.amount) || 0}
            onOpen={(e) => setXemId(e.id)}
            card={(e) => ({
              accent: e.is_paid ? "#22c55e" : "#fdb022",
              title: e.ncc ? `Trả NCC · ${e.ncc.supplier?.name || "—"}` : e.category?.name || e.description || "Chi phí",
              total: formatCurrency(e.amount),
              meta: [e.ncc ? "Trả NCC" : BUCKET_LABEL[(e.category?.bucket || "other") as ExpenseBucket]?.label, e.reference_code].filter(Boolean).join(" · "),
              payment: e.payment_method ? (PAYMENT_LABEL[e.payment_method] ?? e.payment_method) : "",
              summary: e.category?.name && e.description ? e.description : undefined,
              badge: e.is_paid ? null : { label: "Chưa trả", bg: "#fff4e0", fg: "#8a5a00" },
            })}
          />
        }
      />

      {/* Phiếu chi trả NCC: xem nhanh riêng — NCC, mã phiếu, nút sang trang chi tiết (đã trừ vào khoản nào) và Huỷ. */}
      <DocQuickView
        open={!!xem?.ncc}
        onClose={() => setXemId(null)}
        title={xem?.ncc ? `Phiếu chi ${xem.ncc.code}` : ""}
        subtitle={xem ? formatDate(xem.expense_date) : undefined}
        badge={<Badge variant="success">Trả NCC</Badge>}
        fields={xem?.ncc ? [
          {
            label: "Nhà cung cấp",
            value: <Link href={`/suppliers/${xem.ncc.supplier_id}?tab=debt`} className="font-semibold text-primary hover:underline">{xem.ncc.supplier?.name || "—"} →</Link>,
            wide: true,
          },
          { label: "Hình thức", value: nhanHinhThucChiNcc(xem.ncc.method) },
          { label: "Số tham chiếu", value: xem.ncc.reference_code },
          { label: "Ghi chú", value: xem.ncc.notes, wide: true },
        ] : []}
        total={xem?.ncc ? { label: "Số tiền", value: formatCurrency(xem.amount) } : undefined}
        detailHref={xem?.ncc ? `/finance/phieu-chi-ncc/${xem.ncc.id}` : undefined}
        actions={xem?.ncc && chiNccDuoc ? (
          <Button variant="outline" className="h-11 flex-1 text-destructive" onClick={() => { setLyDoHuy(""); setHuyNcc(xem.ncc ?? null) }}>
            <Trash2 className="mr-2 h-4 w-4" /> Huỷ phiếu chi
          </Button>
        ) : null}
      />

      <DocQuickView
        open={!!xem && !xem.ncc}
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
        /* Chi phí không có trang chi tiết riêng — xem nhanh là "chi tiết" của khoản chi (chủ nhà 05/10/2026:
           "xuất excel cho chi tiết 8 loại phiếu"). */
        actions={xem && (xoaDuoc(xem) || duocXuatFile(user?.role, "reports")) ? (
          <>
            <XuatExcelPhieu loai="chi" id={xem.id} className="h-11 flex-1" />
            {xoaDuoc(xem) && (
              <Button variant="outline" className="h-11 flex-1 text-destructive" onClick={() => handleDelete(xem.id)} disabled={deleting === xem.id}>
                <Trash2 className="mr-2 h-4 w-4" /> Xoá
              </Button>
            )}
          </>
        ) : null}
      />

      {/* Lập phiếu chi: chi phí, hoặc trả NCC (chủ nhà 09/10/2026 — "phiếu chi thêm phần chi cho ncc và chọn NCC là xong"). */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Lập phiếu chi</DialogTitle>
            <DialogDescription>
              {loaiPhieu === "ncc" ? "Chi trả nhà cung cấp — tự trừ vào các khoản nợ cũ nhất" : "Ghi nhận một khoản chi phí phát sinh"}
            </DialogDescription>
          </DialogHeader>

          {chiNccDuoc && (
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/40 p-1" role="tablist" aria-label="Loại phiếu chi">
              {([["chi-phi", "Chi phí"], ["ncc", "Trả NCC"]] as const).map(([k, nhan]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={loaiPhieu === k}
                  onClick={() => setLoaiPhieu(k)}
                  className={`h-9 rounded-lg text-sm font-semibold ${loaiPhieu === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  {nhan}
                </button>
              ))}
            </div>
          )}

          {loaiPhieu === "ncc" ? (
            <PhieuChiNccFields value={nccForm} onChange={setNccForm} suppliers={dsNcc} />
          ) : (
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
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : loaiPhieu === "ncc" ? "Lưu phiếu chi" : "Lưu"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!huyNcc}
        onOpenChange={(o) => !o && setHuyNcc(null)}
        title={`Huỷ phiếu chi ${huyNcc?.code ?? ""}?`}
        description="Tiền của phiếu được gỡ khỏi các khoản nợ NCC đã trừ — các khoản ấy về đúng số trước khi chi. Phiếu ở trạng thái Đã huỷ."
        variant="destructive"
        confirmLabel="Huỷ phiếu chi"
        cancelLabel="Không"
        loading={dangHuy}
        onConfirm={handleHuyNcc}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ly-do-huy-pc" className="text-xs uppercase tracking-wider text-muted-foreground">Lý do huỷ</Label>
          <Input id="ly-do-huy-pc" value={lyDoHuy} onChange={(e) => setLyDoHuy(e.target.value)} placeholder="VD: chi nhầm NCC" />
        </div>
      </ConfirmDialog>
    </div>
  )
}
