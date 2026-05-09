/**
 * T-07: driver_handovers client helpers.
 *
 * The confirm step is atomic on the server (confirm_driver_handover RPC).
 * These wrappers create the draft + child rows, then call confirm.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export type FailureReason =
  | "customer_refused"
  | "customer_absent"
  | "wrong_address"
  | "other"

export type HandoverItemSource =
  | "failed_order"
  | "customer_return"
  | "unused_swap_stock"

export type WarehouseZone = "sale" | "date"

export interface HandoverFailedOrderInput {
  orderId: string
  failureReason: FailureReason
  notes?: string
}

export interface HandoverItemInput {
  sourceType: HandoverItemSource
  sourceOrderId?: string | null
  productId: string
  qty: number
  unitName: string
  conversionFactor: number
  qtyInBaseUom: number
  destinationZone: WarehouseZone
  reason?: string
  unitCost?: number | null
  swappedToCustomer?: boolean
}

export interface CreateAndConfirmInput {
  orgId: string
  deliveryId: string
  driverId: string | null
  receivedByUserId: string
  notes?: string
  failedOrders: HandoverFailedOrderInput[]
  items: HandoverItemInput[]
}

export interface CreateAndConfirmResult {
  handoverId: string | null
  error: string | null
}

/**
 * Create a draft handover with all child rows, then call the confirm
 * RPC. The DB transaction inside the RPC posts the stock_entry, bumps
 * batches, opens FIFO layers, and flips affected orders.
 */
export async function createAndConfirmHandover(
  supabase: SupabaseClient,
  input: CreateAndConfirmInput
): Promise<CreateAndConfirmResult> {
  // 1. Insert header.
  const { data: handover, error: hErr } = await supabase
    .from("driver_handovers")
    .insert({
      org_id: input.orgId,
      delivery_id: input.deliveryId,
      driver_id: input.driverId,
      received_by_user_id: input.receivedByUserId,
      notes: input.notes ?? null,
      status: "draft",
    })
    .select("id")
    .single()
  if (hErr || !handover) {
    return { handoverId: null, error: hErr?.message ?? "Insert handover failed" }
  }
  const handoverId = (handover as { id: string }).id

  // 2. Failed orders.
  if (input.failedOrders.length > 0) {
    const { error: foErr } = await supabase
      .from("driver_handover_failed_orders")
      .insert(
        input.failedOrders.map((f) => ({
          handover_id: handoverId,
          order_id: f.orderId,
          failure_reason: f.failureReason,
          notes: f.notes ?? null,
        }))
      )
    if (foErr) return { handoverId, error: foErr.message }
  }

  // 3. Items.
  if (input.items.length > 0) {
    const { error: iErr } = await supabase
      .from("driver_handover_items")
      .insert(
        input.items.map((it) => ({
          handover_id: handoverId,
          source_type: it.sourceType,
          source_order_id: it.sourceOrderId ?? null,
          product_id: it.productId,
          qty: it.qty,
          unit_name: it.unitName,
          conversion_factor: it.conversionFactor,
          qty_in_base_uom: it.qtyInBaseUom,
          destination_zone: it.destinationZone,
          reason: it.reason ?? null,
          unit_cost: it.unitCost ?? null,
          swapped_to_customer: !!it.swappedToCustomer,
        }))
      )
    if (iErr) return { handoverId, error: iErr.message }
  }

  // 4. Confirm — atomic on the server.
  const { error: cErr } = await supabase.rpc("confirm_driver_handover", {
    p_handover_id: handoverId,
  })
  if (cErr) return { handoverId, error: cErr.message }

  return { handoverId, error: null }
}

export const FAILURE_REASON_LABELS: Record<FailureReason, string> = {
  customer_refused: "Khách từ chối nhận",
  customer_absent: "Khách vắng mặt",
  wrong_address: "Sai địa chỉ",
  other: "Lý do khác",
}

export const ZONE_LABELS: Record<WarehouseZone, string> = {
  sale: "Kho bán",
  date: "Kho date / hàng đã đổi",
}
