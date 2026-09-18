/**
 * Lập / huỷ phiếu thu — gọi hai RPC của migration 120.
 *
 * Phiếu thu là CHỨNG TỪ ĐỘC LẬP trong workflow v2: nó tự khép kín với
 * công nợ, không dính vào bước giao hàng như luồng cũ. Một phiếu thu có
 * thể cấn trừ nhiều khoản nợ cùng lúc, và có thể trừ bớt bằng khoản có
 * của phiếu trả ĐỘC LẬP (phiếu không gắn đơn nào).
 *
 * ⚠ HAI LOẠI PHIẾU TRẢ GIẢM CÔNG NỢ THEO HAI ĐƯỜNG KHÁC NHAU — đây là
 * chỗ dễ hiểu nhầm nhất của cả P6:
 *   - Phiếu trả GẮN ĐƠN (`order_id` khác null): `complete_return` tự gọi
 *     `_wf2_recompute_receivable` cho đơn đó, công nợ giảm NGAY. Nó
 *     KHÔNG được đem cấn trừ ở phiếu thu nữa — RPC từ chối bằng
 *     `BAD_CREDIT`, vì làm thế là trừ hai lần.
 *   - Phiếu trả ĐỘC LẬP (`order_id` null): không có đơn nào để tính lại,
 *     nên khoản có nằm chờ cho tới khi kế toán đem nó vào một phiếu thu.
 *     Đó chính là "cấn trừ đơn trả độc lập".
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/** Một khoản nợ được thu trong phiếu, kèm số tiền người dùng chọn. */
export interface CashReceiptLineInput {
  receivable_id: string
  amount: number
}

/** Một phiếu trả độc lập đem cấn trừ. Số tiền lấy từ `credit_note_amount`. */
export interface CashReceiptCreditInput {
  return_id: string
}

/**
 * Payload của `create_cash_receipt(p jsonb)`.
 *
 * ⚠ TÊN KHOÁ PHẢI ĐÚNG TỪNG CHỮ. RPC đọc jsonb nên gõ sai một khoá không
 * sinh lỗi kiểu nào cả — nó chỉ lặng lẽ đọc ra null: `customer_id` sai
 * thành `CUSTOMER_REQUIRED`, `lines` sai thành `EMPTY_RECEIPT`, còn
 * `notes` sai thì ghi chú biến mất mà không ai biết.
 */
export interface CashReceiptInput {
  customer_id: string
  /** Mặc định 'cash' nếu bỏ trống. */
  method?: string
  /** Mặc định hôm nay. Dạng YYYY-MM-DD. */
  receipt_date?: string
  notes?: string | null
  lines: CashReceiptLineInput[]
  credits?: CashReceiptCreditInput[]
}

/**
 * Số tiền khách trả THẬT = tổng khoản nợ đã chọn − tổng khoản có cấn trừ.
 *
 * ⚠ Đây là con số RPC ghi vào `submitted_amount`, và là con số phải hiện
 * to nhất trên màn lập phiếu. Hiện tổng khoản nợ đã chọn thay cho nó là
 * bảo kế toán thu nhiều hơn số khách thật sự phải đưa.
 */
export function cashToCollect(linesTotal: number, creditsTotal: number): number {
  return Math.max(0, Number(linesTotal || 0) - Number(creditsTotal || 0))
}

/**
 * Đổi mã lỗi của hai RPC sang câu tiếng Việt.
 *
 * ⚠ RPC RAISE với `ERRCODE = 'P0001'` mà `errorMessage` dùng chung không
 * biết mã đó. ⚠ Lỗi lạ trả NGUYÊN VĂN.
 */
export function explainReceiptError(message: string): string {
  const m = message || ""
  if (m.includes("CUSTOMER_REQUIRED")) return "Chưa chọn khách hàng."
  if (m.includes("EMPTY_RECEIPT")) return "Chưa chọn khoản nợ nào để thu."
  if (m.includes("CREDIT_EXCEEDS_SELECTED")) {
    return "Khoản cấn trừ lớn hơn số nợ đã chọn. Chọn thêm khoản nợ, hoặc bỏ bớt phiếu trả."
  }
  if (m.includes("BAD_RECEIVABLE_LINE")) {
    return "Có khoản nợ không hợp lệ, hoặc số thu vượt số còn nợ. Tải lại trang — có thể ai đó vừa thu trước."
  }
  if (m.includes("BAD_CREDIT")) {
    // Ba lý do đều dẫn tới cùng một mã; nói cả ba để người dùng tự soi.
    return "Phiếu trả không đủ điều kiện cấn trừ: phải là phiếu ĐÃ hoàn thành, KHÔNG gắn đơn nào, và chưa cấn trừ vào phiếu thu khác."
  }
  if (m.includes("RECEIPT_NOT_FOUND")) return "Không tìm thấy phiếu thu."
  if (m.includes("ORG_MISMATCH")) return "Phiếu thu không thuộc đơn vị của bạn."
  if (m.includes("RECEIPT_NOT_VOIDABLE")) {
    return m.replace(/^.*RECEIPT_NOT_VOIDABLE:\s*/, "")
  }
  if (m.includes("REASON_REQUIRED")) return "Phải ghi lý do huỷ phiếu thu."
  if (m.includes("FORBIDDEN")) return m.replace(/^.*FORBIDDEN:\s*/, "")
  if (
    m.includes("does not exist") &&
    (m.includes("create_cash_receipt") || m.includes("void_cash_receipt"))
  ) {
    return "Chưa chạy migration 119 + 120 trên cơ sở dữ liệu — chạy `supabase db push` rồi thử lại."
  }
  return m
}

/** Lập phiếu thu. Trả về id phiếu vừa tạo. */
export async function createCashReceipt(
  supabase: SupabaseClient,
  input: CashReceiptInput
): Promise<string> {
  const { data, error } = await supabase.rpc("create_cash_receipt", {
    p: {
      customer_id: input.customer_id,
      method: input.method ?? "cash",
      receipt_date: input.receipt_date,
      notes: input.notes ?? null,
      lines: input.lines,
      credits: input.credits ?? [],
    },
  })
  if (error) throw new Error(explainReceiptError(error.message || String(error)))
  // `RETURNS uuid` nên `data` là chuỗi, không phải mảng.
  const id = typeof data === "string" ? data : null
  if (!id) {
    throw new Error("Không nhận được mã phiếu thu vừa lập — tải lại danh sách để kiểm tra.")
  }
  return id
}

/**
 * Huỷ phiếu thu.
 *
 * ⚠ RPC trả công nợ về như cũ: xoá `payments`, trừ lại `receivables.paid`
 * và gỡ dấu đã cấn trừ trên phiếu trả. Bản cũ ở giao diện chỉ đổi trạng
 * thái phiếu và để lại `paid` đã cộng — khách hiện ra đã trả tiền trong
 * khi phiếu thu đã huỷ.
 */
export async function voidCashReceipt(
  supabase: SupabaseClient,
  receiptId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc("void_cash_receipt", {
    p_receipt_id: receiptId,
    p_reason: reason,
  })
  if (error) throw new Error(explainReceiptError(error.message || String(error)))
}
