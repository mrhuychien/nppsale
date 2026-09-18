import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Gửi một đơn nháp đi: `draft` → `submitted` (Phiếu tạm).
 *
 * Thay cho `sendDraftForApproval` của luồng cũ. Workflow v2 không còn bước
 * duyệt, nên đây chỉ là một lần đổi trạng thái. Mốc `submitted_at` do
 * trigger trong migration 119 tự đóng — client không tự đoán giờ.
 *
 * ⚠ `.eq("status", "draft")` KHÔNG phải để cho đẹp: hai người cùng mở một
 * đơn, một người gửi trước, người kia bấm sau thì lệnh thứ hai không được
 * ghi đè. 0 dòng ở đây nghĩa là đơn đã đi tiếp rồi.
 *
 * ⚠ RLS từ chối cũng cho 0 dòng, HTTP 200, `error` là null. Không kiểm số
 * dòng thì màn hình báo "Đã gửi" cho một lệnh chưa chạy.
 */
export async function sendOrder(
  supabase: SupabaseClient,
  i: {
    orderId: string
    /** Cảnh báo cho NPP đọc trước khi xuất hàng. Rỗng = không có gì vướng. */
    reason?: string
  }
): Promise<void> {
  const { data, error } = await supabase
    .from("sales_orders")
    .update({ status: "submitted", approval_reason: i.reason?.trim() || null })
    .eq("id", i.orderId)
    .eq("status", "draft")
    .select("id")
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(
      "Không gửi được đơn — đơn không còn ở trạng thái nháp, hoặc bạn không có quyền. Tải lại trang để xem trạng thái mới."
    )
  }
}

/**
 * Giá trước chiết khấu, dựng lại từ dòng hàng ĐÃ LƯU.
 *
 * ⚠ `sales_orders.discount` là cột của luồng tạo đơn cũ; màn bán hàng
 * không bao giờ ghi vào đó — nó ghi chiết khấu vào từng dòng. Lấy cột kia
 * ra tính là luôn ra 0, và mọi cảnh báo "chiết khấu sâu" im lặng không
 * bao giờ bắn.
 */
export function grossFromSavedLines(
  subtotal: number,
  lines: Array<{ line_discount?: number | null }>
): number {
  const discount = lines.reduce((s, l) => s + Math.max(0, Number(l.line_discount) || 0), 0)
  return Number(subtotal || 0) + discount
}
