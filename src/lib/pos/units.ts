import type { PosUnitOption } from "./types"

/**
 * Bộ đơn vị của một dòng NẠP LẠI từ phiếu đã lưu.
 *
 * ⚠ HỆ SỐ ĐÃ LƯU TRÊN DÒNG THẮNG. Bản cũ dựng `[{ unit_name, conversion: 1 }]`
 *   cho mọi dòng nạp lại — dòng "2 thùng" (×24) mở ra thành 2 thùng HỆ SỐ
 *   1, và bấm Hoàn thành thì `complete_purchase_invoice` nhập 2 thay vì 48
 *   (máy chủ tính `quantity × conversion_factor`), trong khi tiền vẫn tính
 *   theo thùng. Kho hụt 46, giá vốn một hộp đội lên 24 lần.
 *
 * ⚠ GHÉP THÊM CÁC ĐƠN VỊ KHÁC CỦA SẢN PHẨM (nếu danh mục đã nạp), để người
 *   sửa vẫn đổi được đơn vị — nhưng hệ số của đơn vị đã lưu vẫn lấy từ
 *   dòng, vì đó là con số phiếu đã ghi.
 */
export function donViNapLai(
  unitName: string,
  heSoDaLuu: number | string | null | undefined,
  donViDanhMuc?: readonly PosUnitOption[] | null
): PosUnitOption[] {
  const heSo = Number(heSoDaLuu) || 1
  const ds = (donViDanhMuc ?? []).map((u) => ({ ...u }))
  const i = ds.findIndex((u) => u.unit_name === unitName)
  if (i >= 0) ds[i] = { unit_name: unitName, conversion: heSo }
  else ds.push({ unit_name: unitName, conversion: heSo })
  return ds
}
