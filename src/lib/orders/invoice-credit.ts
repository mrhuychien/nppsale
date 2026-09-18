/**
 * KHOẢN TRỪ HÀNG TRẢ TRÊN MỘT HÓA ĐƠN.
 *
 * ⚠ HÓA ĐƠN KHÔNG BỊ SỬA SỐ. Tờ hóa đơn là chứng từ của lô hàng ĐÃ GIAO;
 * hàng trả là một việc xảy ra sau đó. `_wf2b_recompute_receivable` giữ
 * đúng như vậy — nó để `sales_invoices.total` nguyên vẹn và chỉ tính
 *
 *     nợ phải thu = tổng hóa đơn − tổng phiếu trả ĐÃ HOÀN THÀNH
 *
 * Nên con số "còn phải thu" dưới đây là thứ SUY RA để hiện, không phải
 * một cột trong sổ. Ghi đè nó vào `total` là sửa một chứng từ đã phát
 * hành, và lệch với hóa đơn điện tử đã gửi cơ quan thuế.
 *
 * ⚠ CHỈ PHIẾU ĐÃ HOÀN THÀNH MỚI TRỪ. Phiếu còn nháp / đã gửi thì hàng
 * chưa về kho và công nợ chưa đổi — hiện nó như một khoản đã trừ là báo
 * cho kế toán một con số chưa có thật.
 */

export interface InvoiceReturnRow {
  id: string
  status: string
  credit_note_amount: number | null
  created_at?: string | null
  reason?: string | null
}

/** Tổng khoản trừ của các phiếu trả ĐÃ HOÀN THÀNH. */
export function creditOnInvoice(returns: readonly InvoiceReturnRow[]): number {
  return returns
    .filter((r) => r.status === "completed")
    .reduce((s, r) => s + Math.max(0, Number(r.credit_note_amount || 0)), 0)
}

/**
 * Còn phải thu = tổng hóa đơn − khoản trừ, KẸP VỀ 0.
 *
 * ⚠ KẸP LÀ BẮT BUỘC, và phải kẹp GIỐNG HỆT RPC. Khách trả nhiều hơn giá
 * trị hóa đơn thì `_wf2b_recompute_receivable` ghi `GREATEST(0, …)` —
 * màn hình hiện số âm là nói khác sổ, và người đọc tưởng nhà phân phối
 * đang nợ ngược khách trên chính tờ hóa đơn này.
 */
export function netDueOnInvoice(total: number, credit: number): number {
  return Math.max(0, Number(total || 0) - Number(credit || 0))
}

/**
 * Bản IN có được hiện khoản trừ không.
 *
 * ⚠ ĐÃ PHÁT HÀNH HÓA ĐƠN ĐIỆN TỬ THÌ KHÔNG. Tờ in khi đó phải khớp từng
 * con số với tờ đã gửi cơ quan thuế; thêm một dòng trừ là hai tờ cùng
 * một số hóa đơn mang hai con số khác nhau. Chủ nhà đã chốt hiện trên
 * bản in, nhưng chốt đó dừng lại ở đây.
 *
 * ⚠ KHÔNG CÓ KHOẢN TRỪ THÌ CŨNG KHÔNG. In "Trừ hàng trả: 0" là thêm một
 * dòng không nói gì vào một tờ giấy vốn đã chật.
 */
export function showCreditOnPrint(opts: {
  credit: number
  eInvoiceIssued: boolean
}): boolean {
  return opts.credit > 0 && !opts.eInvoiceIssued
}
