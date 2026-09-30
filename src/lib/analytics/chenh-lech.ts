/**
 * CHÊNH LỆCH GIÁ CỦA NHÂN VIÊN — một luật cho Báo cáo tổng hợp (Theo nhân viên) và Báo cáo › Nhân
 * viên ("Hàng bán theo nhân viên").
 *
 * Chủ nhà 30/09/2026 (quét báo cáo): chênh lệch từng ăn cả VAT và lấy bảng giá chung HIỆN TẠI. Chốt:
 *   "Hàng trả về và Hàng đi: Nhân viên sửa giá loại nào -> tính phần chênh số lượng X (giá sửa -
 *    giá gốc). Phần giảm giá cả đơn tính riêng (tính theo đơn)".
 *   - Giá gốc = giá của khách LÚC BÁN = đơn giá + chiết khấu/đơn vị, chụp trên dòng ĐƠN.
 *   - Giá sửa = đơn giá trên dòng (trước thuế).
 *
 *     chênh bán   = Σ SL × (giá sửa − giá gốc)   dòng hoá đơn
 *     chênh trả   = Σ SL × (giá sửa − giá gốc)   dòng trả, giá gốc lấy trên hoá đơn gốc
 *     chênh thuần = chênh bán − chênh trả ("lúc đi đã ăn chênh, lúc về phải trả chênh")
 *     giảm giá cả đơn: cột RIÊNG theo hoá đơn — không trộn vào chênh (`tiLeSauGiam` = 1).
 *
 * ⚠ CHIẾT KHẤU TRÊN DÒNG HOÁ ĐƠN LÀ CỦA CẢ DÒNG ĐƠN (post_invoice chép nguyên, không chia theo SL
 *   xuất) → giá niêm yết tính từ DÒNG ĐƠN (`unit_price + line_discount / quantity`), quy về đơn vị
 *   cơ sở rồi nhân SL cơ sở của dòng hoá đơn — hoá đơn khác đơn vị với đơn cũng đúng.
 * ⚠ `line_discount` chỉ ghi phần GIẢM (nâng giá không ghi) — bán cao hơn giá bảng thì chênh 0.
 * ⚠ Không tra được giá lúc bán (dữ liệu cũ / chưa chạy mig 218) → lùi về giá do nơi gọi đưa (bảng giá
 *   chung hiện tại), rồi mới tới chính đơn giá của dòng (chênh 0).
 */
import { heSoQuyDoi, soLuongCoSo, type SanPhamQuyDoi } from "./units"

const so = (x: unknown): number => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/** Dòng đơn gốc — đủ để ra giá niêm yết lúc bán. */
export interface DongDonGoc {
  id: string
  unit_name?: string | null
  conversion_factor?: number | null
  quantity: number
  unit_price: number
  line_discount?: number | null
}

export interface DongHdGia {
  product_id: string
  unit_name: string
  conversion_factor?: number | null
  quantity: number
  unit_price: number
  line_total: number
  line_discount?: number | null
  order_line_id?: string | null
}

/**
 * Giá niêm yết LÚC BÁN của một dòng hoá đơn, tính cho MỘT ĐƠN VỊ CƠ SỞ. `null` = không tra được.
 */
export function giaNyCoSoLucBan(
  l: DongHdGia,
  sp: SanPhamQuyDoi | null | undefined,
  dongDon?: ReadonlyMap<string, DongDonGoc>
): number | null {
  const d = l.order_line_id ? dongDon?.get(l.order_line_id) : undefined
  if (d && so(d.quantity) > 0) {
    const heSo = heSoQuyDoi(sp, d.unit_name || l.unit_name, d.conversion_factor)
    return (so(d.unit_price) + Math.max(0, so(d.line_discount)) / so(d.quantity)) / heSo
  }
  // Dòng không gắn dòng đơn (thêm thẳng trên hoá đơn): chiết khấu của chính dòng hoá đơn.
  if (!l.order_line_id && so(l.quantity) > 0 && l.line_discount != null) {
    const heSo = heSoQuyDoi(sp, l.unit_name, l.conversion_factor)
    return (so(l.unit_price) + Math.max(0, so(l.line_discount)) / so(l.quantity)) / heSo
  }
  return null
}

export interface ChenhDong {
  /** Tiền trước thuế (bán: sau giảm giá cả đơn; trả: SL × đơn giá). */
  tien: number
  /** Giá trị niêm yết lúc bán. */
  niemYet: number
  chenh: number
}

/**
 * Chênh của MỘT dòng bán. `tiLeSauGiam` = subtotal HĐ / Σ line_total HĐ (phần còn lại sau giảm giá
 * cả đơn; 1 = không giảm). `giaLui` = giá niêm yết đơn vị DÒNG khi không tra được giá lúc bán.
 */
export function chenhDongBan(
  l: DongHdGia,
  sp: SanPhamQuyDoi | null | undefined,
  tiLeSauGiam: number,
  dongDon?: ReadonlyMap<string, DongDonGoc>,
  giaLui?: number
): ChenhDong {
  const tien = so(l.line_total) * (Number.isFinite(tiLeSauGiam) ? Math.max(0, tiLeSauGiam) : 1)
  const coSo = giaNyCoSoLucBan(l, sp, dongDon)
  const heSo = heSoQuyDoi(sp, l.unit_name, l.conversion_factor)
  const niemYet =
    coSo != null
      ? soLuongCoSo(l.quantity, heSo) * coSo
      : so(l.quantity) * (giaLui && giaLui > 0 ? giaLui : so(l.unit_price))
  return { tien, niemYet, chenh: tien - niemYet }
}

/** Tỉ lệ còn lại sau giảm giá cả đơn của một hoá đơn. */
export function tiLeSauGiamHd(subtotal: number | null | undefined, dong: ReadonlyArray<{ line_total: number }>): number {
  const S = dong.reduce((s, l) => s + so(l.line_total), 0)
  const sub = so(subtotal)
  if (!(S > 0) || !(sub > 0)) return 1
  return Math.min(1, sub / S)
}

export interface DongTraGia {
  product_id: string
  unit_name?: string | null
  quantity: number
  unit_price?: number | null
  line_total: number
}

/**
 * Giá niêm yết lúc bán (mỗi đơn vị cơ sở) của MẶT HÀNG trên hoá đơn gốc — bình quân theo SL cơ sở
 * các dòng cùng mặt hàng. `null` = hoá đơn gốc không có mặt hàng đó / không tra được.
 */
export function giaNyCoSoTrenHd(
  productId: string,
  dongHdGoc: ReadonlyArray<DongHdGia>,
  sp: SanPhamQuyDoi | null | undefined,
  dongDon?: ReadonlyMap<string, DongDonGoc>
): number | null {
  let sl = 0, tien = 0
  for (const l of dongHdGoc) {
    if (l.product_id !== productId) continue
    const g = giaNyCoSoLucBan(l, sp, dongDon)
    if (g == null) continue
    const q = soLuongCoSo(l.quantity, heSoQuyDoi(sp, l.unit_name, l.conversion_factor))
    sl += q
    tien += q * g
  }
  return sl > 0 ? tien / sl : null
}

/**
 * Chênh của MỘT dòng trả. `giaNyCoSo` từ hoá đơn gốc (`giaNyCoSoTrenHd`); không có thì `giaLui`
 * (giá niêm yết đơn vị dòng), cuối cùng là đơn giá trả (chênh 0).
 * ⚠ Tiền trả = SL × đơn giá (TRƯỚC thuế) — `return_lines.line_total` đã gồm VAT (mig 214).
 */
export function chenhDongTra(
  l: DongTraGia,
  sp: SanPhamQuyDoi | null | undefined,
  giaNyCoSo: number | null,
  giaLui?: number
): ChenhDong {
  const donGia = l.unit_price != null ? so(l.unit_price) : so(l.quantity) > 0 ? so(l.line_total) / so(l.quantity) : 0
  const tien = so(l.quantity) * donGia
  const niemYet =
    giaNyCoSo != null
      ? soLuongCoSo(l.quantity, heSoQuyDoi(sp, l.unit_name || "")) * giaNyCoSo
      : so(l.quantity) * (giaLui && giaLui > 0 ? giaLui : donGia)
  return { tien, niemYet, chenh: tien - niemYet }
}
