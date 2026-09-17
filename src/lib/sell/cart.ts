/**
 * Giỏ hàng của màn bán hàng trên điện thoại.
 *
 * THUẦN, KHÔNG BIẾT GÌ VỀ REACT
 *   Mọi phép cộng trừ ở đây ra tiền thật. Để chúng trong component thì
 *   cách duy nhất kiểm chứng là bấm tay trên điện thoại; để ở đây thì phá
 *   được bằng test.
 */

export interface CartLine {
  productId: string
  /** Đơn vị bán — `thùng`, `lốc`, `chai`… */
  unit: string
  qty: number
  /** Đơn giá ĐANG áp dụng (có thể đã bị sửa tay). */
  price: number
  /** Giá bảng — giữ lại để biết dòng nào bị sửa giá và sửa bao nhiêu. */
  listPrice: number
  note: string
  /** Hệ số quy đổi về đơn vị cơ sở, chốt lúc thêm dòng. */
  conversion: number
  vatRate: number
}

/**
 * ⚠ KHOÁ DÒNG LÀ (sản phẩm + ĐƠN VỊ), không phải chỉ sản phẩm.
 *
 * Cùng một mặt hàng đặt 3 thùng và 5 chai là chuyện thường ngày — gộp
 * chúng lại là làm hỏng một cách dùng có thật, và cũng không quy đổi
 * ngược lại được vì hai dòng có thể khác giá.
 */
export function lineKey(productId: string, unit: string): string {
  return `${productId}|${unit}`
}

export function findLine(cart: CartLine[], productId: string, unit: string): number {
  return cart.findIndex((l) => l.productId === productId && l.unit === unit)
}

/**
 * Thêm hàng vào giỏ.
 *
 * ⚠ Đã có dòng cùng (sản phẩm + đơn vị) thì CỘNG DỒN vào dòng đó và giữ
 * nguyên vị trí — đẩy nó lên đầu thì mỗi lần bấm + danh sách lại nhảy
 * dưới tay người đang bấm.
 *
 * ⚠ Dòng MỚI thì lên ĐẦU. Thứ vừa thêm là thứ sắp phải sửa số lượng.
 */
export function addLine(cart: CartLine[], line: CartLine): CartLine[] {
  const i = findLine(cart, line.productId, line.unit)
  if (i >= 0) {
    const next = [...cart]
    next[i] = { ...next[i], qty: next[i].qty + line.qty }
    return next
  }
  return [line, ...cart]
}

/** Đặt số lượng. `qty <= 0` là XOÁ dòng — nút − ở số 1 hiện hình thùng rác. */
export function setQty(cart: CartLine[], index: number, qty: number): CartLine[] {
  if (index < 0 || index >= cart.length) return cart
  if (qty <= 0) return cart.filter((_, i) => i !== index)
  const next = [...cart]
  next[index] = { ...next[index], qty }
  return next
}

export function patchLine(
  cart: CartLine[],
  index: number,
  patch: Partial<CartLine>
): CartLine[] {
  if (index < 0 || index >= cart.length) return cart
  const next = [...cart]
  next[index] = { ...next[index], ...patch }
  return next
}

/** Tổng nhu cầu của một sản phẩm, quy về đơn vị cơ sở, cộng MỌI dòng. */
export function baseQtyOf(cart: CartLine[], productId: string): number {
  return cart
    .filter((l) => l.productId === productId)
    .reduce((s, l) => s + l.qty * (l.conversion || 1), 0)
}

export interface CartTotals {
  /** Tổng theo giá BẢNG, trước khi ai sửa giá. */
  gross: number
  /** Tổng theo giá đang áp dụng. */
  subtotal: number
  /** Phần chênh do sửa giá xuống — chỉ tính phần GIẢM. */
  discount: number
  vat: number
  /** Trừ hàng trả (dòng đổi hàng không trừ tiền). */
  returnCredit: number
  /** Khách phải trả. */
  grandTotal: number
}

/**
 * Cộng tiền.
 *
 * ⚠ VAT tính trên `subtotal` (giá đang áp dụng), KHÔNG trên `gross`. Tính
 * trên giá bảng là bắt khách trả thuế cho phần đã được giảm.
 *
 * ⚠ `discount` chỉ nhận phần GIẢM. Nhân viên được phép nâng giá trong hạn
 * mức, và một "chiết khấu âm" hiện trên màn hình thì không ai hiểu là gì.
 */
export function cartTotals(cart: CartLine[], returnCredit = 0): CartTotals {
  const gross = cart.reduce((s, l) => s + l.qty * l.listPrice, 0)
  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0)
  const vat = cart.reduce((s, l) => s + l.qty * l.price * (l.vatRate || 0), 0)
  const discount = Math.max(0, gross - subtotal)
  const credit = Math.max(0, returnCredit)
  return {
    gross: round(gross),
    subtotal: round(subtotal),
    discount: round(discount),
    vat: round(vat),
    returnCredit: round(credit),
    grandTotal: Math.max(0, round(subtotal + vat - credit)),
  }
}

/** Làm tròn về đồng — tiền Việt không có hào. */
function round(n: number): number {
  return Math.round(n)
}

/**
 * Giá dòng này có nằm trong hạn mức nhân viên được phép không.
 *
 * ⚠ SÀN là giá bảng. NVBH không được bán thấp hơn bảng giá — đó là chốt
 * chặn duy nhất giữa một cú gõ nhầm và việc cho không hàng.
 *
 * ⚠ TRẦN là giá bảng + `maxIncreasePct`. Nâng giá cũng phải có mức: khách
 * phát hiện bị tính cao hơn NPP khác là mất khách, không phải lãi thêm.
 *
 * Trả `null` khi giá hợp lệ, hoặc câu giải thích khi không.
 */
export function priceViolation(
  line: Pick<CartLine, "price" | "listPrice">,
  opts: { canEditPrice: boolean; maxIncreasePct: number }
): "below_list" | "above_ceiling" | null {
  // Không có quyền sửa giá thì giá luôn là giá bảng — lệch là do dữ liệu
  // cũ, và chặn ở đây chỉ làm nhân viên không lưu được đơn mà không hiểu.
  if (!opts.canEditPrice) return null
  if (line.listPrice <= 0) return null
  if (line.price < line.listPrice) return "below_list"
  if (line.price > ceilingFor(line.listPrice, opts.maxIncreasePct)) return "above_ceiling"
  return null
}

export function ceilingFor(listPrice: number, maxIncreasePct: number): number {
  return Math.round(listPrice * (1 + (Number(maxIncreasePct) || 0) / 100))
}
