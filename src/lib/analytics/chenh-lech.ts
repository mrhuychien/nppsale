/**
 * CHÊNH LỆCH GIÁ CỦA NHÂN VIÊN — một luật cho Báo cáo tổng hợp (Theo nhân viên) và Báo cáo › Nhân
 * viên ("Hàng bán theo nhân viên").
 *
 * Chủ nhà 01/10/2026 (chốt lại, thay luật "giá lúc bán lấy từ dòng đơn" của mig 218): "hiện tại chỉ có
 *   1 giá bán ra. Cách tính chênh lệch: Hàng đi: lấy số liệu trên hóa đơn. Giá trên hóa đơn so với giá
 *   trên bảng giá (lưu ý phải cùng đơn vị tính) x số lượng".
 *
 *     chênh bán   = Σ SL × (đơn giá trên hoá đơn − giá bảng của ĐÚNG đơn vị dòng)
 *     chênh trả   = Σ (−SL trả) × (đơn giá trên phiếu trả − giá bảng cùng đơn vị)   (hàng trả TÍNH ÂM, chủ nhà
 *                   03/11/2026 — `chenhTraDong` / `chenhTra`)
 *     chênh thuần = chênh bán + chênh trả            (chủ nhà 12/10/2026 — `chenhThuan`; màn gọi "Chênh lệch net")
 *     tổng chênh  = chênh thuần − giảm giá cả đơn   (chủ nhà 12/10/2026 — `tongChenhLech`)
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

/**
 * TỔNG CHÊNH LỆCH — chủ nhà 12/10/2026: "Thêm cột tổng chênh lệch = chênh lệch thuần - giảm giá đơn". `giamDon` là SỐ
 * TIỀN giảm giá cả đơn (dương) — trừ đi. Một luật cho hai báo cáo, như `chenhDong`.
 */
export function tongChenhLech(thuan: number, giamDon: number | null | undefined): number {
  return thuan - (Number(giamDon) || 0)
}

/**
 * CHÊNH LỆCH THUẦN = chênh bán + chênh trả — chủ nhà 12/10/2026 (thay "bán − trả" của 01/10/2026): "trả mày đang tính là
 * âm, nên chênh trả ra giá trị âm. Giá trị này npp đã trả cho nhân viên nên giờ cần thu hồi, nên chênh thuần = chênh
 * bán + chênh trả". Chênh trả đã mang dấu của hàng trả (âm — `chenhTra`), nên ở đây chỉ CỘNG.
 */
export function chenhThuan(chenhBan: number, chenhTra: number): number {
  return chenhBan + chenhTra
}

/**
 * CHÊNH TRẢ — chủ nhà 03/11/2026: "phần chênh lệch trả tính sai: phải là giá trị âm" (12/10/2026: "trả mày đang tính là
 * âm, nên chênh trả ra giá trị âm"). Màn hiện hàng trả là số ÂM (Giá trị trả "-460.000"), nên hàng trả là hàng đi TÍNH ÂM:
 *
 *     chênh trả = (−SL trả) × (đơn giá phiếu trả − giá bảng cùng đơn vị) = giá bảng của hàng trả − tiền trả (trước thuế)
 *
 * Bán trên bảng giá rồi khách trả lại cùng giá → chênh trả ÂM, đúng bằng phần chênh đã tính cho số hàng ấy (NPP thu hồi);
 * chênh net = chênh của SL thực bán. Bán dưới bảng giá rồi trả → chênh trả DƯƠNG (trả lại phần nhân viên đã chịu).
 * ⚠ Bản 12/10/2026 giữ dấu của hàng đi (`chenhDong`): trả cùng giá bán trên bảng giá ra DƯƠNG, chênh net đội lên thay vì
 *   giảm (bài kiểm khi ấy dùng phiếu trả giá DƯỚI bảng giá nên không thấy).
 * Viết `niemYet − tien` (không `−chenh`): hai số bằng nhau ra 0, không ra "-0".
 */
export function chenhTra(tienTra: number, niemYetTra: number): number {
  return (Number(niemYetTra) || 0) - (Number(tienTra) || 0)
}

/** Chênh trả của MỘT dòng phiếu trả: `tien` / `niemYet` vẫn là số dương (màn tự hiện dấu trừ), `chenh` theo `chenhTra`. */
export function chenhTraDong(l: DongChenh, sp: SanPhamQuyDoi | null | undefined): ChenhDong {
  const c = chenhDong(l, sp)
  return { ...c, chenh: chenhTra(c.tien, c.niemYet) }
}

/**
 * THUẾ + LÀM TRÒN — chủ nhà 29/10/2026 hỏi vì sao ở dòng nhân viên "Doanh thu − Theo bảng giá" không ra "Chênh lệch bán":
 * Doanh thu dòng nhân viên là TIỀN HOÁ ĐƠN (gồm VAT, sau giảm giá cả đơn, làm tròn — khớp công nợ, 26/09/2026), còn chênh
 * tính TRƯỚC thuế theo dòng. Chốt cách 1: giữ Doanh thu khớp công nợ, thêm cột này cho đủ vế:
 *
 *     Doanh thu − Theo bảng giá = Chênh lệch bán − Giảm giá đơn + Thuế + làm tròn
 *
 * `sales_invoices.total = subtotal + vat`, `subtotal` ghi SAU giảm giá cả đơn (mig 183) → tiền chứng từ − Σ `line_total`
 * = −giảm giá đơn + VAT + làm tròn; cộng lại giảm giá đơn thì còn đúng VAT + làm tròn. Đang lọc hàng thì ba số đều là
 * PHẦN phân bổ của hàng được lọc (`phanTienQuaLoc`). Một luật cho Báo cáo › Nhân viên và Báo cáo tổng hợp › Theo nhân viên.
 */
export function thueLamTronNv(tienChungTu: number, tienDong: number, giamDon: number | null | undefined): number {
  return (Number(tienChungTu) || 0) - (Number(tienDong) || 0) + (Number(giamDon) || 0)
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
