/**
 * CHI TIẾT NHÀ CUNG CẤP — logic thuần của màn /suppliers/[id] theo thiết kế "ncc chi tiết" (chủ nhà 05/10/2026:
 * "Viết lại giao diện nhà cung cấp chi tiết" · "Xem lại phần xóa NCC?" · "Thêm chức năng gộp NCC").
 *
 *  · Ô trống hiện chữ xám "Chưa cập nhật" (thiết kế) — `truong()` đánh dấu `trong`.
 *  · "Giá trị nhập tháng này" = Σ tổng tiền phiếu nhập HOÀN THÀNH có `invoice_date` (DATE) trong tháng hiện tại
 *    theo giờ VN — so bằng khoá ngày VN, không so mốc ISO/UTC.
 *  · Lịch sử giao dịch gồm phiếu nhập, phiếu trả NCC và phiếu chi trả NCC, mới trước.
 *  · Bảng giá = giá nhập LẦN CUỐI của từng mặt hàng × đơn vị, lấy từ dòng phiếu nhập hoàn thành (đơn giá trước
 *    thuế, đúng đơn vị của dòng — không quy đổi). Mặt hàng gắn NCC mà chưa nhập lần nào vẫn hiện, giá trống.
 */
import { PAYMENT_TERMS } from "@/lib/constants"
import { formatCurrency, formatDate } from "@/lib/utils"
import { vnDateKey } from "@/lib/orders/status-tone"

export const CHUA_CAP_NHAT = "Chưa cập nhật"

/** Loại hình hay gặp — ô chọn ở biểu mẫu; giá trị lưu đúng chữ hiện ra. */
export const LOAI_HINH_NCC = [
  "Hộ kinh doanh",
  "Công ty TNHH",
  "Công ty cổ phần",
  "Doanh nghiệp tư nhân",
  "Cá nhân",
  "Khác",
] as const

/** Các cột hồ sơ NCC mà màn chi tiết đọc / sửa. */
export interface NccHoSo {
  id: string
  name: string
  code: string | null
  category: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  tax_code: string | null
  bank_account: string | null
  bank_name: string | null
  payment_terms: string | null
  notes: string | null
  is_active: boolean | null
  created_at: string | null
  legal_name?: string | null
  business_type?: string | null
  representative?: string | null
  business_license_no?: string | null
  business_license_date?: string | null
  registered_address?: string | null
  credit_limit?: number | string | null
  created_by?: string | null
}

export interface TruongHoSo {
  label: string
  value: string
  /** Ô trống — hiện "Chưa cập nhật" màu xám. */
  trong: boolean
}

const sach = (v: unknown): string => (v == null ? "" : String(v).trim())

export function truong(label: string, v: unknown, rong: string = CHUA_CAP_NHAT): TruongHoSo {
  const s = sach(v)
  return { label, value: s || rong, trong: !s }
}

export function nhanDieuKhoan(code: string | null | undefined): string {
  const c = sach(code)
  if (!c) return ""
  return PAYMENT_TERMS.find((p) => p.value === c)?.label ?? c
}

/** Hạn mức công nợ: trống = "Không đặt hạn mức" (thiết kế) — vẫn là ô ĐÃ cập nhật, không xám. */
export function nhanHanMuc(v: number | string | null | undefined): string {
  if (v === null || v === undefined || sach(v) === "") return "Không đặt hạn mức"
  return formatCurrency(Number(v) || 0)
}

export function hoSoNcc(s: NccHoSo, nguoiTao: string | null, phuTrach: string | null): TruongHoSo[] {
  return [
    truong("Tên nhà cung cấp", s.name),
    truong("Người liên hệ", s.contact_name),
    truong("Điện thoại", s.phone),
    truong("Email", s.email),
    truong("Địa chỉ", s.address),
    truong("Điều khoản thanh toán", nhanDieuKhoan(s.payment_terms)),
    { label: "Hạn mức công nợ", value: nhanHanMuc(s.credit_limit), trong: false },
    truong("Người tạo", nguoiTao),
    truong("Ngày tạo", s.created_at ? formatDate(s.created_at) : ""),
    truong("Đang phụ trách", phuTrach),
  ]
}

export function phapLyNcc(s: NccHoSo): TruongHoSo[] {
  const taiKhoan = [sach(s.bank_account), sach(s.bank_name)].filter(Boolean).join(" · ")
  return [
    truong("Tên pháp nhân", s.legal_name),
    truong("Mã số thuế", s.tax_code),
    truong("Loại hình", s.business_type),
    truong("Người đại diện", s.representative),
    truong("Số giấy phép ĐKKD", s.business_license_no),
    truong("Ngày cấp", s.business_license_date ? formatDate(s.business_license_date) : ""),
    truong("Địa chỉ đăng ký", s.registered_address),
    truong("Tài khoản ngân hàng", taiKhoan),
  ]
}

/** Ô của biểu mẫu sửa mà "Bổ sung" nhảy tới. */
export type TruongSua = "tax_code" | "phone" | "address" | "contact_name" | "bank_account" | "legal_name"

export interface ViecCanLam {
  key: TruongSua
  label: string
}

/** "Cần hoàn thiện": thiếu MST / SĐT / địa chỉ / người liên hệ / tài khoản NH / tên pháp nhân. */
export function viecCanHoanThien(s: NccHoSo): ViecCanLam[] {
  const out: ViecCanLam[] = []
  if (!sach(s.tax_code)) out.push({ key: "tax_code", label: "Chưa có mã số thuế" })
  if (!sach(s.phone)) out.push({ key: "phone", label: "Chưa có số điện thoại" })
  if (!sach(s.address)) out.push({ key: "address", label: "Chưa có địa chỉ" })
  if (!sach(s.contact_name)) out.push({ key: "contact_name", label: "Chưa có người liên hệ" })
  if (!sach(s.bank_account)) out.push({ key: "bank_account", label: "Chưa có tài khoản ngân hàng" })
  if (!sach(s.legal_name)) out.push({ key: "legal_name", label: "Chưa có tên pháp nhân" })
  return out
}

/** "Nhà cung cấp · <loại hình> · N phiếu nhập". */
export function dongPhuNccChiTiet(s: Pick<NccHoSo, "business_type" | "category">, soPhieuNhap: number): string {
  return ["Nhà cung cấp", sach(s.business_type) || sach(s.category), `${soPhieuNhap} phiếu nhập`].filter(Boolean).join(" · ")
}

// ── KPI ────────────────────────────────────────────────────────────────────────────────────────────

export interface PhieuNhapTom {
  id: string
  receipt_code: string | null
  invoice_number?: string | null
  invoice_date: string | null
  status: string | null
  total: number | string | null
  created_at: string
}

/** Khoá tháng VN "YYYY-MM" của một thời điểm. */
export const thangVn = (d: Date): string => vnDateKey(d).slice(0, 7)

/** Σ tổng tiền phiếu nhập HOÀN THÀNH trong tháng hiện tại (giờ VN) — theo `invoice_date`. */
export function giaTriNhapThang(rows: readonly PhieuNhapTom[], now: Date): { tong: number; so: number } {
  const thang = thangVn(now)
  let tong = 0
  let so = 0
  for (const r of rows) {
    if (r.status !== "completed") continue
    const ngay = sach(r.invoice_date) || (r.created_at ? vnDateKey(new Date(r.created_at)) : "")
    if (ngay.slice(0, 7) !== thang) continue
    tong += Number(r.total) || 0
    so++
  }
  return { tong, so }
}

// ── Lịch sử giao dịch ──────────────────────────────────────────────────────────────────────────────

export interface PhieuTraTom {
  id: string
  return_code: string | null
  return_date: string | null
  status: string | null
  total: number | string | null
  created_at: string
}

export interface PhieuChiTom {
  id: string
  payable_id: string
  amount: number | string | null
  method: string | null
  paid_at: string | null
}

export type LoaiGiaoDich = "nhap" | "tra" | "chi"
export type ToneGiaoDich = "success" | "warning" | "danger" | "secondary"

export interface GiaoDichNcc {
  id: string
  loai: LoaiGiaoDich
  ma: string
  meta: string
  soTien: number
  trangThai: string
  tone: ToneGiaoDich
  href: string
  /** ISO / ngày — để xếp mới trước. */
  ngay: string
}

const NHAN_TRANG_THAI: Record<string, { nhan: string; tone: ToneGiaoDich }> = {
  draft: { nhan: "Nháp", tone: "secondary" },
  completed: { nhan: "Hoàn thành", tone: "success" },
  cancelled: { nhan: "Đã huỷ", tone: "danger" },
}
const trangThai = (s: string | null) => NHAN_TRANG_THAI[s ?? ""] ?? { nhan: s || "—", tone: "secondary" as ToneGiaoDich }

const NHAN_HINH_THUC: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", offset: "Cấn trừ" }

export function lichSuGiaoDich(
  nhap: readonly PhieuNhapTom[],
  tra: readonly PhieuTraTom[],
  chi: readonly PhieuChiTom[]
): GiaoDichNcc[] {
  const out: GiaoDichNcc[] = []
  for (const p of nhap) {
    const t = trangThai(p.status)
    const ngay = sach(p.invoice_date) || p.created_at
    out.push({
      id: `nhap-${p.id}`,
      loai: "nhap",
      ma: p.receipt_code || p.invoice_number || "Phiếu nhập",
      meta: ["Phiếu nhập hàng", sach(p.invoice_number) ? `HĐ ${sach(p.invoice_number)}` : "", ngay ? formatDate(ngay) : ""].filter(Boolean).join(" · "),
      soTien: Number(p.total) || 0,
      trangThai: t.nhan,
      tone: t.tone,
      href: `/purchasing/receipts/${p.id}`,
      ngay,
    })
  }
  for (const r of tra) {
    const t = trangThai(r.status)
    const ngay = sach(r.return_date) || r.created_at
    out.push({
      id: `tra-${r.id}`,
      loai: "tra",
      ma: r.return_code || "Phiếu trả NCC",
      meta: ["Trả hàng NCC", ngay ? formatDate(ngay) : ""].filter(Boolean).join(" · "),
      // Trả hàng làm GIẢM số phải trả — hiện số âm.
      soTien: -(Number(r.total) || 0),
      trangThai: t.nhan,
      tone: t.tone,
      href: `/purchase-returns/${r.id}`,
      ngay,
    })
  }
  for (const c of chi) {
    const ngay = c.paid_at ?? ""
    out.push({
      id: `chi-${c.id}`,
      loai: "chi",
      ma: "Trả tiền NCC",
      meta: ["Thanh toán", NHAN_HINH_THUC[c.method ?? ""] ?? "", ngay ? formatDate(ngay) : ""].filter(Boolean).join(" · "),
      soTien: Number(c.amount) || 0,
      trangThai: "Đã chi",
      tone: "success",
      href: `/payables/${c.payable_id}`,
      ngay,
    })
  }
  // Khoá ngày "YYYY-MM-DD" và ISO đều so chuỗi được; cùng ngày thì phiếu nhập trước phiếu chi.
  return out.sort((a, b) => (a.ngay < b.ngay ? 1 : a.ngay > b.ngay ? -1 : 0))
}

// ── Bảng giá nhập ─────────────────────────────────────────────────────────────────────────────────

export interface DongPhieuNhapGia {
  invoice_id: string
  product_id: string
  unit_name: string | null
  unit_price: number | string | null
}

export interface SanPhamTom {
  id: string
  sku: string | null
  name: string
  base_unit: string | null
}

export interface DongBangGia {
  key: string
  productId: string
  sku: string
  ten: string
  donVi: string
  /** `null` = chưa nhập lần nào từ NCC này. */
  gia: number | null
  ngay: string | null
  maPhieu: string | null
  phieuId: string | null
}

/**
 * Giá nhập lần cuối theo (mặt hàng, đơn vị). "Lần cuối" = phiếu có `invoice_date` (rồi `created_at`) mới nhất;
 * chỉ phiếu HOÀN THÀNH. Mặt hàng gắn NCC (`primary_supplier_id`) chưa nhập lần nào → một dòng giá trống.
 */
export function bangGiaNhap(
  sanPham: readonly SanPhamTom[],
  phieu: readonly PhieuNhapTom[],
  dong: readonly DongPhieuNhapGia[]
): DongBangGia[] {
  const phieuXong = new Map(phieu.filter((p) => p.status === "completed").map((p) => [p.id, p]))
  const sp = new Map(sanPham.map((p) => [p.id, p]))
  const khoaNgay = (p: PhieuNhapTom) => `${sach(p.invoice_date)}|${p.created_at ?? ""}`
  const moiNhat = new Map<string, { d: DongPhieuNhapGia; p: PhieuNhapTom }>()
  for (const d of dong) {
    const p = phieuXong.get(d.invoice_id)
    if (!p) continue
    const k = `${d.product_id}|${sach(d.unit_name)}`
    const cu = moiNhat.get(k)
    if (!cu || khoaNgay(p) > khoaNgay(cu.p)) moiNhat.set(k, { d, p })
  }
  const out: DongBangGia[] = []
  const coGia = new Set<string>()
  for (const [k, { d, p }] of Array.from(moiNhat.entries())) {
    const s = sp.get(d.product_id)
    coGia.add(d.product_id)
    out.push({
      key: k,
      productId: d.product_id,
      sku: s?.sku ?? "",
      ten: s?.name ?? "(mặt hàng đã xoá)",
      donVi: sach(d.unit_name) || s?.base_unit || "",
      gia: Number(d.unit_price) || 0,
      ngay: sach(p.invoice_date) || p.created_at,
      maPhieu: p.receipt_code || p.invoice_number || null,
      phieuId: p.id,
    })
  }
  for (const s of sanPham) {
    if (coGia.has(s.id)) continue
    out.push({ key: `${s.id}|`, productId: s.id, sku: s.sku ?? "", ten: s.name, donVi: s.base_unit ?? "", gia: null, ngay: null, maPhieu: null, phieuId: null })
  }
  return out.sort((a, b) => a.ten.localeCompare(b.ten, "vi") || a.donVi.localeCompare(b.donVi, "vi"))
}

// ── Xoá / gộp ─────────────────────────────────────────────────────────────────────────────────────

export interface ChungTuNcc {
  bang: string
  cot?: string
  so: number
  nhan?: string
}

/** Số chứng từ trả về từ `so_chung_tu_ncc` (mig 232). */
export interface SoChungTuNcc {
  tong: number
  chi_tiet: ChungTuNcc[]
  nhan_vien?: number
  so_khoan_no?: number
  con_no?: number
}

const NHAN_BANG: Record<string, string> = {
  purchase_invoices: "phiếu nhập",
  supplier_returns: "phiếu trả NCC",
  payables: "dòng công nợ NCC",
  purchase_orders: "đơn đặt hàng NCC",
  stock_entries: "phiếu kho",
  products: "mặt hàng",
}

/** "2 phiếu nhập, 1 dòng công nợ NCC" — rỗng khi không có gì. */
export function moTaChungTu(ds: readonly ChungTuNcc[] | null | undefined): string {
  return (ds ?? [])
    .filter((c) => Number(c.so) > 0)
    .map((c) => `${c.so} ${c.nhan || NHAN_BANG[c.bang] || c.bang}`)
    .join(", ")
}

/** Được xoá hẳn khi KHÔNG có chứng từ / mặt hàng nào gắn với NCC. */
export const duocXoaNcc = (so: Pick<SoChungTuNcc, "tong"> | null | undefined): boolean => !!so && Number(so.tong) === 0

/** Vai trò được gộp NCC — cùng danh sách RPC `gop_nha_cung_cap` kiểm. */
export const VAI_TRO_GOP_NCC = ["owner", "manager", "accountant"] as const
export const duocGopNcc = (role: string | null | undefined): boolean =>
  (VAI_TRO_GOP_NCC as readonly string[]).includes(role ?? "")

/** Lỗi máy chủ của luồng xoá / gộp → câu tiếng Việt (bỏ mã ở đầu). */
export function loiNcc(msg: string | null | undefined): string {
  const s = sach(msg)
  if (!s) return "Lỗi không xác định"
  if (s.startsWith("KHONG_DU_QUYEN")) return "Bạn không có quyền làm việc này (chỉ Chủ NPP / Quản lý / Kế toán được gộp NCC)."
  if (s.startsWith("KHONG_TIM_THAY_NCC")) return "Không tìm thấy nhà cung cấp (đã bị xoá hoặc thuộc NPP khác)."
  if (s.startsWith("GOP_NCC_TRUNG")) return "Chọn một nhà cung cấp KHÁC để gộp vào."
  const m = /^[A-Z_]+:\s*([\s\S]*)$/.exec(s)
  return m ? m[1] : s
}
