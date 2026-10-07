"use client"

/**
 * PHIẾU NHẬP HÀNG / TRẢ HÀNG NCC TRÊN ĐIỆN THOẠI — theo khuôn màn làm đơn di động (/sell).
 *
 * Chủ nhà 30/09/2026: "Làm màn nhập hàng, trả hàng NCC (vẫn giữ 2 màn riêng nhé) trên di động
 * giống màn làm đơn hàng trên di động". Hai màn (`/purchasing/receipts/new`,
 * `/purchase-returns/new`) giữ riêng — mỗi màn nạp dữ liệu và ghi phiếu của nó; khung này chỉ
 * là giao diện chung:
 *   - Bước "Thêm hàng" (như 2a): NCC lên đầu, ô tìm, thẻ hàng — chạm thẻ = +1 ở đơn vị đang
 *     chọn, bộ − số + trên thẻ, thanh đáy "N mặt hàng · tiền" + "Xem phiếu".
 *   - Bước "Phiếu" (như 2b): thẻ NCC, dòng hàng (chạm → sheet sửa dòng như 3a), thông tin
 *     phiếu, tổng tiền dưới đáy bấm mở chi tiết, hai nút Lưu tạm / Hoàn thành.
 * ⚠ Nút Back của điện thoại ở bước Phiếu quay về bước Thêm hàng (history), không rời màn.
 *
 * TẠO NHANH TẠI CHỖ (chủ nhà 03/10/2026, Update 3.10): "khi tìm kiếm hàng thêm nút thêm sản phẩm ở top,
 * cạnh nút chọn nhiều sản phẩm. — Khi tìm kiếm ncc, thêm nút thêm NCC" · "Khi tạo xong sản phẩm hoặc NCC
 * -> bấm xong thì quay về phần đang làm … add luôn". Tấm trượt kín màn, điền sẵn chữ đang tìm; lưu xong
 * hàng mới vào phiếu (như chạm thẻ), NCC mới được chọn cho phiếu — phiếu đang làm giữ nguyên.
 */

import { bottomSheetBox, useViewportInsets } from "@/hooks/use-viewport-insets"
import { useCallback, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, ChevronUp, ListChecks, PackagePlus, Plus, Search, Truck, Trash2, TriangleAlert, X } from "lucide-react"
import { chamTheHang, docChonNhieu, ghiChonNhieu, roiManSauKhiThem } from "@/lib/sell/pick-mode"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { SellBottomBar } from "@/components/sell/bottom-bar"
import { Skeleton } from "@/components/ui/skeleton"
import { cn, formatCurrency, formatInt } from "@/lib/utils"
import { timXepHang } from "@/lib/search"
import { SEARCH_FIELD_PROPS, HIDE_NATIVE_CLEAR } from "@/lib/ui/search-field"
import {
  lineDiscountAmountOf, lineNetOf, validReceiptLines,
  type ReceiptLine, type ReceiptProduct,
} from "@/lib/purchasing/receipt-form"
import { inSupplierScope, linesOutOfSupplierScope } from "@/lib/purchasing/return-form"
import type { PickerExtra } from "@/lib/purchasing/picker-extras"
import {
  buocSoLuong, datSoLuong, dongChuaCoGia, doiDonViDong, donViNhap, giaGoiY, MUC_VAT, soLuongTrenPhieu, tongPhieuNcc, tongSoLuong, vatMacDinh,
  type GiamGiaPhieu,
} from "@/lib/purchasing/phieu-mobile"
import { SoThuTu } from "@/components/mobile/so-thu-tu"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase/client"
import { duocTaoNhanh, NHAN_TAO_NHANH } from "@/lib/tao-nhanh/quyen"
import { TaoNhanhSanPham } from "@/components/tao-nhanh/tao-nhanh-san-pham"
import { TaoNhanhNcc } from "@/components/tao-nhanh/tao-nhanh-ncc"
import type { Product } from "@/types"
import { docSanPhamVuaTao, gopVuaTao } from "@/lib/tao-nhanh/vua-tao"
import { useBangGiaNhap } from "@/hooks/use-bang-gia-nhap"
import { ganGiaNhap } from "@/lib/purchasing/bang-gia-nhap"

/** Trần số thẻ vẽ một lúc — như /sell. */
const RENDER_CAP = 60

type NccMuc = { id: string; name: string; code?: string | null }

/** Cột danh mục như trang nạp (`loadCatalogue` ở hai trang) — đọc lại hàng vừa tạo kèm đơn vị quy đổi. */
const COT_HANG_MOI = "id, name, sku, barcode, base_unit, cost_price, vat_rate, shelf_life_days, primary_supplier_id, units:product_units(*)"

export interface PhieuNccValue {
  supplierId: string
  discount: string
  vatOverride: string
  notes: string
  lines: ReceiptLine[]
}

export interface PhieuNccMobileProps {
  kind: "nhap" | "tra"
  suppliers: Array<{ id: string; name: string; code?: string | null }>
  products: ReceiptProduct[]
  /** Danh mục đang nạp. */
  loading?: boolean
  catalogueTruncated?: boolean
  extras: Record<string, PickerExtra>
  value: PhieuNccValue
  onChange: (patch: Partial<PhieuNccValue>) => void
  /** Ô riêng của từng loại phiếu (số HĐ / ngày / kho / lý do). */
  fields: ReactNode
  submitting: boolean
  onDraft: () => void
  onDone: () => void
  backHref: string
  /**
   * Chữ riêng cho màn SỬA (chủ nhà 05/10/2026: màn sửa dùng chung khung với màn tạo) — tiêu đề, nút, dòng nhắc.
   * Thiếu khoá nào thì giữ chữ mặc định của loại phiếu.
   */
  chuRieng?: Partial<Record<"them" | "phieu" | "nhap" | "xong" | "goiY", string>>
  /** Bước mở đầu — màn sửa mở thẳng bước Phiếu (đã có dòng hàng). */
  buocDau?: "hang" | "phieu"
}

const CHU = {
  nhap: {
    them: "Nhập hàng",
    phieu: "Phiếu nhập hàng",
    tong: "Cần trả NCC",
    nhap: "Lưu tạm",
    xong: "Hoàn thành",
    dangXong: "Đang ghi sổ…",
    goiY: "Hoàn thành = nhập kho + ghi công nợ NCC.",
  },
  tra: {
    them: "Trả hàng NCC",
    phieu: "Phiếu trả NCC",
    tong: "NCC trả lại",
    nhap: "Lưu nháp",
    xong: "Gửi phiếu",
    dangXong: "Đang gửi…",
    goiY: "Gửi phiếu = xuất kho + giảm công nợ NCC.",
  },
} as const

const so = (s: string | number | null | undefined): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function PhieuNccMobile({
  kind, suppliers, products, loading = false, catalogueTruncated = false, extras,
  value, onChange, fields, submitting, onDraft, onDone, backHref, chuRieng, buocDau = "hang",
}: PhieuNccMobileProps) {
  const router = useRouter()
  const chu = { ...CHU[kind], ...chuRieng }
  const [buoc, setBuoc] = useState<"hang" | "phieu">(buocDau)
  const [q, setQ] = useState("")
  const dq = useDeferredValue(q)
  const [unitSel, setUnitSel] = useState<Record<string, string>>({})
  const [nccOpen, setNccOpen] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [chiTiet, setChiTiet] = useState(false)
  const [seq, setSeq] = useState(0)
  /**
   * CHỌN TỪNG MÃ là mặc định; CHỌN NHIỀU là tuỳ chọn (chủ nhà 30/09/2026: "cho chọn 1 sản phẩm 1
   * lần là mặc định, nút tùy chọn chọn nhiều sản phẩm 1 lúc (bật tắt khi ấn, ko tự thay đổi trạng
   * thái)") — như /sell (`pick-mode.ts`). Chỉ đổi khi bấm nút; nhớ trên máy, nhập và trả NCC riêng.
   * ⚠ Đọc bộ nhớ SAU khi gắn màn: server không có localStorage.
   */
  const loaiChon = kind === "nhap" ? "nhap" : "tra-ncc"
  const [chonNhieu, setChonNhieu] = useState(false)
  useEffect(() => { setChonNhieu(docChonNhieu(loaiChon)) }, [loaiChon])
  const doiCheDoChon = () => {
    const v = !chonNhieu
    ghiChonNhieu(v, loaiChon)
    setChonNhieu(v)
  }

  /* Tạo nhanh: hàng / NCC vừa tạo sống ở đây tới khi trang nạp lại danh mục. */
  const { user } = useAuth()
  const duocTaoSp = duocTaoNhanh(user?.role, "san-pham")
  const duocTaoNcc = duocTaoNhanh(user?.role, "ncc")
  const [hangMoi, setHangMoi] = useState<ReceiptProduct[]>([])
  const [nccMoi, setNccMoi] = useState<NccMuc[]>([])
  const [taoSp, setTaoSp] = useState<{ chu: string } | null>(null)
  const [taoNcc, setTaoNcc] = useState<{ chu: string } | null>(null)
  /* Giá gợi ý theo bảng giá nhập (mig 234, chủ nhà 06/10/2026: "lưu giá nhập load lại khi làm đơn"). */
  const bangGiaNhap = useBangGiaNhap()
  const dsHang = useMemo(() => ganGiaNhap(gopVuaTao(products, hangMoi), bangGiaNhap), [products, hangMoi, bangGiaNhap])
  const dsNcc = useMemo(() => gopVuaTao(suppliers, nccMoi), [suppliers, nccMoi])

  const lines = value.lines
  const supplier = dsNcc.find((s) => s.id === value.supplierId) ?? null
  const byId = useMemo(() => new Map(dsHang.map((p) => [p.id, p])), [dsHang])

  /* ⚠ Back của điện thoại ở bước Phiếu → về bước Thêm hàng, không rời màn. */
  useEffect(() => {
    const onPop = () => setBuoc("hang")
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])
  const moPhieu = () => {
    if (buoc === "phieu") return
    window.history.pushState({ phieuNcc: 1 }, "")
    setBuoc("phieu")
    window.scrollTo(0, 0)
  }
  const veThemHang = () => {
    if (window.history.state?.phieuNcc) window.history.back()
    else setBuoc("hang")
  }

  /* Hàng của NCC đang chọn (mặt hàng chưa gán NCC vẫn hiện — xem `inSupplierScope`). */
  const trongPhamVi = useMemo(
    () => dsHang.filter((p) => inSupplierScope(p as { primary_supplier_id?: string | null }, value.supplierId)),
    [dsHang, value.supplierId]
  )
  const danhSach = useMemo(() => {
    const kq = timXepHang(trongPhamVi, dq, (x) => [x.sku, x.barcode, x.name], { nho: "hang" }).ketQua
    return kq.slice(0, RENDER_CAP)
  }, [trongPhamVi, dq])

  const unitOf = (p: ReceiptProduct) => unitSel[p.id] ?? p.base_unit
  const step = useCallback(
    (p: ReceiptProduct, unit: string, d: number) => {
      const dongMoi = soLuongTrenPhieu(lines, p.id, unit) === 0
      setSeq((s) => s + 1)
      onChange({ lines: buocSoLuong(lines, p, unit, d, seq) })
      /* Chọn từng mã: thêm một mã mới là sang phiếu ngay (như /sell). */
      if (roiManSauKhiThem({ chonNhieu, delta: d, dongMoi })) moPhieu()
    },
    [lines, onChange, seq, chonNhieu] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /* Chạm thẻ / chạm quy cách — luật ở `chamTheHang`. */
  const cham = (p: ReceiptProduct, unit: string, laQuyCach: boolean) => {
    const kq = chamTheHang({ chonNhieu, daCo: soLuongTrenPhieu(lines, p.id, unit) > 0, laQuyCach })
    if (kq.them) {
      setSeq((s) => s + 1)
      onChange({ lines: buocSoLuong(lines, p, unit, 1, seq) })
    }
    if (kq.sangPhieu) moPhieu()
  }

  /**
   * Hàng vừa tạo: đọc lại kèm đơn vị quy đổi (form chỉ trả dòng `products`), cho vào danh mục rồi THÊM như
   * chạm thẻ — 1 đơn vị cơ sở; chọn từng mã thì sang phiếu, chọn nhiều thì ở lại (`chamTheHang`).
   * ⚠ Đọc lại lỗi vẫn thêm được (chỉ thiếu đơn vị quy đổi) — không bắt làm lại hàng đã tạo.
   */
  const daTaoHang = async (sp: Product) => {
    let moi: ReceiptProduct = { ...sp, units: [] }
    try {
      const doc = await docSanPhamVuaTao<ReceiptProduct>(createClient(), sp.id, COT_HANG_MOI)
      if (doc) moi = { ...moi, ...doc, units: doc.units ?? [] }
    } catch {
      /* giữ bản form trả về */
    }
    setHangMoi((ds) => [...ds.filter((x) => x.id !== moi.id), moi])
    cham(moi, moi.base_unit, false)
  }

  const hopLe = validReceiptLines(lines)
  /**
   * GIẢM GIÁ PHIẾU TRƯỚC THUẾ + VAT MỘT MỨC CHO CẢ PHIẾU (chủ nhà 30/09/2026). Số gõ (đ / %) và
   * mức VAT sống ở đây; phiếu nhận SỐ TIỀN: `discount` = tiền giảm, `vatOverride` = tiền VAT —
   * máy chủ cộng `subtotal + vat − discount` ra đúng tổng này (xem `tongPhieuNcc`).
   */
  const [giam, setGiam] = useState<GiamGiaPhieu>(() => ({ value: value.discount, mode: "amount" }))
  const [vatChon, setVatChon] = useState<number | null>(null)
  const vatPct = vatChon ?? vatMacDinh(hopLe, byId)
  const t = tongPhieuNcc(hopLe, giam, vatPct)
  useEffect(() => {
    const d = String(t.discount)
    const v = String(t.vat)
    if (value.discount !== d || value.vatOverride !== v) onChange({ discount: d, vatOverride: v })
  }, [t.discount, t.vat]) // eslint-disable-line react-hooks/exhaustive-deps
  const ngoaiNcc = value.supplierId ? linesOutOfSupplierScope(lines, dsHang as Array<{ id: string; primary_supplier_id?: string | null }>, value.supplierId) : []
  const chuaGia = dongChuaCoGia(lines)
  const chuaXong = !value.supplierId ? "Chọn NCC" : hopLe.length === 0 ? "Chưa có hàng" : null

  const nccButton = (
    <button
      type="button"
      onClick={() => setNccOpen(true)}
      data-testid="chon-ncc"
      className="flex h-10 items-center gap-2 rounded-[10px] bg-primary/10 px-3 text-left"
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-[12px] font-bold text-primary-foreground">
        {supplier ? supplier.name.trim()[0]?.toUpperCase() : <Truck className="h-3.5 w-3.5" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-primary">{supplier?.name ?? "Chọn nhà cung cấp"}</span>
      <span className="shrink-0 whitespace-nowrap text-[12px] font-medium text-primary">{supplier ? "Đổi NCC" : "Chọn"}</span>
    </button>
  )

  return (
    <div className="-mx-4 -mt-4 flex min-h-screen flex-col bg-surface-container-low">
      {buoc === "hang" ? (
        <div className="flex flex-col pb-32" data-testid="buoc-them-hang">
          {/* ---------- ĐẦU MÀN (như 2a) ---------- */}
          <div className="sticky top-0 z-20 flex flex-col gap-2.5 border-b border-border bg-surface-container-lowest px-4 pb-2.5 pt-3.5">
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Quay lại" onClick={() => router.push(backHref)} className="-ml-2 grid h-9 w-9 place-items-center text-on-surface">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <h1 className="min-w-0 flex-1 truncate text-[19px] font-bold text-on-surface">{chu.them}</h1>
              {duocTaoSp && (
                <button
                  type="button"
                  aria-label="Thêm sản phẩm"
                  title={q.trim() ? `Tạo sản phẩm mới “${q.trim()}”` : NHAN_TAO_NHANH["san-pham"]}
                  onClick={() => setTaoSp({ chu: q })}
                  data-testid="them-san-pham"
                  className="flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-primary/10 px-2.5 text-[13px] font-semibold text-primary"
                >
                  <PackagePlus className="h-[18px] w-[18px]" />
                  Thêm SP
                </button>
              )}
              <button
                type="button"
                aria-pressed={chonNhieu}
                aria-label={chonNhieu ? "Đang chọn nhiều mã — bấm để chọn từng mã" : "Chọn nhiều mã"}
                title={chonNhieu ? "Đang chọn nhiều mã: thêm xong vẫn ở lại màn. Bấm để tắt." : "Chọn nhiều mã (đang chọn từng mã: thêm một mã là sang phiếu)"}
                onClick={doiCheDoChon}
                data-testid="chon-nhieu"
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border transition-colors",
                  chonNhieu ? "border-primary bg-primary text-primary-foreground" : "border-border text-on-surface-variant"
                )}
              >
                <ListChecks className="h-[18px] w-[18px]" />
              </button>
            </div>
            {nccButton}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tên, mã hàng, mã vạch…"
                aria-label="Tìm sản phẩm"
                {...SEARCH_FIELD_PROPS}
                className={cn("h-11 w-full rounded-xl border-0 bg-surface-container-low pl-[38px] pr-10 text-[14px] text-on-surface outline-none", HIDE_NATIVE_CLEAR)}
              />
              {q && (
                <button type="button" onClick={() => setQ("")} aria-label="Xoá tìm kiếm" className="absolute right-1 top-1 grid h-9 w-9 place-items-center text-lg text-muted-foreground">
                  ×
                </button>
              )}
            </div>
            {supplier && (
              <p className="px-1 text-[12px] text-muted-foreground">Đang hiện hàng của {supplier.name} và hàng chưa gán NCC.</p>
            )}
          </div>

          {catalogueTruncated && (
            <p className="mx-3 mt-3 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold text-[#7a4b00]">
              Danh mục chưa tải hết — có thể thiếu mã khi tìm. Tải lại trang để thử lại.
            </p>
          )}

          <div className="grid content-start gap-2 p-3">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-[14px]" />)
            ) : danhSach.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center" data-testid="hang-trong">
                <p className="text-sm text-muted-foreground">
                  {q.trim() ? `Không tìm thấy sản phẩm khớp “${q.trim()}”` : "Chưa có sản phẩm nào"}
                </p>
                {duocTaoSp && (
                  <button
                    type="button"
                    onClick={() => setTaoSp({ chu: q })}
                    className="tap flex max-w-full items-center gap-1.5 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground"
                  >
                    <PackagePlus className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{q.trim() ? `Thêm sản phẩm “${q.trim()}”` : "Thêm sản phẩm"}</span>
                  </button>
                )}
              </div>
            ) : (
              danhSach.map((p) => (
                <TheHangNcc
                  key={p.id}
                  product={p}
                  unit={unitOf(p)}
                  qty={soLuongTrenPhieu(lines, p.id, unitOf(p))}
                  extra={extras[p.id]}
                  chonNhieu={chonNhieu}
                  onPickUnit={(u) => {
                    setUnitSel((m) => ({ ...m, [p.id]: u }))
                    cham(p, u, true)
                  }}
                  onTap={() => cham(p, unitOf(p), false)}
                  onStep={(d) => step(p, unitOf(p), d)}
                />
              ))
            )}
          </div>

          <SellBottomBar className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[12px] text-muted-foreground">
                {lines.length} mặt hàng · {formatInt(tongSoLuong(lines))} đơn vị
              </span>
              <span className="text-[16px] font-bold tabular-data text-on-surface">{formatCurrency(t.subtotal)}</span>
            </div>
            <button
              type="button"
              onClick={moPhieu}
              className="h-12 shrink-0 rounded-xl bg-primary px-[22px] text-[15px] font-semibold text-primary-foreground"
            >
              Xem phiếu
            </button>
          </SellBottomBar>
        </div>
      ) : (
        <div className="flex flex-col pb-[200px]" data-testid="buoc-phieu">
          {/* ---------- ĐẦU MÀN (như 2b) ---------- */}
          <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-surface-container-lowest px-4 pb-3 pt-3.5">
            <button type="button" onClick={veThemHang} aria-label="Quay lại" className="-ml-2 grid h-9 w-9 place-items-center text-on-surface">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-[19px] font-bold">{chu.phieu}</h1>
            <button
              type="button"
              onClick={veThemHang}
              className="flex h-9 items-center gap-1 rounded-[10px] bg-primary/10 px-3 text-[13px] font-semibold text-primary"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
              Thêm hàng
            </button>
          </div>

          <div className="flex min-w-0 flex-col gap-2.5 p-3">
            <button type="button" onClick={() => setNccOpen(true)} className="flex items-center gap-3 rounded-[14px] bg-surface-container-lowest p-3 text-left">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-primary/10 font-bold text-primary">
                {supplier ? supplier.name.trim().charAt(0).toUpperCase() : <Truck className="h-4 w-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold text-on-surface">{supplier?.name ?? "Chọn nhà cung cấp"}</span>
                <span className="truncate text-[12px] text-muted-foreground">
                  {supplier ? (supplier.code ? `Mã ${supplier.code}` : "Nhà cung cấp") : "Phiếu nào cũng phải có NCC"}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>

            {ngoaiNcc.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
                <TriangleAlert className="mt-px h-[18px] w-[18px] shrink-0" />
                <span>{ngoaiNcc.length} dòng là hàng của NCC khác — bỏ ra hoặc đổi NCC trước khi lưu.</span>
              </div>
            )}
            {kind === "nhap" && chuaGia > 0 && (
              <div className="rounded-xl bg-[#fff7e6] px-3 py-2.5 text-[13px] font-semibold leading-snug text-[#7a4b00]">
                {chuaGia} dòng chưa có giá nhập — chạm dòng để gõ theo hoá đơn NCC.
              </div>
            )}

            {/* ---------- DÒNG HÀNG ---------- */}
            <div className="flex flex-col rounded-[14px] bg-surface-container-lowest">
              {lines.length === 0 ? (
                <p className="p-7 text-center text-sm text-muted-foreground">Chưa có sản phẩm. Bấm “Thêm hàng” để chọn.</p>
              ) : (
                lines.map((l, i) => {
                  const giam = lineDiscountAmountOf(l)
                  return (
                    <div key={l.id} data-testid="dong-phieu-ncc" className="flex flex-col gap-2.5 border-b border-border/60 p-3">
                      <div className="flex items-start gap-2">
                        <SoThuTu n={i + 1} />
                        <button type="button" onClick={() => setEditIdx(i)} className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                          <span className="text-[14px] font-semibold leading-[1.35] text-on-surface">{l.product_name}</span>
                          <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
                            <span className={cn("whitespace-nowrap", !(so(l.unit_price) > 0) && "font-semibold text-error")}>
                              {so(l.unit_price) > 0 ? `${formatCurrency(so(l.unit_price))} / ${l.unit_name}` : `Chưa có giá / ${l.unit_name}`}
                            </span>
                            {giam > 0 && (
                              <span className="whitespace-nowrap rounded-[5px] bg-[#ecfdf3] px-1.5 py-px font-semibold text-[#067647]">
                                Giảm {l.discount_mode === "percent" ? `${l.line_discount.replace(".", ",")}%` : formatCurrency(giam)}
                              </span>
                            )}
                            {l.note && <span className="italic">“{l.note}”</span>}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onChange({ lines: datSoLuong(lines, i, 0) })}
                          aria-label={`Xoá ${l.product_name}`}
                          className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center text-muted-foreground"
                        >
                          <X className="h-4 w-4" strokeWidth={2.2} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <BoSoLuong
                          ten={l.product_name}
                          qty={so(l.quantity)}
                          unit={l.unit_name}
                          onChange={(n) => onChange({ lines: datSoLuong(lines, i, Math.max(1, n)) })}
                        />
                        <span className="text-[15px] font-bold tabular-data">{formatCurrency(lineNetOf(l))}</span>
                      </div>
                      {/* ĐVT chọn ngay trên dòng (chủ nhà 07/10/2026: "Phiếu trả hàng NCC … chưa chọn được đơn vị tính")
                          — trước đây phải chạm tên hàng mở sheet mới thấy, dễ bỏ sót. */}
                      {(() => {
                        const sp = byId.get(l.product_id)
                        const dvs = sp ? donViNhap(sp) : []
                        if (!sp || dvs.length < 2) return null
                        return (
                          <div role="group" aria-label={`Đơn vị tính ${l.product_name}`} className="flex flex-wrap gap-1.5" data-testid="dvt-dong-ncc">
                            {dvs.map((u) => (
                              <button
                                key={u}
                                type="button"
                                aria-pressed={u === l.unit_name}
                                onClick={() => u !== l.unit_name && onChange({ lines: doiDonViDong(lines, i, sp, u) })}
                                className={cn(
                                  "h-8 rounded-full border px-3 text-[13px] font-semibold",
                                  u === l.unit_name ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                                )}
                              >
                                {u}
                              </button>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })
              )}
              {lines.length > 0 && (
                <div className="flex justify-between p-3 text-[13px] text-muted-foreground">
                  <span>Tiền hàng</span>
                  <span className="font-semibold tabular-data text-on-surface">{formatCurrency(t.subtotal)}</span>
                </div>
              )}
            </div>

            {/* ---------- THÔNG TIN PHIẾU ---------- */}
            <div className="flex flex-col gap-3 rounded-[14px] bg-surface-container-lowest p-3">
              {fields}
              <OTruong label="Giảm giá phiếu (trước thuế)">
                <span className="flex gap-1.5">
                  <span role="group" aria-label="Giảm giá phiếu theo" className="flex shrink-0 rounded-[10px] bg-surface-container-low p-[3px]">
                    {(["amount", "percent"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={giam.mode === m}
                        onClick={() => setGiam({ mode: m, value: "" })}
                        className={cn(
                          "h-[38px] rounded-lg px-3 text-[13px]",
                          giam.mode === m ? "bg-surface-container-lowest font-semibold text-primary" : "font-medium text-on-surface-variant"
                        )}
                      >
                        {m === "amount" ? "đ" : "%"}
                      </button>
                    ))}
                  </span>
                  {giam.mode === "amount" ? (
                    <OTien id="phieu-ncc-giam" value={giam.value} onChange={(v) => setGiam({ mode: "amount", value: v })} placeholder="0" />
                  ) : (
                    <input
                      id="phieu-ncc-giam"
                      inputMode="decimal"
                      value={giam.value}
                      onChange={(e) => setGiam({ mode: "percent", value: e.target.value.replace(",", ".").replace(/[^\d.]/g, "") })}
                      placeholder="0"
                      className="h-11 w-full min-w-0 rounded-[10px] border border-border bg-surface-container-lowest px-3 text-right text-[15px] tabular-data outline-none focus:border-primary"
                    />
                  )}
                </span>
                {giam.mode === "percent" && t.discount > 0 && (
                  <span className="text-[12px] text-muted-foreground">= {formatCurrency(t.discount)}</span>
                )}
              </OTruong>
              <OTruong label="VAT cả phiếu">
                <span role="group" aria-label="VAT cả phiếu" className="flex w-fit gap-0.5 rounded-[10px] bg-surface-container-low p-[3px]">
                  {MUC_VAT.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={vatPct === m}
                      onClick={() => setVatChon(m)}
                      className={cn(
                        "h-[36px] rounded-lg px-3.5 text-[13px]",
                        vatPct === m ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "font-medium text-on-surface-variant"
                      )}
                    >
                      {m}%
                    </button>
                  ))}
                </span>
              </OTruong>
              <OTruong label="Ghi chú">
                <textarea
                  id="phieu-ncc-ghi-chu"
                  rows={2}
                  value={value.notes}
                  onChange={(e) => onChange({ notes: e.target.value })}
                  className="w-full rounded-[10px] border border-border bg-surface-container-lowest px-3 py-2 text-[14px] outline-none focus:border-primary"
                />
              </OTruong>
            </div>
          </div>

          {/* ---------- TỔNG DƯỚI ĐÁY, BẤM MỞ CHI TIẾT (như 2b) ---------- */}
          {chiTiet && <div aria-hidden onClick={() => setChiTiet(false)} className="fixed inset-0 z-20 bg-on-surface/45" />}
          <SellBottomBar className={cn("flex flex-col gap-3", chiTiet && "rounded-t-[20px]")}>
            {chiTiet && (
              <div className="flex flex-col gap-3 border-b border-border pb-3 text-[15px] text-on-surface-variant">
                <Hang label={`Tiền hàng · ${hopLe.length} mặt hàng`} value={formatCurrency(t.subtotal)} />
                {t.discount > 0 && <Hang label="Giảm giá phiếu" value={`−${formatCurrency(t.discount)}`} />}
                <Hang label={`VAT ${vatPct}%`} value={`+${formatCurrency(t.vat)}`} />
                <p className="text-[12px] text-muted-foreground">{chu.goiY}</p>
              </div>
            )}
            <button type="button" onClick={() => setChiTiet((v) => !v)} aria-expanded={chiTiet} className="flex items-center justify-between text-left">
              <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
                <span className="text-[18px] font-bold text-on-surface">{chu.tong}</span>
                <span className="grid h-[22px] min-w-[22px] place-items-center rounded-full border-[1.5px] border-primary px-1 text-[12px] font-bold text-primary">
                  {hopLe.length}
                </span>
                <ChevronUp className={cn("h-4 w-4 text-on-surface-variant transition-transform", chiTiet && "rotate-180")} />
              </span>
              <span data-testid="tong-phieu-ncc" className="whitespace-nowrap text-[24px] font-bold tabular-data text-on-surface">
                {formatCurrency(t.total)}
              </span>
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={submitting || !value.supplierId || ngoaiNcc.length > 0}
                onClick={onDraft}
                className="h-[50px] flex-1 rounded-xl border border-border bg-surface-container-lowest text-[15px] font-semibold text-on-surface-variant disabled:opacity-40"
              >
                {chu.nhap}
              </button>
              <button
                type="button"
                disabled={submitting || !!chuaXong || ngoaiNcc.length > 0}
                onClick={onDone}
                className="h-[50px] flex-[2] rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground disabled:opacity-40"
              >
                {submitting ? chu.dangXong : chuaXong ?? (ngoaiNcc.length > 0 ? "Hàng NCC khác" : chu.xong)}
              </button>
            </div>
          </SellBottomBar>
        </div>
      )}

      <ChonNccSheet
        open={nccOpen}
        suppliers={dsNcc}
        valueId={value.supplierId}
        onPick={(id) => {
          onChange({ supplierId: id })
          setNccOpen(false)
        }}
        onClose={() => setNccOpen(false)}
        /* ⚠ Đóng tấm chọn rồi mới mở khung tạo — hai hộp thoại chồng nhau giành tiêu điểm. */
        onTaoMoi={duocTaoNcc ? (chu) => { setNccOpen(false); setTaoNcc({ chu }) } : undefined}
      />

      <TaoNhanhSanPham
        open={!!taoSp}
        onOpenChange={(o) => !o && setTaoSp(null)}
        chuBanDau={taoSp?.chu}
        /* NCC của phiếu điền sẵn — hàng mới hiện ngay trong danh sách hàng của NCC này. */
        nccBanDau={value.supplierId || undefined}
        moTa={kind === "nhap" ? "Tạo xong sản phẩm được thêm luôn vào phiếu nhập." : "Tạo xong sản phẩm được thêm luôn vào phiếu trả."}
        onDaTao={(sp) => void daTaoHang(sp)}
      />
      <TaoNhanhNcc
        open={!!taoNcc}
        onOpenChange={(o) => !o && setTaoNcc(null)}
        chuBanDau={taoNcc?.chu}
        onDaTao={(n) => {
          setNccMoi((ds) => [...ds.filter((x) => x.id !== n.id), { id: n.id, name: n.name, code: n.code }])
          onChange({ supplierId: n.id })
        }}
      />

      <SuaDongSheet
        line={editIdx == null ? null : lines[editIdx] ?? null}
        product={editIdx == null || !lines[editIdx] ? undefined : byId.get(lines[editIdx].product_id)}
        onPatch={(p) => editIdx != null && onChange({ lines: lines.map((l, k) => (k === editIdx ? { ...l, ...p } : l)) })}
        onUnit={(u) => {
          if (editIdx == null) return
          const p = byId.get(lines[editIdx].product_id)
          if (!p) return
          onChange({ lines: doiDonViDong(lines, editIdx, p, u) })
          setEditIdx(null)
        }}
        onRemove={() => {
          if (editIdx != null) onChange({ lines: datSoLuong(lines, editIdx, 0) })
          setEditIdx(null)
        }}
        onClose={() => setEditIdx(null)}
      />
    </div>
  )
}

/** Thẻ hàng — như `ProductCard` của /sell; giá là giá nhập gợi ý, tồn là tồn kho. */
function TheHangNcc({
  product, unit, qty, extra, chonNhieu, onPickUnit, onTap, onStep,
}: {
  product: ReceiptProduct
  unit: string
  qty: number
  extra?: PickerExtra
  chonNhieu: boolean
  onPickUnit: (u: string) => void
  onTap: () => void
  onStep: (d: number) => void
}) {
  const units = donViNhap(product)
  const gia = giaGoiY(product, unit)
  const co = qty > 0
  const rieng = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div
      data-testid="the-hang-ncc"
      role="button"
      tabIndex={0}
      aria-label={`Thêm ${product.name}`}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onTap()
        }
      }}
      className={cn(
        "flex cursor-pointer select-none flex-col gap-2.5 rounded-[14px] border-[1.5px] bg-surface-container-lowest p-3 transition-transform active:scale-[0.99]",
        "[content-visibility:auto] [contain-intrinsic-size:auto_104px]",
        co ? "border-primary" : "border-transparent"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <p className="line-clamp-2 text-[14px] font-semibold leading-[1.35] text-on-surface">{product.name}</p>
          <p className="text-[12px] text-muted-foreground">
            {product.sku}
            {" · "}
            {/* ⚠ Chưa đọc được tồn thì nói ra, không in 0 (xem `PickerExtra`). */}
            {extra?.onHand == null ? "chưa rõ tồn" : `Tồn ${formatInt(extra.onHand)} ${product.base_unit}`}
            {extra?.supplierName ? ` · ${extra.supplierName}` : ""}
          </p>
        </div>
        <div className="whitespace-nowrap text-right">
          <p className="text-[15px] font-bold tabular-data text-on-surface">{gia > 0 ? formatCurrency(gia) : "chưa có giá"}</p>
          <p className="text-[11px] text-muted-foreground">/ {unit}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 gap-0.5 overflow-x-auto rounded-[10px] bg-surface-container-low p-[3px]">
          {units.map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={u === unit}
              onClick={rieng(() => onPickUnit(u))}
              className={cn(
                "h-[30px] shrink-0 rounded-lg px-3 text-[13px]",
                u === unit ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "font-medium text-on-surface-variant"
              )}
            >
              {u}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {/* Chọn từng mã: không có −/+ (chạm là sang phiếu, sửa số lượng ở phiếu) — chỉ báo đã có. */}
        {co && !chonNhieu && (
          <span data-testid="da-co-tren-phieu" className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[12px] font-semibold text-primary">
            Đã có {formatInt(qty)} {unit}
          </span>
        )}
        {co && chonNhieu && (
          <div className="flex h-9 shrink-0 items-center rounded-[10px] bg-primary text-primary-foreground [&>button]:active:bg-black/10">
            <button type="button" aria-label={`Bớt ${product.name}`} onClick={rieng(() => onStep(-1))} className="h-9 w-9 text-[18px]">
              −
            </button>
            <span aria-label={`Số lượng ${product.name}`} className="min-w-6 text-center text-[14px] font-bold tabular-data">
              {formatInt(qty)}
            </span>
            <button type="button" aria-label={`Tăng ${product.name}`} onClick={rieng(() => onStep(1))} className="h-9 w-9 text-[18px]">
              +
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** − số + của dòng; nút − dừng ở 1 (xoá là nút riêng), chạm số để gõ. */
function BoSoLuong({ ten, qty, unit, onChange }: { ten: string; qty: number; unit: string; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-9 items-center rounded-[10px] border border-border">
        <button type="button" aria-label={`Bớt ${ten}`} disabled={qty <= 1} onClick={() => onChange(qty - 1)} className="h-9 w-9 text-[18px] disabled:opacity-30">
          −
        </button>
        <input
          aria-label={`Số lượng ${ten}`}
          inputMode="decimal"
          value={String(qty)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const n = Number(e.target.value.replace(",", "."))
            if (Number.isFinite(n) && n > 0) onChange(n)
          }}
          className="h-9 w-12 bg-transparent text-center text-[14px] font-bold tabular-data outline-none"
        />
        <button type="button" aria-label={`Tăng ${ten}`} onClick={() => onChange(qty + 1)} className="h-9 w-9 text-[18px]">
          +
        </button>
      </div>
      <span className="text-[13px] text-muted-foreground">{unit}</span>
    </div>
  )
}

export function OTruong({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** Ô tiền: hiện có dấu chấm hàng nghìn, lưu chuỗi số (trống = trống). */
export function OTien({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const hien = value.trim() === "" ? "" : formatInt(Number(value) || 0)
  return (
    <input
      id={id}
      inputMode="numeric"
      value={hien}
      placeholder={placeholder}
      onChange={(e) => {
        const d = e.target.value.replace(/\D/g, "")
        onChange(d === "" ? "" : String(Number(d)))
      }}
      className="h-11 w-full rounded-[10px] border border-border bg-surface-container-lowest px-3 text-right text-[15px] tabular-data outline-none focus:border-primary"
    />
  )
}

function Hang({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="font-semibold tabular-data text-on-surface">{value}</span>
    </div>
  )
}

/** Chọn NCC — như màn chọn khách (2c): ô tìm + danh sách. */
function ChonNccSheet({
  open, suppliers, valueId, onPick, onClose, onTaoMoi,
}: {
  open: boolean
  suppliers: Array<{ id: string; name: string; code?: string | null }>
  valueId: string
  onPick: (id: string) => void
  onClose: () => void
  /** Có quyền tạo NCC thì có — nhận chữ đang tìm (thành tên NCC). */
  onTaoMoi?: (chu: string) => void
}) {
  const [q, setQ] = useState("")
  useEffect(() => {
    if (open) setQ("")
  }, [open])
  const ds = useMemo(() => timXepHang(suppliers, q, (s) => [s.code, s.name]).ketQua.slice(0, 80), [suppliers, q])
  /* ⚠ Bàn phím mở thì nhấc tấm lên trên bàn phím và thu chiều cao theo phần còn thấy — không thì danh sách
     NCC tụt xuống dưới bàn phím (chủ nhà 30/09/2026). Cùng cách với /sell (line-edit-sheet). */
  const vp = useViewportInsets(open)
  const box = vp ? bottomSheetBox(vp, 0.85) : null
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[85vh] flex-col gap-0 rounded-t-[20px] p-0"
        style={box ? { maxHeight: box.height, bottom: box.bottom } : undefined}
        data-testid="chon-ncc-sheet"
      >
        <div className="flex flex-col gap-2.5 border-b border-border/60 px-4 pb-3 pt-2">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[16px] font-bold">Chọn nhà cung cấp</p>
            {onTaoMoi && (
              <button
                type="button"
                onClick={() => onTaoMoi(q)}
                data-testid="them-ncc"
                className="flex h-9 shrink-0 items-center gap-1 rounded-[10px] bg-primary/10 px-3 text-[13px] font-semibold text-primary"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
                Thêm NCC
              </button>
            )}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên hoặc mã NCC…"
              aria-label="Tìm nhà cung cấp"
              {...SEARCH_FIELD_PROPS}
              className={cn("h-11 w-full rounded-xl border-0 bg-surface-container-low pl-[38px] pr-3 text-[14px] outline-none", HIDE_NATIVE_CLEAR)}
            />
          </div>
        </div>
        <div className="flex flex-col overflow-y-auto">
          {ds.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Không tìm thấy NCC nào khớp.</p>
          ) : (
            ds.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick(s.id)}
                className={cn("flex items-center gap-3 border-b border-border/60 px-4 py-3 text-left", s.id === valueId && "bg-primary/10")}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-primary/10 font-bold text-primary">
                  {s.name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[15px] font-semibold">{s.name}</span>
                  {s.code && <span className="text-[12px] text-muted-foreground">{s.code}</span>}
                </span>
                {s.id === valueId && <span className="text-[12px] font-semibold text-primary">Đang chọn</span>}
              </button>
            ))
          )}
          {/* Dòng tạo mới ở CUỐI danh sách (kể cả khi không khớp NCC nào) — như ô chọn có tìm (`taoMoi`). */}
          {onTaoMoi && (
            <button
              type="button"
              onClick={() => onTaoMoi(q)}
              data-testid="tao-ncc-moi"
              className="flex min-h-[52px] items-center gap-3 px-4 py-3 pb-[calc(var(--safe-b)+12px)] text-left text-[15px] font-semibold text-primary"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-dashed border-primary/50">
                <Plus className="h-4 w-4" strokeWidth={2.6} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {q.trim() ? `${NHAN_TAO_NHANH.ncc} “${q.trim()}”` : NHAN_TAO_NHANH.ncc}
              </span>
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Sửa dòng (như 3a): số lượng, đơn vị, giá nhập, giảm giá (đ / %), ghi chú — VAT đặt ở cả phiếu. */
function SuaDongSheet({
  line, product, onPatch, onUnit, onRemove, onClose,
}: {
  line: ReceiptLine | null
  product: ReceiptProduct | undefined
  onPatch: (p: Partial<ReceiptLine>) => void
  onUnit: (u: string) => void
  onRemove: () => void
  onClose: () => void
}) {
  const open = !!line
  const vp = useViewportInsets(open)
  const box = vp ? bottomSheetBox(vp, 0.9) : null
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="bottom"
        className="flex max-h-[90vh] flex-col gap-0 rounded-t-[20px] p-0"
        style={box ? { maxHeight: box.height, bottom: box.bottom } : undefined}
      >
        {line && (
          <>
            <div className="flex items-start gap-3 border-b border-border/60 px-4 pb-3.5 pt-2">
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <p className="text-[16px] font-bold leading-[1.35]">{line.product_name}</p>
                <p className="text-[12px] text-muted-foreground">{line.sku}</p>
              </div>
              <button type="button" aria-label="Đóng" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-container-low">
                <X className="h-3.5 w-3.5" strokeWidth={2.4} />
              </button>
            </div>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3.5">
              {product && donViNhap(product).length > 1 && (
                <OTruong label="Đơn vị">
                  <span className="flex w-fit gap-0.5 rounded-[10px] bg-surface-container-low p-[3px]">
                    {donViNhap(product).map((u) => (
                      <button
                        key={u}
                        type="button"
                        aria-pressed={u === line.unit_name}
                        onClick={() => onUnit(u)}
                        className={cn(
                          "h-[32px] rounded-lg px-3 text-[13px]",
                          u === line.unit_name ? "bg-surface-container-lowest font-semibold text-primary shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "font-medium text-on-surface-variant"
                        )}
                      >
                        {u}
                      </button>
                    ))}
                  </span>
                </OTruong>
              )}
              <div className="grid grid-cols-2 gap-2">
                <OTruong label={`Số lượng (${line.unit_name})`}>
                  <input
                    id="sua-dong-sl"
                    inputMode="decimal"
                    value={line.quantity}
                    onChange={(e) => onPatch({ quantity: e.target.value.replace(",", ".") })}
                    className="h-11 w-full rounded-[10px] border border-border bg-surface-container-lowest px-3 text-right text-[15px] tabular-data outline-none focus:border-primary"
                  />
                </OTruong>
                <OTruong label={`Giá nhập / ${line.unit_name}`}>
                  <OTien id="sua-dong-gia" value={line.unit_price} onChange={(v) => onPatch({ unit_price: v })} placeholder="Gõ theo HĐ NCC" />
                </OTruong>
              </div>
              <div className="grid gap-2">
                <OTruong label="Giảm giá dòng">
                  <span className="flex gap-1.5">
                    <span className="flex shrink-0 rounded-[10px] bg-surface-container-low p-[3px]">
                      {(["amount", "percent"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={line.discount_mode === m}
                          onClick={() => onPatch({ discount_mode: m, line_discount: "" })}
                          className={cn(
                            "h-[38px] rounded-lg px-2.5 text-[13px]",
                            line.discount_mode === m ? "bg-surface-container-lowest font-semibold text-primary" : "font-medium text-on-surface-variant"
                          )}
                        >
                          {m === "amount" ? "đ" : "%"}
                        </button>
                      ))}
                    </span>
                    <input
                      id="sua-dong-giam"
                      inputMode="decimal"
                      value={line.line_discount}
                      onChange={(e) => onPatch({ line_discount: e.target.value.replace(",", ".").replace(/[^\d.]/g, "") })}
                      placeholder="0"
                      className="h-11 w-full min-w-0 rounded-[10px] border border-border bg-surface-container-lowest px-3 text-right text-[15px] tabular-data outline-none focus:border-primary"
                    />
                  </span>
                </OTruong>
              </div>
              <OTruong label="Ghi chú dòng">
                <input
                  id="sua-dong-ghi-chu"
                  value={line.note}
                  onChange={(e) => onPatch({ note: e.target.value })}
                  className="h-11 w-full rounded-[10px] border border-border bg-surface-container-lowest px-3 text-[14px] outline-none focus:border-primary"
                />
              </OTruong>
              <div className="flex items-center justify-between border-t border-border/60 pt-3">
                <span className="text-[14px] text-muted-foreground">Thành tiền</span>
                <span className="text-[18px] font-bold tabular-data">{formatCurrency(lineNetOf(line))}</span>
              </div>
            </div>
            <div className="flex gap-2 border-t border-border/60 px-4 pb-[calc(var(--safe-b)+14px)] pt-3">
              <button type="button" onClick={onRemove} className="flex h-12 items-center gap-1.5 rounded-xl border border-border px-4 text-[14px] font-semibold text-error">
                <Trash2 className="h-4 w-4" /> Bỏ dòng
              </button>
              <button type="button" onClick={onClose} className="h-12 flex-1 rounded-xl bg-primary text-[15px] font-semibold text-primary-foreground">
                Xong
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Nhóm nút chọn một (kho, lý do…) — thay ô thả xuống cho ngón cái. */
export function NhomNut<T extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-9 rounded-[10px] border px-3 text-[13px]",
            o.value === value ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border font-medium text-on-surface-variant"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
