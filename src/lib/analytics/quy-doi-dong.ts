/**
 * QUY ĐỔI SỐ LƯỢNG CỦA MỘT DÒNG CHỨNG TỪ VỀ ĐƠN VỊ CƠ SỞ — cho báo cáo.
 *
 * ⚠ CHỦ NHÀ 24/09/2026: "Rà soát các lỗi sai tương tự trong các báo cáo" — báo
 *   cáo cộng 3 thùng + 5 hộp thành "8" rồi dán nhãn đơn vị cơ sở, và nhân số
 *   lượng thùng với giá / giá vốn của một hộp.
 *
 * Luật dùng chung nằm ở `./units` (không sửa ở đây); tệp này chỉ gói lại cho
 * từng loại dòng:
 *   · dòng đơn / hóa đơn / đơn mua: `quantity` theo `unit_name` → × hệ số
 *     (ưu tiên số chụp `conversion_factor`, không có thì tra danh mục).
 *   · dòng phiếu kho: `quantity` có khi là đơn vị giao dịch (phiếu xuất
 *     mig 120 ghi `p_qty_base / v_conv`), có khi đã là cơ sở (phiếu nhập mig
 *     142/168) — chỉ `qty_in_base_uom` (NOT NULL, mig 039) là chắc chắn.
 *     `unit_cost` là giá vốn MỘT đơn vị cơ sở (mig 016).
 */
import { heSoQuyDoi, soLuongCoSo, type SanPhamQuyDoi } from "./units"

export type DongCoDonVi = {
  quantity: number | string | null | undefined
  unit_name?: string | null
  /** Số chụp trên dòng (sales_order_lines / sales_invoice_lines). */
  conversion_factor?: number | string | null
}

/** Số lượng của dòng quy về đơn vị cơ sở. */
export function slCoSoDong(l: DongCoDonVi, sp?: SanPhamQuyDoi | null): number {
  return soLuongCoSo(l.quantity, heSoQuyDoi(sp ?? null, l.unit_name || "", l.conversion_factor))
}

export type DongKho = {
  quantity?: number | string | null
  qty_in_base_uom?: number | string | null
  unit_cost?: number | string | null
}

/** Số lượng cơ sở của dòng phiếu kho (luôn dương — phiếu xuất có thể ghi âm). */
export function slCoSoDongKho(l: DongKho): number {
  const coSo = l.qty_in_base_uom
  const q = coSo === null || coSo === undefined || coSo === "" ? l.quantity : coSo
  return Math.abs(Number(q) || 0)
}

/** Giá trị theo giá vốn của dòng phiếu kho = SL cơ sở × giá vốn / đơn vị cơ sở. */
export function giaTriVonDongKho(l: DongKho): number {
  return slCoSoDongKho(l) * (Number(l.unit_cost) || 0)
}
