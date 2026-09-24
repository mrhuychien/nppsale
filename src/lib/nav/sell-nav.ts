/**
 * Đi lại giữa các màn của luồng bán hàng.
 *
 * ⚠ VÌ SAO PHẢI CÓ FILE NÀY. Luồng bán hàng là NHIỀU TRANG thật, nên nút
 * back của điện thoại đi theo ngăn xếp lịch sử. Mỗi lần một màn `push` một
 * địa chỉ mà lẽ ra phải `replace` là ngăn xếp mọc thêm một tầng thừa, và
 * người dùng bấm back rơi vào đúng màn vừa thoát ra.
 *
 * ⚠ LỖI NGƯỜI DÙNG BÁO: "màn hàng trả về trong đơn — ấn xong, về đơn hàng
 * thì lại ra phần chọn hàng trả". Ngăn xếp lúc đó là
 *
 *     giỏ hàng → phiếu trả → chọn hàng trả → phiếu trả
 *
 * vì màn chọn hàng `push` một bản phiếu trả THỨ HAI thay vì thay chính nó.
 * Nút "Xong · về đơn hàng" gọi `router.back()`, và tầng ngay dưới không
 * phải giỏ hàng mà là màn chọn hàng. Người dùng bấm Xong và rơi ngược vào
 * chỗ vừa thoát ra — bấm mãi không ra khỏi vòng.
 */

/** Router tối thiểu — đủ để kiểm thử mà không cần dựng Next. */
export interface SellRouter {
  back: () => void
  replace: (href: string) => void
}

/** Màn soạn đơn. Đây là "đơn hàng" mà các nút Xong đang nói tới. */
export const SELL_ORDER_HREF = "/sell/cart"
/** Phiếu hàng trả / đổi của đơn đang soạn. */
export const SELL_RETURNS_HREF = "/sell/returns"

/**
 * Từ màn chọn hàng trả quay về phiếu trả.
 *
 * ⚠ `replace`, KHÔNG `push`. Màn chọn hàng được mở TỪ phiếu trả, nên quay
 * về nó là ĐÓNG màn chọn hàng chứ không phải mở thêm một màn nữa.
 */
export function backToReturnSlip(router: SellRouter): void {
  router.replace(SELL_RETURNS_HREF)
}

/**
 * Từ phiếu trả về đơn hàng.
 *
 * Phiếu trả chỉ mở được từ giỏ hàng, nên `back()` vừa đúng đích vừa giữ
 * ngăn xếp sạch — không để lại một tầng giỏ hàng trùng.
 *
 * ⚠ Trừ khi KHÔNG CÓ GÌ ĐỂ LÙI: mở thẳng bằng đường dẫn, hoặc vừa tải lại
 * trang. Lúc đó `back()` đưa người dùng ra khỏi hẳn ứng dụng — mà nút thì
 * ghi "về đơn hàng". Nút hứa một nơi thì phải tới đúng nơi đó.
 */
export function backToOrder(router: SellRouter): void {
  const canGoBack = typeof window !== "undefined" && window.history.length > 1
  if (canGoBack) router.back()
  else router.replace(SELL_ORDER_HREF)
}

/** Trang chủ — đích của nút lùi ở màn Đơn hàng. */
export const HOME_HREF = "/home"

/**
 * Nút lùi (‹) ở màn Đơn hàng.
 *
 * ⚠ CHỦ NHÀ 24/09/2026: "từ Đơn hàng ấn nút back < thì lại quay về thêm hàng.
 *   Đơn hàng quay lại thì ra Trang chủ chứ". Bản cũ `push("/sell")` — mở lại màn
 *   Thêm hàng, và nút lùi ở đó lại về đơn: một vòng không ra được.
 *   · Đơn MỚI → Trang chủ (`replace`: không chồng thêm tầng). Giỏ vẫn giữ
 *     trong máy — lần sau bấm "Tạo đơn" là soạn tiếp.
 *   · Đang SỬA một đơn có sẵn → về đúng chỗ đã mở nó (chi tiết / danh sách);
 *     không có gì để lùi thì về Trang chủ.
 */
export function backFromOrder(router: SellRouter, dangSua: boolean): void {
  const canGoBack = typeof window !== "undefined" && window.history.length > 1
  if (dangSua && canGoBack) router.back()
  else router.replace(HOME_HREF)
}
