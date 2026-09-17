import type { OfflineReturnLine } from "@/lib/orders/create"

/**
 * Hàng trả / đổi đi kèm một đơn bán.
 *
 * HAI LOẠI DÒNG, KHÁC NHAU Ở CHỖ TIỀN
 *   · TRẢ TIỀN: hàng nhập lại kho, và tiền hàng TRỪ vào đơn này.
 *   · ĐỔI HÀNG: hàng nhập lại kho, nhưng KHÔNG trừ tiền — khách đã lấy
 *     hàng khác thay thế, và hàng thay thế đó nằm trong phần bán.
 *
 * ⚠ Nhầm hai loại là sai tiền theo cả hai chiều: coi dòng đổi là trả thì
 * bớt tiền hai lần, coi dòng trả là đổi thì khách trả tiền cho hàng đã
 * đưa lại.
 */
export interface ReturnCartLine {
  productId: string
  unit: string
  qty: number
  /** Đơn giá dùng để quy ra tiền trả. */
  price: number
  vatRate: number
  isExchange: boolean
  note: string
}

export const RETURN_REASONS = [
  { value: "damaged", label: "Hư hỏng" },
  { value: "near_expiry", label: "Gần hết hạn" },
  { value: "wrong_item", label: "Sai hàng" },
  { value: "refused", label: "Từ chối nhận" },
] as const

export function returnReasonLabel(value: string): string {
  return RETURN_REASONS.find((r) => r.value === value)?.label ?? value
}

/**
 * Tiền trừ vào đơn.
 *
 * ⚠ CHỈ CỘNG DÒNG TRẢ TIỀN. Dòng đổi hàng không trừ đồng nào — xem chú
 * thích đầu file.
 */
export function returnCreditOf(lines: ReturnCartLine[]): number {
  return Math.round(
    lines.filter((l) => !l.isExchange).reduce((s, l) => s + l.qty * l.price * (1 + (l.vatRate || 0)), 0)
  )
}

export function findReturnLine(lines: ReturnCartLine[], productId: string, unit: string): number {
  return lines.findIndex((l) => l.productId === productId && l.unit === unit)
}

/** Thêm dòng trả; trùng (sản phẩm + đơn vị) thì cộng dồn, giữ nguyên chỗ. */
export function addReturnLine(lines: ReturnCartLine[], line: ReturnCartLine): ReturnCartLine[] {
  const i = findReturnLine(lines, line.productId, line.unit)
  if (i >= 0) {
    const next = [...lines]
    next[i] = { ...next[i], qty: next[i].qty + line.qty }
    return next
  }
  return [line, ...lines]
}

export function setReturnQty(
  lines: ReturnCartLine[],
  index: number,
  qty: number
): ReturnCartLine[] {
  if (index < 0 || index >= lines.length) return lines
  if (qty <= 0) return lines.filter((_, i) => i !== index)
  const next = [...lines]
  next[index] = { ...next[index], qty }
  return next
}

export function patchReturnLine(
  lines: ReturnCartLine[],
  index: number,
  patch: Partial<ReturnCartLine>
): ReturnCartLine[] {
  if (index < 0 || index >= lines.length) return lines
  const next = [...lines]
  next[index] = { ...next[index], ...patch }
  return next
}

/**
 * Chuyển sang dạng lưu xuống DB.
 *
 * ⚠ LUÔN gửi `is_exchange`, kể cả khi `false`. PostgREST suy ra danh sách
 * cột từ DÒNG ĐẦU TIÊN của mảng, nên một dòng có cột đó đứng sau các dòng
 * không có sẽ mất giá trị một cách lặng lẽ và mọi dòng đổi thành dòng trả
 * tiền — sai tiền mà không báo gì.
 */
export function toReturnLine(l: ReturnCartLine): OfflineReturnLine {
  const note = l.note?.trim()
  return {
    product_id: l.productId,
    unit_name: l.unit,
    quantity: l.qty,
    unit_price: l.price,
    vat_rate: l.vatRate || 0,
    line_total: Math.round(l.qty * l.price * (1 + (l.vatRate || 0))),
    is_exchange: l.isExchange,
    ...(note ? { note } : {}),
  }
}
