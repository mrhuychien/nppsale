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

// =====================================================================
// Per-USER price-edit rules (migration 027 — Update #2 v2 §4.6)
// =====================================================================
//
// 3 ràng buộc:
//   1) Đơn bán: giá ≥ giá list.
//   2) Đơn bán: giá ≤ giá list × (1 + max_increase_pct/100).
//   3) Đơn trả: giá ≤ giá đã bán trong đơn gốc tham chiếu (fallback giá
//      list nếu không link đơn gốc).
//
// Owner & accountant có flag free → bỏ qua check (UI cho nhập tự do).

export interface UserPriceEditRules {
  allow_price_edit: boolean
  /** % cap tăng giá tối đa khi bán. 0 = không được tăng (chỉ bằng list). */
  price_edit_max_increase_pct: number
  /** True khi user là owner/accountant — bỏ qua mọi check (free). */
  free: boolean
}

export function userPriceRulesFrom(
  user:
    | {
        role?: string | null
        allow_price_edit?: boolean
        price_edit_max_increase_pct?: number
      }
    | null
    | undefined
): UserPriceEditRules {
  const free = user?.role === "owner" || user?.role === "accountant"
  return {
    allow_price_edit: free || !!user?.allow_price_edit,
    price_edit_max_increase_pct: Math.max(
      0,
      Number(user?.price_edit_max_increase_pct ?? 0)
    ),
    free,
  }
}

/** Trả về null khi giá hợp lệ, ngược lại là chuỗi lỗi tiếng Việt. */
export function validateUserSalesPrice(
  enteredPrice: number,
  listPrice: number,
  rules: UserPriceEditRules
): string | null {
  if (!Number.isFinite(enteredPrice) || enteredPrice < 0) return "Giá không hợp lệ"
  if (rules.free) return null
  if (!rules.allow_price_edit) {
    if (Math.abs(enteredPrice - listPrice) > 0.5) {
      return `Bạn không có quyền sửa giá (giá list ${formatVnd(listPrice)})`
    }
    return null
  }
  // Ràng buộc 1: ≥ giá list
  if (enteredPrice < listPrice - 0.5) {
    return `Đơn bán: giá ≥ giá list ${formatVnd(listPrice)}`
  }
  // Ràng buộc 2: ≤ list × (1 + max%)
  const ceiling = listPrice * (1 + rules.price_edit_max_increase_pct / 100)
  if (enteredPrice > ceiling + 0.5) {
    return `Đơn bán: tối đa được tăng ${rules.price_edit_max_increase_pct}% = ${formatVnd(ceiling)}`
  }
  return null
}

/**
 * Đơn trả: giá ≤ giá đã bán (truyền vào `originalPrice`). Nếu không
 * link đơn gốc → caller truyền listPrice làm fallback.
 */
export function validateUserReturnPrice(
  enteredPrice: number,
  originalPrice: number,
  rules: UserPriceEditRules
): string | null {
  if (!Number.isFinite(enteredPrice) || enteredPrice < 0) return "Giá không hợp lệ"
  if (rules.free) return null
  if (!rules.allow_price_edit) {
    if (Math.abs(enteredPrice - originalPrice) > 0.5) {
      return `Bạn không có quyền sửa giá (giá tham chiếu ${formatVnd(originalPrice)})`
    }
    return null
  }
  // Ràng buộc 3: ≤ giá đã bán
  if (enteredPrice > originalPrice + 0.5) {
    return `Đơn trả: giá ≤ giá đã bán ${formatVnd(originalPrice)}`
  }
  return null
}

// =====================================================================
// Per-product price-edit rules (migration 025)
// =====================================================================
//
// Per-product overrides let the distributor say "this SKU lets the rep
// charge UP to +X% above list in sales orders" or "lets the rep refund
// DOWN to -Y VND below list in returns". The org-level pricing_rules
// above govern discount-side flexibility; this is the markup-side
// (sales) and discount-side (returns) inverse.
//
// Quy tắc:
//   - Sales: price ∈ [sell_price, sell_price + adjustment]
//   - Returns: price ∈ [sell_price - adjustment, sell_price]

export interface ProductPriceEditRules {
  allow_price_edit: boolean
  price_edit_max_type: "percent" | "value"
  price_edit_max: number
}

export function productPriceRulesFrom(
  product: {
    allow_price_edit?: boolean
    price_edit_max_type?: "percent" | "value" | string | null
    price_edit_max?: number
  } | null | undefined
): ProductPriceEditRules {
  return {
    allow_price_edit: !!product?.allow_price_edit,
    price_edit_max_type:
      product?.price_edit_max_type === "value" ? "value" : "percent",
    price_edit_max: Math.max(0, Number(product?.price_edit_max ?? 0)),
  }
}

function adjustmentAmount(sellPrice: number, rules: ProductPriceEditRules): number {
  if (!rules.allow_price_edit || rules.price_edit_max <= 0) return 0
  return rules.price_edit_max_type === "percent"
    ? (Math.max(0, sellPrice) * rules.price_edit_max) / 100
    : rules.price_edit_max
}

export function salesPriceBounds(
  sellPrice: number,
  rules: ProductPriceEditRules
): { min: number; max: number } {
  const adj = adjustmentAmount(sellPrice, rules)
  return { min: sellPrice, max: sellPrice + adj }
}

export function returnsPriceBounds(
  sellPrice: number,
  rules: ProductPriceEditRules
): { min: number; max: number } {
  const adj = adjustmentAmount(sellPrice, rules)
  return { min: Math.max(0, sellPrice - adj), max: sellPrice }
}

/**
 * Validate a sales-line price. Returns null when valid, or a Vietnamese
 * error string explaining the breach. Tolerance ±0.5 to handle rounding.
 */
export function validateProductSalesPrice(
  enteredPrice: number,
  sellPrice: number,
  rules: ProductPriceEditRules
): string | null {
  if (!Number.isFinite(enteredPrice) || enteredPrice < 0) {
    return "Giá không hợp lệ"
  }
  // Sản phẩm không cho phép sửa: phải đúng giá bán
  if (!rules.allow_price_edit) {
    if (Math.abs(enteredPrice - sellPrice) > 0.5) {
      return `Sản phẩm này không cho phép sửa giá (giá bán ${formatVnd(sellPrice)})`
    }
    return null
  }
  const { min, max } = salesPriceBounds(sellPrice, rules)
  if (enteredPrice < min - 0.5) {
    return `Đơn bán: giá ≥ ${formatVnd(min)} (giá bán)`
  }
  if (enteredPrice > max + 0.5) {
    return `Đơn bán: giá ≤ ${formatVnd(max)} (giá bán + tối đa)`
  }
  return null
}

export function validateProductReturnPrice(
  enteredPrice: number,
  sellPrice: number,
  rules: ProductPriceEditRules
): string | null {
  if (!Number.isFinite(enteredPrice) || enteredPrice < 0) {
    return "Giá không hợp lệ"
  }
  if (!rules.allow_price_edit) {
    if (Math.abs(enteredPrice - sellPrice) > 0.5) {
      return `Sản phẩm này không cho phép sửa giá (giá bán ${formatVnd(sellPrice)})`
    }
    return null
  }
  const { min, max } = returnsPriceBounds(sellPrice, rules)
  if (enteredPrice > max + 0.5) {
    return `Đơn trả: giá ≤ ${formatVnd(max)} (giá bán)`
  }
  if (enteredPrice < min - 0.5) {
    return `Đơn trả: giá ≥ ${formatVnd(min)} (giá bán − tối đa)`
  }
  return null
}
