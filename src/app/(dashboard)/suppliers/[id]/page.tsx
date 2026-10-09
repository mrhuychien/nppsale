"use client"

/**
 * CHI TIẾT NHÀ CUNG CẤP — thiết kế "ncc chi tiết" (chủ nhà 05/10/2026: "Viết lại giao diện nhà cung cấp chi tiết").
 *
 * Thẻ đầu (chữ cái · tên · Hoạt động/Ngừng hợp tác · "Nhà cung cấp · loại hình · N phiếu nhập" · Tạo phiếu nhập /
 * Trả hàng NCC / Sửa thông tin) → 4 ô số (2 cột điện thoại, 4 cột máy tính) → ≥1280px hai cột: thẻ chính có 5 tab
 * (Lịch sử giao dịch · Tổng quan · Bảng giá · Công nợ · Thông tin pháp lý) + cột phải 360px (Hoạt động gần đây ·
 * Cần hoàn thiện · Vùng nguy hiểm).
 *
 * ⚠ Công nợ đọc từ `payables` (`docSoNoNcc`, KHÔNG kẹp dòng âm — mig 231). `?tab=debt` mở thẳng tab Công nợ (màn
 *   Công nợ theo NCC bấm sang).
 * ⚠ Xoá: chỉ Chủ NPP; hỏi `so_chung_tu_ncc` trước, xoá qua RPC `xoa_nha_cung_cap` (mig 232/233) — xem `SupplierDangerZone`.
 * ⚠ "Tạo phiếu nhập" / "Trả hàng NCC" mang `?ncc=<id>` — màn lập phiếu (điện thoại) và POS (máy tính) chọn sẵn NCC.
 */
import { diHoacMoPos } from "@/components/sell/pos-new-tab"
import { useEffect, useState, useCallback, useMemo } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/hooks/use-auth"
import { useRoleGuard } from "@/hooks/use-role-guard"
import { hasPermission } from "@/lib/permissions"
import { PageHeader } from "@/components/ui/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/ui/empty-state"
import Link from "@/components/ui/link"
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table"
import { FileText, Undo2, Pencil, CreditCard, History, Package, CheckCircle2, Wallet } from "lucide-react"
import { PhieuChiNccDialog } from "@/components/finance/phieu-chi-ncc"
import { docPhieuChiCuaNcc, duocChiTraNcc, type PhieuChiNcc } from "@/lib/payables/phieu-chi-ncc"
import { SupplierEditSheet } from "@/components/suppliers/supplier-edit-sheet"
import { SupplierDangerZone } from "@/components/suppliers/supplier-danger-zone"
import { MergeSupplierDialog } from "@/components/suppliers/merge-supplier-dialog"
import { selectResilient } from "@/lib/supabase/resilient"
import { fetchAllForAggregate, docTheoLoId } from "@/lib/supabase/aggregate"
import { docSoNoNcc, tongNoNcc, NHAN_LOAI_NO_NCC, type DongSoNoNcc } from "@/lib/payables/so-no-ncc"
import {
  bangGiaNhap, dongPhuNccChiTiet, duocGopNcc, duocQuyenXoaNcc, giaTriNhapThang, hoSoNcc, lichSuGiaoDich, phapLyNcc, viecCanHoanThien,
  type DongBangGia, type DongPhieuNhapGia, type NccHoSo, type PhieuChiTom, type PhieuNhapTom, type PhieuTraTom,
  type SanPhamTom, type TruongHoSo, type TruongSua,
} from "@/lib/suppliers/chi-tiet"
import { chuCaiDau } from "@/lib/suppliers/mobile-list"
import { hrefPhieuNhapMoi, hrefTraNccMoi } from "@/lib/purchasing/ncc-tu-link"
import { formatCurrency, formatDate, cn } from "@/lib/utils"
import { errorMessage } from "@/lib/errors"

type Ncc = NccHoSo & { org_id: string; is_verified: boolean | null; rating: number | null }

const COT_CU = "id, org_id, name, code, category, contact_name, phone, email, address, tax_code, bank_account, bank_name, payment_terms, rating, notes, is_verified, is_active, created_at"
const COT_MOI = `${COT_CU}, legal_name, business_type, representative, business_license_no, business_license_date, registered_address, credit_limit, created_by`

const TAB = ["history", "overview", "price_list", "debt", "legal"] as const
type Tab = (typeof TAB)[number]
const NHAN_TAB: Record<Tab, string> = {
  history: "Lịch sử giao dịch",
  overview: "Tổng quan",
  price_list: "Bảng giá",
  debt: "Công nợ",
  legal: "Thông tin pháp lý",
}

/** Số dòng lịch sử hiện mỗi lượt "Xem thêm". */
const MOI_LUOT = 30

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>()
  /* `?tab=debt` — từ màn Công nợ theo NCC bấm sang thẳng tab Công nợ. */
  const tabUrl = useSearchParams().get("tab")
  const [tab, setTab] = useState<Tab>((TAB as readonly string[]).includes(tabUrl ?? "") ? (tabUrl as Tab) : "history")
  const { user } = useAuth()
  const { loading: authLoading } = useRoleGuard("inventory")
  const [supplier, setSupplier] = useState<Ncc | null>(null)
  const [loi, setLoi] = useState<string | null>(null)
  /** Sổ công nợ NCC — từ `payables` (mỗi phiếu nhập hoàn thành một dòng), không từ phiếu kho. */
  const [soNo, setSoNo] = useState<DongSoNoNcc[]>([])
  const [soNoLoi, setSoNoLoi] = useState<string | null>(null)
  const [phieuNhap, setPhieuNhap] = useState<PhieuNhapTom[]>([])
  const [phieuTra, setPhieuTra] = useState<PhieuTraTom[]>([])
  const [phieuChi, setPhieuChi] = useState<PhieuChiTom[]>([])
  /** Phiếu chi trả NCC (mig 242) — mỗi phiếu MỘT dòng giao dịch, dù tiền đã chia vào nhiều khoản nợ. */
  const [phieuChiNcc, setPhieuChiNcc] = useState<PhieuChiNcc[]>([])
  const [moChiNcc, setMoChiNcc] = useState(false)
  const [soSanPham, setSoSanPham] = useState(0)
  const [bangGia, setBangGia] = useState<DongBangGia[] | null>(null)
  const [bangGiaLoi, setBangGiaLoi] = useState<string | null>(null)
  const [nguoiTao, setNguoiTao] = useState<string | null>(null)
  const [phuTrach, setPhuTrach] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [soHien, setSoHien] = useState(MOI_LUOT)
  const [sua, setSua] = useState<{ open: boolean; focus: TruongSua | null }>({ open: false, focus: null })
  const [gopOpen, setGopOpen] = useState(false)
  const supabase = createClient()
  const router = useRouter()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [supRes, noRes, nhapRes, traRes, spRes, phuTrachRes] = await Promise.all([
      /* DB chưa chạy mig 232 thì thiếu cột hồ sơ pháp lý — đọc lại bằng bộ cột cũ, không trắng màn. */
      selectResilient<Ncc>((sel) => supabase.from("suppliers").select(sel).eq("id", id).limit(1), COT_MOI, COT_CU),
      docSoNoNcc(supabase, id),
      fetchAllForAggregate<PhieuNhapTom>((from, to) =>
        supabase
          .from("purchase_invoices")
          .select("id, receipt_code, invoice_number, invoice_date, status, total, created_at", { count: "exact" })
          .eq("supplier_id", id)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to)
      ),
      fetchAllForAggregate<PhieuTraTom>((from, to) =>
        supabase
          .from("supplier_returns")
          .select("id, return_code, return_date, status, total, created_at", { count: "exact" })
          .eq("supplier_id", id)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to)
      ),
      fetchAllForAggregate<SanPhamTom>((from, to) =>
        supabase
          .from("products")
          .select("id, sku, name, base_unit", { count: "exact" })
          .eq("primary_supplier_id", id)
          .order("id")
          .range(from, to)
      ),
      supabase.from("user_suppliers").select("user_id").eq("supplier_id", id),
    ])

    const s = supRes.data[0] ?? null
    setSupplier(s)
    setLoi(supRes.error)
    setSoNo(noRes.rows)
    setSoNoLoi(noRes.error ? noRes.error : noRes.truncated ? "Sổ nợ đọc chưa hết — số tổng có thể thiếu." : null)
    setPhieuNhap(nhapRes.rows)
    setPhieuTra(traRes.rows)
    setSoSanPham(spRes.rows.length)
    if (nhapRes.error || traRes.error) console.error("[suppliers/id] đọc phiếu lỗi:", nhapRes.error ?? traRes.error)

    // Phiếu chi trả NCC (theo dòng nợ) · người tạo · nhân viên phụ trách — phụ, lỗi thì để trống.
    const userIds = Array.from(new Set([
      ...(((phuTrachRes.data as Array<{ user_id: string }> | null) ?? []).map((r) => r.user_id)),
      ...(s?.created_by ? [s.created_by] : []),
    ]))
    const [chi, nguoi, pcn, phanPcn] = await Promise.all([
      docTheoLoId<PhieuChiTom>(
        noRes.rows.map((r) => r.id),
        (lo, from, to) =>
          supabase.from("payable_payments").select("id, payable_id, amount, method, paid_at", { count: "exact" })
            .in("payable_id", lo).order("id").range(from, to),
        "phiếu chi trả NCC"
      ).catch((e) => { console.error("[suppliers/id]", e); return [] as PhieuChiTom[] }),
      userIds.length
        ? supabase.from("users").select("id, full_name").in("id", userIds)
        : Promise.resolve({ data: [] as Array<{ id: string; full_name: string }>, error: null }),
      docPhieuChiCuaNcc(supabase, id),
      /* Phần tiền của phiếu chi NCC đã chia vào từng khoản nợ — không hiện riêng từng phần (phiếu đã là một dòng).
         ⚠ Cột mới (mig 242) đọc RIÊNG: sổ chưa chạy 242 thì lượt này hỏng → rỗng, các lần trả cũ hiện như trước. */
      docTheoLoId<{ id: string }>(
        noRes.rows.map((r) => r.id),
        (lo, from, to) =>
          supabase.from("payable_payments").select("id", { count: "exact" })
            .in("payable_id", lo).not("supplier_payment_id", "is", null).order("id").range(from, to),
        "phần tiền của phiếu chi NCC"
      ).catch(() => [] as Array<{ id: string }>),
    ])
    const phanCuaPhieu = new Set(phanPcn.map((p) => p.id))
    setPhieuChi(chi.filter((c) => !phanCuaPhieu.has(c.id)))
    setPhieuChiNcc(pcn)
    const ten = new Map(((nguoi.data as Array<{ id: string; full_name: string }> | null) ?? []).map((u) => [u.id, u.full_name]))
    setNguoiTao(s?.created_by ? ten.get(s.created_by) ?? null : null)
    const ds = ((phuTrachRes.data as Array<{ user_id: string }> | null) ?? [])
      .map((r) => ten.get(r.user_id))
      .filter((x): x is string => !!x)
      .sort((a, b) => a.localeCompare(b, "vi"))
    setPhuTrach(ds.length ? ds.join(", ") : null)

    // Bảng giá: dòng phiếu nhập HOÀN THÀNH + mặt hàng gắn NCC.
    try {
      const xong = nhapRes.rows.filter((p) => p.status === "completed").map((p) => p.id)
      const dong = await docTheoLoId<DongPhieuNhapGia>(
        xong,
        (lo, from, to) =>
          supabase.from("purchase_invoice_lines").select("id, invoice_id, product_id, unit_name, unit_price", { count: "exact" })
            .in("invoice_id", lo).order("id").range(from, to),
        "dòng phiếu nhập"
      )
      const thieu = Array.from(new Set(dong.map((d) => d.product_id))).filter((pid) => !spRes.rows.some((p) => p.id === pid))
      const them = await docTheoLoId<SanPhamTom>(
        thieu,
        (lo, from, to) => supabase.from("products").select("id, sku, name, base_unit", { count: "exact" }).in("id", lo).order("id").range(from, to),
        "mặt hàng đã nhập"
      )
      setBangGia(bangGiaNhap([...spRes.rows, ...them], nhapRes.rows, dong))
      setBangGiaLoi(spRes.error)
    } catch (e) {
      setBangGia([])
      setBangGiaLoi(errorMessage(e, "Không đọc được bảng giá nhập"))
    }
    setLoading(false)
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const lichSu = useMemo(() => lichSuGiaoDich(phieuNhap, phieuTra, phieuChi, phieuChiNcc), [phieuNhap, phieuTra, phieuChi, phieuChiNcc])

  if (authLoading || loading) return <Skeleton className="h-96" />
  if (!supplier) {
    return (
      <div className="space-y-4 p-8 text-center text-muted-foreground">
        <p>Không tìm thấy nhà cung cấp</p>
        {loi && <p className="text-sm text-destructive">{loi}</p>}
        <Button variant="outline" onClick={() => router.push("/suppliers")}>Về danh sách nhà cung cấp</Button>
      </div>
    )
  }

  const canEdit = !!user && hasPermission(user.role, "inventory", "update")
  /* Chủ nhà 05/10/2026: "Chỉ NPP được xoá" — cùng chốt RPC `xoa_nha_cung_cap` (mig 233). */
  const canDelete = duocQuyenXoaNcc(user?.role)
  const canMerge = duocGopNcc(user?.role)
  const noMo = soNo.filter((r) => r.status !== "paid")
  const tongNo = tongNoNcc(soNo)
  const nhapXong = phieuNhap.filter((p) => p.status === "completed")
  const thang = giaTriNhapThang(phieuNhap, new Date())
  const viec = viecCanHoanThien(supplier)
  const moSua = (focus: TruongSua | null = null) => setSua({ open: true, focus })
  const dangHopTac = supplier.is_active !== false

  const kpis = [
    {
      key: "thang",
      label: "Giá trị nhập tháng này",
      value: formatCurrency(thang.tong),
      unit: "",
      note: thang.so > 0 ? `${thang.so} phiếu nhập hoàn thành trong tháng` : "Chưa có phiếu nhập trong tháng",
    },
    {
      key: "no",
      label: "Công nợ NCC",
      value: soNoLoi && soNo.length === 0 ? "—" : formatCurrency(tongNo),
      unit: "",
      note: noMo.length > 0 ? (tongNo < 0 ? "NCC còn nợ lại mình" : `${noMo.length} khoản chưa trả xong`) : "Không có công nợ",
      testId: "ncc-con-no",
      tone: tongNo > 0 ? "text-destructive" : tongNo < 0 ? "text-[#067647]" : "",
    },
    { key: "phieu", label: "Tổng phiếu nhập", value: String(nhapXong.length), unit: "phiếu", note: "Từ khi tạo nhà cung cấp" },
    {
      key: "sp",
      label: "Sản phẩm",
      value: String(soSanPham),
      unit: "SKU",
      note: soSanPham > 0 ? "Mặt hàng lấy NCC này làm NCC chính" : "Chưa gắn sản phẩm",
    },
  ]

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader title="" backHref="/suppliers" />

      {/* Thẻ đầu */}
      <section className="flex flex-col gap-4 rounded-2xl border bg-card p-4 sm:p-6" data-testid="ncc-dau">
        <div className="flex items-start gap-3.5">
          <div className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[14px] bg-primary/10 text-[22px] font-bold text-primary sm:h-16 sm:w-16">
            {chuCaiDau(supplier.name)}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="break-words text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">{supplier.name}</h1>
              <Badge variant={dangHopTac ? "success" : "danger"} className="rounded-full" data-testid="ncc-trang-thai">
                {dangHopTac ? "Hoạt động" : "Ngừng hợp tác"}
              </Badge>
              {supplier.is_verified && (
                <Badge variant="info" className="gap-1 rounded-full">
                  <CheckCircle2 className="h-3 w-3" /> Đã xác minh
                </Badge>
              )}
            </div>
            <span className="text-sm text-muted-foreground" data-testid="ncc-dong-phu">
              {dongPhuNccChiTiet(supplier, nhapXong.length)}
              {supplier.code ? ` · ${supplier.code}` : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-11 basis-full gap-2 rounded-xl sm:h-10 sm:basis-auto"
            /* Máy tính mở POS nhập hàng ở tab mới; điện thoại đi màn thường — cả hai chọn sẵn NCC này (?ncc=). */
            onClick={() => diHoacMoPos(router.push, hrefPhieuNhapMoi(supplier.id))}
          >
            <FileText className="h-4 w-4" /> Tạo phiếu nhập
          </Button>
          <Button variant="outline" className="h-11 basis-full gap-2 rounded-xl sm:h-10 sm:basis-auto" onClick={() => diHoacMoPos(router.push, hrefTraNccMoi(supplier.id))}>
            <Undo2 className="h-4 w-4" /> Trả hàng NCC
          </Button>
          {/* Phiếu chi trả NCC (chủ nhà 09/10/2026): chi một cục, tự trừ vào các khoản nợ cũ nhất. Chủ NPP / Kế toán. */}
          {duocChiTraNcc(user?.role) && (
            <Button variant="outline" className="h-11 basis-full gap-2 rounded-xl sm:h-10 sm:basis-auto" onClick={() => setMoChiNcc(true)}>
              <Wallet className="h-4 w-4" /> Chi trả NCC
            </Button>
          )}
          {canEdit && (
            <Button variant="outline" className="h-11 basis-full gap-2 rounded-xl sm:h-10 sm:basis-auto" onClick={() => moSua()}>
              <Pencil className="h-4 w-4" /> Sửa thông tin
            </Button>
          )}
        </div>
      </section>

      {/* 4 ô số */}
      <section className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4" data-testid="ncc-kpi">
        {kpis.map((k) => (
          <div key={k.key} className="flex min-w-0 flex-col gap-1.5 rounded-2xl border bg-card p-3.5 sm:p-5">
            <span className="text-xs font-medium text-muted-foreground">{k.label}</span>
            <div className="flex items-baseline gap-1.5">
              <span className={cn("truncate text-[22px] font-bold leading-tight tracking-tight tabular-nums sm:text-[28px]", k.tone)} data-testid={k.testId}>
                {k.value}
              </span>
              {k.unit && <span className="text-xs text-muted-foreground">{k.unit}</span>}
            </div>
            <span className="text-xs text-muted-foreground">{k.note}</span>
          </div>
        ))}
      </section>

      <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <TabsList className="h-auto gap-0.5 rounded-xl bg-muted p-[3px]">
                {TAB.map((t) => (
                  <TabsTrigger
                    key={t}
                    value={t}
                    className="h-9 rounded-[10px] px-3.5 text-sm data-[state=active]:bg-card data-[state=active]:font-semibold data-[state=active]:text-primary"
                  >
                    {NHAN_TAB[t]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* Tab: Lịch sử giao dịch */}
            <TabsContent value="history" className="mt-4">
              <div className="overflow-hidden rounded-2xl border bg-card">
                <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
                  <h3 className="flex-1 text-base font-bold text-foreground">Lịch sử giao dịch</h3>
                  <span className="text-xs text-muted-foreground">
                    {phieuNhap.length} phiếu nhập · {phieuTra.length} phiếu trả · {phieuChi.length + phieuChiNcc.length} lần trả tiền
                  </span>
                </div>
                {lichSu.length === 0 ? (
                  <div className="border-t px-4 py-2 sm:px-6">
                    <EmptyState
                      icon={<History className="h-8 w-8 text-muted-foreground" />}
                      title="Chưa có giao dịch"
                      description="Phiếu nhập, phiếu trả NCC và các lần trả tiền NCC sẽ hiện ở đây."
                    />
                  </div>
                ) : (
                  <>
                    {lichSu.slice(0, soHien).map((g) => (
                      <Link
                        key={g.id}
                        href={g.href}
                        className="flex min-h-11 items-start gap-3 border-t px-4 py-3.5 text-foreground hover:bg-muted/40 sm:px-6"
                        data-testid="ncc-giao-dich"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-semibold text-primary">{g.ma}</span>
                          <span className="text-xs text-muted-foreground">{g.meta}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className={cn("text-sm font-bold tabular-nums", g.soTien < 0 && "text-[#067647]")}>{formatCurrency(g.soTien)}</span>
                          <Badge variant={g.tone} className="rounded-full">{g.trangThai}</Badge>
                        </span>
                      </Link>
                    ))}
                    {lichSu.length > soHien && (
                      <div className="border-t px-4 py-3 sm:px-6">
                        <Button variant="ghost" className="h-10 w-full" onClick={() => setSoHien((n) => n + MOI_LUOT)}>
                          Xem thêm · đang hiện {soHien}/{lichSu.length}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </TabsContent>

            {/* Tab: Tổng quan */}
            <TabsContent value="overview" className="mt-4">
              <BangTruong
                title="Hồ sơ nhà cung cấp"
                fields={hoSoNcc(supplier, nguoiTao, phuTrach)}
                action={canEdit ? <Button variant="link" className="h-9 px-0 font-semibold" onClick={() => moSua()}>Sửa thông tin</Button> : null}
                testId="ncc-ho-so"
              />
            </TabsContent>

            {/* Tab: Bảng giá — giá nhập lần cuối theo mặt hàng × đơn vị, từ phiếu nhập hoàn thành. */}
            <TabsContent value="price_list" className="mt-4">
              <Card className="rounded-2xl">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Bảng giá sản phẩm</CardTitle>
                  <span className="text-xs text-muted-foreground">Giá nhập gần nhất · trước thuế</span>
                </CardHeader>
                <CardContent className="space-y-3">
                  {bangGiaLoi && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{bangGiaLoi}</p>}
                  {!bangGia || bangGia.length === 0 ? (
                    <EmptyState
                      icon={<Package className="h-8 w-8 text-muted-foreground" />}
                      title="Chưa có sản phẩm"
                      description="Mặt hàng hiện ở đây khi gắn NCC này làm NCC chính hoặc khi có phiếu nhập hoàn thành từ NCC này."
                    />
                  ) : (
                    <>
                      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-xs uppercase">Mã</TableHead>
                              <TableHead className="text-xs uppercase">Tên hàng</TableHead>
                              <TableHead className="text-xs uppercase">ĐVT</TableHead>
                              <TableHead className="text-right text-xs uppercase">Giá nhập</TableHead>
                              <TableHead className="text-xs uppercase">Lần nhập cuối</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {bangGia.map((d) => (
                              <TableRow key={d.key} data-testid="dong-bang-gia">
                                <TableCell className="font-mono text-xs">{d.sku}</TableCell>
                                <TableCell className="font-medium">{d.ten}</TableCell>
                                <TableCell>{d.donVi}</TableCell>
                                <TableCell className="text-right font-bold tabular-nums">
                                  {d.gia === null ? <span className="font-normal text-muted-foreground">Chưa nhập</span> : formatCurrency(d.gia)}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                  {d.phieuId ? (
                                    <Link href={`/purchasing/receipts/${d.phieuId}`} className="text-primary hover:underline">
                                      {d.maPhieu ?? "Phiếu nhập"}
                                    </Link>
                                  ) : "—"}
                                  {d.ngay ? ` · ${formatDate(d.ngay)}` : ""}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="space-y-2 md:hidden">
                        {bangGia.map((d) => (
                          <div key={d.key} className="flex items-start justify-between gap-3 rounded-xl border bg-card p-3" data-testid="dong-bang-gia-mobile">
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">{d.ten}</span>
                              <span className="block text-xs text-muted-foreground">
                                {[d.sku, d.donVi, d.maPhieu, d.ngay ? formatDate(d.ngay) : ""].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            <span className="shrink-0 text-right text-sm font-bold tabular-nums">
                              {d.gia === null ? <span className="font-normal text-muted-foreground">Chưa nhập</span> : formatCurrency(d.gia)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Công nợ — sổ `payables` của NCC (phiếu nhập · trả NCC · nợ đầu kỳ), chủ nhà 05/10/2026. */}
            <TabsContent value="debt" className="mt-4">
              <Card className="rounded-2xl">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-base">Công nợ nhà cung cấp</CardTitle>
                  <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>Còn phải trả <b className="tabular-nums text-foreground">{formatCurrency(tongNo)}</b> · {noMo.length} khoản chưa xong</span>
                    {duocChiTraNcc(user?.role) && (
                      <Button size="sm" className="h-9 gap-1.5" onClick={() => setMoChiNcc(true)}>
                        <Wallet className="h-4 w-4" /> Chi trả NCC
                      </Button>
                    )}
                  </span>
                </CardHeader>
                <CardContent className="space-y-3">
                  {soNoLoi && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{soNoLoi}</p>}
                  {soNo.length === 0 ? (
                    <EmptyState
                      icon={<CreditCard className="h-8 w-8 text-muted-foreground" />}
                      title="Không có công nợ"
                      description="Chưa có phiếu nhập nào hoàn thành từ nhà cung cấp này"
                    />
                  ) : (
                    <>
                      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="text-xs uppercase">Chứng từ</TableHead>
                              <TableHead className="text-xs uppercase">Loại</TableHead>
                              <TableHead className="text-xs uppercase">Ngày</TableHead>
                              <TableHead className="text-right text-xs uppercase">Phải trả</TableHead>
                              <TableHead className="text-right text-xs uppercase">Đã thanh toán</TableHead>
                              <TableHead className="text-right text-xs uppercase">Còn lại</TableHead>
                              <TableHead className="text-xs uppercase">Trạng thái</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {soNo.map((r) => (
                              <TableRow key={r.id} className="cursor-pointer hover:bg-muted/40" onClick={() => router.push(r.href)} data-testid="dong-no-ncc">
                                <TableCell className="font-mono text-xs font-bold text-primary">{r.ma}</TableCell>
                                <TableCell><Badge variant="outline">{NHAN_LOAI_NO_NCC[r.loai]}</Badge></TableCell>
                                <TableCell className="text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(r.amount)}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatCurrency(r.paid)}</TableCell>
                                <TableCell className={`text-right font-bold tabular-nums ${r.conLai < 0 ? "text-[#067647]" : ""}`}>{formatCurrency(r.conLai)}</TableCell>
                                <TableCell>
                                  {/* Dòng trả trước (phiếu chi trả dư, mig 242) là tiền NCC đang giữ của mình — không phải khoản "chưa thanh toán". */}
                                  <Badge variant={r.loai === "tra-truoc" || r.status === "paid" ? "success" : r.status === "overdue" ? "danger" : "warning"}>
                                    {r.loai === "tra-truoc" ? "Tiền trả trước" : r.status === "paid" ? "Đã thanh toán" : r.status === "overdue" ? "Quá hạn" : r.status === "partial" ? "Thanh toán một phần" : "Chưa thanh toán"}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="space-y-2 md:hidden">
                        {soNo.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => router.push(r.href)}
                            className="flex w-full items-center justify-between gap-3 rounded-xl border bg-card p-3 text-left"
                            data-testid="dong-no-ncc-mobile"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-mono text-xs font-bold text-primary">{r.ma}</span>
                              <span className="block text-xs text-muted-foreground">
                                {NHAN_LOAI_NO_NCC[r.loai]} · {formatDate(r.created_at)} · {r.loai === "tra-truoc" ? "Tiền trả trước" : r.status === "paid" ? "Đã thanh toán" : "Còn nợ"}
                              </span>
                            </span>
                            <span className={`shrink-0 text-right text-sm font-bold tabular-nums ${r.conLai < 0 ? "text-[#067647]" : ""}`}>{formatCurrency(r.conLai)}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab: Thông tin pháp lý */}
            <TabsContent value="legal" className="mt-4">
              <BangTruong
                title="Thông tin pháp lý"
                fields={phapLyNcc(supplier)}
                action={canEdit ? (
                  <Button variant="outline" className="h-9 gap-1.5 rounded-[10px] font-semibold text-primary" onClick={() => moSua("legal_name")}>
                    <Pencil className="h-4 w-4" /> Cập nhật
                  </Button>
                ) : null}
                testId="ncc-phap-ly"
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Cột phải */}
        <aside className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <div className="flex flex-col gap-3.5 rounded-2xl border bg-card p-4 sm:p-6" data-testid="ncc-hoat-dong">
            <h3 className="text-base font-bold text-foreground">Hoạt động gần đây</h3>
            {lichSu.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chưa có hoạt động.</p>
            ) : (
              lichSu.slice(0, 5).map((g) => (
                <Link key={g.id} href={g.href} className="flex gap-2.5 rounded-lg hover:bg-muted/40">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {g.loai === "nhap" ? `Phiếu nhập ${g.ma}` : g.loai === "tra" ? `Trả hàng ${g.ma}` : `Trả tiền NCC ${formatCurrency(g.soTien)}`}
                    </span>
                    <span className="text-xs text-muted-foreground">{g.meta}</span>
                  </span>
                </Link>
              ))
            )}
            <div className="border-t pt-3 text-xs text-muted-foreground">Gồm phiếu nhập, trả hàng và thanh toán.</div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-6" data-testid="ncc-can-hoan-thien">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-foreground">Cần hoàn thiện</h3>
              {viec.length > 0 && <Badge variant="warning" className="rounded-full">{viec.length} việc</Badge>}
            </div>
            {viec.length === 0 ? (
              <p className="text-sm text-muted-foreground">Hồ sơ đã đủ thông tin.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {viec.map((v) => (
                  <div key={v.key} className="flex min-h-11 items-center gap-2.5 rounded-xl bg-muted/40 px-3" data-testid={`viec-${v.key}`}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" />
                    <span className="flex-1 text-sm font-medium text-foreground">{v.label}</span>
                    {canEdit && (
                      <Button variant="link" className="h-9 px-1 font-semibold" onClick={() => moSua(v.key)}>Bổ sung</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {(canDelete || canMerge || canEdit) && (
            <SupplierDangerZone
              supplier={supplier}
              canDelete={canDelete}
              canEdit={canEdit}
              canMerge={canMerge}
              onDeleted={() => router.push("/suppliers")}
              onDeactivated={fetchData}
              onMerge={() => setGopOpen(true)}
            />
          )}
        </aside>
      </div>

      {canEdit && (
        <SupplierEditSheet
          open={sua.open}
          onOpenChange={(o) => setSua((s) => ({ ...s, open: o }))}
          supplier={supplier}
          focus={sua.focus}
          onSaved={fetchData}
        />
      )}
      {canMerge && (
        <MergeSupplierDialog
          open={gopOpen}
          onOpenChange={setGopOpen}
          nguon={[{ id: supplier.id, name: supplier.name, code: supplier.code, is_active: supplier.is_active }]}
          onDone={(vao) => router.push(`/suppliers/${vao}`)}
        />
      )}
      {duocChiTraNcc(user?.role) && (
        <PhieuChiNccDialog
          open={moChiNcc}
          onOpenChange={setMoChiNcc}
          coDinh={{ id: supplier.id, name: supplier.name }}
          onSaved={fetchData}
        />
      )}
    </div>
  )
}

function BangTruong({
  title,
  fields,
  action,
  testId,
}: {
  title: string
  fields: TruongHoSo[]
  action: React.ReactNode
  testId: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" data-testid={testId}>
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <h3 className="flex-1 text-base font-bold text-foreground">{title}</h3>
        {action}
      </div>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] py-2">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col gap-1 px-4 py-2.5 sm:px-6">
            <dt className="text-xs text-muted-foreground">{f.label}</dt>
            <dd className={cn("break-words text-sm", f.trong ? "font-normal text-muted-foreground" : "font-medium text-foreground")}>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
