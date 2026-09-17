import { decideStatus, type StatusDecisionInput } from "@/lib/sell/submit"
import { DRAFT_APPROVAL_REASON } from "@/lib/orders/save-gate"
import { createNotificationForUsers, fetchApproversForOrg } from "@/lib/notifications"
import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Gửi một đơn nháp đi duyệt.
 *
 * VÌ SAO PHẢI CÓ HÀM NÀY
 *   Trước đây NVBH lưu tạm được nhưng KHÔNG gửi đi được: bảng chuyển
 *   trạng thái ở màn chi tiết đơn chỉ cho owner/manager bấm "Duyệt đơn",
 *   còn NVBH chỉ có "Huỷ đơn". Đơn tạm nằm im, quản lý không thấy, và
 *   người duy nhất biết nó tồn tại là người soạn nó.
 */

/**
 * Đơn nháp này ĐÃ GỬI đi duyệt chưa.
 *
 * ⚠ HAI LOẠI ĐƠN NHÁP KHÁC HẲN NHAU và trước nay bị gộp làm một:
 *   1. Bản nháp NVBH tự lưu để soạn tiếp — chưa ai cần xem.
 *   2. Đơn đã gửi, quy tắc không cho tự duyệt — quản lý phải xử lý HÔM NAY.
 * Cả hai đều `status = 'draft'`, nên màn danh sách đơn gắn nhãn "Cần duyệt"
 * cho cả loại 1. Quản lý mở ra thấy một đơn người ta còn đang soạn dở, và
 * sau vài lần như vậy thì nhãn "Cần duyệt" mất hết ý nghĩa.
 *
 * Dấu phân biệt là LÝ DO: bản tự lưu mang đúng câu `DRAFT_APPROVAL_REASON`,
 * đơn đã gửi mang lý do do bộ quy tắc sinh ra.
 */
export function isSentForApproval(
  status: string,
  approvalReason: string | null | undefined
): boolean {
  if (status !== "draft") return false
  const r = (approvalReason ?? "").trim()
  return r.length > 0 && r !== DRAFT_APPROVAL_REASON
}

/**
 * Giá trị hàng TRƯỚC chiết khấu, tính từ dòng đã lưu trong DB.
 *
 * ⚠ CON SỐ NÀY KHÔNG CÓ TRÊN ĐẦU ĐƠN. `subtotal` là số SAU chiết khấu, và
 * mọi ngưỡng duyệt đều xét số sau chiết khấu — nên đơn sửa giá về 0 tụt
 * xuống dưới mọi ngưỡng rồi TỰ ĐỘNG DUYỆT. Quy tắc chiết khấu sâu chỉ chạy
 * khi có số trước chiết khấu, và nó nằm ở `line_discount` của từng dòng.
 *
 * ⚠ Lấy từ dòng ĐÃ LƯU chứ không tính lại theo bảng giá hôm nay: bảng giá
 * đổi sau ngày tạo đơn thì một đơn bán đúng giá bỗng nhiên trông như được
 * chiết khấu sâu, và nhân viên bị chặn vì một việc họ không làm.
 */
export function grossFromSavedLines(
  subtotal: number,
  lines: Array<{ line_discount?: number | null }>
): number {
  const discount = lines.reduce((s, l) => s + Math.max(0, Number(l.line_discount) || 0), 0)
  return Number(subtotal || 0) + discount
}

export interface SendForApprovalInput extends Omit<StatusDecisionInput, "asDraft"> {
  orderId: string
  orderCode: string
  orgId: string
  /** Người bấm gửi — ghi vào `approved_by` khi đơn tự duyệt được. */
  userId: string
}

export interface SendForApprovalResult {
  status: "draft" | "confirmed"
  reason: string
}

/**
 * Chấm quy tắc rồi đặt trạng thái cho một đơn ĐÃ CÓ trong DB.
 *
 * ⚠ CHỈ ĐỔI ĐƯỢC ĐƠN CÒN Ở `draft`. Điều kiện `.eq("status", "draft")` là
 * chốt chống đua: quản lý vừa duyệt xong trên máy tính trong lúc NVBH bấm
 * Gửi trên điện thoại — thiếu vế đó thì cú bấm chậm hơn kéo một đơn đã
 * duyệt ngược về nháp, và kho đang lấy hàng thì không hiểu chuyện gì.
 */
export async function sendDraftForApproval(
  supabase: SupabaseClient,
  i: SendForApprovalInput
): Promise<SendForApprovalResult> {
  const { status, reason } = decideStatus({ ...i, asDraft: false })

  const patch: Record<string, unknown> =
    status === "confirmed"
      ? {
          status: "confirmed",
          approved_by: i.userId,
          approved_at: new Date().toISOString(),
          approval_reason: null,
        }
      : // ⚠ Lý do RỖNG là không được. Chính nó phân biệt "đã gửi, chờ
        // duyệt" với "bản nháp tự lưu"; rỗng thì đơn gửi đi xong lại hiện
        // như chưa gửi và không ai ngó tới.
        { approval_reason: reason || "Chờ duyệt tay." }

  const { data: rows, error } = await supabase
    .from("sales_orders")
    .update(patch)
    .eq("id", i.orderId)
    .eq("status", "draft")
    .select("id")
  if (error) throw error
  // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. Cũng 0 dòng khi đơn đã
  // rời khỏi `draft`. Hai chuyện đó khác nhau nhưng cùng một cách xử: nói
  // ra, đừng báo "đã gửi".
  if (!rows || rows.length === 0) {
    throw new Error(
      `Không gửi được đơn ${i.orderCode}. Đơn có thể đã được duyệt hoặc huỷ — mở lại đơn để xem trạng thái mới.`
    )
  }

  if (status === "draft") {
    await notifyApprovers(supabase, {
      orgId: i.orgId,
      orderId: i.orderId,
      orderCode: i.orderCode,
      reason,
    })
  }

  return { status, reason }
}

/**
 * Báo cho owner/manager rằng có đơn chờ duyệt.
 *
 * ⚠ ĐƠN NẰM CHỜ MÀ KHÔNG AI BIẾT THÌ BẰNG NHƯ CHƯA GỬI. Đây là nửa sau của
 * việc "gửi duyệt" — nửa đầu chỉ đổi một chữ trong cột `status`.
 *
 * Không ném lỗi: `createNotificationForUsers` đã nuốt lỗi và ghi log. Đơn
 * đã đổi trạng thái rồi, làm hỏng cả thao tác vì một cái thông báo là đổi
 * một phiền toái lấy một mất mát.
 */
export async function notifyApprovers(
  supabase: SupabaseClient,
  i: { orgId: string; orderId: string; orderCode: string; reason: string }
): Promise<void> {
  const approvers = await fetchApproversForOrg(supabase, i.orgId)
  await createNotificationForUsers(supabase, {
    orgId: i.orgId,
    userIds: approvers,
    type: "order_pending_approval",
    title: `Đơn ${i.orderCode} chờ duyệt`,
    body: i.reason || undefined,
    linkUrl: `/orders/${i.orderId}`,
    metadata: { order_id: i.orderId },
  })
}
