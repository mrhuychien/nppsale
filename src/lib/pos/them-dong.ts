/**
 * THÊM HÀNG VÀO PHIẾU POS: dòng mới lên ĐẦU danh sách — chủ nhà 13/10/2026: "xử lý phần pos : thêm sản phẩm thì sản
 * phẩm xuất hiện đầu danh sách luôn". Một luật cho mọi màn POS (đơn hàng, hoá đơn, trả hàng, nhập hàng, trả NCC).
 *
 * ⚠ THỨ TỰ TRÊN MÀN LÀ THỨ TỰ LƯU (số thứ tự dòng theo vị trí) — mở lại phiếu, in phiếu cũng món mới nhất ở trên, khớp
 *   cái người lập đã thấy.
 */

/** Thêm một dòng mới lên đầu. */
export function themLenDau<T>(ds: readonly T[], moi: T): T[] {
  return [moi, ...ds]
}

/**
 * Dòng thứ `i` (đã sửa bằng `sua`) lên đầu, các dòng khác giữ thứ tự — gộp dòng trùng (màn đơn) thì dòng vừa được cộng
 * số lượng cũng lên đầu: món vừa bấm luôn nằm trên cùng.
 */
export function donLenDau<T>(ds: readonly T[], i: number, sua: (x: T) => T): T[] {
  if (i < 0 || i >= ds.length) return [...ds]
  return [sua(ds[i]), ...ds.slice(0, i), ...ds.slice(i + 1)]
}
