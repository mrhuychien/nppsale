// ===================================================================
// T-01 — UOM conversion helpers.
//
// Use base UOM for any inventory math (batches.qty_on_hand cộng/trừ).
// Use transaction UOM for display + slips.
// ===================================================================

import type { Product, ProductUnit } from "@/types"

/**
 * Look up the conversion factor of unit_name on a product. Returns 1
 * when unit_name = product.base_unit OR no matching product_unit row.
 */
export function getConversionFactor(
  product: Pick<Product, "base_unit"> | null | undefined,
  units: ProductUnit[] | null | undefined,
  unitName: string
): number {
  if (!product || !unitName) return 1
  if (unitName === product.base_unit) return 1
  const u = (units || []).find((x) => x.unit_name === unitName)
  if (!u) return 1
  return Math.max(1, Number(u.conversion || 1))
}

/** quantity in transaction UOM × factor → base UOM count. */
export function toBaseQty(qty: number, factor: number): number {
  return Number(qty || 0) * Math.max(1, Number(factor || 1))
}

/**
 * Format display: "4 thùng (40 hộp)" when factor > 1, else just
 * "40 hộp".
 */
export function formatQtyWithBase(
  qty: number,
  unit: string,
  baseQty: number,
  baseUnit: string
): string {
  if (!unit || unit === baseUnit || baseQty === qty) {
    return `${qty} ${baseUnit || unit}`.trim()
  }
  return `${qty} ${unit} (${baseQty} ${baseUnit})`
}
