/**
 * Hoàn thành / huỷ phiếu trả — gọi hai RPC của migration 120.
 *
 * Toàn bộ việc nằm trong RPC: dựng phiếu nhập kho, cộng tồn vào đúng lô
 * của đúng khu vực kho, đóng giá vốn theo hàng THẬT, đổi trạng thái phiếu
 * và tính lại công nợ của đơn gốc — tất cả trong MỘT giao dịch.
 *
 * ⚠ MIGRATION 120 ĐÃ GỠ TRIGGER NHẬP KHO TỰ ĐỘNG của đơn trả. Nghĩa là
 * một phiếu trả được đặt thành `completed` bằng lệnh ghi thẳng sẽ KHÔNG
 * nhập kho gì cả: hàng khách trả biến mất khỏi tồn, và công nợ không
 * giảm. `complete_return` là đường duy nhất còn lại.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Kho nhận hàng trả về.
 *
 * ⚠ NGƯỜI DUYỆT PHẢI CHỌN, KHÔNG ĐƯỢC ĐOÁN HỘ. Hàng khách trả về có thể
 * còn bán được (kho `sale`) hoặc đã cận hạn / hỏng và phải để riêng (kho
 * `date`). Mặc định thầm một bên là hoặc đem hàng cận hạn bán tiếp, hoặc
 * chôn hàng còn tốt vào kho chờ xử lý.
 */
export type ReturnZone = "sale" | "date"

export const RETURN_ZONES: Array<{ value: ReturnZone; label: string; hint: string }> = [
  { value: "sale", label: "Kho bán", hint: "Hàng còn tốt, bán tiếp được" },
  { value: "date", label: "Kho cận date", hint: "Hàng cận hạn hoặc cần xử lý riêng" },
]

/**
 * Đổi mã lỗi của hai RPC sang câu tiếng Việt.
 *
 * ⚠ Mọi RPC của v2 RAISE với `ERRCODE = 'P0001'`, mà `errorMessage` dùng
 * chung không biết mã đó — nó in nguyên văn kỹ thuật kèm "(mã P0001)".
 * ⚠ Lỗi lạ trả về NGUYÊN VĂN: đoán sai rồi người ta đi sửa nhầm chỗ còn
 * tệ hơn đọc không hiểu.
 */
export function explainReturnError(message: string): string {
  const m = message || ""
  if (m.includes("RETURN_NOT_FOUND")) return "Không tìm thấy phiếu trả."
  if (m.includes("ORG_MISMATCH")) return "Phiếu trả không thuộc đơn vị của bạn."
  if (m.includes("RETURN_NOT_SUBMITTED")) {
    return "Phiếu trả không còn ở Phiếu tạm — có thể ai đó vừa xử lý. Tải lại trang."
  }
  if (m.includes("BAD_ZONE")) return "Phải chọn kho nhận: kho bán hoặc kho cận date."
  if (m.includes("ORDER_NOT_COMPLETED")) {
    // Nhập lại hàng của một đơn chưa xuất là cộng khống tồn kho.
    return "Đơn gốc chưa xuất hàng nên chưa nhập trả được. Xuất hàng cho đơn đó trước."
  }
  if (m.includes("RETURN_NOT_CANCELLABLE")) {
    return m.replace(/^.*RETURN_NOT_CANCELLABLE:\s*/, "")
  }
  if (m.includes("OVERPAID_AFTER_CREDIT")) {
    /**
     * ⚠ MÃ NÀY BẮN GIÁN TIẾP, TỪ `_wf2_recompute_receivable` — không nằm
     * trong thân `complete_return` nên rất dễ quên. Nó xảy ra khi khách
     * đã trả nhiều hơn số nợ SAU khi trừ khoản có: hệ thống không có
     * khái niệm số dư có, nên hạ nợ xuống dưới số đã trả là làm biến mất
     * tiền đang giữ của khách. Và nó ROLLBACK CẢ `complete_return`, kể
     * cả phần nhập kho — hàng khách trả không vào tồn.
     *
     * ⚠ THÔNG ĐIỆP GỐC BẢO "huỷ phiếu thu trước", mà đó là việc người
     * dùng THƯỜNG KHÔNG LÀM ĐƯỢC: nếu tiền vào qua màn thu tiền theo
     * công nợ thì không có phiếu thu nào để huỷ. Nói đúng cả hai đường
     * thay vì lặp lại một lời khuyên có thể bế tắc.
     */
    return `${m.replace(/^.*OVERPAID_AFTER_CREDIT:\s*/, "")}. Phải đảo bớt tiền đã thu trước: huỷ phiếu thu tương ứng, hoặc nhờ kế toán chỉnh khoản đã thu nếu tiền vào không qua phiếu thu.`
  }
  if (m.includes("LOCKED_CREDIT_APPLIED")) {
    // Tiền đã đi rồi thì không đảo kho lặng lẽ được.
    return `${m.replace(/^.*LOCKED_CREDIT_APPLIED:\s*/, "")} — huỷ phiếu thu trước rồi mới huỷ phiếu trả.`
  }
  if (m.includes("NO_IMPORT_TO_REVERSE")) {
    return m.replace(/^.*NO_IMPORT_TO_REVERSE:\s*/, "")
  }
  /* Mã của `save_pos_return` (mig 190). */
  if (m.includes("RETURN_LOCKED")) return m.replace(/^.*RETURN_LOCKED:\s*/, "")
  if (m.includes("RETURN_COMPLETED")) return m.replace(/^.*RETURN_COMPLETED:\s*/, "")
  if (m.includes("CUSTOMER_NOT_FOUND")) return "Không tìm thấy khách hàng."
  if (m.includes("INVOICE_NOT_FOUND")) return "Không tìm thấy hóa đơn gốc."
  if (m.includes("BAD_PAYLOAD")) return m.replace(/^.*BAD_PAYLOAD:\s*/, "")
  if (m.includes("FORBIDDEN")) return m.replace(/^.*FORBIDDEN:\s*/, "")
  if (m.includes("does not exist") && (m.includes("complete_return") || m.includes("cancel_return"))) {
    return "Chưa chạy migration 119 + 120 trên cơ sở dữ liệu — chạy `supabase db push` rồi thử lại."
  }
  return m
}

/** Hoàn thành phiếu trả: nhập kho + giảm công nợ. Trả về id phiếu nhập. */
export async function completeReturn(
  supabase: SupabaseClient,
  returnId: string,
  zone: ReturnZone
): Promise<string | null> {
  const { data, error } = await supabase.rpc("complete_return", {
    p_return_id: returnId,
    p_zone: zone,
  })
  if (error) throw new Error(explainReturnError(error.message || String(error)))
  // ⚠ `RETURNS TABLE` nên `data` là MỘT MẢNG, không phải object.
  const row = (Array.isArray(data) ? data[0] : data) as { entry_id?: string | null } | null | undefined
  return row?.entry_id ?? null
}

/**
 * Huỷ phiếu trả.
 *
 * Phiếu còn ở Phiếu tạm thì chỉ đổi trạng thái. Phiếu ĐÃ hoàn thành thì
 * RPC đảo kho và tính lại công nợ — và từ chối nếu khoản có đã được cấn
 * trừ vào một phiếu thu.
 */
export async function cancelReturn(
  supabase: SupabaseClient,
  returnId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc("cancel_return", {
    p_return_id: returnId,
    p_reason: reason,
  })
  if (error) throw new Error(explainReturnError(error.message || String(error)))
}
