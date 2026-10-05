/**
 * NCC ĐI KÈM ĐƯỜNG DẪN — chủ nhà 05/10/2026 ("Có"): nút "Tạo phiếu nhập" / "Trả hàng NCC" ở chi tiết NCC mở màn
 * lập phiếu với NCC ấy chọn sẵn. Điện thoại: `/purchasing/receipts/new?ncc=<id>` · `/purchase-returns/new?ncc=<id>`;
 * máy tính: màn POS tương ứng (`posNewPurchaseHref(id)` / `posNewSupplierReturnHref(id)`) — cùng tham số.
 *
 * ⚠ Chỉ chọn sẵn khi NCC có trong danh sách đã nạp (NCC đang hợp tác). NCC ngừng hợp tác / id lạ → để trống, người
 *   dùng chọn tay như cũ — không dựng một NCC ma mà ô chọn không có.
 */
export const THAM_SO_NCC = "ncc"

const kem = (duong: string, nccId?: string | null) => {
  const id = (nccId ?? "").trim()
  return id ? `${duong}?${THAM_SO_NCC}=${encodeURIComponent(id)}` : duong
}

export const hrefPhieuNhapMoi = (nccId?: string | null) => kem("/purchasing/receipts/new", nccId)
export const hrefTraNccMoi = (nccId?: string | null) => kem("/purchase-returns/new", nccId)

/** id NCC từ tham số nếu nó có trong danh sách đã nạp; còn lại `""`. */
export function nccTuLink(raw: string | null | undefined, ds: ReadonlyArray<{ id: string }>): string {
  const id = (raw ?? "").trim()
  return id && ds.some((s) => s.id === id) ? id : ""
}
