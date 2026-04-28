import type { SupabaseClient } from "@supabase/supabase-js"

export interface PricingRules {
  allow_sales_override: boolean
  sale_min_pct: number
  sale_min_value: number
  return_max_pct: number
  return_max_value: number
}

export const DEFAULT_PRICING_RULES: PricingRules = {
  allow_sales_override: false,
  sale_min_pct: 0,
  sale_min_value: 0,
  return_max_pct: 0,
  return_max_value: 0,
}

export async function loadPricingRules(
  supabase: SupabaseClient,
  orgId: string
): Promise<PricingRules> {
  const { data } = await supabase
    .from("pricing_rules")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle()
  if (!data) return DEFAULT_PRICING_RULES
  const row = data as Partial<PricingRules>
  return {
    allow_sales_override: !!row.allow_sales_override,
    sale_min_pct: Number(row.sale_min_pct ?? 0),
    sale_min_value: Number(row.sale_min_value ?? 0),
    return_max_pct: Number(row.return_max_pct ?? 0),
    return_max_value: Number(row.return_max_value ?? 0),
  }
}

/**
 * Compute the floor for a sale price given the default and the rules.
 * The floor is the LARGER of the two limits (whichever lets the rep
 * discount more, since pct and value are alternative caps the admin
 * sets — apply the more permissive one).
 *
 * Returns the default price itself when no override is allowed.
 */
export function saleFloor(defaultPrice: number, rules: PricingRules): number {
  if (!rules.allow_sales_override) return defaultPrice
  const pctOff = (defaultPrice * rules.sale_min_pct) / 100
  const valueOff = rules.sale_min_value
  const allowedDiscount = Math.max(pctOff, valueOff)
  return Math.max(0, defaultPrice - allowedDiscount)
}

/**
 * Ceiling for a return-line price given the default and the rules.
 * Mirror logic: the rep can mark a return up by at most pct OR value,
 * whichever is more permissive.
 */
export function returnCeiling(defaultPrice: number, rules: PricingRules): number {
  if (!rules.allow_sales_override) return defaultPrice
  const pctUp = (defaultPrice * rules.return_max_pct) / 100
  const valueUp = rules.return_max_value
  const allowedMarkup = Math.max(pctUp, valueUp)
  return defaultPrice + allowedMarkup
}

export interface PriceCheck {
  ok: boolean
  /** A short message for UI ("Min 95.000đ", "Vượt giá mặc định 5.000đ"...) */
  message: string | null
  /** The bound that was hit (floor for sale, ceiling for return) */
  bound: number
}

export function validateSalePrice(
  price: number,
  defaultPrice: number,
  rules: PricingRules
): PriceCheck {
  const floor = saleFloor(defaultPrice, rules)
  if (price >= floor - 0.5) {
    return { ok: true, message: null, bound: floor }
  }
  if (!rules.allow_sales_override) {
    return {
      ok: false,
      message: `Không được giảm giá dưới ${formatVnd(defaultPrice)}`,
      bound: floor,
    }
  }
  return {
    ok: false,
    message: `Giá tối thiểu ${formatVnd(floor)}`,
    bound: floor,
  }
}

export function validateReturnPrice(
  price: number,
  defaultPrice: number,
  rules: PricingRules
): PriceCheck {
  const ceiling = returnCeiling(defaultPrice, rules)
  if (price <= ceiling + 0.5) {
    return { ok: true, message: null, bound: ceiling }
  }
  if (!rules.allow_sales_override) {
    return {
      ok: false,
      message: `Không được nhận trả với giá cao hơn ${formatVnd(defaultPrice)}`,
      bound: ceiling,
    }
  }
  return {
    ok: false,
    message: `Giá trả tối đa ${formatVnd(ceiling)}`,
    bound: ceiling,
  }
}

function formatVnd(n: number): string {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n)) + "đ"
}
