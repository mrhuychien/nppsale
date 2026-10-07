/**
 * PHIẾU TRẢ TỰ SINH (THEO HÓA ĐƠN) vs PHIẾU TRẢ NGƯỜI DÙNG TỰ LẬP — được làm gì.
 *
 * ⚠ CHỦ NHÀ 25/09/2026 (mig 191):
 *   · "Phiếu trả sinh ra tự động thì chỉ huỷ phiếu ko sửa được (muốn sửa thì sửa từ
 *     hoá đơn), khi huỷ phiếu -> quay lại trạng thái chờ xử lý."
 *   · "Phiếu trả do người dùng tạo -> sửa/huỷ được -> mọi thứ cập nhật theo."
 *   · "Lưu ý trạng thái Chờ xử lý chỉ có ở phiếu trả tự sinh."
 *   · Phiếu tự sinh đang Chờ xử lý: CHẶN huỷ — sửa từ hóa đơn.
 *
 * "Tự sinh" = `credit_with_invoice` (post_invoice gắn lúc xuất hóa đơn, công nợ đã trừ
 * vào hóa đơn). Nháp đi theo ĐƠN chưa xuất hóa đơn cũng thuộc đơn — sửa ở đơn.
 * Các luật này máy chủ cũng giữ (`cancel_return`, `save_pos_return`, trigger khoá).
 */
export interface PhieuTraXet {
  status: string
  credit_with_invoice?: boolean | null
  order_id?: string | null
  invoice_id?: string | null
}

export const laPhieuTuSinh = (r: PhieuTraXet): boolean => !!r.credit_with_invoice

/** Hàng trả nằm trong ĐƠN, chờ xuất hóa đơn — chưa phải phiếu độc lập. */
export const laNhapTheoDon = (r: PhieuTraXet): boolean =>
  !r.credit_with_invoice && r.status === "draft" && !!r.order_id && !r.invoice_id

export interface HanhDongPhieuTra {
  /** Bấm Hoàn thành (nhập kho; phiếu tự lập thì trừ nợ luôn). */
  hoanThanh: boolean
  /** "huy" = huỷ hẳn; "ve_cho" = huỷ nhập kho, phiếu về Chờ xử lý (tự sinh). */
  huy: false | "huy" | "ve_cho"
  /** Sửa dòng hàng / số tiền (POS, ô Credit Note). */
  sua: boolean
  /** Vì sao bị khoá — hiện cho người dùng thay vì giấu nút không lời. */
  lyDo: string | null
}

export const LY_DO_TU_SINH = "Phiếu trả tự sinh theo hóa đơn — muốn sửa hay bỏ hàng trả thì sửa hóa đơn."
export const LY_DO_THEO_DON = "Hàng trả đang đi theo đơn hàng, chờ xuất hóa đơn — sửa ở đơn hàng."

export const LY_DO_RONG = "Phiếu nháp không còn dòng hàng nào — huỷ để dọn khỏi danh sách."

/**
 * @param soDong số dòng hàng của phiếu, khi màn đã đọc. Phiếu TỰ SINH nháp RỖNG (bị bỏ hết
 *   dòng khi sửa hóa đơn) thì huỷ được — mig 213; bỏ trống = không biết, luật cũ.
 */
export function hanhDongPhieuTra(r: PhieuTraXet, soDong?: number): HanhDongPhieuTra {
  if (r.status === "cancelled") return { hoanThanh: false, huy: false, sua: false, lyDo: null }
  /* Chỉ phiếu TỰ SINH bị kẹt (luật cũ khoá mọi nút của nó); nháp tự lập đã huỷ / sửa được sẵn. */
  if (laPhieuTuSinh(r) && r.status === "draft" && soDong === 0) return { hoanThanh: false, huy: "huy", sua: false, lyDo: LY_DO_RONG }
  if (laPhieuTuSinh(r)) {
    if (r.status === "completed") return { hoanThanh: false, huy: "ve_cho", sua: false, lyDo: LY_DO_TU_SINH }
    return { hoanThanh: r.status === "submitted", huy: false, sua: false, lyDo: LY_DO_TU_SINH }
  }
  if (laNhapTheoDon(r)) return { hoanThanh: false, huy: false, sua: false, lyDo: LY_DO_THEO_DON }
  if (r.status === "completed") return { hoanThanh: false, huy: "huy", sua: true, lyDo: null }
  // Nháp (hoặc "Chờ xử lý" cũ của phiếu tự lập — mig 191 chuyển về Nháp).
  return { hoanThanh: true, huy: "huy", sua: true, lyDo: null }
}

/**
 * Nút "Sửa" của một phiếu trả mở đi đâu — MỘT chỗ cho cả xem nhanh lẫn trang chi tiết.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: phiếu TỰ SINH "Sửa - khi bấm vào nhảy ra sửa hoá đơn"; phiếu TỰ
 *   LẬP "Sửa khi bấm vào nhảy ra pos sửa phiếu". Hàng trả còn nằm trong ĐƠN chưa xuất →
 *   sửa đơn. Đã huỷ → không sửa (`null`).
 */
export function duongSuaPhieuTra(r: PhieuTraXet & { id: string }): { href: string; nhan: string } | null {
  if (r.status === "cancelled") return null
  if (laPhieuTuSinh(r)) return r.invoice_id ? { href: `/sales-invoices/${r.invoice_id}/edit`, nhan: "Sửa hóa đơn" } : null
  if (laNhapTheoDon(r)) return r.order_id ? { href: `/pos/don-hang/${r.order_id}`, nhan: "Sửa đơn" } : null
  return { href: `/pos/tra-hang/${r.id}`, nhan: "Sửa" }
}

/**
 * ĐỔI NGÀY CHỨNG TỪ (`return_date`) của phiếu trả — chủ nhà 08/10/2026: "phiếu tự sinh theo đơn đặt hàng tao cũng
 * muốn sửa được ngày tháng".
 * - Mọi phiếu chưa huỷ, kể cả phiếu TỰ SINH (các nút sửa hàng / tiền của nó vẫn khoá — sửa từ hóa đơn). Máy chủ cho
 *   ghi `return_date` (danh sách cột sửa được của `_khoa_ghi_thang_phieu_tra`, mig 227).
 * - ⚠ Phiếu tự sinh: công nợ và doanh số VẪN theo ngày hóa đơn (`_ngay_tru_doanh_so`, mig 192) — chỉ đổi ngày in trên
 *   phiếu / ngày nhóm ở danh sách. Phiếu tự lập đã hoàn thành: ngày trừ doanh số đi theo ngày phiếu (mig 188).
 * - Không cho ngày sau hôm nay (giờ VN).
 */
export function loiDoiNgayPhieuTra(r: PhieuTraXet, ngay: string, homNay: string): string | null {
  if (r.status === "cancelled") return "Phiếu đã huỷ — không đổi ngày."
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return "Chọn ngày phiếu."
  if (ngay > homNay) return "Ngày phiếu không được sau hôm nay."
  return null
}

/** Câu giải thích dưới ô đổi ngày — nói đúng ngày đổi ảnh hưởng tới đâu. */
export function giaiThichDoiNgay(r: PhieuTraXet): string {
  if (laPhieuTuSinh(r)) return "Phiếu tự sinh theo hóa đơn: công nợ và doanh số vẫn tính theo ngày hóa đơn — chỉ đổi ngày của phiếu."
  if (r.status === "completed") return "Ngày trừ doanh số và công nợ của phiếu đi theo ngày mới."
  return "Ngày chứng từ của phiếu trả."
}
