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
  /* Dòng KHÔNG lưu hệ số (vd. `return_lines` — máy chủ tự tra) thì hệ số
     của danh mục là con số đúng; đè bằng 1 là thùng thành hộp. */
  if (i >= 0) { if (heSoDaLuu != null) ds[i] = { unit_name: unitName, conversion: heSo } }
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
  return { unit: donVi, price: gia, listPrice: gia, units: donViCuaSanPham(p) }
}

/**
 * Bộ đơn vị của một mặt hàng trong danh mục — đơn vị CƠ SỞ đứng đầu.
 *
 * ⚠ ĐỪNG DÙNG THẲNG `p.units`. Bảng `product_units` có thể không khai lại
 *   đơn vị cơ sở: ô chọn khi ấy không có "hộp" trong khi dòng đang là hộp,
 *   và `base_unit` gửi đi (`l.units[0]`) thành "thùng".
 */
export function donViCuaSanPham(p: PricedProduct): PosUnitOption[] {
  return sellableUnits(p).map((x) => ({ unit_name: x, conversion: conversionFor(p, x) }))
}

/**
 * ĐỔI ĐƠN VỊ MÀ GIÁ ĐI THEO HỆ SỐ — giá vốn (nhập hàng, trả NCC) và giá đã
 * chốt trên chứng từ (dòng trả nạp từ hóa đơn gốc).
 *
 * ⚠ KHÁC GIÁ BÁN. Giá bán tra bảng giá (`doiDonViDong`) vì thùng có thể rẻ
 *   hơn 24 hộp. Giá vốn thì không có bảng: một thùng nhập 480.000 nghĩa
 *   là một hộp 20.000 — và dòng trả theo hóa đơn phải hoàn đúng tiền
 *   khách đã trả, không theo bảng giá hôm nay. Chủ nhà chốt 23/09/2026.
 *
 * Thiếu hệ số của một trong hai đơn vị thì giữ giá — đoán là ghi sai tiền.
 */
export function doiDonViTheoHeSo(
  l: Pick<PosLine, "unit" | "price" | "units">,
  donVi: string
): Pick<PosLine, "unit" | "price"> {
  const cu = l.units.find((u) => u.unit_name === l.unit)?.conversion
  const moi = l.units.find((u) => u.unit_name === donVi)?.conversion
  if (!cu || !moi) return { unit: donVi, price: l.price }
  return { unit: donVi, price: Math.round((l.price / cu) * moi) }
}

/**
 * Bộ đơn vị đem ra ô chọn của một dòng.
 *
 * ⚠ DÒNG NẠP LẠI CÓ THỂ ĐẾN TRƯỚC DANH MỤC — lúc ấy chỉ biết đơn vị đã
 *   lưu. Ghép danh mục vào LÚC VẼ để dòng ấy vẫn đổi được đơn vị; hệ số đã
 *   biết của dòng (nếu có) vẫn thắng — xem `donViNapLai`.
 */
export function donViHienThi(
  l: Pick<PosLine, "unit" | "units">,
  p: PricedProduct | null | undefined
): PosUnitOption[] {
  if (!p || l.units.length > 1) {
    return l.units.length ? l.units : [{ unit_name: l.unit, conversion: 1 }]
  }
  const daBiet = l.units.find((u) => u.unit_name === l.unit)?.conversion
  return donViNapLai(l.unit, daBiet ?? null, donViCuaSanPham(p))
}

/**
 * ĐỔI ĐƠN VỊ CỦA MỘT DÒNG HÀNG TRẢ.
 *
 * Dòng thêm tay: tra bảng giá như dòng bán (`doiDonViDong`). Dòng mang giá
 * của chứng từ (`giaTheoHoaDon` — nạp từ hóa đơn gốc, hoặc phiếu đã lưu):
 * giá đi theo hệ số, để hoàn đúng tiền khách đã trả.
 */
export function doiDonViDongTra(
  l: Pick<PosLine, "unit" | "price" | "units" | "giaTheoHoaDon">,
  donVi: string,
  p: PricedProduct | null | undefined,
  groupId: string | null | undefined
): Partial<PosLine> {
  const ds = donViHienThi(l, p)
  if (l.giaTheoHoaDon) return { units: ds, ...doiDonViTheoHeSo({ ...l, units: ds }, donVi) }
  return doiDonViDong({ ...l, units: ds }, donVi, p, groupId)
}
