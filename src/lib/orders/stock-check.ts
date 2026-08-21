/**
 * Kiểm tồn khi soạn đơn — tách khỏi `order-form.tsx` để test được.
 *
 * VÌ SAO ĐÁNG TÁCH RA
 * Phần này quyết định có chặn người dùng lưu đơn hay không. Sai theo chiều
 * lỏng thì bán quá tồn (kho không có hàng để giao); sai theo chiều chặt thì
 * chặn nhầm đơn hợp lệ, nhân viên đứng ở cửa hàng không lưu được đơn. Trước
 * đây nó nằm giữa một component 1.976 dòng nên không có cách nào kiểm chứng
 * ngoài bấm tay.
 *
 * BA QUY TẮC DỄ NHẦM, ĐÃ ĐƯỢC GHIM BẰNG TEST
 *  1. Mọi so sánh phải quy về ĐƠN VỊ CƠ SỞ. Bán 1 thùng (12 hộp) mà tồn
 *     10 hộp là vượt tồn, dù "1 < 10".
 *  2. Nhiều dòng CÙNG sản phẩm phải cộng dồn nhu cầu. Tồn 10, hai dòng mỗi
 *     dòng 6 → từng dòng nhìn riêng đều hợp lệ, nhưng tổng 12 > 10.
 *  3. Hàng ĐỔI cũng xuất kho như hàng bán nên phải tính vào nhu cầu; hàng
 *     trả thường thì ngược lại (nhập kho) nên không tính.
 */

export interface StockCheckProduct {
  id: string
  base_unit: string
  units?: Array<{ unit_name: string; conversion: number }> | null
}

export interface StockCheckLine {
  product_id: string
  unit_name: string
  quantity: number
}

export interface StockCheckReturnLine extends StockCheckLine {
  is_exchange: boolean
}

/**
 * Quy số lượng của một dòng về đơn vị cơ sở.
 *
 * Không tìm thấy sản phẩm hoặc không tìm thấy hệ số quy đổi thì giữ nguyên
 * số lượng (hệ số 1). Đây là lựa chọn CÓ CHỦ ĐÍCH: thà cảnh báo hụt còn hơn
 * nhân với một hệ số đoán mò rồi chặn nhầm đơn hợp lệ.
 */
export function toBaseQty(
  line: StockCheckLine,
  products: StockCheckProduct[]
): number {
  const product = products.find((p) => p.id === line.product_id)
  if (!product) return line.quantity
  if (line.unit_name === product.base_unit) return line.quantity
  const u = product.units?.find((x) => x.unit_name === line.unit_name)
  return line.quantity * (u?.conversion || 1)
}

/** Tổng nhu cầu theo sản phẩm (đơn vị cơ sở) của các dòng bán. */
export function saleDemandByProduct(
  lines: StockCheckLine[],
  products: StockCheckProduct[]
): Record<string, number> {
  const m: Record<string, number> = {}
  for (const l of lines) {
    m[l.product_id] = (m[l.product_id] || 0) + toBaseQty(l, products)
  }
  return m
}

/** Như trên nhưng CHỈ tính dòng trả có đánh dấu đổi hàng. */
export function exchangeDemandByProduct(
  returnLines: StockCheckReturnLine[],
  products: StockCheckProduct[]
): Record<string, number> {
  const m: Record<string, number> = {}
  for (const l of returnLines) {
    if (!l.is_exchange) continue
    m[l.product_id] = (m[l.product_id] || 0) + toBaseQty(l, products)
  }
  return m
}

/**
 * Tồn còn lại cho MỘT dòng bán = tồn kho trừ đi nhu cầu của các dòng bán
 * KHÁC cùng sản phẩm.
 *
 * Cố ý không trừ nhu cầu hàng đổi ở đây: nếu trừ, một dòng bán vốn hợp lệ
 * sẽ bỗng nhiên bị tô đỏ chỉ vì người dùng thêm dòng đổi ở phía dưới. Lỗi
 * nên "đổ" vào đúng dòng vừa thêm.
 */
export function availableForSaleLine(
  index: number,
  lines: StockCheckLine[],
  products: StockCheckProduct[],
  stockByProduct: Record<string, number>
): number {
  const line = lines[index]
  const onHand = stockByProduct[line.product_id] ?? 0
  const otherSale = lines.reduce((sum, l, i) => {
    if (i === index) return sum
    if (l.product_id !== line.product_id) return sum
    return sum + toBaseQty(l, products)
  }, 0)
  return onHand - otherSale
}

/** Dòng bán này có vượt tồn không. */
export function isSaleLineOverstock(
  index: number,
  lines: StockCheckLine[],
  products: StockCheckProduct[],
  stockByProduct: Record<string, number>
): boolean {
  return (
    toBaseQty(lines[index], products) >
    availableForSaleLine(index, lines, products, stockByProduct)
  )
}

/**
 * Tồn còn lại cho một dòng ĐỔI = tồn kho trừ TOÀN BỘ nhu cầu bán, trừ tiếp
 * các dòng đổi khác cùng sản phẩm. Dòng trả thường không xuất kho nên không
 * tính vào đây.
 */
export function availableForExchangeLine(
  index: number,
  returnLines: StockCheckReturnLine[],
  lines: StockCheckLine[],
  products: StockCheckProduct[],
  stockByProduct: Record<string, number>
): number {
  const line = returnLines[index]
  const onHand = stockByProduct[line.product_id] ?? 0
  const saleUsed = saleDemandByProduct(lines, products)[line.product_id] || 0
  const otherExchange = returnLines.reduce((sum, l, i) => {
    if (i === index) return sum
    if (!l.is_exchange) return sum
    if (l.product_id !== line.product_id) return sum
    return sum + toBaseQty(l, products)
  }, 0)
  return onHand - saleUsed - otherExchange
}

/** Dòng trả này có vượt tồn không (chỉ áp dụng cho dòng đổi hàng). */
export function isReturnLineOverstock(
  index: number,
  returnLines: StockCheckReturnLine[],
  lines: StockCheckLine[],
  products: StockCheckProduct[],
  stockByProduct: Record<string, number>
): boolean {
  const line = returnLines[index]
  if (!line.is_exchange) return false
  return (
    toBaseQty(line, products) >
    availableForExchangeLine(index, returnLines, lines, products, stockByProduct)
  )
}

/**
 * Kiểm tổng thể: có sản phẩm nào mà TỔNG nhu cầu (bán + đổi) vượt tồn không.
 *
 * Đây mới là điều kiện dùng để CHẶN LƯU đơn. Kiểm từng dòng ở trên chỉ để
 * tô đỏ đúng chỗ cho người dùng thấy. Ví dụ: tồn 10, bán 9, đổi 2 → từng
 * dòng đều "gần đủ" nhưng tổng 11 > 10 → phải chặn.
 */
export function hasOverstock(
  lines: StockCheckLine[],
  returnLines: StockCheckReturnLine[],
  products: StockCheckProduct[],
  stockByProduct: Record<string, number>
): boolean {
  const sale = saleDemandByProduct(lines, products)
  const exchange = exchangeDemandByProduct(returnLines, products)
  const pids = Array.from(new Set<string>([...Object.keys(sale), ...Object.keys(exchange)]))
  for (const pid of pids) {
    if ((sale[pid] || 0) + (exchange[pid] || 0) > (stockByProduct[pid] ?? 0)) {
      return true
    }
  }
  return false
}
