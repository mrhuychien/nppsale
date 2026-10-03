/**
 * Tuyến bán hàng (`sales_routes`) — phần thuần dùng chung của màn Tuyến và khung tạo nhanh tuyến.
 */

/** Tuyến vừa tạo — đủ cho ô chọn tuyến (`channel` của khách lưu MÃ tuyến). */
export interface TuyenVuaTao {
  id: string
  code: string
  name: string
}

/**
 * Chữ đang gõ ở ô tìm tuyến → ô nào của tuyến mới được gán sẵn (chủ nhà 03/10/2026). Một từ ngắn không dấu,
 * không cách (VD "t5", "HORECA") là MÃ tuyến (viết hoa); còn lại ("Thứ Năm") là TÊN tuyến.
 */
export function chuBanDauTuyen(chu: string | null | undefined): { code: string; name: string } {
  const t = String(chu ?? "").trim()
  if (/^[A-Za-z0-9_-]{1,12}$/.test(t)) return { code: t.toUpperCase(), name: "" }
  return { code: "", name: t }
}
