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
 * ⚠ HAI LUẬT TRỪ, KHÔNG PHẢI MỘT — và chúng là BẢN SAO CỦA SQL trong
 * `_wf2b_recompute_receivable` (mig 133). Lệch một chữ là màn hình nói
 * khác sổ:
 *
 *   · Phiếu ĐI CÙNG HÓA ĐƠN (`credit_with_invoice`, sinh ra từ đơn và
 *     được `post_invoice` gắn vào): trừ NGAY từ lúc phiếu ở 'submitted'.
 *     Hàng đã đổi tay lúc NVBH giao, khách đã trả tiền phần chênh — sổ
 *     phải đúng ngay lúc đó, không đợi thủ kho.
 *   · Phiếu ĐỘC LẬP: trừ khi 'completed', tức khi hàng thật sự về kho.
 *
 * ⚠ SỬA MỘT BÊN THÌ SỬA CẢ HAI. Xem `tests/invoice-credit.test.ts` —
 * có chốt đọc thẳng câu SQL của mig 133 để bắt lúc chúng trôi xa nhau.
 */

export interface InvoiceReturnRow {
  id: string
  status: string
  credit_note_amount: number | null
  /** Khoản trừ đi cùng hóa đơn (mig 133). Thiếu cột thì coi như false. */
  credit_with_invoice?: boolean | null
  created_at?: string | null
  reason?: string | null
  /** Dòng của phiếu — chỉ nơi nào cần in mới đọc tới. */
  lines?: Array<{
    id: string
    unit_name: string
    quantity: number
    unit_price: number
    line_total: number
    is_exchange?: boolean | null
    product?: { name?: string | null } | null
  }> | null
}

/**
 * Phiếu này đã trừ vào công nợ chưa.
 *
 * ⚠ MỘT CHỖ TRẢ LỜI DUY NHẤT. Màn chi tiết, ngăn xem nhanh và bản in đều
 * phải nói cùng một câu; ba chỗ tự xét là ba câu trả lời cho cùng một
 * phiếu, và người đọc tin chỗ nào cũng có thể sai.
 */
export function creditCounted(
  // ⚠ CHỈ NHẬN HAI TRƯỜNG NÓ THẬT SỰ DÙNG. Bắt cả `InvoiceReturnRow` là
  //   mọi nơi gọi phải mang theo cả `lines`, `reason`… và chỗ nào có hình
  //   dạng hơi khác thì phải ép kiểu — ép kiểu ở đường tính tiền là chỗ
  //   lỗi đi qua mà không ai thấy.
  r: Pick<InvoiceReturnRow, "status"> & { credit_with_invoice?: boolean | null }
): boolean {
  return r.credit_with_invoice === true
    ? r.status === "submitted" || r.status === "completed"
    : r.status === "completed"
}

/** Tổng khoản trừ ĐÃ vào công nợ của hóa đơn này. */
export function creditOnInvoice(returns: readonly InvoiceReturnRow[]): number {
  return returns
    .filter(creditCounted)
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
