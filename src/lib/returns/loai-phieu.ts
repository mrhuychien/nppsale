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

export function hanhDongPhieuTra(r: PhieuTraXet): HanhDongPhieuTra {
  if (r.status === "cancelled") return { hoanThanh: false, huy: false, sua: false, lyDo: null }
  if (laPhieuTuSinh(r)) {
    if (r.status === "completed") return { hoanThanh: false, huy: "ve_cho", sua: false, lyDo: LY_DO_TU_SINH }
    return { hoanThanh: r.status === "submitted", huy: false, sua: false, lyDo: LY_DO_TU_SINH }
  }
  if (laNhapTheoDon(r)) return { hoanThanh: false, huy: false, sua: false, lyDo: LY_DO_THEO_DON }
  if (r.status === "completed") return { hoanThanh: false, huy: "huy", sua: true, lyDo: null }
  // Nháp (hoặc "Chờ xử lý" cũ của phiếu tự lập — mig 191 chuyển về Nháp).
  return { hoanThanh: true, huy: "huy", sua: true, lyDo: null }
}
