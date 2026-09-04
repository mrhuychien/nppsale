import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Đánh dấu hoá đơn GỐC là "đã bị thay thế".
 *
 * VÌ SAO BẮT BUỘC: khi MISA trả `OrgRefID` trên một bản THAY THẾ, tờ gốc
 * vẫn đang ở trạng thái "đã ký" trong sổ. Không đánh dấu thì HAI hoá đơn
 * cùng hiện "đã ký" cho MỘT lần bán → doanh thu và thuế đầu ra khai GẤP
 * ĐÔI.
 *
 * VÌ SAO KHÔNG ĐỢI VÒNG QUÉT TỰ TÌM RA: bản BỊ thay thế không hề mang
 * `Org*` (đã đo — trống sạch). Nên nếu chỉ suy ngược từ OrgRefID của tờ
 * mới, một hoá đơn hết hiệu lực mà ta chưa thấy bản thay thế của nó sẽ
 * VĨNH VIỄN không lộ. Đây là đường duy nhất phát hiện được nó.
 *
 * Chỉ gọi khi quan hệ là 'replacement' — hoá đơn ĐIỀU CHỈNH cũng mang
 * OrgRefID nhưng bản gốc của nó VẪN CÒN hiệu lực.
 *
 * Trả về id hoá đơn gốc đã đánh dấu, hoặc null nếu không tìm thấy /
 * không cần đổi.
 */
export async function markOriginalReplaced(
  admin: SupabaseClient,
  orgId: string,
  orgRefId: string,
  replacementInvoiceId: string
): Promise<string | null> {
  const { data: original, error } = await admin
    .from("invoices")
    .select("id, misa_status")
    .eq("org_id", orgId)
    .eq("misa_ref_id", orgRefId)
    .maybeSingle()

  if (error) {
    console.error("[misa/mark-replaced] tìm hoá đơn gốc lỗi:", error.message)
    return null
  }
  // Không tìm thấy: hoá đơn gốc phát hành thẳng trên MISA, chưa từng qua
  // app này. Không tạo dòng mới — đó là việc của bảng snapshot (chưa có).
  if (!original) return null
  // Đã đánh dấu rồi thì thôi, tránh ghi đè misa_note mỗi lượt quét.
  if (original.misa_status === "replaced") return null

  const { error: updErr } = await admin
    .from("invoices")
    .update({
      misa_status: "replaced",
      misa_relation: "replaced",
      misa_note:
        `Đã bị thay thế bởi một hoá đơn khác trên MISA (phát hiện qua OrgRefID của tờ ` +
        `thay thế, id nội bộ ${replacementInvoiceId}). Hết hiệu lực — KHÔNG kê khai tờ này.`,
    })
    .eq("id", original.id)

  if (updErr) {
    console.error("[misa/mark-replaced] đánh dấu hoá đơn gốc lỗi:", updErr.message)
    return null
  }
  return original.id as string
}
