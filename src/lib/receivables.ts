import type { SupabaseClient } from "@supabase/supabase-js"
import { recomputeReceivableForOrder } from "@/lib/returns"

/**
 * Ensure a receivable exists for the given order. The amount is the order
 * total minus any approved/completed return credits linked to it (so a
 * concurrent return that pre-dates this call still nets out correctly).
 *
 * Idempotent: returns { created: false } when a receivable already exists.
 */
export async function ensureReceivableForOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<{ created: boolean; error?: string }> {
  // Check if receivable already exists
  const { data: existing, error: checkErr } = await supabase
    .from("receivables")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle()

  if (checkErr) {
    return { created: false, error: checkErr.message }
  }
  if (existing) {
    // Re-net it in case approved returns piled up before delivery completed.
    try {
      await recomputeReceivableForOrder(supabase, orderId)
    } catch (err) {
      return { created: false, error: (err as Error).message }
    }
    return { created: false }
  }

  try {
    await recomputeReceivableForOrder(supabase, orderId)
  } catch (err) {
    return { created: false, error: (err as Error).message }
  }
  return { created: true }
}
