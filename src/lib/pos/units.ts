import type { PosLine, PosUnitOption } from "./types"
import { unitPriceFor, conversionFor, sellableUnits, type PricedProduct } from "@/lib/sell/pricing"

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

/**
 * ĐỔI ĐƠN VỊ CỦA MỘT DÒNG — dòng bán lẫn dòng hàng đổi trả.
 *
 * ⚠ ĐỔI ĐƠN VỊ LÀ ĐỔI GIÁ. Chủ nhà báo 23/09/2026: ở khối "Hàng đổi trả
 *   kèm đơn", bấm hộp → thùng mà đơn giá vẫn là giá hộp — "Trừ đơn" hụt
 *   đúng bằng hệ số. Dòng bán thì tra lại bảng giá; dòng trả chỉ đổi
 *   nhãn. Nay cả hai đi qua đây.
 *
 * ⚠ TRA LẠI BẢNG GIÁ, KHÔNG NHÂN CHIA HỆ SỐ — bảng giá thùng có thể rẻ
 *   hơn 12 lần giá chai. Chỉ khi danh mục không còn mặt hàng (đã ngừng
 *   bán) mới giữ giá cũ: không có gì để tra.
 */
export function doiDonViDong(
  l: Pick<PosLine, "price" | "units">,
  donVi: string,
  p: PricedProduct | null | undefined,
  groupId: string | null | undefined
): Pick<PosLine, "unit" | "price" | "listPrice" | "units"> {
  if (!p) return { unit: donVi, price: l.price, listPrice: l.price, units: l.units }
  const gia = unitPriceFor(p, donVi, groupId)
  return {
    unit: donVi,
    price: gia,
    listPrice: gia,
    units: sellableUnits(p).map((x) => ({ unit_name: x, conversion: conversionFor(p, x) })),
  }
}
