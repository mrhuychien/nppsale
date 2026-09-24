/**
 * Giỏ hàng của màn bán hàng trên điện thoại.
 *
 * THUẦN, KHÔNG BIẾT GÌ VỀ REACT
 *   Mọi phép cộng trừ ở đây ra tiền thật. Để chúng trong component thì
 *   cách duy nhất kiểm chứng là bấm tay trên điện thoại; để ở đây thì phá
 *   được bằng test.
 */

import { discountAmount, lineGross, type DiscountInput } from "@/lib/pos/discount"
import { vatChungCuaDong } from "@/lib/pos/vat"

/* ⚠ Quy tắc SỐ dùng chung với POS (hàm thuần, không store) — `/sell` đọc qua
   đây, không import thẳng `@/lib/pos` (chốt tách store, tests/pos-cau-truc). */
export { vatChungCuaDong, vatChungKeTiep } from "@/lib/pos/vat"
export { switchUnit, unitLabel, lineGross, type DiscountInput } from "@/lib/pos/discount"

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
  /**
   * Giảm giá của dòng, theo % hoặc theo đồng — chủ nhà 24/09/2026: "sell
   * mobile … thêm giảm giá từng dòng theo %, giá trị". Cùng quy tắc số với
   * POS (`@/lib/pos/discount`). Vắng = không giảm.
   *
   * ⚠ KHÔNG CÓ CỘT RIÊNG DƯỚI SỔ. Như POS (`posLinesToCart`), khoản giảm quy
   *   về ĐƠN GIÁ lúc ghi (`netPriceOf`) — mọi phép tiền đọc giá ấy, đừng đọc
   *   `price` trần.
   */
  discount?: DiscountInput
}

/** Khoản giảm của dòng, quy ra đồng, kẹp trong [0, tiền hàng]. */
export function lineDiscountAmountOf(l: Pick<CartLine, "qty" | "price" | "discount">): number {
  return l.discount ? discountAmount(l.discount, lineGross(l.qty, l.price)) : 0
}

/**
 * Đơn giá SAU giảm dòng — giá đi xuống sổ, cũng là giá mọi tổng tiền dùng.
 *
 * ⚠ LÀM TRÒN VỀ ĐỒNG Ở ĐƠN GIÁ, như POS. Sổ chỉ giữ `unit_price`; tổng tính
 *   trên giá chưa làm tròn thì tổng đơn lệch vài đồng với tổng máy chủ cộng
 *   lại từ dòng.
 */
export function netPriceOf(l: Pick<CartLine, "qty" | "price" | "discount">): number {
  const giam = lineDiscountAmountOf(l)
  if (giam <= 0 || !(l.qty > 0)) return l.price
  return Math.round((lineGross(l.qty, l.price) - giam) / l.qty)
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
  return [theoThueChung(cart, line), ...cart]
}

/**
 * ĐẶT SỐ LƯỢNG CHO NHIỀU MẶT HÀNG MỘT LẦN — chế độ "chọn nhiều" ở /sell
 * (chủ nhà yêu cầu 23/09/2026).
 *
 * ⚠ SỐ TUYỆT ĐỐI, KHÔNG CỘNG DỒN. Ô số lượng của chế độ ấy hiện sẵn số
 *   đang có trong giỏ; người dùng sửa thành 5 nghĩa là giỏ có 5, không
 *   phải 2 + 5. `qty <= 0` là bỏ dòng.
 *
 * ⚠ MỘT PHÉP, KHÔNG PHẢI VÒNG `addLine` + `setQty(index)`. `addLine` đẩy
 *   dòng mới lên đầu nên chỉ số của các dòng sau lệch đi — `setQty` theo
 *   chỉ số đã tính trước là sửa nhầm dòng.
 *
 * Dòng đã có giữ nguyên giá (có thể đã sửa tay), ghi chú và vị trí; dòng
 * mới lên đầu theo thứ tự chọn. Hai lựa chọn trùng (sản phẩm + đơn vị):
 * lựa chọn sau thắng.
 */
export function setLinesQty(cart: CartLine[], picks: CartLine[]): CartLine[] {
  const cuoi = new Map<string, CartLine>()
  for (const p of picks) cuoi.set(lineKey(p.productId, p.unit), p)
  let next = [...cart]
  const moi: CartLine[] = []
  cuoi.forEach((p) => {
    const i = findLine(next, p.productId, p.unit)
    if (i >= 0) {
      if (p.qty <= 0) next = next.filter((_, k) => k !== i)
      else next[i] = { ...next[i], qty: p.qty }
    } else if (p.qty > 0) {
      moi.push(theoThueChung(cart, p))
    }
  })
  return [...moi, ...next]
}

/**
 * THUẾ CẢ ĐƠN — chủ nhà 24/09/2026: "sell mobile -> Bỏ VAT từng dòng". Thuế
 * đặt một lần cho cả giỏ (như nút thuế cả đơn của POS), đi xuống MỌI dòng —
 * sổ vẫn giữ `vat_rate` theo dòng (mig 183), chỉ là không đặt riêng từng dòng.
 */
export function setVatAll(cart: CartLine[], rate: number): CartLine[] {
  return cart.map((l) => ({ ...l, vatRate: rate }))
}

/**
 * Dòng MỚI theo thuế chung của giỏ khi cả giỏ đang cùng một thuế — như POS
 * (`vatChungCuaDong(cu)`). Không có ô thuế dòng thì một dòng lệch thuế là
 * thứ người dùng không thấy và không sửa được. Giỏ đang lệch sẵn (đơn cũ
 * nạp lại) thì giữ thuế danh mục.
 */
export function theoThueChung(cart: readonly CartLine[], line: CartLine): CartLine {
  const chung = vatChungCuaDong(cart)
  return cart.length > 0 && chung !== null ? { ...line, vatRate: chung } : line
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
  /* ⚠ Giá SAU giảm dòng — xem `netPriceOf`. */
  const subtotal = cart.reduce((s, l) => s + l.qty * netPriceOf(l), 0)
  const vat = cart.reduce((s, l) => s + l.qty * netPriceOf(l) * (l.vatRate || 0), 0)
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
