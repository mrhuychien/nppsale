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
 * `confirmed` = đã duyệt. Trước đây chỉ có `draft`: duyệt xong là nhân
 * viên hết đường sửa, sai một con số cũng phải nhờ quản lý hoặc huỷ đơn
 * làm lại từ đầu.
 *
 * ⚠ KHÔNG có `picking`. Từ lúc thủ kho bắt đầu lấy hàng, đơn trên giấy và
 * hàng trên xe đẩy phải là một; sửa lúc đó là hai người làm hai việc khác
 * nhau trên cùng một đơn.
 */
export const SALES_EDITABLE_STATUSES: OrderStatus[] = ["draft", "confirmed"]

/** Trạng thái đã chốt — không ai sửa được nữa, kể cả chủ. */
export const TERMINAL_STATUSES: OrderStatus[] = ["delivered", "cancelled"]

/** Vai trò được sửa đơn ở bước lấy hàng (§4.4). */
const PICKING_EDIT_ROLES: Role[] = ["warehouse", "owner", "manager"]

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
  if (ctx.status === "draft" || ctx.status === "confirmed") return true
  return ctx.status === "picking" && PICKING_EDIT_ROLES.includes(ctx.role)
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
  if (ctx.status === "delivered") return "Đơn đã giao xong nên không sửa được nữa."
  if (ctx.status === "cancelled") return "Đơn đã huỷ nên không sửa được nữa."
  if (ctx.role === "sales") {
    if (!ctx.salesUserId || ctx.salesUserId !== ctx.userId) {
      return "Đơn này do nhân viên khác phụ trách."
    }
    return "Kho đã bắt đầu lấy hàng — báo quản lý nếu cần đổi."
  }
  return "Không sửa được đơn ở trạng thái này."
}
