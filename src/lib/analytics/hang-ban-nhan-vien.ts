/**
 * "HÀNG BÁN THEO NHÂN VIÊN" (Báo cáo > Nhân viên) — phần cộng dồn thuần.
 *
 * ⚠ CHỦ NHÀ 24/09/2026 (SP001945 "Bánh lễ đậu xanh 100g (10h/khay x 6
 *   khay/th)"): SL bán 64 "hộp", niêm yết 844.800đ, doanh thu 8.640.000đ.
 *   64 là KHAY, 13.200đ là giá một HỘP → niêm yết hụt 10 lần, chênh lệch
 *   phồng. Luật (`./units`):
 *     - SL cộng dồn / hiện cạnh `base_unit` → quy về đơn vị cơ sở.
 *     - Niêm yết = SL dòng × giá niêm yết CỦA ĐÚNG ĐƠN VỊ DÒNG.
 *   SL của nhân viên gộp nhiều mặt hàng → `qtyTheoDv` (theo từng đơn vị cơ
 *   sở, `./sl-theo-don-vi`); `qty` chỉ để sắp xếp, KHÔNG hiện.
 */
import { giaNiemYetDonVi, heSoQuyDoi, soLuongCoSo, type SanPhamQuyDoi } from "./units"
import { congSL, type SLTheoDonVi } from "./sl-theo-don-vi"

export type SanPhamHangBan = SanPhamQuyDoi & { id: string; sku: string; name: string }

export interface DongBanHangBan {
  product_id: string
  unit_name: string
  /** Hệ số chụp trên dòng hóa đơn — ưu tiên hơn danh mục. */
  conversion_factor?: number | null
  quantity: number
  unit_price?: number | null
  line_total: number
}

export interface DongTraHangBan {
  product_id: string
  unit_name?: string | null
  quantity: number
  line_total: number
}

export interface HangBanSanPham {
  productId: string
  sku: string
  name: string
  /** Luôn là đơn vị cơ sở — SL bên cạnh đã quy đổi. */
  unit: string
  qty: number
  /** Một khoá (`unit`) — cùng số với `qty`. */
  qtyTheoDv: SLTheoDonVi
  listed: number
  revenue: number
  diff: number
  returnQty: number
  returnQtyTheoDv: SLTheoDonVi
  returnValue: number
  netRevenue: number
}

export interface HangBanNhanVien {
  id: string
  /** ⚠ Tổng lẫn đơn vị — chỉ để sắp xếp. Hiện `qtyTheoDv`. */
  qty: number
  qtyTheoDv: SLTheoDonVi
  listed: number
  revenue: number
  diff: number
  /** ⚠ Tổng lẫn đơn vị — chỉ để sắp xếp. Hiện `returnQtyTheoDv`. */
  returnQty: number
  returnQtyTheoDv: SLTheoDonVi
  returnValue: number
  netRevenue: number
  products: HangBanSanPham[]
}

/**
 * Giá trị niêm yết của MỘT dòng hóa đơn = SL dòng × giá niêm yết của đơn vị dòng.
 * Mặt hàng chưa có giá niêm yết nào thì lấy đơn giá trên dòng (cùng đơn vị) —
 * chênh lệch 0 thay vì "chênh" cả doanh thu.
 */
export function giaTriNiemYetDong(l: DongBanHangBan, sp: SanPhamQuyDoi | null | undefined): number {
  const heSo = heSoQuyDoi(sp, l.unit_name, l.conversion_factor)
  const gia = giaNiemYetDonVi(sp, l.unit_name, heSo)
  const donGia = gia > 0 ? gia : Number(l.unit_price || 0)
  return (Number(l.quantity) || 0) * donGia
}

/**
 * Cộng dòng bán + dòng trả theo nhân viên → mặt hàng.
 * Dòng có mặt hàng không nằm trong `sanPham` (bị lọc / không đọc được) bị bỏ ở phía bán,
 * như bản cũ; phía trả vẫn cộng (tên "—").
 */
export function congHangBanNhanVien(input: {
  ban: ReadonlyArray<{ uid: string; line: DongBanHangBan }>
  tra: ReadonlyArray<{ uid: string; line: DongTraHangBan }>
  sanPham: ReadonlyMap<string, SanPhamHangBan>
}): HangBanNhanVien[] {
  const m = new Map<string, HangBanNhanVien & { _sp: Map<string, HangBanSanPham> }>()
  const dong = (uid: string) => {
    let r = m.get(uid)
    if (!r) {
      r = {
        id: uid, qty: 0, qtyTheoDv: {}, listed: 0, revenue: 0, diff: 0,
        returnQty: 0, returnQtyTheoDv: {}, returnValue: 0, netRevenue: 0, products: [], _sp: new Map(),
      }
      m.set(uid, r)
    }
    return r
  }
  const matHang = (r: ReturnType<typeof dong>, pid: string) => {
    let p = r._sp.get(pid)
    if (!p) {
      const sp = input.sanPham.get(pid)
      p = {
        productId: pid,
        sku: sp?.sku || "—",
        name: sp?.name || "—",
        unit: sp?.base_unit || "",
        qty: 0, qtyTheoDv: {}, listed: 0, revenue: 0, diff: 0,
        returnQty: 0, returnQtyTheoDv: {}, returnValue: 0, netRevenue: 0,
      }
      r._sp.set(pid, p)
      r.products.push(p)
    }
    return p
  }

  for (const { uid, line } of input.ban) {
    const sp = input.sanPham.get(line.product_id)
    if (!sp) continue
    // SL quy về đơn vị cơ sở; niêm yết theo đơn vị dòng.
    const qty = soLuongCoSo(line.quantity, heSoQuyDoi(sp, line.unit_name, line.conversion_factor))
    const listed = giaTriNiemYetDong(line, sp)
    const revenue = Number(line.line_total || 0)
    const r = dong(uid)
    r.qty += qty
    congSL(r.qtyTheoDv, sp.base_unit, qty)
    r.listed += listed
    r.revenue += revenue
    const p = matHang(r, line.product_id)
    p.qty += qty
    congSL(p.qtyTheoDv, p.unit, qty)
    p.listed += listed
    p.revenue += revenue
  }

  for (const { uid, line } of input.tra) {
    const sp = input.sanPham.get(line.product_id)
    // Dòng trả không có hệ số chụp → tra danh mục.
    const qty = soLuongCoSo(line.quantity, heSoQuyDoi(sp, line.unit_name || ""))
    const value = Number(line.line_total || 0)
    const r = dong(uid)
    r.returnQty += qty
    congSL(r.returnQtyTheoDv, sp?.base_unit, qty)
    r.returnValue += value
    const p = matHang(r, line.product_id)
    p.returnQty += qty
    congSL(p.returnQtyTheoDv, p.unit, qty)
    p.returnValue += value
  }

  const out: HangBanNhanVien[] = []
  for (const r of Array.from(m.values())) {
    r.diff = r.revenue - r.listed
    r.netRevenue = r.revenue - r.returnValue
    for (const p of r.products) {
      p.diff = p.revenue - p.listed
      p.netRevenue = p.revenue - p.returnValue
    }
    r.products.sort((a, b) => b.revenue - a.revenue)
    const { _sp, ...rest } = r
    void _sp
    out.push(rest)
  }
  return out.sort((a, b) => b.revenue - a.revenue)
}
