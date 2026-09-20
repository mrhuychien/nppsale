/**
 * BA TRẠNG THÁI CỦA PHIẾU NHẬP HÀNG — và chỉ ba (chủ nhà chốt).
 *
 * ⚠ DANH SÁCH NÀY PHẢI PHỦ HẾT `purchase_invoices_status_chk`. Bài học
 * đắt của kho mã này: màn danh sách đơn hàng từng có SÁU trạng thái
 * nhưng chỉ BỐN tab, nên đơn `partially_invoiced` biến mất khỏi mọi
 * tab — chủ nhà báo "đơn hoàn thành xong thấy biến mất luôn". Có chốt
 * đối chiếu danh sách này với CHECK constraint thật trong
 * `tests/purchase-receipt-ui.test.ts`.
 */

export const RECEIPT_STATUS = ["draft", "completed", "cancelled"] as const
export type ReceiptStatus = (typeof RECEIPT_STATUS)[number]

const LABEL: Record<string, string> = {
  draft: "Phiếu tạm",
  completed: "Hoàn thành",
  cancelled: "Đã huỷ",
}

/**
 * ⚠ MÃ LẠ THÌ IN NGUYÊN MÃ, đừng in "—". Mã không có trong bảng nghĩa
 * là dữ liệu có thứ bảng nhãn chưa biết; giấu đi là giấu luôn manh mối.
 */
export function receiptStatusLabel(s: string | null | undefined): string {
  if (!s) return "—"
  return LABEL[s] ?? s
}

/**
 * Màu chấm của dải viên thuốc.
 *
 * ⚠ HỔ PHÁCH CHO "CÒN VIỆC", KHÔNG DÙNG ĐỎ CHO PHIẾU TẠM. Phiếu tạm là
 * trạng thái bình thường của một phiếu đang soạn; đỏ là dành cho lỗi.
 */
export function receiptStatusTone(s: string): string {
  if (s === "completed") return "#12b76a"
  if (s === "cancelled") return "#98a2b3"
  return "#d99b0d"
}
