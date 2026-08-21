// =====================================================================
// T-02 — FIFO costing layer helpers.
//
// Wraps the SQL helper `fifo_consume()` (mig 040) and exposes
// JS-friendly create/value functions.
// =====================================================================

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"

export type WarehouseZone = "sale" | "date"

export interface CreateLayerOpts {
  orgId: string
  productId: string
  warehouseZone: WarehouseZone
  sourceLineId?: string | null
  qtyInBaseUom: number
  unitCost: number
  postingAt?: Date
}

export interface ConsumeOpts {
  orgId: string
  productId: string
  warehouseZone: WarehouseZone
  qtyInBaseUom: number
  outLineId: string
}

/** Creates a new FIFO layer for an inbound stock event (import). */
export async function createFifoLayer(
  supabase: SupabaseClient,
  opts: CreateLayerOpts
): Promise<{ layerId: string }> {
  const { data, error } = await supabase
    .from("fifo_layers")
    .insert({
      org_id: opts.orgId,
      product_id: opts.productId,
      warehouse_zone: opts.warehouseZone,
      source_line_id: opts.sourceLineId ?? null,
      qty_in_base_uom_remaining: opts.qtyInBaseUom,
      unit_cost: opts.unitCost,
      posting_at: (opts.postingAt ?? new Date()).toISOString(),
    })
    .select("id")
    .single()
  if (error || !data) throw error || new Error("create-layer failed")
  return { layerId: (data as { id: string }).id }
}

/**
 * Atomically consume FIFO layers for an outbound stock event.
 * Throws "FIFO_INSUFFICIENT_STOCK" when cumulative remaining < needed.
 *
 * Defensive: when mig 040 hasn't been applied (RPC missing), returns
 * { totalCost: 0, layersUsed: 0, skipped: true } so legacy code paths
 * still work.
 */
export async function consumeFifoLayers(
  supabase: SupabaseClient,
  opts: ConsumeOpts
): Promise<{ totalCost: number; layersUsed: number; skipped: boolean }> {
  const { data, error } = await supabase.rpc("fifo_consume", {
    p_org_id: opts.orgId,
    p_product_id: opts.productId,
    p_warehouse_zone: opts.warehouseZone,
    p_qty_needed: opts.qtyInBaseUom,
    p_out_line_id: opts.outLineId,
  })
  if (error) {
    const msg = (error.message || "").toLowerCase()
    if (msg.includes("fifo_consume") && msg.includes("does not exist")) {
      // Mig 040 not applied yet; degrade silently.
      return { totalCost: 0, layersUsed: 0, skipped: true }
    }
    throw error
  }
  const row = Array.isArray(data) ? data[0] : data
  return {
    totalCost: Number((row as { total_cost?: number })?.total_cost ?? 0),
    layersUsed: Number((row as { layers_used?: number })?.layers_used ?? 0),
    skipped: false,
  }
}

/** SUM(remaining * unit_cost) for stock-value reports. */
export async function getStockValue(
  supabase: SupabaseClient,
  orgId: string,
  filters: { productId?: string; warehouseZone?: WarehouseZone } = {}
): Promise<Array<{ productId: string; warehouseZone: WarehouseZone; qty: number; value: number }>> {
  // Giá trị tồn kho là một con số TIỀN. Server chỉ trả 1.000 dòng mỗi
  // request nên phải lấy đủ qua nhiều trang, nếu không giá trị tồn báo về
  // sẽ nhỏ hơn thực tế mà không có lỗi nào.
  const res = await fetchAllForAggregate<{
    product_id: string
    warehouse_zone: WarehouseZone
    qty_in_base_uom_remaining: number
    unit_cost: number
  }>((from, to) => {
    let query = supabase
      .from("fifo_layers")
      .select("product_id, warehouse_zone, qty_in_base_uom_remaining, unit_cost", {
        count: "exact",
      })
      .eq("org_id", orgId)
      .is("closed_at", null)
      .gt("qty_in_base_uom_remaining", 0)
    if (filters.productId) query = query.eq("product_id", filters.productId)
    if (filters.warehouseZone) query = query.eq("warehouse_zone", filters.warehouseZone)
    return query.range(from, to)
  })
  if (res.error) throw new Error(res.error)

  const agg = new Map<string, { productId: string; warehouseZone: WarehouseZone; qty: number; value: number }>()
  for (const r of res.rows) {
    const key = `${r.product_id}__${r.warehouse_zone}`
    const prev = agg.get(key)
    const qty = Number(r.qty_in_base_uom_remaining || 0)
    const value = qty * Number(r.unit_cost || 0)
    if (prev) {
      prev.qty += qty
      prev.value += value
    } else {
      agg.set(key, {
        productId: r.product_id,
        warehouseZone: r.warehouse_zone,
        qty,
        value,
      })
    }
  }
  return Array.from(agg.values())
}
