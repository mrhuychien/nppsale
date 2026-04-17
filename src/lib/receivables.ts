import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Map payment terms string to due date days from today.
 */
function paymentTermsToDays(terms: string | null | undefined): number {
  if (!terms) return 0
  const match = terms.match(/NET(\d+)/i)
  if (match) return parseInt(match[1], 10)
  // COD: due immediately
  return 0
}

/**
 * Ensure a receivable exists for the given order.
 * Idempotent - will not create duplicate if one already exists.
 * Returns true if created, false if already exists or error.
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
    return { created: false }
  }

  // Fetch order info
  const { data: order, error: orderErr } = await supabase
    .from("sales_orders")
    .select("id, org_id, customer_id, sales_user_id, total, payment_terms, order_date")
    .eq("id", orderId)
    .single()

  if (orderErr || !order) {
    return { created: false, error: orderErr?.message || "Không tìm thấy đơn hàng" }
  }

  // Calculate due_date
  const days = paymentTermsToDays(order.payment_terms)
  const baseDate = order.order_date ? new Date(order.order_date) : new Date()
  const dueDate = new Date(baseDate)
  dueDate.setDate(baseDate.getDate() + days)
  const dueDateStr = dueDate.toISOString().slice(0, 10)

  // Create receivable
  const { error: insertErr } = await supabase.from("receivables").insert({
    org_id: order.org_id,
    order_id: order.id,
    customer_id: order.customer_id,
    sales_user_id: order.sales_user_id,
    amount: order.total,
    paid: 0,
    due_date: dueDateStr,
    status: "open",
  })

  if (insertErr) {
    return { created: false, error: insertErr.message }
  }
  return { created: true }
}
