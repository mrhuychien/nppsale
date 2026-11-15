/**
 * LỌC CHỨNG TỪ THEO SẢN PHẨM — chủ nhà 15/11/2026: "Thêm cho tao bộ lọc sản phẩm trong Đơn hàng/Hóa đơn/Trả hàng/Nhập
 * NCC/Trả NCC". Chọn một mặt hàng → danh sách chỉ còn chứng từ có ít nhất MỘT dòng mặt hàng ấy (kể cả dòng hàng đổi).
 *
 * ⚠ LỌC TRÊN MÁY CHỦ BẰNG BẢNG DÒNG NHÚNG `!inner`: `select=…,loc_sp:sales_order_lines!inner(product_id)` +
 *   `loc_sp.product_id=eq.<id>`. Một câu, không cần migration; danh sách, phân trang, `count=exact`, câu gộp `count()` /
 *   `<cột>.sum()` (mig 206 / 257) đều theo đúng bộ lọc — đo trên PostgREST 12 thật 15/11/2026. Đừng đổi sang "tra id
 *   chứng từ có mặt hàng rồi `id=in.(…)`": mặt hàng bán chạy nằm trong hàng nghìn tờ, danh sách id vượt trần URL, bộ lọc
 *   phải cắt ngầm (như ô tìm "Theo mã, tên hàng" — `useFieldSearch` có ngân sách + cảnh báo thiếu).
 * ⚠ BẢNG NHÚNG PHẢI CÓ TRONG `select` CỦA MỌI CÂU MANG ĐIỀU KIỆN LỌC — thiếu là PostgREST trả 400 PGRST108 ("'loc_sp' is not
 *   an embedded resource in this request"): danh sách báo lỗi, tổng tiền / số đếm lùi về cách cũ rồi hỏng nốt. Hai hàm
 *   đi đôi: `kemLocSp` cho chuỗi `select`, `apLocSp` trong hàm lọc chung của màn.
 * ⚠ NHÚNG CÓ CỘT (`(product_id)`), KHÔNG NHÚNG RỖNG `!inner()`: nhúng rỗng đi cùng câu gộp là 400 (42703) trên PostgREST
 *   thật — như bảng khách của bộ lọc tuyến (`NHOM_TUYEN`). Câu gộp nhóm thêm theo mảng dòng nhúng; `docTongGop` /
 *   `docDemNhom` cộng dồn mọi nhóm nên số không đổi.
 */

/** Bảng chứng từ → bảng dòng hàng (khoá ngoại về `id` của chứng từ). View `v_hoa_don_con_lai` (mig 257) mang `id` của hoá đơn. */
export const BANG_DONG_LOC_SP = {
  sales_orders: "sales_order_lines",
  sales_invoices: "sales_invoice_lines",
  v_hoa_don_con_lai: "sales_invoice_lines",
  returns: "return_lines",
  purchase_invoices: "purchase_invoice_lines",
  supplier_returns: "supplier_return_lines",
} as const

export type BangLocSp = keyof typeof BANG_DONG_LOC_SP

/** Tên nhúng của bảng dòng trong câu — riêng, để không đụng nhúng có sẵn của màn (`lines`, `customer`…). */
export const NHUNG_LOC_SP = "loc_sp"

/** Mặt hàng đang lọc: id, hoặc trống / "all" = không lọc. */
export function spDangLoc(sp: string | null | undefined): string | null {
  return sp && sp !== "all" ? sp : null
}

/** Chuỗi `select` kèm bảng dòng nhúng khi đang lọc một mặt hàng; không lọc thì trả nguyên. */
export function kemLocSp(select: string, bang: BangLocSp, sp: string | null | undefined): string {
  const id = spDangLoc(sp)
  return id ? `${select}, ${NHUNG_LOC_SP}:${BANG_DONG_LOC_SP[bang]}!inner(product_id)` : select
}

/** Điều kiện lọc — chỉ đặt lên câu mà `select` đã đi qua `kemLocSp` với CÙNG mặt hàng. */
export function apLocSp<Q>(q: Q, sp: string | null | undefined): Q {
  const id = spDangLoc(sp)
  return id ? (q as unknown as { eq: (c: string, v: string) => Q }).eq(`${NHUNG_LOC_SP}.product_id`, id) : q
}
