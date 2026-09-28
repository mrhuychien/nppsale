/**
 * SỬA HÓA ĐƠN KHI PHIẾU TRẢ THEO HÓA ĐƠN ĐÃ NHẬP KHO — chủ nhà 28/09/2026:
 *   "khi sửa hoá đơn có phiếu nhập kho đã hoàn thành -> hệ thống sẽ hỏi 'Cần huỷ
 *    phiếu nhập trước?' y/n -> yes -> huỷ phiếu nhập, trên hoá đơn sửa được tất cả
 *    thông tin, khi cập nhật -> cập nhật lại hết" · "No -> giữ nguyên phiếu nhập
 *    gắn vào hoá đơn mới."
 *
 * Máy chủ làm cả hai nhánh trong giao dịch `reissue_invoice` (mig 210, khoá
 * `tra_da_nhap` của tải trọng). Ở đây chỉ là luật để màn hình hỏi và mở khoá dòng.
 */

/** 'lam_lai' = Có (huỷ phiếu nhập, sửa, nhập lại cùng kho); 'giu' = Không. */
export type CheDoTraDaNhap = "lam_lai" | "giu"

export interface PhieuTraCuaDon {
  id: string
  status: string
  invoice_id: string | null
  credit_with_invoice?: boolean | null
}

/** Phiếu TỰ SINH đã nhập kho của đúng tờ đang sửa — đúng điều kiện máy chủ hỏi. */
export function laDaNhapTuSinh(r: PhieuTraCuaDon, invoiceId: string | null): boolean {
  return !!invoiceId && r.status === "completed" && r.invoice_id === invoiceId && r.credit_with_invoice === true
}

export function phieuDaNhapCuaHoaDon<T extends PhieuTraCuaDon>(rs: readonly T[], invoiceId: string | null): T[] {
  return rs.filter((r) => laDaNhapTuSinh(r, invoiceId))
}

/**
 * Dòng của phiếu này sửa được trên màn hóa đơn không — ĐÚNG điều kiện
 * `_apply_return_edits`, cộng phiếu đã nhập kho khi người dùng chọn "Có" (máy chủ
 * huỷ phiếu nhập trước khi áp phần sửa, phiếu về Chờ xử lý).
 */
export function traSuaDuoc(r: PhieuTraCuaDon, invoiceId: string | null, cheDo: CheDoTraDaNhap | null): boolean {
  const cho = (r.status === "draft" || r.status === "submitted") && (invoiceId ? r.invoice_id === invoiceId : r.invoice_id === null)
  return cho || (cheDo === "lam_lai" && laDaNhapTuSinh(r, invoiceId))
}
