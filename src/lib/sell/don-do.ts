/**
 * ĐƠN ĐANG LÀM DỞ ở /sell.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Màn sell mobile cho nhân viên bán hàng: Nếu có đơn đang làm dở
 *   khi vào làm đơn sẽ hiện modal hỏi: Bạn có đơn hàng đang làm dở. Bạn có muốn tiếp tục?
 *   Có / Không. Nếu không -> vào làm đơn trắng, nếu có -> làm tiếp đơn dở."
 */
export interface GioXet {
  cart: readonly unknown[]
  returnLines: readonly unknown[]
}

/** Giỏ còn hàng bán hoặc hàng trả = đơn đang làm dở (chỉ chọn khách thì chưa phải đơn). */
export const coDonDangLamDo = (g: GioXet): boolean => g.cart.length > 0 || g.returnLines.length > 0

/**
 * Vào luồng /sell ở trang này thì có hỏi không.
 * Không hỏi ở trang tự nạp đơn vào giỏ (sửa / đặt lại), trang xong đơn và danh sách nháp.
 */
export const hoiKhiVaoTrang = (pathname: string): boolean =>
  pathname.startsWith("/sell") && !/^\/sell\/(edit|reorder|done|drafts)(\/|$)/.test(pathname)
