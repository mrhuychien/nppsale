import type { ApprovalRules } from "@/types"

/**
 * Ngữ cảnh để chấm quy tắc duyệt: quy tắc của NPP + công nợ.
 *
 * ⚠ GOM VỀ MỘT CHỖ vì nay có BA nơi cần: gửi đơn mới, lưu đơn đang sửa,
 * và gửi duyệt một đơn nháp từ danh sách. Ba bản chép tay thì bản nào sửa
 * sau sẽ lệch, và chỗ lệch là chỗ đơn lọt qua.
 */
export interface ApprovalContext {
  rules: ApprovalRules | null
  customerDebt: number
  customerOverdue: number
  repPortfolioDebt: number
  /**
   * Đọc có hỏng không.
   *
   * ⚠ HỎNG THÌ KHÔNG ĐƯỢC TỰ DUYỆT. Công nợ đọc hỏng trả về 0, mà 0 nghĩa
   * là "khách không nợ gì" — đúng cái làm mọi ngưỡng đều lọt.
   */
  failed: boolean
}

const RULE_COLS =
  "id, org_id, auto_approve_max, manager_approve_max, customer_debt_max, customer_overdue_max, rep_portfolio_debt_max, enforce_credit_limit, notes, is_active, updated_by, created_at, updated_at"

type Client = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const EMPTY_APPROVAL_CONTEXT: ApprovalContext = {
  rules: null,
  customerDebt: 0,
  customerOverdue: 0,
  repPortfolioDebt: 0,
  failed: false,
}

export async function loadApprovalContext(
  supabase: Client,
  opts: { orgId: string; customerId: string; salesUserId: string; now?: number }
): Promise<ApprovalContext> {
  // audit-ok: cả ba lỗi được gộp vào cờ `failed` ở cuối hàm, và nơi gọi
  // dùng cờ đó để KHÔNG tự duyệt. Không kiểm từng chỗ vì một truy vấn hỏng
  // hay cả ba hỏng đều dẫn tới cùng một việc phải làm.
  const [rulesRes, recRes, repRes] = await Promise.all([
    // audit-ok: xem chú thích ngay trên — gộp vào cờ `failed`.
    supabase.from("approval_rules").select(RULE_COLS).eq("org_id", opts.orgId).maybeSingle(),
    // audit-ok: xem chú thích ngay trên — gộp vào cờ `failed`.
    supabase
      .from("receivables")
      .select("amount, paid, due_date")
      .eq("customer_id", opts.customerId)
      .neq("status", "paid"),
    // audit-ok: xem chú thích ngay trên — gộp vào cờ `failed`.
    supabase
      .from("receivables")
      .select("amount, paid")
      .eq("sales_user_id", opts.salesUserId)
      .neq("status", "paid"),
  ])

  const rows = (recRes.data as Array<{ amount: number; paid: number; due_date: string | null }>) || []
  const now = opts.now ?? Date.now()
  return {
    rules: (rulesRes.data as ApprovalRules) ?? null,
    customerDebt: rows.reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0),
    customerOverdue: rows
      .filter((r) => r.due_date && new Date(r.due_date).getTime() < now)
      .reduce((s, r) => s + (Number(r.amount) - Number(r.paid)), 0),
    repPortfolioDebt: ((repRes.data as Array<{ amount: number; paid: number }>) || []).reduce(
      (s, r) => s + (Number(r.amount) - Number(r.paid)),
      0
    ),
    failed: !!(rulesRes.error || recRes.error || repRes.error),
  }
}
