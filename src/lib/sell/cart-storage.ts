/**
 * Khoá lưu giỏ bán hàng trong `localStorage` — MỘT chỗ khai báo.
 *
 * Tách khỏi `use-sell-cart` để phần xoá đơn (`lib/orders/delete`) dọn được
 * giỏ mà không phải kéo cả hook React vào.
 */
export const SELL_CART_STORAGE_KEY = "npp.sell.cart.v1"

/**
 * Quên giỏ đang SỬA đúng đơn vừa bị xoá.
 *
 * ⚠ XOÁ ĐƠN MÀ GIỎ VẪN GIỮ `editing.orderId` là để lại một cái bẫy: lần
 *   bấm Lưu kế tiếp ghi vào một đơn không còn tồn tại — đã đo:
 *   `new row violates row-level security policy for table
 *   "sales_order_lines"`, và người dùng đọc ra là "không có quyền".
 *   Màn Đơn tạm và màn chi tiết đơn đều xoá được đơn, nhưng chỉ màn giỏ
 *   là từng dọn giỏ.
 *
 * @returns true khi đã dọn.
 */
export function quenGioSuaDon(orderId: string, store: Pick<Storage, "getItem" | "removeItem"> | null = coStorage()): boolean {
  if (!store) return false
  try {
    const raw = store.getItem(SELL_CART_STORAGE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as { editing?: { orderId?: string } | null }
    if (saved?.editing?.orderId !== orderId) return false
    store.removeItem(SELL_CART_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

function coStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null
  } catch {
    return null
  }
}
