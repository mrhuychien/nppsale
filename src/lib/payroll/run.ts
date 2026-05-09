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
    .select("*")
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

export async function computePayrollRun(
  supabase: SupabaseClient,
  runId: string
): Promise<{ count: number; error: string | null }> {
  const { data, error } = await supabase.rpc("compute_payroll_run", {
    p_run_id: runId,
  })
  if (error) return { count: 0, error: error.message }
  return { count: Number(data || 0), error: null }
}

export async function lockPayrollRun(
  supabase: SupabaseClient,
  runId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc("lock_payroll_run", {
    p_run_id: runId,
  })
  return { error: error?.message ?? null }
}

export async function setManualAdjustment(
  supabase: SupabaseClient,
  itemId: string,
  patch: { manual_adjustment: number; notes?: string | null }
): Promise<{ error: string | null }> {
  // Re-compute net_salary with the new adjustment in a single round-trip.
  const { data: row, error: readErr } = await supabase
    .from("payroll_run_items")
    .select(
      "prorated_base, kpi_bonus, order_count_bonus, activity_bonus, overtime, deductions, social_insurance"
    )
    .eq("id", itemId)
    .single()
  if (readErr || !row) return { error: readErr?.message ?? "Not found" }
  const r = row as {
    prorated_base: number
    kpi_bonus: number
    order_count_bonus: number
    activity_bonus: number
    overtime: number
    deductions: number
    social_insurance: number
  }
  const net =
    Number(r.prorated_base || 0) +
    Number(r.kpi_bonus || 0) +
    Number(r.order_count_bonus || 0) +
    Number(r.activity_bonus || 0) +
    Number(r.overtime || 0) +
    Number(patch.manual_adjustment || 0) -
    Number(r.deductions || 0) -
    Number(r.social_insurance || 0)
  const { error } = await supabase
    .from("payroll_run_items")
    .update({
      manual_adjustment: patch.manual_adjustment,
      notes: patch.notes ?? null,
      net_salary: net,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId)
  return { error: error?.message ?? null }
}
