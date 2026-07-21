// =====================================================================
// T-15 — KPI tiers / order-count bonus / activity bonus computations.
//
// Per-user (mig 043) layered on top of org-level (mig 031). Resolver
// uses per-user when present, falls back to org-level.
// =====================================================================

import type { SupabaseClient } from "@supabase/supabase-js"

export interface KpiTier {
  min_revenue: number
  bonus_type: "percent" | "fixed"
  bonus_value: number
  order_index?: number
}

export interface OrderCountBonusConfig {
  period: "week" | "month"
  min_order_count: number
  min_order_value: number
  bonus_per_order: number
  effective_from: string
  effective_to: string | null
}

/**
 * KPI tier bonus: pick the highest tier whose min_revenue is met, then
 * compute amount per its bonus_type. Returns 0 when no tier hit.
 */
export async function computeKpiBonus(
  supabase: SupabaseClient,
  opts: { userId: string; month: string; revenue: number }
): Promise<{ bonus: number; tier: KpiTier | null }> {
  const { data, error } = await supabase
    .from("salary_kpi_tiers")
    .select("min_revenue, bonus_type, bonus_value, order_index")
    .eq("user_id", opts.userId)
    .eq("month", opts.month)
    .order("min_revenue", { ascending: false })

  if (error) {
    if ((error.message || "").includes("salary_kpi_tiers")) {
      return { bonus: 0, tier: null }
    }
    throw error
  }
  const tiers = (data as KpiTier[]) || []
  for (const t of tiers) {
    if (opts.revenue + 0.5 >= Number(t.min_revenue)) {
      const amount =
        t.bonus_type === "percent"
          ? (opts.revenue * Number(t.bonus_value)) / 100
          : Number(t.bonus_value)
      return { bonus: amount, tier: t }
    }
  }
  return { bonus: 0, tier: null }
}

/**
 * Order-count bonus (D9): only counts orders meeting BOTH:
 *   • total >= min_order_value
 *   • cumulative count >= min_order_count
 * Returns 0 if count threshold not met.
 */
export async function computeOrderCountBonus(
  supabase: SupabaseClient,
  opts: {
    userId: string
    periodStart: string
    periodEnd: string
  }
): Promise<{ count: number; bonus: number; config: OrderCountBonusConfig | null }> {
  const { data: configs, error: cfgErr } = await supabase
    .from("salary_order_count_bonus_configs")
    .select("id, org_id, user_id, period, min_order_count, min_order_value, bonus_per_order, effective_from, effective_to, created_at")
    .eq("user_id", opts.userId)
    .lte("effective_from", opts.periodEnd)
    .or(`effective_to.is.null,effective_to.gte.${opts.periodStart}`)
    .order("effective_from", { ascending: false })
    .limit(1)
  if (cfgErr) {
    if ((cfgErr.message || "").includes("salary_order_count_bonus_configs")) {
      return { count: 0, bonus: 0, config: null }
    }
    throw cfgErr
  }
  const config = ((configs as OrderCountBonusConfig[]) || [])[0] || null
  if (!config) return { count: 0, bonus: 0, config: null }

  // Count orders for this user in period that hit the value threshold
  const { count, error: orderErr } = await supabase
    .from("sales_orders")
    .select("id", { count: "exact", head: true })
    .eq("sales_user_id", opts.userId)
    .eq("status", "delivered")
    .gte("order_date", opts.periodStart)
    .lte("order_date", opts.periodEnd)
    .gte("total", config.min_order_value)
  if (orderErr) throw orderErr

  const c = Number(count || 0)
  if (c < config.min_order_count) return { count: c, bonus: 0, config }
  return { count: c, bonus: c * Number(config.bonus_per_order), config }
}

/** Activity bonus: manual entry per (user, month). */
export async function getActivityBonus(
  supabase: SupabaseClient,
  opts: { userId: string; month: string }
): Promise<number> {
  const { data, error } = await supabase
    .from("monthly_activity_bonuses")
    .select("amount")
    .eq("user_id", opts.userId)
    .eq("month", opts.month)
    .maybeSingle()
  if (error) {
    if ((error.message || "").includes("monthly_activity_bonuses")) return 0
    throw error
  }
  return Number((data as { amount?: number } | null)?.amount ?? 0)
}
