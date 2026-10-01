/**
 * CHÊNH LỆCH GIÁ CỦA NHÂN VIÊN — một luật cho Báo cáo tổng hợp (Theo nhân viên) và Báo cáo › Nhân
 * viên ("Hàng bán theo nhân viên").
 *
 * Chủ nhà 01/10/2026 (chốt lại, thay luật "giá lúc bán lấy từ dòng đơn" của mig 218): "hiện tại chỉ có
 *   1 giá bán ra. Cách tính chênh lệch: Hàng đi: lấy số liệu trên hóa đơn. Giá trên hóa đơn so với giá
 *   trên bảng giá (lưu ý phải cùng đơn vị tính) x số lượng".
 *
 *     chênh bán   = Σ SL × (đơn giá trên hoá đơn − giá bảng của ĐÚNG đơn vị dòng)
 *     chênh trả   = Σ SL × (đơn giá trên phiếu trả − giá bảng của đúng đơn vị dòng)   (cùng luật)
 *     chênh thuần = chênh bán − chênh trả
 *
 * - Đơn giá TRƯỚC thuế (`unit_price`) — không lấy tiền gồm VAT (`return_lines.line_total` có VAT).
 * - Giá bảng của đơn vị dòng: `giaNiemYetDonVi` (bảng giá đơn vị đó → giá cơ sở × hệ số, như
 *   `unitPriceFor`). Bán 2 thùng thì so với giá THÙNG, không so với giá lon.
 * - Giảm giá cả đơn là cột RIÊNG — không trộn vào chênh.
 * - Mặt hàng chưa có giá bảng → so với chính đơn giá (chênh 0), không "chênh" cả doanh thu.
 */
import { giaNiemYetDonVi, heSoQuyDoi, type SanPhamQuyDoi } from "./units"

const so = (x: unknown): number => {
  const n = Number(x)
  return Number.isFinite(n) ? n : 0
}

/** Dòng hoá đơn / dòng trả — đủ để tính chênh. */
export interface DongChenh {
  unit_name?: string | null
  /** Hệ số chụp trên dòng (hoá đơn có; dòng trả không có → tra danh mục). */
  conversion_factor?: number | null
  quantity: number
  /** Đơn giá trước thuế. Thiếu thì suy từ `line_total / quantity`. */
  unit_price?: number | null
  line_total: number
}

export interface ChenhDong {
  /** SL × đơn giá trên chứng từ (trước thuế). */
  tien: number
  /** SL × giá bảng của đúng đơn vị dòng. */
  niemYet: number
  chenh: number
}

/** Giá bảng của ĐÚNG đơn vị của dòng (0 = mặt hàng chưa có giá). */
export function giaBangCuaDong(l: DongChenh, sp: SanPhamQuyDoi | null | undefined): number {
  const dv = l.unit_name || sp?.base_unit || ""
  return giaNiemYetDonVi(sp, dv, heSoQuyDoi(sp, dv, l.conversion_factor))
}

/** Chênh của MỘT dòng (bán hay trả cùng một phép): SL × (đơn giá chứng từ − giá bảng cùng đơn vị). */
export function chenhDong(l: DongChenh, sp: SanPhamQuyDoi | null | undefined): ChenhDong {
  const sl = so(l.quantity)
  const donGia = l.unit_price != null ? so(l.unit_price) : sl !== 0 ? so(l.line_total) / sl : 0
  const giaBang = giaBangCuaDong(l, sp)
  const tien = sl * donGia
  const niemYet = sl * (giaBang > 0 ? giaBang : donGia)
  return { tien, niemYet, chenh: tien - niemYet }
}
