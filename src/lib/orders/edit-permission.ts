import type { OrderStatus, Role } from "@/types"

/**
 * Ai được sửa đơn, ở trạng thái nào.
 *
 * VÌ SAO TÁCH RA KHỎI MÀN HÌNH
 *   Ba biến `canEdit` / `fullEdit` / `canDelete` trước đây là ba biểu thức
 *   boolean viết thẳng giữa một trang 2.300 dòng. Không kiểm chứng được
 *   bằng gì ngoài bấm tay, mà đây lại là chỗ quyết định một nhân viên có
 *   sửa được đơn đã duyệt hay không.
 *
 * ⚠ BẢNG NÀY PHẢI KHỚP CHÍNH SÁCH RLS (migration 115).
 *   Nới ở màn hình mà quên nới dưới database thì Supabase trả HTTP 200 với
 *   0 dòng bị sửa và KHÔNG kèm lỗi: nhân viên bấm Lưu, thấy "Đã cập nhật",
 *   mà đơn không đổi gì. Siết ở database mà quên siết màn hình cũng ra
 *   đúng cảnh đó. Đó là lý do hai bên dùng chung một danh sách trạng thái
 *   và có phép kiểm đối chiếu chúng với nhau.
 */

/**
 * Trạng thái mà NVBH được sửa đơn CỦA CHÍNH MÌNH.
 *
 * `submitted` = phiếu tạm, đã gửi nhưng NPP chưa xuất hàng. Hàng chưa rời
 * kho nên sửa vẫn an toàn. Xuất hàng rồi thì mọi thay đổi phải đi qua RPC
 * sửa đơn đã hoàn thành, không phải đường này.
 */
export const SALES_EDITABLE_STATUSES: OrderStatus[] = ["draft", "submitted"]

/**
 * Trạng thái không sửa được bằng màn hình thường.
 *
 * ⚠ BA TRẠNG THÁI ĐÃ XUẤT HÀNG ĐỀU NẰM ĐÂY. Trigger
 * `guard_order_lines_locked` (migration 124) ném `ORDER_LOCKED` cho
 * `partially_invoiced`, `completed` và `closed`. Bỏ sót một cái là màn
 * hình mở nút Sửa rồi cơ sở dữ liệu từ chối — người dùng gõ xong mới
 * nhận lỗi, và không hiểu vì sao nút lại mở.
 *
 * ⚠ KHÔNG CÒN ĐƯỜNG "SỬA ĐƠN ĐÃ HOÀN THÀNH". v2b bỏ hẳn cơ chế đó: sai
 * thì HUỶ HÓA ĐƠN rồi lập lại, kho hoàn về đúng lô đã lấy.
 */
export const TERMINAL_STATUSES: OrderStatus[] = [
  "partially_invoiced",
  "completed",
  "closed",
  "cancelled",
]

export interface OrderEditContext {
  role: Role
  userId: string
  status: OrderStatus
  /** Ai là NVBH phụ trách đơn. `null` = đơn cũ chưa ghi lại. */
  salesUserId: string | null
  /** Quyền `orders.update` trong ma trận phân quyền. */
  hasUpdatePermission: boolean
}

/**
 * Có sửa được gì không (kể cả chỉ sửa ghi chú).
 *
 * ⚠ NVBH phải là người phụ trách ĐÚNG đơn đó. RLS cũng đòi vậy, nên nếu
 * màn hình mở nút Sửa cho một đơn của người khác thì bấm Lưu sẽ rơi vào
 * đúng cái bẫy 0-dòng-không-lỗi nói ở đầu file.
 */
export function canEditOrder(ctx: OrderEditContext): boolean {
  if (!ctx.hasUpdatePermission) return false
  if (TERMINAL_STATUSES.includes(ctx.status)) return false
  if (ctx.role === "sales") {
    if (!ctx.salesUserId || ctx.salesUserId !== ctx.userId) return false
    return SALES_EDITABLE_STATUSES.includes(ctx.status)
  }
  return true
}

/** Sửa được cả dòng hàng, điều khoản, ngày giao — không chỉ ghi chú. */
export function canFullEditOrder(ctx: OrderEditContext): boolean {
  if (!canEditOrder(ctx)) return false
  return ctx.status === "draft" || ctx.status === "submitted"
}

/**
 * Vì sao không sửa được — để màn hình nói ra thay vì ẩn nút không lời.
 *
 * ⚠ Nút biến mất không giải thích gì là lý do người dùng nhắn hỏi. Trả
 * `null` khi sửa được.
 */
export function whyCannotEdit(ctx: OrderEditContext): string | null {
  if (canEditOrder(ctx)) return null
  if (!ctx.hasUpdatePermission) return "Bạn chưa được cấp quyền sửa đơn hàng."
  // ⚠ ĐỪNG CHỈ NGƯỜI TA TỚI MỘT NÚT KHÔNG CÒN TỒN TẠI. Câu cũ bảo "dùng
  //   nút Sửa đơn đã hoàn thành" — v2b gỡ cả cơ chế đó.
  if (ctx.status === "completed" || ctx.status === "partially_invoiced") {
    return "Đơn đã xuất hàng — muốn đổi thì huỷ hóa đơn rồi lập lại."
  }
  if (ctx.status === "closed") return "Đơn đã đóng — huỷ hóa đơn trước nếu muốn mở lại."
  if (ctx.status === "cancelled") return "Đơn đã huỷ nên không sửa được nữa."
  if (ctx.role === "sales") {
    if (!ctx.salesUserId || ctx.salesUserId !== ctx.userId) {
      return "Đơn này do nhân viên khác phụ trách."
    }
  }
  return "Không sửa được đơn ở trạng thái này."
}

/**
 * ⚠ ĐÃ GỠ Ở WORKFLOW V2B: `CompletedEditContext`, `whyLockedCompleted`,
 *   `canEditCompleted`.
 *
 * Chúng là bốn khoá của cơ chế "sửa đơn đã hoàn thành" và soi theo
 * `_wf2_assert_order_unlocked` — hàm mà migration 124 đã DROP. Giữ lại
 * là để một bộ kiểm tra trông còn sống nhưng đang soi vào chỗ trống, và
 * lần sau có người đọc rồi tưởng cơ chế ấy còn.
 *
 * Khoá tương đương của v2b nằm trong `cancel_invoice` (migration 125) và
 * bám vào HÓA ĐƠN chứ không bám vào đơn: tiền thu, hóa đơn điện tử đã
 * phát hành, phiếu trả đã hoàn thành. Giao diện của chúng ở
 * `/sales-invoices/[id]`.
 *
 * `organizations.completed_edit_days` cũng không còn ai đọc — cột giữ
 * lại để không mất cấu hình tổ chức đã đặt (xem chú thích cột ở mig 124).
 */
