import type { ApprovalRules, Customer, Role } from "@/types"
import { formatCurrency } from "@/lib/utils"

export interface ApprovalContext {
  orderTotal: number
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
