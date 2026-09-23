/**
 * T-16 Bảng lương — payroll_runs CRUD + compute/lock RPCs.
 *
 * The DB is the source of truth; compute_payroll_run pulls from
 * hr_attendance / hr_salary_config / sales_orders / salary_kpi_tiers /
 * salary_order_count_bonus_configs / monthly_activity_bonuses.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type PayrollStatus = "draft" | "locked"

export interface PayrollRun {
  id: string
  org_id: string
  month: string
  status: PayrollStatus
  computed_at: string | null
  locked_at: string | null
  locked_by: string | null
  created_at: string
}

export interface PayrollRunItem {
  id: string
  payroll_run_id: string
  user_id: string
  base_salary: number
  standard_workdays: number
  actual_workdays: number
  prorated_base: number
  /** Tổng phụ cấp (xăng xe + điện thoại) — mig 064. */
  allowances?: number
  kpi_bonus: number
  order_count_bonus: number
  activity_bonus: number
  overtime: number
  deductions: number
  social_insurance: number
  manual_adjustment: number
  net_salary: number
  notes: string | null
  computed_breakdown: Record<string, unknown>
}

/** Create or fetch the (org, month) run row. Idempotent. */
export async function ensurePayrollRun(
  supabase: SupabaseClient,
  opts: { orgId: string; month: string; userId: string }
): Promise<{ run: PayrollRun | null; error: string | null }> {
  const { data: existing, error: findErr } = await supabase
    .from("payroll_runs")
    .select("id, org_id, month, status, computed_at, locked_at, locked_by, created_by, created_at")
    .eq("org_id", opts.orgId)
    .eq("month", opts.month)
    .maybeSingle()
  if (findErr) return { run: null, error: findErr.message }
  if (existing) return { run: existing as PayrollRun, error: null }

  const { data, error } = await supabase
    .from("payroll_runs")
    .insert({
      org_id: opts.orgId,
      month: opts.month,
      status: "draft",
      created_by: opts.userId,
    })
    .select()
    .single()
  if (error) return { run: null, error: error.message }
  return { run: data as PayrollRun, error: null }
}

/**
 * Các mã lỗi hai hàm RPC bảng lương ném ra (mig 050 + 094). Chúng là mã
 * kỹ thuật viết hoa, đưa thẳng lên toast thì người dùng đọc được
 * "FORBIDDEN_ROLE" và không biết phải làm gì tiếp.
 */
const PAYROLL_ERRORS: Record<string, string> = {
  PAYROLL_RUN_NOT_FOUND: "Không tìm thấy kỳ lương này.",
  PAYROLL_RUN_LOCKED: "Kỳ lương đã khoá — mở khoá trước khi tính lại.",
  ORG_MISMATCH: "Kỳ lương không thuộc đơn vị của bạn.",
  FORBIDDEN_ROLE:
    "Chỉ chủ NPP, quản lý hoặc kế toán mới được tính / khoá bảng lương.",
}

function payrollError(message: string): string {
  for (const [code, vi] of Object.entries(PAYROLL_ERRORS)) {
    if (message.includes(code)) return vi
  }
  return message
}

export async function computePayrollRun(
  supabase: SupabaseClient,
  runId: string
): Promise<{ count: number; error: string | null }> {
  const { data, error } = await supabase.rpc("compute_payroll_run", {
    p_run_id: runId,
  })
  if (error) return { count: 0, error: payrollError(error.message) }
  return { count: Number(data || 0), error: null }
}

export async function lockPayrollRun(
  supabase: SupabaseClient,
  runId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("lock_payroll_run", {
    p_run_id: runId,
  })
  return { error: error ? payrollError(error.message) : null }
}

export async function setManualAdjustment(
  supabase: SupabaseClient,
  itemId: string,
  patch: {
    manual_adjustment: number
    notes?: string | null
    /** Optional override for BHXH/BHYT/BHTN — defaults to current value. */
    social_insurance?: number
  }
): Promise<{ error: string | null }> {
  /**
   * ⚠ KHÔNG TỰ TÍNH `net_salary` Ở ĐÂY NỮA (mig 173). Trigger
   *   `trg_tinh_luong_thuc_nhan` tính lại lương thực nhận trên mọi lần sửa,
   *   bằng đúng công thức của `compute_payroll_run` — bản cũ cộng trừ ở
   *   trình duyệt rồi ghi thẳng, nên ai sửa được dòng lương là ghi được
   *   một con số bất kỳ vào cột ấy.
   *
   * ⚠ ĐẾM DÒNG: RLS từ chối (vai không được làm lương) là 0 dòng, không lỗi.
   */
  const update: Record<string, unknown> = {
    manual_adjustment: patch.manual_adjustment,
    notes: patch.notes ?? null,
    updated_at: new Date().toISOString(),
  }
  if (patch.social_insurance !== undefined) update.social_insurance = Number(patch.social_insurance) || 0
  const { data, error } = await supabase
    .from("payroll_run_items")
    .update(update)
    .eq("id", itemId)
    .select("id")
  if (error) return { error: payrollError(error.message) }
  if (!data || data.length === 0) {
    return { error: "Không lưu được — bạn không có quyền sửa bảng lương, hoặc kỳ lương đã khoá." }
  }
  return { error: null }
}
