/**
 * Màn nào được có thanh nav dưới màn hình.
 *
 * ⚠ LỖI NGƯỜI DÙNG BÁO. Màn giỏ hàng có thanh hành động dính đáy của
 * riêng nó ("Lưu tạm" / "Đặt hàng"), mà thanh nav cũng dính đáy và nằm
 * TRÊN nó. Kết quả: hai nút quan trọng nhất của cả luồng bị che mất một
 * nửa, người dùng cuộn kiểu gì cũng không thấy — vì cả hai đều `fixed`,
 * cuộn không làm chúng nhúc nhích.
 *
 * Hai thanh dính đáy chồng nhau là lỗi BỐ CỤC, không phải lỗi đệm: thêm
 * padding chỉ đẩy nội dung, không đẩy được một khối `fixed`.
 *
 * CÁCH XỬ: màn nào đang trong một luồng dở dang và có hành động chính của
 * riêng nó thì KHÔNG hiện nav. Người dùng vẫn có nút quay lại ở góc trái,
 * và đỡ bấm nhầm sang tab khác lúc đang soạn đơn.
 */

/**
 * Các màn tự dựng thanh hành động dính đáy.
 *
 * ⚠ So theo tiền tố đường dẫn. Thêm màn mới có thanh dính đáy mà quên ghi
 * vào đây thì nút của nó bị che — phép kiểm trong `tests/` quét thư mục
 * route và bắt đúng chuyện đó.
 */
export const OWN_ACTION_BAR_ROUTES = [
  "/sell/cart",
  "/sell/terms",
  "/sell/returns",
  "/sell/scan",
  /* Phiếu nhập hàng / trả hàng NCC trên điện thoại (chủ nhà 30/09/2026) — thanh đáy riêng. */
  "/purchasing/receipts/new",
  "/purchase-returns/new",
  /* Lập phiếu trả hàng của khách trên điện thoại kiểu /sell (chủ nhà 07/10/2026) — thanh đáy riêng. */
  "/returns/new",
  /* Nhập kho / kiểm kê trên điện thoại theo bản thiết kế 30/09/2026 — thanh đáy riêng. */
  "/inventory/stock-in",
  "/inventory/stocktake-adjust",
  /* Thêm khách hàng trên điện thoại (thiết kế 01/10/2026) — thanh đáy Huỷ / Lưu riêng. */
  "/customers/new",
  /* Soạn hàng trên điện thoại theo mẫu 02/10/2026 — thanh đáy riêng (Bắt đầu nhặt / Đã nhặt đủ…). */
  "/inventory/soan-hang",
] as const

/**
 * Màn luồng tác vụ theo bản thiết kế /sell mới (chủ nhà 24/09/2026: "Ẩn tab bar:
 * đây là luồng tác vụ, có nút back rõ ràng") — so ĐÚNG đường dẫn, không tiền tố:
 * `/sell/drafts`, `/sell/done` vẫn có thanh nav.
 */
export const TASK_FLOW_ROUTES = ["/sell", "/sell/customer"] as const

/**
 * Màn SỬA phiếu nhập / phiếu trả NCC — cùng khung `PhieuNccMobile` với màn tạo (chủ nhà 05/10/2026: "sửa phiếu nhập
 * hàng ncc chưa quay về giống phần tạo phiếu") nên cũng có thanh đáy + đầu màn riêng. Đường dẫn có mã phiếu ở giữa
 * nên không ghi được vào danh sách tiền tố bên trên.
 */
export function laSuaPhieuNcc(pathname: string): boolean {
  return /^\/(purchasing\/receipts|purchase-returns)\/[^/]+\/edit$/.test(pathname)
}

export function showsBottomNav(pathname: string): boolean {
  if ((TASK_FLOW_ROUTES as readonly string[]).includes(pathname)) return false
  if (laSuaPhieuNcc(pathname)) return false
  return !OWN_ACTION_BAR_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))
}

/**
 * Màn tự dựng ĐẦU TRANG riêng trên điện thoại (nút lùi + mã đơn + huy hiệu
 * trạng thái, theo mẫu thiết kế "Chi tiết đơn"). Để app bar chuẩn chồng
 * lên là hai hàng tiêu đề cho một màn — đúng lỗi mà /home và /sell đã
 * tránh. Desktop vẫn có app bar: ở đó bố cục hai cột cần nó.
 */
/**
 * Danh sách dựng đầu trang xanh theo mẫu màn Đơn hàng qua `DocListLayout mobileHead` (chủ nhà
 * 30/09/2026: "viết lại tất cả các trang danh sách chưa theo phong cách trang Đơn hàng"). So ĐÚNG
 * đường dẫn — trang con (chi tiết, tạo mới) vẫn có app bar.
 */
export const DOC_LIST_MOBILE_ROUTES = [
  "/commissions/policies",
  "/finance/cash-receipts",
  "/finance/expenses",
  "/inventory/batches",
  "/invoices",
  "/payables",
  "/promotions",
  "/purchase-returns",
  "/purchasing/invoices",
  "/purchasing/receipts",
  "/receivables",
] as const

export const DAU_TRANG_RIENG_ROUTES = [
  "/dashboard",
  "/products",
  "/inventory/stock-in",
  "/inventory/stocktake-adjust",
  "/inventory/adjustments",
  "/inventory",
  "/inventory/entries",
  "/settings/users",
  "/suppliers",
  "/customers/new",
  "/inventory/soan-hang",
] as const

export function hidesMobileAppBar(pathname: string): boolean {
  if ((DOC_LIST_MOBILE_ROUTES as readonly string[]).includes(pathname)) return true
  /* Màn điện thoại theo 8 bản thiết kế chủ nhà gửi 30/09/2026 — tự dựng đầu trang (`DauTrangXanh` /
     `DauTrangTrang`, src/components/mobile/dau-trang.tsx). */
  if ((DAU_TRANG_RIENG_ROUTES as readonly string[]).includes(pathname)) return true
  /* Chi tiết phiếu kho (/inventory/entries/<id>) — đầu trắng riêng. */
  if (/^\/inventory\/entries\/[^/]+$/.test(pathname)) return true
  /* "/orders", "/customers": danh sách trên điện thoại có đầu trang xanh riêng (mẫu 26/09/2026). */
  /* "/bao-cao/*": Báo cáo tổng hợp có đầu trang xanh + ☰ menu 6 màn riêng (thiết kế 26/09/2026). */
  return (
    pathname === "/orders" ||
    pathname === "/customers" ||
    /* "/returns": danh sách trả hàng trên điện thoại theo mẫu 27/09/2026 — đầu trang xanh riêng. */
    pathname === "/returns" ||
    /* "/sales-invoices": hoá đơn bán trên điện thoại theo mẫu Đơn hàng (27/09/2026). */
    pathname === "/sales-invoices" ||
    /^\/orders\/[^/]+$/.test(pathname) ||
    /* Phiếu nhập hàng / trả hàng NCC di động có đầu màn riêng như /sell (chủ nhà 30/09/2026). */
    pathname === "/purchasing/receipts/new" ||
    pathname === "/purchase-returns/new" ||
    /* Lập phiếu trả hàng của khách — đầu màn riêng như /sell (chủ nhà 07/10/2026). */
    pathname === "/returns/new" ||
    laSuaPhieuNcc(pathname) ||
    pathname === "/bao-cao" ||
    pathname.startsWith("/bao-cao/")
  )
}

/**
 * Trang danh sách / trang gốc của một mục (không phải chi tiết hay form nhập) — chủ nhà 30/09/2026:
 * "Các trang danh sách khi NPP truy cập mobile phải có menu 3 gạch". Ô trái app bar của những trang
 * này là ☰ (không phải ←) với khối văn phòng.
 * Chi tiết / form = có đoạn là mã id (uuid) hoặc kết thúc bằng /new, /edit, /print.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function laTrangDanhSach(pathname: string): boolean {
  const doan = pathname.split("/").filter(Boolean)
  if (doan.length === 0) return false
  if (doan.some((d) => UUID.test(d))) return false
  return !["new", "edit", "print"].includes(doan[doan.length - 1])
}
