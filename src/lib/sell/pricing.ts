import type { PriceList, Product, ProductUnit } from "@/types"

export type PricedProduct = Product & {
  price_lists?: PriceList[] | null
  units?: ProductUnit[] | null
}

/**
 * Giá một đơn vị của một sản phẩm cho một nhóm khách.
 *
 * VÌ SAO TÁCH RA KHỎI MÀN HÌNH
 *   Phép này quyết định con số người mua phải trả. Trước đây nó nằm giữa
 *   `order-form.tsx`, và màn bán hàng mới cần đúng phép đó — chép sang là
 *   chắc chắn có ngày hai màn báo hai giá cho cùng một mặt hàng.
 *
 * BỐN BẬC, XÉT THEO THỨ TỰ
 *   1. Bảng giá riêng của NHÓM khách (dữ liệu NPP cũ còn dùng).
 *   2. Bảng giá CHUNG (`group_id` rỗng).
 *   3. Đơn vị cơ sở → `products.sell_price`.
 *   4. Đơn vị quy đổi → giá cơ sở × hệ số.
 *
 * ⚠ Trả 0 khi không tra ra giá nào. 0 ở đây nghĩa là CHƯA CÓ GIÁ, không
 * phải "miễn phí" — nơi gọi phải hiện "chưa có giá" chứ đừng in "0đ".
 */
export function unitPriceFor(
  product: PricedProduct,
  unitName: string,
  groupId: string | null | undefined
): number {
  if (groupId) {
    const groupMatch = product.price_lists?.find(
      (pl) => pl.unit_name === unitName && pl.group_id === groupId
    )
    if (groupMatch) return Number(groupMatch.price)
  }
  const defaultMatch = product.price_lists?.find(
    (pl) => pl.unit_name === unitName && !pl.group_id
  )
  if (defaultMatch) return Number(defaultMatch.price)

  if (unitName === product.base_unit) return Number(product.sell_price ?? 0)

  const unitInfo = product.units?.find((u) => u.unit_name === unitName)
  if (unitInfo) {
    const basePrice = unitPriceFor(product, product.base_unit, groupId)
    if (basePrice > 0) return basePrice * Number(unitInfo.conversion)
  }
  return 0
}

/**
 * Hệ số quy đổi của một đơn vị về đơn vị cơ sở.
 *
 * ⚠ Không tra ra thì trả 1, KHÔNG đoán. Đoán một hệ số ở đây là sai số
 * lượng xuất kho — thà cảnh báo hụt còn hơn trừ nhầm kho.
 */
export function conversionFor(product: PricedProduct, unitName: string): number {
  if (unitName === product.base_unit) return 1
  const u = product.units?.find((x) => x.unit_name === unitName)
  return Number(u?.conversion) || 1
}

/**
 * Danh sách đơn vị bán được, đơn vị CƠ SỞ đứng đầu.
 *
 * ⚠ Bỏ đơn vị trùng tên đơn vị cơ sở: vài sản phẩm khai lại chính nó
 * trong bảng `product_units` với hệ số 1, và khi đó thẻ sản phẩm hiện hai
 * nút giống hệt nhau cạnh nhau.
 */
export function sellableUnits(product: PricedProduct): string[] {
  const base = product.base_unit
  const rest = (product.units ?? [])
    .map((u) => u.unit_name)
    .filter((n) => n && n !== base)
  return [base, ...Array.from(new Set(rest))]
}

/** Tồn kho quy ra số nguyên đơn vị đang chọn (2.5 thùng thì bán được 2). */
export function stockInUnit(
  product: PricedProduct,
  unitName: string,
  baseOnHand: number
): number {
  const conv = conversionFor(product, unitName)
  return Math.floor((Number(baseOnHand) || 0) / (conv || 1))
}
