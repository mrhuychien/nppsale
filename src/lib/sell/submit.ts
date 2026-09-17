import { createOrderRecords, type OfflineOrderPayload } from "@/lib/orders/create"
import { enqueueOrder } from "@/lib/offline/outbox"
import { evaluateApproval } from "@/lib/approval"
import { DRAFT_APPROVAL_REASON } from "@/lib/orders/save-gate"
import type { ApprovalRules, Customer, Role } from "@/types"

/**
 * Gửi một đơn từ màn bán hàng.
 *
 * ⚠ MỘT ĐƯỜNG GHI DUY NHẤT. Cả có mạng lẫn không mạng đều dựng cùng một
 * `OfflineOrderPayload` rồi đi qua `createOrderRecords`, thứ đã BẤT BIẾN
 * theo `client_request_id`. Không mạng thì gói đó nằm trong hàng đợi và
 * chính hàm kia đẩy nó lên sau — nên đường ngoại tuyến không còn là nhánh
 * ít ai chạy tới, nó là chính đường kia, chỉ hoãn lại.
 */
export type SubmitOutcome =
  | { kind: "queued"; orderCode: string }
  | { kind: "created"; orderCode: string; orderId: string; status: "draft" | "confirmed"; reason: string }

export interface SubmitInput extends StatusDecisionInput {
  payload: OfflineOrderPayload
  online: boolean
}

/**
 * Đầu vào để quyết trạng thái đơn.
 *
 * ⚠ CHỈ NHẬN CON SỐ, không nhận giỏ hàng hay gói đơn. Ba nơi cần phép
 * này — gửi đơn mới, lưu đơn đang sửa, gửi duyệt một đơn nháp từ danh
 * sách — và nơi thứ ba không có giỏ hàng trong tay, chỉ có dòng đã lưu.
 */
export interface StatusDecisionInput {
  /** Bấm "Lưu tạm" — đơn nằm lại ở nháp, không chạy quy tắc duyệt. */
  asDraft: boolean
  orderTotal: number
  /** SAU chiết khấu, TRƯỚC thuế. */
  subtotal: number
  /** TRƯỚC chiết khấu, TRƯỚC thuế. */
  grossBeforeDiscount: number
  customer: Pick<Customer, "id" | "credit_limit"> | null
  rules: ApprovalRules | null
  customerDebt: number
  customerOverdue: number
  repPortfolioDebt: number
  role: Role
  /**
   * Đọc ngữ cảnh duyệt (quy tắc, công nợ) có hỏng không.
   *
   * ⚠ HỎNG THÌ KHÔNG ĐƯỢC TỰ DUYỆT. Công nợ đọc hỏng trả về 0, mà 0 nghĩa
   * là "khách không nợ gì" — đúng cái làm mọi ngưỡng đều lọt. Một lần đọc
   * hỏng không được biến thành một đơn tự duyệt.
   */
  contextFailed?: boolean
}

/**
 * Quyết trạng thái đơn.
 *
 * ⚠ ĐƠN NHÁP KHÔNG CHẠY BỘ QUY TẮC. Chưa gửi đi thì chưa có gì để duyệt,
 * và kết quả sẽ cũ mất trước khi ai kịp đọc vì người dùng còn sửa tiếp.
 *
 * ⚠ Truyền `grossBeforeDiscount` RIÊNG. Mọi ngưỡng đều xét tổng SAU chiết
 * khấu, nên chiết khấu 100% làm đơn tụt xuống dưới ngưỡng và tự động duyệt
 * — cho không hàng mà không ai được hỏi.
 */
export function decideStatus(i: StatusDecisionInput): {
  status: "draft" | "confirmed"
  reason: string
} {
  if (i.asDraft) return { status: "draft", reason: DRAFT_APPROVAL_REASON }
  if (i.contextFailed) {
    return {
      status: "draft",
      reason: "Không đọc được công nợ / quy tắc duyệt — đơn chờ duyệt tay.",
    }
  }
  const decision = evaluateApproval(i.rules, {
    orderTotal: i.orderTotal,
    grossBeforeDiscount: i.grossBeforeDiscount,
    discountAmount: Math.max(0, i.grossBeforeDiscount - i.subtotal),
    customer: i.customer,
    customerDebt: i.customerDebt,
    customerOverdue: i.customerOverdue,
    repPortfolioDebt: i.repPortfolioDebt,
    role: i.role,
  })
  return decision.autoApprove
    ? { status: "confirmed", reason: "" }
    : { status: "draft", reason: decision.reason }
}

type Client = Parameters<typeof createOrderRecords>[0]

export async function submitSellOrder(
  supabase: Client,
  i: SubmitInput,
  ctx: { userId: string; orgId: string }
): Promise<SubmitOutcome> {
  if (!i.online) {
    await enqueueOrder(i.payload)
    return { kind: "queued", orderCode: i.payload.order.order_code }
  }

  const { orderId } = await createOrderRecords(supabase, i.payload, ctx)
  const { status, reason } = decideStatus(i)

  // `createOrderRecords` luôn ghi ở trạng thái `draft` (nó vốn dùng cho
  // hàng đợi ngoại tuyến). Đơn tự duyệt được thì nâng lên ngay tại đây.
  const update: Record<string, unknown> =
    status === "confirmed"
      ? {
          status: "confirmed",
          approved_by: ctx.userId,
          approved_at: new Date().toISOString(),
          approval_reason: null,
        }
      : { approval_reason: reason || null }

  const { data: rows, error } = await supabase
    .from("sales_orders")
    .update(update)
    .eq("id", orderId)
    .select("id")
  if (error) throw error
  // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. Đơn đã tạo nhưng đứng
  // sai trạng thái mà màn hình báo thành công là kiểu hỏng khó tìm nhất.
  if (!rows || rows.length === 0) {
    throw new Error(
      `Đã tạo đơn ${i.payload.order.order_code} nhưng không đặt được trạng thái. Mở lại đơn để kiểm tra.`
    )
  }

  return { kind: "created", orderCode: i.payload.order.order_code, orderId, status, reason }
}
