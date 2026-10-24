/**
 * MÀN POS NÀO CẦN SỔ KHÁCH (chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → rà soát: POS nhập hàng kéo cả sổ
 * khách ≈1 MB dù màn chỉ làm với NCC).
 *
 * Nhập hàng (`/pos/nhap-hang/…`) và trả NCC (`/pos/tra-ncc/…`) không chọn khách — không tải. Mọi lối khác (đơn, hoá
 * đơn, trả hàng khách, trang `/pos` chưa rõ loại) thì tải. Đang ở màn NCC mà mở thêm tab đơn / hoá đơn thì provider
 * tải riêng khách lúc ấy (`loadSellCustomers`).
 */
export function canKhachPos(pathname: string | null | undefined): boolean {
  return !/^\/pos\/(nhap-hang|tra-ncc)(\/|$)/.test(pathname ?? "")
}
