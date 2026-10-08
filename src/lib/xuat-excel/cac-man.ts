/**
 * CỘT XUẤT EXCEL CỦA TỪNG DANH SÁCH CHỨNG TỪ (chủ nhà 05/10/2026: "Thêm phần xuất excel cho phiếu trả hàng ncc và
 * các phiếu khác tương tự"). Khung chung ở `./phieu.ts`; mỗi màn ở đây chỉ khai câu chọn dòng + danh sách cột.
 *
 * ⚠ TIỀN HÓA ĐƠN BÁN LÀ SỐ CÒN LẠI SAU HÀNG TRẢ (CLAUDE.md, mig 192) — cột "Tổng tiền" của sheet Phiếu là
 *   `total − hàng trả đã trừ vào hóa đơn` (`traTheoHoaDon`), như cột tiền trên danh sách; tiền gốc và hàng trả
 *   nằm ở hai cột riêng cạnh nó.
 * ⚠ PHIẾU TRẢ CỦA KHÁCH: tiền là `credit_note_amount`; dòng HÀNG ĐỔI không tính tiền (cột "Tiền tính nợ" = 0).
 * ⚠ GIÁ VỐN (phiếu kho) chỉ xuất cho người xem được giá vốn (`xemDuocGiaVon`).
 */
import {
  CASH_RECEIPT_SOURCE_LABEL, CASH_RECEIPT_STATUS_LABEL, tomTatDongPhieuThu, type DongPhieuThuTom,
} from "@/lib/finance/cash-receipt-list"
import { INVOICE_STATUS_MAP, ORDER_STATUS_MAP, RETURN_REASONS, RETURN_STATUS_MAP, STOCK_ENTRY_TYPES } from "@/lib/constants"
import { receiptStatusLabel } from "@/lib/purchasing/receipt-status"
import { giamCuaHoaDon } from "@/lib/pos/invoice-discount"
import { tenPhieuTra } from "@/lib/returns/ma-phieu"
import {
  HANG_NHUNG, SHEET_DONG, SHEET_PHIEU, cotHang, dungBang, ghepDong, ngayVN, soLg, tien,
  type Cot, type DongHangTho, type SheetXuat,
} from "./phieu"

type Ten = { full_name?: string | null } | null | undefined
type DoiTac = { name?: string | null; code?: string | null } | null | undefined
type Khach = { store_name?: string | null; phone?: string | null; address?: string | null; customer_code?: string | null } | null | undefined
/** Tên người theo id (`created_by`…) — bảng không nhúng được người lập thì đọc riêng (`napTenNguoi`). */
export type TenNguoi = ReadonlyMap<string, string>

/**
 * Nơi đọc dòng của một loại chứng từ (`napDong`). Tên bảng dòng nằm ở đây, không ở trang danh sách: danh sách
 * KHÔNG đọc dòng hàng để vẽ (bớt lượt gọi, 27/09/2026) — chỉ lúc bấm Xuất Excel.
 */
export interface NguonDong {
  bang: string
  /** Cột khoá ngoài trỏ về phiếu. */
  cot: string
  chon: string
  /** Tên trong câu báo lỗi. */
  ten: string
}

const KHO: Record<string, string> = { sale: "Kho hàng bán", date: "Kho hàng date" }
export const kho = (z: string | null | undefined) => (z ? KHO[z] ?? z : "")
const nguoi = (m: TenNguoi, id: string | null | undefined) => (id ? m.get(id) ?? "" : "")

/** Hai sheet: Phiếu + Chi tiết dòng. */
function haiSheet<P extends { id: string }, L extends { sort_order?: number | null; id?: string | null }>(
  phieu: readonly P[], cotPhieu: readonly Cot<P>[],
  dong: readonly L[], cuaPhieu: (l: L) => string | null | undefined, cotDong: readonly Cot<{ p: P; l: L }>[]
): SheetXuat[] {
  return [
    { ten: SHEET_PHIEU, rows: dungBang(cotPhieu, phieu) },
    { ten: SHEET_DONG, rows: dungBang(cotDong, ghepDong(phieu, dong, cuaPhieu)) },
  ]
}

/* ======================================================================================= 1. TRẢ HÀNG NCC */

export interface PhieuTraNcc {
  id: string
  return_code: string | null
  return_date: string | null
  warehouse_zone: string | null
  status: string
  subtotal?: number | string | null
  vat?: number | string | null
  discount?: number | string | null
  total: number | string | null
  reason?: string | null
  notes?: string | null
  created_by?: string | null
  supplier?: DoiTac
}
export interface DongTraNcc extends DongHangTho {
  id?: string | null
  return_id: string
  sort_order?: number | null
  notes?: string | null
}
const TT_TRA_NCC: Record<string, string> = { draft: "Nháp", completed: "Đã gửi", cancelled: "Đã huỷ" }
export const CHON_DONG_TRA_NCC =
  `id, return_id, sort_order, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, line_total, notes, ${HANG_NHUNG}`

export const DONG_TRA_NCC: NguonDong = { bang: "supplier_return_lines", cot: "return_id", chon: CHON_DONG_TRA_NCC, ten: "Dòng phiếu trả NCC" }
export function xuatTraHangNcc(phieu: readonly PhieuTraNcc[], dong: readonly DongTraNcc[], ten: TenNguoi): SheetXuat[] {
  const ma = (p: PhieuTraNcc) => p.return_code || "chưa sinh mã"
  return haiSheet(
    phieu,
    [
      { ten: "Mã phiếu", lay: ma },
      { ten: "Ngày", lay: (p) => ngayVN(p.return_date) },
      { ten: "Mã NCC", lay: (p) => p.supplier?.code },
      { ten: "Nhà cung cấp", lay: (p) => p.supplier?.name },
      { ten: "Kho xuất", lay: (p) => kho(p.warehouse_zone) },
      { ten: "Trạng thái", lay: (p) => TT_TRA_NCC[p.status] ?? p.status },
      { ten: "Tiền hàng (chưa VAT)", lay: (p) => tien(p.subtotal) },
      { ten: "VAT", lay: (p) => tien(p.vat) },
      { ten: "Giảm giá", lay: (p) => tien(p.discount) },
      { ten: "Tổng tiền", lay: (p) => tien(p.total) },
      { ten: "Lý do", lay: (p) => p.reason },
      { ten: "Ghi chú", lay: (p) => p.notes },
      { ten: "Người lập", lay: (p) => nguoi(ten, p.created_by) },
    ],
    dong,
    (l) => l.return_id,
    [
      { ten: "Mã phiếu", lay: ({ p }) => ma(p) },
      { ten: "Ngày", lay: ({ p }) => ngayVN(p.return_date) },
      { ten: "Nhà cung cấp", lay: ({ p }) => p.supplier?.name },
      { ten: "Trạng thái", lay: ({ p }) => TT_TRA_NCC[p.status] ?? p.status },
      ...cotHang<{ l: DongTraNcc }>((r) => r.l),
      { ten: "Ghi chú dòng", lay: ({ l }) => l.notes },
    ]
  )
}

/* ======================================================================================= 2. PHIẾU NHẬP HÀNG */

export interface PhieuNhap {
  id: string
  receipt_code: string | null
  invoice_number: string | null
  invoice_date: string | null
  status: string
  warehouse_zone: string | null
  subtotal?: number | string | null
  vat?: number | string | null
  vat_override?: number | string | null
  discount?: number | string | null
  total: number | string | null
  notes?: string | null
  created_by?: string | null
  supplier?: DoiTac
}
export interface DongNhap extends DongHangTho {
  id?: string | null
  invoice_id: string
  sort_order?: number | null
  notes?: string | null
}
export const CHON_DONG_NHAP =
  `id, invoice_id, sort_order, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, line_total, notes, ${HANG_NHUNG}`

export const DONG_NHAP: NguonDong = { bang: "purchase_invoice_lines", cot: "invoice_id", chon: CHON_DONG_NHAP, ten: "Dòng phiếu nhập" }
export function xuatPhieuNhap(phieu: readonly PhieuNhap[], dong: readonly DongNhap[], ten: TenNguoi): SheetXuat[] {
  const ma = (p: PhieuNhap) => p.receipt_code || "(chưa cấp mã)"
  return haiSheet(
    phieu,
    [
      { ten: "Mã phiếu", lay: ma },
      { ten: "Ngày", lay: (p) => ngayVN(p.invoice_date) },
      { ten: "Số HĐ NCC", lay: (p) => p.invoice_number },
      { ten: "Mã NCC", lay: (p) => p.supplier?.code },
      { ten: "Nhà cung cấp", lay: (p) => p.supplier?.name },
      { ten: "Kho", lay: (p) => kho(p.warehouse_zone) },
      { ten: "Trạng thái", lay: (p) => receiptStatusLabel(p.status) },
      { ten: "Tiền hàng (chưa VAT)", lay: (p) => tien(p.subtotal) },
      /* Tiền thuế gõ tay theo giấy NCC thắng tiền máy cộng (mig 146) — như ô VAT ở xem nhanh. */
      { ten: "VAT", lay: (p) => tien(p.vat_override ?? p.vat) },
      { ten: "Giảm giá", lay: (p) => tien(p.discount) },
      { ten: "Cần trả NCC", lay: (p) => tien(p.total) },
      { ten: "Ghi chú", lay: (p) => p.notes },
      { ten: "Người lập", lay: (p) => nguoi(ten, p.created_by) },
    ],
    dong,
    (l) => l.invoice_id,
    [
      { ten: "Mã phiếu", lay: ({ p }) => ma(p) },
      { ten: "Ngày", lay: ({ p }) => ngayVN(p.invoice_date) },
      { ten: "Số HĐ NCC", lay: ({ p }) => p.invoice_number },
      { ten: "Nhà cung cấp", lay: ({ p }) => p.supplier?.name },
      { ten: "Trạng thái", lay: ({ p }) => receiptStatusLabel(p.status) },
      ...cotHang<{ l: DongNhap }>((r) => r.l),
      { ten: "Ghi chú dòng", lay: ({ l }) => l.notes },
    ]
  )
}

/* ======================================================================================= 3. TRẢ HÀNG (KHÁCH) */

export interface PhieuTraKhach {
  id: string
  return_date?: string | null
  created_at: string
  reason: string | null
  status: string
  credit_note_amount: number | string | null
  credit_with_invoice?: boolean | null
  destination_zone?: string | null
  notes?: string | null
  customer?: Khach
  requester?: Ten
  seller?: Ten
  order?: { order_code?: string | null } | null
  invoice?: { invoice_code?: string | null } | null
}
export interface DongTraKhach extends DongHangTho {
  id?: string | null
  return_id: string
  is_exchange?: boolean | null
  note?: string | null
  reason?: string | null
}
/** Câu chọn đầu phiếu để xuất — số PT- đọc riêng (`docMaPhieuTra`, sổ chưa chạy mig 193 vẫn xuất được). */
export const CHON_PHIEU_TRA_KHACH =
  "id, created_at, return_date, reason, status, credit_note_amount, credit_with_invoice, destination_zone, notes, " +
  "customer:customers(store_name, phone, address), requester:users!returns_requested_by_fkey(full_name), " +
  "seller:users!returns_sales_user_id_fkey(full_name), order:sales_orders(order_code), invoice:sales_invoices(invoice_code)"
export const CHON_DONG_TRA_KHACH =
  `id, return_id, unit_name, quantity, unit_price, vat_rate, line_total, is_exchange, note, reason, ${HANG_NHUNG}`

export const DONG_TRA_KHACH: NguonDong = { bang: "return_lines", cot: "return_id", chon: CHON_DONG_TRA_KHACH, ten: "Dòng phiếu trả" }
export const lyDoTra = (v: string | null | undefined) => (v ? RETURN_REASONS.find((r) => r.value === v)?.label ?? v : "")

export function xuatTraHangKhach(phieu: readonly PhieuTraKhach[], dong: readonly DongTraKhach[], maPhieu: ReadonlyMap<string, string>): SheetXuat[] {
  const ma = (p: PhieuTraKhach) => tenPhieuTra(maPhieu.get(p.id))
  /* Ngày chứng từ (mig 188); phiếu cũ chưa có thì ngày lập — như cột Ngày của danh sách. */
  const ngay = (p: PhieuTraKhach) => ngayVN(p.return_date || p.created_at)
  const tt = (p: PhieuTraKhach) => RETURN_STATUS_MAP[p.status]?.label ?? p.status
  return haiSheet(
    phieu,
    [
      { ten: "Số phiếu", lay: ma },
      { ten: "Ngày", lay: ngay },
      { ten: "Khách hàng", lay: (p) => p.customer?.store_name },
      { ten: "SĐT", lay: (p) => p.customer?.phone },
      { ten: "Đơn gốc", lay: (p) => p.order?.order_code },
      { ten: "Hóa đơn gốc", lay: (p) => p.invoice?.invoice_code },
      { ten: "Loại phiếu", lay: (p) => (p.credit_with_invoice ? "Theo hóa đơn (tự sinh)" : "Tự lập") },
      { ten: "Lý do", lay: (p) => lyDoTra(p.reason) },
      { ten: "Trạng thái", lay: tt },
      { ten: "Kho nhận", lay: (p) => kho(p.destination_zone) },
      { ten: "Tiền trả (trừ nợ)", lay: (p) => tien(p.credit_note_amount) },
      { ten: "Người tạo", lay: (p) => p.requester?.full_name },
      { ten: "Tính cho NV", lay: (p) => p.seller?.full_name },
      { ten: "Ghi chú", lay: (p) => p.notes },
    ],
    dong,
    (l) => l.return_id,
    [
      { ten: "Số phiếu", lay: ({ p }) => ma(p) },
      { ten: "Ngày", lay: ({ p }) => ngay(p) },
      { ten: "Khách hàng", lay: ({ p }) => p.customer?.store_name },
      { ten: "Hóa đơn gốc", lay: ({ p }) => p.invoice?.invoice_code },
      { ten: "Trạng thái", lay: ({ p }) => tt(p) },
      { ten: "Loại dòng", lay: ({ l }) => (l.is_exchange ? "Hàng đổi" : "Hàng trả") },
      ...cotHang<{ l: DongTraKhach }>((r) => r.l),
      /* Hàng đổi không tính tiền (CLAUDE.md) — Σ cột này mới so với "Tiền trả" của phiếu. */
      { ten: "Tiền tính nợ", lay: ({ l }) => (l.is_exchange ? 0 : tien(l.line_total)) },
      { ten: "Lý do dòng", lay: ({ l }) => lyDoTra(l.reason) },
      { ten: "Ghi chú dòng", lay: ({ l }) => l.note },
    ]
  )
}

/* ======================================================================================= 4. PHIẾU THU */

export interface PhieuThuXuat {
  id: string
  receipt_code: string
  receipt_date: string
  status: string
  source_type: string | null
  expected_amount: number | string | null
  submitted_amount: number | string | null
  notes: string | null
  collector?: Ten
  creator?: Ten
  receiver?: Ten
}
export interface DongThu extends DongPhieuThuTom {
  id?: string | null
  notes?: string | null
  invoice?: (DongPhieuThuTom["invoice"] & { invoice_date?: string | null }) | null
  receivable?: (DongPhieuThuTom["receivable"] & { opening_balance?: boolean | null }) | null
}
export const CHON_DONG_THU =
  "id, receipt_id, amount, notes, " +
  "invoice:sales_invoices(id, invoice_code, invoice_date, customer:customers(store_name)), " +
  "receivable:receivables(opening_balance, customer:customers(store_name)), " +
  "order:sales_orders(order_code, customer:customers(store_name))"

export const DONG_THU: NguonDong = { bang: "cash_receipt_lines", cot: "receipt_id", chon: CHON_DONG_THU, ten: "Dòng phiếu thu" }
/** Khoản một dòng phiếu thu trả cho: hóa đơn (nhãn chính — CLAUDE.md), nợ đầu kỳ, hay đơn cũ. */
export function khoanThu(l: DongThu): string {
  if (l.invoice?.invoice_code) return "Hóa đơn"
  if (l.receivable?.opening_balance) return "Nợ đầu kỳ"
  if (l.order?.order_code) return "Đơn hàng (cũ)"
  return "Khác"
}
export const khachDong = (l: DongThu) =>
  l.receivable?.customer?.store_name || l.invoice?.customer?.store_name || l.order?.customer?.store_name || ""

export function xuatPhieuThu(phieu: readonly PhieuThuXuat[], dong: readonly DongThu[]): SheetXuat[] {
  const tom = tomTatDongPhieuThu(dong)
  const tt = (p: PhieuThuXuat) => CASH_RECEIPT_STATUS_LABEL[p.status] ?? p.status
  return haiSheet(
    phieu,
    [
      { ten: "Số phiếu", lay: (p) => p.receipt_code },
      { ten: "Ngày thu", lay: (p) => ngayVN(p.receipt_date) },
      { ten: "Trạng thái", lay: tt },
      { ten: "Khách hàng", lay: (p) => tom[p.id]?.khach.join(", ") },
      { ten: "Hóa đơn", lay: (p) => tom[p.id]?.hoaDon.join(", ") },
      { ten: "Số tiền", lay: (p) => tien(p.expected_amount) },
      { ten: "Đã nộp", lay: (p) => tien(p.submitted_amount) },
      { ten: "Chênh lệch nộp", lay: (p) => tien(p.submitted_amount) - tien(p.expected_amount) },
      { ten: "Nguồn", lay: (p) => CASH_RECEIPT_SOURCE_LABEL[p.source_type ?? ""] ?? p.source_type },
      { ten: "Người thu", lay: (p) => p.collector?.full_name },
      { ten: "Người tạo", lay: (p) => p.creator?.full_name },
      { ten: "Người nhận", lay: (p) => p.receiver?.full_name },
      { ten: "Ghi chú", lay: (p) => p.notes },
    ],
    dong,
    (l) => l.receipt_id,
    [
      { ten: "Số phiếu", lay: ({ p }) => p.receipt_code },
      { ten: "Ngày thu", lay: ({ p }) => ngayVN(p.receipt_date) },
      { ten: "Trạng thái", lay: ({ p }) => tt(p) },
      { ten: "Khách hàng", lay: ({ l }) => khachDong(l) },
      { ten: "Khoản thu", lay: ({ l }) => khoanThu(l) },
      { ten: "Hóa đơn", lay: ({ l }) => l.invoice?.invoice_code },
      { ten: "Ngày hóa đơn", lay: ({ l }) => ngayVN(l.invoice?.invoice_date) },
      { ten: "Đơn hàng", lay: ({ l }) => l.order?.order_code },
      { ten: "Số tiền", lay: ({ l }) => tien(l.amount) },
      { ten: "Ghi chú dòng", lay: ({ l }) => l.notes },
    ]
  )
}

/* ======================================================================================= 5. CHI PHÍ (PHIẾU CHI) */

export interface PhieuChiXuat {
  id: string
  expense_date: string
  amount: number | string | null
  description: string | null
  reference_code: string | null
  source_type: string | null
  is_paid: boolean
  payment_method: string | null
  created_by?: string | null
  category?: { name?: string | null; bucket?: string | null } | null
}
export const NHOM_CHI: Record<string, string> = { cogs: "Giá vốn", operating: "Vận hành", hr: "Nhân sự", financial: "Tài chính", tax: "Thuế", other: "Khác" }
export const HINH_THUC: Record<string, string> = { cash: "Tiền mặt", transfer: "Chuyển khoản", ewallet: "Ví điện tử" }

/** Một sheet — khoản chi không có dòng hàng. */
export function xuatChiPhi(phieu: readonly PhieuChiXuat[], ten: TenNguoi): SheetXuat[] {
  return [{
    ten: SHEET_PHIEU,
    rows: dungBang<PhieuChiXuat>([
      { ten: "Ngày", lay: (e) => ngayVN(e.expense_date) },
      { ten: "Mã tham chiếu", lay: (e) => e.reference_code },
      { ten: "Danh mục", lay: (e) => e.category?.name },
      { ten: "Nhóm", lay: (e) => NHOM_CHI[e.category?.bucket || "other"] ?? e.category?.bucket },
      { ten: "Mô tả", lay: (e) => e.description },
      { ten: "Số tiền", lay: (e) => tien(e.amount) },
      { ten: "Trạng thái", lay: (e) => (e.is_paid ? "Đã trả" : "Chưa trả") },
      { ten: "Hình thức", lay: (e) => (e.payment_method ? HINH_THUC[e.payment_method] ?? e.payment_method : "") },
      { ten: "Nguồn", lay: (e) => (e.source_type ? e.source_type : "Nhập tay") },
      { ten: "Người lập", lay: (e) => nguoi(ten, e.created_by) },
    ], phieu),
  }]
}

/* ======================================================================================= 6. PHIẾU KHO */

export interface PhieuKhoXuat {
  id: string
  entry_code: string
  type: string
  status: string | null
  notes: string | null
  created_at: string
  posted_at?: string | null
  issue_reason?: string | null
  warehouse_zone?: string | null
  dest_warehouse_zone?: string | null
  creator?: Ten
}
export interface DongKho extends DongHangTho {
  id?: string | null
  entry_id: string
  qty_in_base_uom?: number | string | null
  conversion_factor_snapshot?: number | string | null
  unit_cost?: number | string | null
  notes?: string | null
  batch?: { batch_code?: string | null; expires_at?: string | null } | null
}
export const CHON_DONG_KHO =
  `id, entry_id, unit_name, quantity, qty_in_base_uom, conversion_factor_snapshot, unit_cost, notes, batch:batches(batch_code, expires_at), ${HANG_NHUNG}`
export const TT_KHO: Record<string, string> = { draft: "Nháp", posted: "Đã duyệt", cancelled: "Đã hủy" }
export const loaiKho = (t: string) => STOCK_ENTRY_TYPES.find((x) => x.value === t)?.label ?? t

export const DONG_KHO: NguonDong = { bang: "stock_entry_lines", cot: "entry_id", chon: CHON_DONG_KHO, ten: "Dòng phiếu kho" }
/** SL theo đơn vị cơ sở: số kho ghi sổ (`qty_in_base_uom`), phiếu cũ chưa có thì quy đổi từ hệ số chụp. */
export function slCoSoKho(l: DongKho): number {
  if (l.qty_in_base_uom != null && l.qty_in_base_uom !== "") return soLg(l.qty_in_base_uom)
  const h = Number(l.conversion_factor_snapshot ?? l.conversion_factor)
  return soLg((Number(l.quantity) || 0) * (Number.isFinite(h) && h > 0 ? h : 1))
}

export function xuatPhieuKho(phieu: readonly PhieuKhoXuat[], dong: readonly DongKho[], giaVon: boolean): SheetXuat[] {
  const tt = (p: PhieuKhoXuat) => TT_KHO[p.status || "posted"] ?? p.status ?? ""
  const cotDong: Cot<{ p: PhieuKhoXuat; l: DongKho }>[] = [
    { ten: "Mã phiếu", lay: ({ p }) => p.entry_code },
    { ten: "Ngày", lay: ({ p }) => ngayVN(p.created_at) },
    { ten: "Loại", lay: ({ p }) => loaiKho(p.type) },
    { ten: "Trạng thái", lay: ({ p }) => tt(p) },
    { ten: "Kho", lay: ({ p }) => kho(p.warehouse_zone) },
    { ten: "Mã hàng", lay: ({ l }) => l.product?.sku },
    { ten: "Tên hàng", lay: ({ l }) => l.product?.name || "Không rõ mặt hàng" },
    { ten: "ĐVT", lay: ({ l }) => l.unit_name },
    { ten: "SL", lay: ({ l }) => soLg(l.quantity) },
    { ten: "SL quy đổi", lay: ({ l }) => slCoSoKho(l) },
    { ten: "ĐV cơ sở", lay: ({ l }) => l.product?.base_unit },
    { ten: "Số lô", lay: ({ l }) => l.batch?.batch_code },
    { ten: "Hạn dùng", lay: ({ l }) => ngayVN(l.batch?.expires_at) },
  ]
  if (giaVon) {
    /* `unit_cost` là giá MỖI ĐƠN VỊ CƠ SỞ (CLAUDE.md) → giá trị = SL quy đổi × giá. */
    cotDong.push(
      { ten: "Giá vốn / ĐV cơ sở", lay: ({ l }) => tien(l.unit_cost) },
      { ten: "Giá trị", lay: ({ l }) => tien(slCoSoKho(l) * (Number(l.unit_cost) || 0)) }
    )
  }
  cotDong.push({ ten: "Ghi chú dòng", lay: ({ l }) => l.notes })
  return haiSheet(
    phieu,
    [
      { ten: "Mã phiếu", lay: (p) => p.entry_code },
      { ten: "Ngày tạo", lay: (p) => ngayVN(p.created_at) },
      { ten: "Ngày duyệt", lay: (p) => ngayVN(p.posted_at) },
      { ten: "Loại", lay: (p) => loaiKho(p.type) },
      { ten: "Trạng thái", lay: tt },
      { ten: "Kho", lay: (p) => kho(p.warehouse_zone) },
      { ten: "Kho đích", lay: (p) => kho(p.dest_warehouse_zone) },
      { ten: "Lý do xuất", lay: (p) => p.issue_reason },
      { ten: "Ghi chú", lay: (p) => p.notes },
      { ten: "Người lập", lay: (p) => p.creator?.full_name },
    ],
    dong,
    (l) => l.entry_id,
    cotDong
  )
}

/* ======================================================================================= 7. ĐƠN HÀNG */

export interface DonXuat {
  id: string
  order_code: string
  order_date: string | null
  status: string
  payment_terms?: string | null
  subtotal?: number | string | null
  discount?: number | string | null
  vat?: number | string | null
  total: number | string | null
  notes?: string | null
  customer?: Khach
  sales_user?: Ten
  creator?: Ten
}
export interface DongDon extends DongHangTho {
  id?: string | null
  order_id: string
  note?: string | null
}
export const CHON_DONG_DON =
  `id, order_id, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, line_total, note, ${HANG_NHUNG}`

export const DONG_DON: NguonDong = { bang: "sales_order_lines", cot: "order_id", chon: CHON_DONG_DON, ten: "Dòng đơn hàng" }
/** Đơn hàng là số HOẠT ĐỘNG (đã đặt), không phải doanh thu — doanh thu ở Hóa đơn bán (CLAUDE.md). */
export function xuatDonHang(phieu: readonly DonXuat[], dong: readonly DongDon[]): SheetXuat[] {
  const tt = (p: DonXuat) => ORDER_STATUS_MAP[p.status]?.label ?? p.status
  return haiSheet(
    phieu,
    [
      { ten: "Mã đơn", lay: (p) => p.order_code },
      { ten: "Ngày đặt", lay: (p) => ngayVN(p.order_date) },
      { ten: "Khách hàng", lay: (p) => p.customer?.store_name },
      { ten: "SĐT", lay: (p) => p.customer?.phone },
      { ten: "Địa chỉ", lay: (p) => p.customer?.address },
      { ten: "Nhân viên", lay: (p) => p.sales_user?.full_name },
      { ten: "Trạng thái", lay: tt },
      { ten: "Thanh toán", lay: (p) => p.payment_terms },
      { ten: "Tiền hàng (chưa VAT)", lay: (p) => tien(p.subtotal) },
      { ten: "Giảm giá", lay: (p) => tien(p.discount) },
      { ten: "VAT", lay: (p) => tien(p.vat) },
      { ten: "Tổng tiền", lay: (p) => tien(p.total) },
      { ten: "Ghi chú", lay: (p) => p.notes },
      { ten: "Người tạo", lay: (p) => p.creator?.full_name },
    ],
    dong,
    (l) => l.order_id,
    [
      { ten: "Mã đơn", lay: ({ p }) => p.order_code },
      { ten: "Ngày đặt", lay: ({ p }) => ngayVN(p.order_date) },
      { ten: "Khách hàng", lay: ({ p }) => p.customer?.store_name },
      { ten: "Nhân viên", lay: ({ p }) => p.sales_user?.full_name },
      { ten: "Trạng thái", lay: ({ p }) => tt(p) },
      ...cotHang<{ l: DongDon }>((r) => r.l, { giaSauGiam: true }),
      { ten: "Ghi chú dòng", lay: ({ l }) => l.note },
    ]
  )
}

/* ======================================================================================= 8. HÓA ĐƠN BÁN */

export interface HoaDonXuat {
  id: string
  invoice_code: string
  invoice_date: string | null
  status: string
  payment_terms?: string | null
  subtotal?: number | string | null
  vat?: number | string | null
  total: number | string | null
  notes?: string | null
  replaced_from?: string | null
  replaced_by?: string | null
  customer?: Khach
  sales_user?: Ten
  creator?: Ten
  order?: { order_code?: string | null } | null
}
export interface DongHoaDon extends DongHangTho {
  id?: string | null
  invoice_id: string
  sort_order?: number | null
  is_exchange?: boolean | null
  note?: string | null
}
export const CHON_DONG_HOA_DON =
  `id, invoice_id, sort_order, unit_name, quantity, unit_price, line_discount, vat_rate, conversion_factor, line_total, is_exchange, note, ${HANG_NHUNG}`

export const DONG_HOA_DON: NguonDong = { bang: "sales_invoice_lines", cot: "invoice_id", chon: CHON_DONG_HOA_DON, ten: "Dòng hóa đơn" }
/** `traHang` = hàng trả đã trừ vào từng hóa đơn (`traTheoHoaDon`) — tiền danh sách là SỐ CÒN LẠI. */
export function xuatHoaDon(phieu: readonly HoaDonXuat[], dong: readonly DongHoaDon[], traHang: ReadonlyMap<string, number>): SheetXuat[] {
  const tt = (p: HoaDonXuat) => {
    const nhan = INVOICE_STATUS_MAP[p.status]?.label ?? p.status
    if (p.status !== "posted") return nhan
    return p.replaced_by ? "Đã bị thay" : p.replaced_from ? "Lập lại" : nhan
  }
  const dongCua = new Map<string, DongHoaDon[]>()
  for (const l of dong) {
    const ds = dongCua.get(l.invoice_id)
    if (ds) ds.push(l)
    else dongCua.set(l.invoice_id, [l])
  }
  const tra = (p: HoaDonXuat) => tien(traHang.get(p.id))
  const cotPhieu: Cot<HoaDonXuat>[] = [
    { ten: "Mã hóa đơn", lay: (p) => p.invoice_code },
    { ten: "Ngày", lay: (p) => ngayVN(p.invoice_date) },
    { ten: "Mã đơn", lay: (p) => p.order?.order_code },
    { ten: "Khách hàng", lay: (p) => p.customer?.store_name },
    { ten: "SĐT", lay: (p) => p.customer?.phone },
    { ten: "Địa chỉ", lay: (p) => p.customer?.address },
    { ten: "Nhân viên", lay: (p) => p.sales_user?.full_name },
    { ten: "Trạng thái", lay: tt },
    { ten: "Thanh toán", lay: (p) => p.payment_terms },
    /* Giảm giá cả đơn mang sang hóa đơn = Σ(SL × giá) − subtotal (mig 183) — cùng hàm màn chi tiết dùng. */
    {
      ten: "Giảm giá",
      lay: (p) => tien(giamCuaHoaDon(
        (dongCua.get(p.id) ?? []).map((l) => ({ quantity: l.quantity ?? null, unit_price: l.unit_price ?? null, is_exchange: l.is_exchange })),
        p.subtotal
      )),
    },
    { ten: "Tiền hàng (chưa VAT)", lay: (p) => tien(p.subtotal) },
    { ten: "VAT", lay: (p) => tien(p.vat) },
    { ten: "Tổng hóa đơn", lay: (p) => tien(p.total) },
    { ten: "Hàng trả", lay: tra },
    { ten: "Tổng tiền (còn lại)", lay: (p) => tien(p.total) - tra(p) },
    { ten: "Ghi chú", lay: (p) => p.notes },
    { ten: "Người tạo", lay: (p) => p.creator?.full_name },
  ]
  return haiSheet(
    phieu,
    cotPhieu,
    dong,
    (l) => l.invoice_id,
    [
      { ten: "Mã hóa đơn", lay: ({ p }) => p.invoice_code },
      { ten: "Ngày", lay: ({ p }) => ngayVN(p.invoice_date) },
      { ten: "Khách hàng", lay: ({ p }) => p.customer?.store_name },
      { ten: "Nhân viên", lay: ({ p }) => p.sales_user?.full_name },
      { ten: "Trạng thái", lay: ({ p }) => tt(p) },
      { ten: "Loại dòng", lay: ({ l }) => (l.is_exchange ? "Hàng đổi" : "Bán") },
      ...cotHang<{ l: DongHoaDon }>((r) => r.l, { giaSauGiam: true }),
      { ten: "Ghi chú dòng", lay: ({ l }) => l.note },
    ]
  )
}

