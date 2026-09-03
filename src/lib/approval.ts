import type { ApprovalRules, Customer, Role } from "@/types"
import { formatCurrency } from "@/lib/utils"

export interface ApprovalContext {
  orderTotal: number
  /**
   * Giá trị hàng TRƯỚC chiết khấu và TRƯỚC VAT (tổng qty × đơn giá gốc),
   * cùng số tiền chiết khấu trên nền đó.
   *
   * VÌ SAO CẦN RIÊNG HAI TRƯỜNG NÀY
   * Mọi quy tắc phía dưới đều xét `orderTotal` — tức số SAU chiết khấu.
   * Chiết khấu 100% làm đơn 720.000đ thành 0đ, và `0 >= auto_approve_max`
   * là false nên đơn TỰ ĐỘNG DUYỆT: hàng ra khỏi kho, không ai duyệt,
   * không cảnh báo. Cho không hàng mà quy tắc theo ngưỡng tiền không bắt
   * được, vì thứ nó canh đã bị chiết khấu về 0.
   *
   * Cố ý KHÔNG suy tỉ lệ chiết khấu bằng `(gross - orderTotal) / gross`:
   * `orderTotal` đã gồm VAT còn `gross` thì chưa, nên hiệu số đó nhỏ hơn
   * chiết khấu thật và sẽ TÍNH THIẾU đúng vào lúc cần chặn nhất.
   * Không truyền thì quy tắc chiết khấu bỏ qua (giữ nguyên hành vi cũ cho
   * nơi gọi chưa cập nhật).
   */
  grossBeforeDiscount?: number
  discountAmount?: number
  customer: Pick<Customer, "id" | "credit_limit"> | null
  customerDebt: number
  customerOverdue: number
  repPortfolioDebt: number
  role: Role
}

export interface ApprovalDecision {
  /** true = can be auto-confirmed without human approval */
  autoApprove: boolean
  /** Human-readable reason describing the blocking rule(s). Empty when autoApprove is true. */
  reason: string
  /** Reasons as an array for structured rendering. */
  reasons: string[]
  /** Which role is expected to approve when not auto (owner/manager). */
  expectedApprover: "owner" | "manager" | null
}

/**
 * Ngưỡng chiết khấu cần duyệt. Đặt trong mã chứ không trong bảng
 * approval_rules vì đây là chốt chặn AN TOÀN, không phải tham số kinh
 * doanh: một NPP đặt ngưỡng tiền cao vẫn phải bị chặn khi cho không hàng.
 * Muốn cấu hình được thì thêm cột vào approval_rules ở migration sau.
 */
export const DEEP_DISCOUNT_MANAGER_PCT = 30
export const DEEP_DISCOUNT_OWNER_PCT = 50

export const DEFAULT_APPROVAL_RULES: Omit<ApprovalRules, "id" | "org_id" | "created_at" | "updated_at" | "updated_by"> = {
  auto_approve_max: 20_000_000,
  manager_approve_max: 50_000_000,
  customer_debt_max: 0,
  customer_overdue_max: 0,
  rep_portfolio_debt_max: 0,
  enforce_credit_limit: true,
  notes: null,
  is_active: true,
}

/**
 * Decide whether a sales order can be auto-approved given the org's
 * configured rules and contextual state.
 */
export function evaluateApproval(
  rules: ApprovalRules | null,
  ctx: ApprovalContext
): ApprovalDecision {
  const r = rules ?? ({ ...DEFAULT_APPROVAL_RULES, id: "", org_id: "", created_at: "", updated_at: "", updated_by: null } as ApprovalRules)

  if (!r.is_active) {
    return {
      autoApprove: false,
      reason: "Quy tắc duyệt đang tắt — cần duyệt thủ công",
      reasons: ["Quy tắc duyệt đang tắt — cần duyệt thủ công"],
      expectedApprover: "manager",
    }
  }

  const reasons: string[] = []
  let expectedApprover: "owner" | "manager" | null = null

  // 1. Order value thresholds
  if (ctx.orderTotal >= r.auto_approve_max) {
    if (ctx.orderTotal < r.manager_approve_max) {
      reasons.push(
        `Đơn ${formatCurrency(ctx.orderTotal)} vượt ngưỡng tự động duyệt (${formatCurrency(r.auto_approve_max)}) — cần Manager duyệt`
      )
      expectedApprover = "manager"
    } else {
      reasons.push(
        `Đơn ${formatCurrency(ctx.orderTotal)} vượt ngưỡng Manager duyệt (${formatCurrency(r.manager_approve_max)}) — cần Owner duyệt`
      )
      expectedApprover = "owner"
    }
  }

  // 2. Customer total debt
  if (r.customer_debt_max > 0 && ctx.customerDebt > r.customer_debt_max) {
    reasons.push(
      `Công nợ khách hàng ${formatCurrency(ctx.customerDebt)} vượt ngưỡng ${formatCurrency(r.customer_debt_max)}`
    )
    if (!expectedApprover) expectedApprover = "manager"
  }

  // 3. Customer overdue debt
  if (r.customer_overdue_max > 0 && ctx.customerOverdue > r.customer_overdue_max) {
    reasons.push(
      `Công nợ quá hạn của KH ${formatCurrency(ctx.customerOverdue)} vượt ngưỡng ${formatCurrency(r.customer_overdue_max)}`
    )
    if (!expectedApprover) expectedApprover = "manager"
  }

  // 4. Rep portfolio debt
  if (r.rep_portfolio_debt_max > 0 && ctx.repPortfolioDebt > r.rep_portfolio_debt_max) {
    reasons.push(
      `Tổng công nợ nhân viên phụ trách ${formatCurrency(ctx.repPortfolioDebt)} vượt ngưỡng ${formatCurrency(r.rep_portfolio_debt_max)}`
    )
    if (!expectedApprover) expectedApprover = "manager"
  }

  // 5. Credit limit
  if (r.enforce_credit_limit && ctx.customer && ctx.customer.credit_limit > 0) {
    const projected = ctx.customerDebt + ctx.orderTotal
    if (projected > ctx.customer.credit_limit) {
      reasons.push(
        `Đơn này sẽ đưa dư nợ KH lên ${formatCurrency(projected)}, vượt hạn mức ${formatCurrency(ctx.customer.credit_limit)}`
      )
      if (!expectedApprover) expectedApprover = "manager"
    }
  }

  // 6. Chiết khấu sâu — canh trên giá trị hàng TRƯỚC chiết khấu.
  //
  // Năm quy tắc trên đều xét số sau chiết khấu nên chiết khấu 100% lọt hết:
  // đơn 720.000đ thành 0đ thì không quy tắc nào chạm tới. Ngưỡng ở đây là
  // TỈ LỆ chiết khấu, không phải số tiền, để không phụ thuộc cấu hình
  // ngưỡng tiền của từng NPP.
  const gross = ctx.grossBeforeDiscount ?? 0
  const discountAmount = ctx.discountAmount ?? 0
  if (gross > 0 && discountAmount > 0) {
    const discountPct = (discountAmount / gross) * 100
    if (discountPct >= DEEP_DISCOUNT_OWNER_PCT) {
      reasons.push(
        `Chiết khấu ${discountPct.toFixed(0)}% (${formatCurrency(discountAmount)}) ` +
        `trên hàng trị giá ${formatCurrency(gross)} — cần Owner duyệt`
      )
      expectedApprover = "owner"
    } else if (discountPct >= DEEP_DISCOUNT_MANAGER_PCT) {
      reasons.push(
        `Chiết khấu ${discountPct.toFixed(0)}% trên hàng trị giá ${formatCurrency(gross)} — cần Manager duyệt`
      )
      if (!expectedApprover) expectedApprover = "manager"
    }
  }

  if (reasons.length === 0) {
    return { autoApprove: true, reason: "", reasons: [], expectedApprover: null }
  }

  return {
    autoApprove: false,
    reason: reasons.join(" • "),
    reasons,
    expectedApprover,
  }
}

/**
 * Check if the current user is allowed to approve an order requiring
 * the specified approver role. Owner can approve anything; manager
 * cannot approve orders that need owner.
 */
export function canApproveForLevel(role: Role, expected: "owner" | "manager" | null): boolean {
  if (!expected) return true
  if (role === "owner") return true
  if (role === "manager" && expected === "manager") return true
  return false
}
