import type { CartLine } from "@/lib/sell/cart"
import type { ReturnCartLine } from "@/lib/sell/returns"
import type { StockCheckLine, StockCheckReturnLine } from "@/lib/orders/stock-check"

/**
 * Nối giỏ hàng của màn bán hàng vào phép kiểm tồn dùng chung.
 *
 * ⚠ HÀNG ĐỔI CŨNG XUẤT KHO. Bản đầu của màn bán hàng chỉ cộng các dòng
 * BÁN rồi so với tồn — dòng "đổi hàng" bị bỏ qua hoàn toàn. Nhưng đổi hàng
 * là lấy hàng mới trong kho đưa cho khách; nó ăn tồn y như một dòng bán.
 * Tồn 10, bán 9, đổi 2 thì cả hai phần đều "gần đủ" mà tổng 11 > 10, và
 * thủ kho là người phát hiện ra lúc không còn hàng để lấy.
 *
 * Phép kiểm đầy đủ đã có sẵn ở `@/lib/orders/stock-check` (viết cho màn
 * tạo đơn cũ, có test riêng). Ở đây chỉ đổi hình dạng dữ liệu, KHÔNG viết
 * lại quy tắc — viết lại là mở đường cho hai bản lệch nhau.
 *
 * ⚠ Hệ số quy đổi tra theo DANH MỤC chứ không lấy `conversion` đã chốt
 * trong dòng giỏ, vì dòng TRẢ không mang hệ số nào cả. Hai số này chỉ khác
 * nhau khi mở lại một đơn cũ mà quy cách đóng gói đã đổi từ lúc tạo — lệch
 * ở đó là lệch một cảnh báo tồn, không phải lệch tiền.
 */
export function toStockLines(cart: CartLine[]): StockCheckLine[] {
  return cart.map((l) => ({
    product_id: l.productId,
    unit_name: l.unit,
    quantity: l.qty,
  }))
}

export function toStockReturnLines(lines: ReturnCartLine[]): StockCheckReturnLine[] {
  return lines.map((l) => ({
    product_id: l.productId,
    unit_name: l.unit,
    quantity: l.qty,
    is_exchange: l.isExchange,
  }))
}
