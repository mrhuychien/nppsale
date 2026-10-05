/**
 * XUẤT EXCEL DANH SÁCH CHỨNG TỪ — chủ nhà 05/10/2026: "Thêm phần xuất excel cho phiếu trả hàng ncc và các phiếu
 * khác tương tự".
 *
 * Một tệp = sheet "Phiếu" (mỗi chứng từ một dòng) + sheet "Chi tiết dòng" (mỗi dòng hàng một dòng, kèm mã phiếu /
 * ngày / đối tác để lọc, pivot ngay trong Excel) — cùng kiểu tệp báo cáo chủ nhà đã khen 02/10/2026
 * (`src/lib/bao-cao/xuat-chi-tiet.ts`).
 *
 * Ở đây chỉ có phần THUẦN (dựng bảng, đổi số / ngày) — mỗi màn chỉ khai: đọc đủ đầu phiếu theo đúng bộ lọc đang
 * xem, đọc dòng, và danh sách cột (`src/lib/xuat-excel/cac-man.ts`). Ghi tệp nằm ở `XuatExcelButton`.
 *
 * ⚠ SỐ GHI LÀ SỐ, KHÔNG PHẢI CHUỖI ĐÃ ĐỊNH DẠNG. "434.555.942đ" thì Excel coi là chữ: không cộng, không lọc được.
 * ⚠ NGÀY THEO LỊCH VIỆT NAM (dd/mm/yyyy). Cột `date` (ngày chứng từ) giữ nguyên ngày; mốc giờ (`timestamptz`) đổi
 *   sang giờ VN trước — 20h tối 15/09 giờ VN là 13h UTC cùng ngày, 01h sáng 16/09 giờ VN là 18h UTC ngày 15.
 */
import { heSoQuyDoi, soLuongCoSo, type SanPhamQuyDoi } from "@/lib/analytics/units"
import { vnDateKey } from "@/lib/orders/status-tone"

export type O = string | number
export interface SheetXuat {
  ten: string
  rows: O[][]
}

/** Một cột: tiêu đề + cách lấy ô từ một dòng. `null` / `undefined` ghi ô trống. */
export interface Cot<T> {
  ten: string
  lay: (r: T) => O | null | undefined
}

/** Tiêu đề + các dòng. */
export function dungBang<T>(cot: readonly Cot<T>[], rows: readonly T[]): O[][] {
  const out: O[][] = [cot.map((c) => c.ten)]
  for (const r of rows) out.push(cot.map((c) => c.lay(r) ?? ""))
  return out
}

/** Tiền: số nguyên đồng. Ô trống / chữ → 0. */
export const tien = (v: unknown): number => Math.round(Number(v) || 0)

/** Số lượng: giữ phần lẻ (0,5 thùng), bỏ sai số dấu phẩy động. */
export const soLg = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0
}

/** Thuế suất lưu dạng TỈ LỆ (mig 141: 0,1 = 10%) → số phần trăm. */
export const phanTramVat = (v: unknown): number => Math.round((Number(v) || 0) * 10000) / 100

/** Ngày theo lịch VN, dd/mm/yyyy. `YYYY-MM-DD` (cột date) giữ nguyên ngày; mốc giờ đổi sang giờ VN. */
export function ngayVN(v: string | null | undefined): string {
  if (!v) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ""
  const [y, mo, da] = vnDateKey(d).split("-")
  return `${da}/${mo}/${y}`
}

/** Tên tệp kèm ngày (lịch VN) — nhiều lần xuất không đè nhau trong Downloads: `tra-hang-ncc_2026-10-05.xlsx`. */
export function tenTepXuat(tienTo: string, now: Date = new Date()): string {
  return `${tienTo}_${vnDateKey(now)}.xlsx`
}

/**
 * Tên tệp xuất MỘT phiếu (trang chi tiết): `tra-hang-ncc_TN-0001_2026-10-05.xlsx`. Mã có ký tự không hợp lệ trong
 * tên tệp (`/`, khoảng trắng…) thì thay bằng `-`; phiếu chưa có mã thì như tên tệp danh sách.
 */
export function tenTepMotPhieu(tienTo: string, ma: string | null | undefined, now: Date = new Date()): string {
  const sach = (ma ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return sach ? `${tienTo}_${sach}_${vnDateKey(now)}.xlsx` : tenTepXuat(tienTo, now)
}

/**
 * Ghép dòng vào phiếu: giữ ĐÚNG THỨ TỰ PHIẾU của danh sách (người ta lọc / xếp rồi mới xuất), trong mỗi phiếu xếp
 * theo `sort_order` (thứ tự trên chứng từ) rồi `id`. Dòng không thuộc phiếu nào đang xuất thì bỏ.
 */
export function ghepDong<P extends { id: string }, L extends { sort_order?: number | null; id?: string | null }>(
  phieu: readonly P[],
  dong: readonly L[],
  cuaPhieu: (l: L) => string | null | undefined
): Array<{ p: P; l: L }> {
  const theoPhieu = new Map<string, L[]>()
  for (const l of dong) {
    const k = cuaPhieu(l)
    if (!k) continue
    const ds = theoPhieu.get(k)
    if (ds) ds.push(l)
    else theoPhieu.set(k, [l])
  }
  const out: Array<{ p: P; l: L }> = []
  for (const p of phieu) {
    const ds = theoPhieu.get(p.id)
    if (!ds) continue
    ds.sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) || String(a.id ?? "").localeCompare(String(b.id ?? "")))
    for (const l of ds) out.push({ p, l })
  }
  return out
}

/** Mặt hàng như dòng chứng từ nhúng về (`product:products(sku, name, base_unit, units:product_units(…))`). */
export type HangNhung = (SanPhamQuyDoi & { sku?: string | null; name?: string | null }) | null | undefined

/** Một dòng hàng của bất kỳ chứng từ nào — các cột chung. */
export interface DongHangTho {
  unit_name?: string | null
  quantity?: number | string | null
  unit_price?: number | string | null
  line_discount?: number | string | null
  vat_rate?: number | string | null
  line_total?: number | string | null
  /** Hệ số chụp trên dòng (ưu tiên hơn danh mục — `heSoQuyDoi`). */
  conversion_factor?: number | string | null
  product?: HangNhung
}

/** Hàng đã xoá khỏi danh mục vẫn phải hiện là có một dòng, không phải ô trống. */
const tenHang = (sp: HangNhung) => sp?.name || "Không rõ mặt hàng"

/**
 * Đơn giá TRƯỚC giảm của dòng bán / đơn hàng: sổ lưu `unit_price` SAU giảm và khoản giảm `line_discount` (như
 * `donGiaTruocGiam` ở chi tiết hóa đơn) — cộng ngược để Đơn giá × SL − Giảm = Thành tiền đúng trong Excel.
 */
export function donGiaTruocGiam(l: DongHangTho): number {
  const sl = Number(l.quantity) || 0
  const giam = Number(l.line_discount) || 0
  return sl > 0 && giam > 0 ? Math.round((Number(l.unit_price) || 0) + giam / sl) : tien(l.unit_price)
}

/** SL quy về đơn vị cơ sở của dòng (`soLuongCoSo` × `heSoQuyDoi`, ưu tiên hệ số chụp trên dòng). */
export function slCoSo(l: DongHangTho): number {
  const sp = l.product
  return soLg(soLuongCoSo(l.quantity, heSoQuyDoi(sp ?? null, l.unit_name || "", l.conversion_factor)))
}

/**
 * Cột hàng dùng chung: Mã hàng · Tên hàng · ĐVT · SL · SL quy đổi · ĐV cơ sở · Đơn giá · Giảm giá dòng · VAT % ·
 * Thành tiền. `giaSauGiam` = sổ lưu đơn giá SAU giảm (hóa đơn bán, đơn hàng) → in đơn giá trước giảm.
 * `vat` = false khi bảng dòng không có thuế suất.
 */
export function cotHang<T>(lay: (r: T) => DongHangTho, o: { giaSauGiam?: boolean; vat?: boolean } = {}): Cot<T>[] {
  const cot: Cot<T>[] = [
    { ten: "Mã hàng", lay: (r) => lay(r).product?.sku || "" },
    { ten: "Tên hàng", lay: (r) => tenHang(lay(r).product) },
    { ten: "ĐVT", lay: (r) => lay(r).unit_name || "" },
    { ten: "SL", lay: (r) => soLg(lay(r).quantity) },
    { ten: "SL quy đổi", lay: (r) => slCoSo(lay(r)) },
    { ten: "ĐV cơ sở", lay: (r) => lay(r).product?.base_unit || "" },
    { ten: "Đơn giá", lay: (r) => (o.giaSauGiam ? donGiaTruocGiam(lay(r)) : tien(lay(r).unit_price)) },
    { ten: "Giảm giá dòng", lay: (r) => tien(lay(r).line_discount) },
  ]
  if (o.vat !== false) cot.push({ ten: "VAT %", lay: (r) => phanTramVat(lay(r).vat_rate) })
  cot.push({ ten: "Thành tiền", lay: (r) => tien(lay(r).line_total) })
  return cot
}

/** Cột chọn mặt hàng nhúng — đủ để quy đổi đơn vị (`heSoQuyDoi`). */
export const HANG_NHUNG = "product:products(sku, name, base_unit, units:product_units(unit_name, conversion))"

/** Tên sheet cố định — hai sheet, như tệp báo cáo. */
export const SHEET_PHIEU = "Phiếu"
export const SHEET_DONG = "Chi tiết dòng"
