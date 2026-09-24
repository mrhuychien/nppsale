/**
 * GIẢM GIÁ CẢ ĐƠN — đi từ đơn sang hóa đơn (mig 183).
 *
 * ⚠ CHỦ NHÀ 24/09/2026: "Bê nguyên các trường từ Đơn hàng sang Hóa đơn, ko
 *   được để sót". Đơn ghi `subtotal` SAU giảm giá đơn; hóa đơn trước đây cộng
 *   lại từ dòng nên khoản giảm biến mất và khách bị ghi nợ cao hơn đơn.
 *
 * ⚠ SUY RA TỪ `Σ(SL × giá) − subtotal`, KHÔNG TỪ `sales_orders.discount`. Cột
 *   ấy gộp cả chiết khấu dòng (giá bảng − giá bán) và bù trừ dòng nâng giá,
 *   nên trừ ngược ra phần "giảm cả đơn" là đoán. Còn `subtotal` của đơn và
 *   của hóa đơn (từ mig 183) cùng một nghĩa: sau giảm đơn, trước thuế.
 *
 * ⚠ BỎ QUA SAI SỐ LÀM TRÒN. Mỗi dòng làm tròn riêng, tổng làm tròn một lần —
 *   lệch tới nửa đồng mỗi dòng. Hiệu nhỏ hơn hoặc bằng số dòng là tiếng ồn,
 *   không phải giảm giá; mang nó sang hóa đơn là in một dòng "Giảm 2đ".
 */
export interface DongTien {
  quantity: number
  unitPrice: number
}

/** Khoản giảm cả đơn nằm trong một chứng từ: `Σ(SL × giá) − subtotal`, 0 nếu chỉ là sai số. */
export function giamCuaChungTu(dong: readonly DongTien[], subtotal: number | null | undefined): number {
  const coSo = dong.filter((l) => (Number(l.quantity) || 0) > 0)
  const tienHang = Math.round(coSo.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0))
  const hieu = tienHang - Math.round(Number(subtotal) || 0)
  return hieu > Math.max(1, coSo.length) ? hieu : 0
}

/**
 * Khoản giảm cả đơn CÒN LẠI cho lần xuất tiếp theo: giảm của đơn trừ phần các
 * hóa đơn khác (còn hiệu lực) của đơn đã dùng. Không âm.
 */
export function giamGiaDonConLai(o: {
  dongDon: readonly DongTien[]
  subtotalDon: number | null | undefined
  hoaDonKhac: ReadonlyArray<{ dong: readonly DongTien[]; subtotal: number | null | undefined }>
}): number {
  const cuaDon = giamCuaChungTu(o.dongDon, o.subtotalDon)
  const daDung = o.hoaDonKhac.reduce((s, h) => s + giamCuaChungTu(h.dong, h.subtotal), 0)
  return Math.max(0, cuaDon - daDung)
}

/** Dòng hóa đơn như đọc từ `sales_invoice_lines` — dòng đổi (giá 0) tự loại. */
export interface DongHoaDonDoc {
  quantity: number | string | null
  unit_price: number | string | null
  is_exchange?: boolean | null
}

/**
 * Giảm giá cả đơn mà MỘT tờ hóa đơn đã ghi (mig 183): `Σ(SL × giá) − subtotal`.
 * Tờ lập trước mig 183 có `subtotal = Σ` nên ra 0 — đúng.
 */
export function giamCuaHoaDon(dong: readonly DongHoaDonDoc[], subtotal: number | string | null | undefined): number {
  return giamCuaChungTu(
    dong.filter((l) => !l.is_exchange).map((l) => ({ quantity: Number(l.quantity) || 0, unitPrice: Number(l.unit_price) || 0 })),
    Number(subtotal) || 0
  )
}
