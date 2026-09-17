import type { OfflineOrderLine, OfflineOrderPayload } from "@/lib/orders/create"
import type { CartLine, CartTotals } from "@/lib/sell/cart"
import { toReturnLine, type ReturnCartLine } from "@/lib/sell/returns"

/**
 * Dựng gói đơn hàng từ giỏ.
 *
 * VÌ SAO ĐI QUA ĐÚNG MỘT GÓI
 *   `OfflineOrderPayload` vốn sinh ra cho hàng đợi ngoại tuyến, và
 *   `createOrderRecords` biết cách ghi nó xuống DB một cách BẤT BIẾN theo
 *   `client_request_id` — gọi lại không tạo đơn trùng.
 *
 *   Nên luồng bán hàng mới dùng chung đúng gói đó cho cả hai đường: có
 *   mạng thì ghi thẳng, không mạng thì xếp hàng. Một dạng dữ liệu, một
 *   phép ghi, và đường ngoại tuyến không còn là nhánh ít ai chạy tới —
 *   nó là chính đường kia, chỉ hoãn lại.
 */
export interface BuildPayloadInput {
  /** Khoá BẤT BIẾN sinh TRƯỚC khi gửi. Gửi lại vẫn là một đơn. */
  clientRequestId: string
  orderCode: string
  customerId: string
  customerName: string
  paymentTerms: string
  expectedDelivery: string | null
  notes: string
  cart: CartLine[]
  totals: CartTotals
  /** ISO. Truyền vào chứ không gọi `new Date()` bên trong — để test được. */
  createdAt: string
  returnReason: string
  returnLines: ReturnCartLine[]
}

/**
 * Chiết khấu của MỘT dòng, tính bằng tiền.
 *
 * ⚠ Chỉ nhận phần GIẢM. Nhân viên được nâng giá trong hạn mức, và một
 * dòng "chiết khấu âm" ghi xuống sổ kế toán thì không ai đối chiếu nổi.
 */
export function lineDiscountOf(line: CartLine): number {
  return Math.max(0, Math.round(line.qty * (line.listPrice - line.price)))
}

export function toOrderLine(line: CartLine): OfflineOrderLine {
  const note = line.note?.trim()
  return {
    product_id: line.productId,
    unit_name: line.unit,
    quantity: line.qty,
    unit_price: line.price,
    line_discount: lineDiscountOf(line),
    line_total: Math.round(line.qty * line.price),
    // ⚠ Chốt hệ số quy đổi NGAY LÚC NÀY. Đơn nằm trong hàng đợi vài giờ
    // rồi mới đẩy lên; nếu lúc đó mới tra lại hệ số mà ai đó vừa sửa quy
    // cách đóng gói thì số lượng xuất kho lệch, không ai biết vì sao.
    conversion_factor: line.conversion || 1,
    ...(note ? { note } : {}),
  }
}

export function buildOrderPayload(i: BuildPayloadInput): OfflineOrderPayload {
  return {
    clientRequestId: i.clientRequestId,
    order: {
      order_code: i.orderCode,
      customer_id: i.customerId,
      payment_terms: i.paymentTerms,
      expected_delivery: i.expectedDelivery || null,
      // `subtotal` là số SAU chiết khấu và TRƯỚC thuế — đúng nghĩa cột
      // trong `sales_orders`, và là nền để quy tắc chiết khấu sâu chạy.
      subtotal: i.totals.subtotal,
      vat: i.totals.vat,
      total: i.totals.grandTotal,
      notes: i.notes.trim() || null,
    },
    lines: i.cart.map(toOrderLine),
    // ⚠ Không có dòng trả thì KHÔNG tạo phiếu trả rỗng. Một phiếu trả 0
    // dòng vẫn hiện ở màn /returns chờ quản lý duyệt, và không ai biết
    // phải duyệt cái gì.
    returns: i.returnLines.length ? { reason: i.returnReason, notes: null } : null,
    returnLines: i.returnLines.map(toReturnLine),
    meta: {
      customerName: i.customerName,
      total: i.totals.grandTotal,
      createdAt: i.createdAt,
      lineCount: i.cart.length,
    },
  }
}

/**
 * Giá trị hàng TRƯỚC chiết khấu, chưa thuế.
 *
 * Quy tắc duyệt cần con số này riêng: mọi ngưỡng đều xét tổng SAU chiết
 * khấu, nên chiết khấu 100% làm đơn tụt xuống dưới ngưỡng và TỰ ĐỘNG
 * DUYỆT — cho không hàng mà không ai được hỏi.
 */
export function grossBeforeDiscountOf(cart: CartLine[]): number {
  return Math.round(cart.reduce((s, l) => s + l.qty * l.listPrice, 0))
}
