/**
 * QUY ĐỔI ĐƠN VỊ TRONG BÁO CÁO.
 *
 * ⚠ CHỦ NHÀ 24/09/2026 (Báo cáo > Nhân viên > Hàng bán theo nhân viên): "Giá trị
 *   niêm yết đang bị tính sai … giá niêm yết đang tính theo đơn vị cơ sở. Số
 *   lượng bán tính theo đơn vị trung gian. Nên doanh thu lớn - Giá trị niêm yết
 *   thấp -> Chênh lệch cao."
 *
 * Hai luật, dùng chung mọi báo cáo:
 *   1. SỐ LƯỢNG cộng qua nhiều dòng phải quy về ĐƠN VỊ CƠ SỞ trước
 *      (`soLuongCoSo`). 3 thùng + 5 hộp không phải "8".
 *   2. GIÁ nhân với số lượng phải là giá CỦA ĐÚNG ĐƠN VỊ ĐÓ (`giaNiemYetDonVi`):
 *      bảng giá chung của đơn vị ấy, không có thì giá cơ sở × hệ số.
 */

export type SanPhamQuyDoi = {
  base_unit: string
  sell_price?: number | string | null
  units?: ReadonlyArray<{ unit_name: string; conversion: number | string }> | null
  /** Bảng giá — chỉ dòng `group_id` rỗng (giá chung) được dùng làm giá niêm yết. */
  price_lists?: ReadonlyArray<{ unit_name: string; price: number | string; group_id?: string | null }> | null
}

/**
 * Hệ số quy về đơn vị cơ sở của một dòng.
 *
 * ⚠ ƯU TIÊN SỐ CHỤP TRÊN DÒNG (`conversion_factor` của dòng hóa đơn): danh mục có
 *   thể đổi hệ số sau này, dòng đã ghi sổ thì không. Dòng không có số chụp (phiếu
 *   trả khách) mới tra danh mục.
 */
export function heSoQuyDoi(sp: SanPhamQuyDoi | null | undefined, unitName: string, chup?: number | string | null): number {
  const c = Number(chup)
  if (Number.isFinite(c) && c > 0) return c
  if (!sp || !unitName || unitName === sp.base_unit) return 1
  const u = sp.units?.find((x) => x.unit_name === unitName)
  const h = Number(u?.conversion)
  return Number.isFinite(h) && h > 0 ? h : 1
}

/** Số lượng quy về đơn vị cơ sở. */
export function soLuongCoSo(qty: number | string | null | undefined, heSo: number): number {
  return (Number(qty) || 0) * heSo
}

/**
 * Giá niêm yết của MỘT đơn vị `unitName`.
 *
 * Bảng giá chung (không theo nhóm khách) của đúng đơn vị → không có thì giá bán
 * cơ sở × hệ số. `0` = chưa có giá niêm yết.
 */
export function giaNiemYetDonVi(sp: SanPhamQuyDoi | null | undefined, unitName: string, heSo: number): number {
  if (!sp) return 0
  const bang = sp.price_lists?.find((p) => p.unit_name === unitName && !p.group_id)
  if (bang && Number(bang.price) > 0) return Number(bang.price)
  // Giá cơ sở: bảng giá chung của đơn vị cơ sở, rồi mới tới `sell_price` — cùng thứ tự `unitPriceFor`.
  const bangCoSo = sp.price_lists?.find((p) => p.unit_name === sp.base_unit && !p.group_id)
  const coSo = bangCoSo && Number(bangCoSo.price) > 0 ? Number(bangCoSo.price) : Number(sp.sell_price) || 0
  return coSo * (unitName === sp.base_unit ? 1 : heSo)
}
