import type {
  HrMonthlyBonus,
  KpiMetricConfig,
  OrderMilestoneTier,
  PerUnitBonus,
  SalesOrder,
} from "@/types"

// =====================================================================
// Update #2 v2 §2.1 / §2.2 / §2.3 — Bonus computation library.
//
// Pure functions, no IO. Caller fetches the period's hr_monthly_bonus
// config + the per-user activity data and passes it in. Used by the
// payroll preview (§2.5) and the actual payroll-finalization job.
// =====================================================================

export interface OrderLineLite {
  product_id: string
  unit_name: string
  quantity: number
  /** sale-line unit_price for "above-list %" KPI; optional. */
  unit_price?: number
  list_price?: number
}

export interface UserPeriodActivity {
  user_id: string
  /** Đơn DELIVERED trong kỳ (đã loại cancelled). */
  delivered_orders: SalesOrder[]
  /** Tổng dòng SP trên các đơn DELIVERED, để tính per-unit bonus. */
  delivered_lines: OrderLineLite[]
  /** Số khách mới mở (created_at trong kỳ + bởi user này). */
  new_customers: number
  /** % visit-coverage = visits/route_assignments (tuỳ org tracking). */
  visit_coverage: number
  /** Tỉ lệ trả = trả_value / doanh_thu. */
  return_rate: number
}

// ---------- §2.1 Per-unit bonus -------------------------------------

export function computePerUnitBonus(
  lines: OrderLineLite[],
  rules: PerUnitBonus[]
): { total: number; breakdown: { rule: PerUnitBonus; qty: number; amount: number }[] } {
  const breakdown: { rule: PerUnitBonus; qty: number; amount: number }[] = []
  let total = 0
  for (const rule of rules) {
    if (!rule || rule.bonus <= 0) continue
    const matched = lines.filter(
      (l) =>
        (rule.product_id == null || l.product_id === rule.product_id) &&
        (!rule.unit_name || l.unit_name === rule.unit_name)
    )
    const qty = matched.reduce((s, l) => s + Number(l.quantity || 0), 0)
    const amount = qty * Number(rule.bonus || 0)
    if (qty > 0) {
      breakdown.push({ rule, qty, amount })
      total += amount
    }
  }
  return { total, breakdown }
}

// ---------- §2.2 Order-count milestones ------------------------------

export function computeOrderMilestoneBonus(
  orderCount: number,
  tiers: OrderMilestoneTier[]
): { total: number; tier: OrderMilestoneTier | null } {
  // Pick the HIGHEST tier whose threshold is met.
  let best: OrderMilestoneTier | null = null
  for (const t of tiers) {
    if (orderCount >= Number(t.min_orders || 0)) {
      if (!best || Number(t.min_orders) > Number(best.min_orders)) best = t
    }
  }
  return { total: best ? Number(best.bonus || 0) : 0, tier: best }
}

// ---------- §2.3 KPI metrics -----------------------------------------

export interface KpiSnapshot {
  new_customers: number
  visit_coverage: number
  aov: number
  return_rate: number
  above_list_pct: number
}

export function snapshotKpis(activity: UserPeriodActivity): KpiSnapshot {
  const delivered = activity.delivered_orders
  const totalRevenue = delivered.reduce((s, o) => s + Number(o.total || 0), 0)
  const aov = delivered.length > 0 ? totalRevenue / delivered.length : 0

  // % đơn có dòng vượt giá list (vẫn nằm trong khoảng cho phép).
  let aboveListLines = 0
  let totalLines = 0
  for (const l of activity.delivered_lines) {
    if (l.list_price && l.unit_price) {
      totalLines++
      if (l.unit_price > l.list_price + 0.5) aboveListLines++
    }
  }
  const above_list_pct = totalLines > 0 ? (aboveListLines / totalLines) * 100 : 0

  return {
    new_customers: activity.new_customers,
    visit_coverage: activity.visit_coverage,
    aov,
    return_rate: activity.return_rate,
    above_list_pct,
  }
}

export function computeKpiBonus(
  snapshot: KpiSnapshot,
  metrics: KpiMetricConfig[]
): {
  total: number
  perMetric: { config: KpiMetricConfig; value: number; bonus: number }[]
} {
  const perMetric: { config: KpiMetricConfig; value: number; bonus: number }[] = []
  let total = 0
  for (const m of metrics) {
    const value = (snapshot as unknown as Record<string, number>)[m.key] ?? 0
    let earned = 0
    if (m.higher_is_better !== false) {
      // Highest tier whose `min` is met
      for (const t of m.tiers) {
        if (value >= Number(t.min || 0) && Number(t.bonus || 0) > earned) {
          earned = Number(t.bonus || 0)
        }
      }
    } else {
      // Lower-is-better: pick the tier whose `min` ≥ value (we treat
      // `min` as "max acceptable" for these metrics)
      for (const t of m.tiers) {
        if (value <= Number(t.min || 0) && Number(t.bonus || 0) > earned) {
          earned = Number(t.bonus || 0)
        }
      }
    }
    perMetric.push({ config: m, value, bonus: earned })
    total += earned
  }
  return { total, perMetric }
}

// ---------- Aggregate ------------------------------------------------

export interface BonusBreakdown {
  perUnit: ReturnType<typeof computePerUnitBonus>
  orderMilestone: ReturnType<typeof computeOrderMilestoneBonus>
  kpi: ReturnType<typeof computeKpiBonus>
  total: number
}

export function computeAllBonuses(
  config: HrMonthlyBonus | null,
  activity: UserPeriodActivity
): BonusBreakdown {
  const perUnit = computePerUnitBonus(
    activity.delivered_lines,
    config?.per_unit_bonuses ?? []
  )
  const orderMilestone = computeOrderMilestoneBonus(
    activity.delivered_orders.length,
    config?.order_milestone_tiers ?? []
  )
  const kpiSnapshot = snapshotKpis(activity)
  const kpi = computeKpiBonus(kpiSnapshot, config?.kpi_metrics ?? [])
  return {
    perUnit,
    orderMilestone,
    kpi,
    total: perUnit.total + orderMilestone.total + kpi.total,
  }
}
