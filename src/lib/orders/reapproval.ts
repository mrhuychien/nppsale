import { canApproveForLevel, type ApprovalDecision } from "@/lib/approval"
import type { OrderStatus, Role } from "@/types"

/**
 * Sửa đơn ĐÃ DUYỆT xong thì có phải duyệt lại không.
 *
 * ⚠ LỖ HỔNG PHẢI BỊT. Cho nhân viên sửa đơn sau khi duyệt mà không kiểm
 * lại gì thì bước duyệt thành vô nghĩa: gửi một đơn nhỏ cho quản lý bấm
 * duyệt, xong sửa lên gấp mười. Người duyệt đã ký vào một tờ giấy khác
 * với tờ cuối cùng ra kho.
 *
 * ⚠ KHÔNG ĐƯỢC so tổng tiền trước/sau rồi kết luận "giảm là an toàn".
 * Chiết khấu 100% làm đơn 720.000đ thành 0đ — tổng GIẢM mà đó chính là ca
 * cho không hàng. `evaluateApproval` đã có quy tắc chiết khấu sâu cho đúng
 * ca này, nên chạy lại cả bộ quy tắc mới là cách duy nhất không hụt.
 *
 * Trả `true` thì nơi gọi đưa đơn về `draft` kèm `approval_reason`.
 */
export function needsReapprovalAfterEdit(opts: {
  /** Trạng thái đơn TRƯỚC khi sửa. */
  status: OrderStatus
  /** Kết quả chạy lại bộ quy tắc trên số liệu MỚI. */
  decision: ApprovalDecision
  /** Vai trò người vừa sửa. */
  editorRole: Role
}): boolean {
  // Đơn chưa duyệt thì không có gì để duyệt lại — nó vẫn đang chờ duyệt.
  if (opts.status !== "confirmed") return false
  // Số liệu mới vẫn nằm trong ngưỡng tự duyệt: không làm phiền ai.
  if (opts.decision.autoApprove) return false
  // Người vừa sửa có đủ thẩm quyền duyệt chính mức đó → coi như họ đã
  // duyệt lại ngay lúc sửa. Bắt quản lý duyệt lại đơn do chính quản lý
  // sửa là thêm một bước không thêm chốt chặn nào.
  return !canApproveForLevel(opts.editorRole, opts.decision.expectedApprover)
}

/** Câu ghi vào `approval_reason` khi đơn bị trả về chờ duyệt lại. */
export function reapprovalReason(decision: ApprovalDecision): string {
  const why = decision.reason?.trim()
  return why ? `Sửa sau khi duyệt — cần duyệt lại: ${why}` : "Sửa sau khi duyệt — cần duyệt lại"
}
