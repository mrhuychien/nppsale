import type { SupabaseClient } from "@supabase/supabase-js"
import { ensureReceivableForOrder } from "@/lib/receivables"

type Sb = SupabaseClient

function generateReceiptCode(): string {
  const now = new Date()
  const yy = String(now.getFullYear()).slice(-2)
  const mm = String(now.getMonth() + 1).padStart(2, "0")
  const dd = String(now.getDate()).padStart(2, "0")
  const rand = Math.floor(1 + Math.random() * 9999).toString().padStart(4, "0")
  return `PT-${yy}${mm}${dd}-${rand}`
}

interface DeliveryRow {
  id: string
  org_id: string
  driver_id: string | null
  settled_at?: string | null
}

interface DeliveryLineRow {
  id: string
  order_id: string
  status: string
  payment_method: string | null
  amount_collected: number | null
  order?: {
    id: string
    total: number | null
    payment_terms: string | null
    status: string
  }
}

export interface CreateReceiptResult {
  receiptId: string
  receiptCode: string
  reused: boolean
  expected: number
  submitted: number
}

/**
 * Tìm hoặc tạo phiếu thu (TT200) cho chuyến giao này — gộp nhanh,
 * không cần qua màn quyết toán (/settle). Default values:
 *  - submitted_amount = expected (sum of delivered+COD line totals)
 *  - per-line amount = order.total cho dòng delivered+COD
 *  - phương thức thu = cash (mặc định) hoặc transfer nếu line là cod_transfer
 *
 * Nếu đã có phiếu thu cho delivery này → trả về phiếu cũ (idempotent).
 */
export async function createOrFindReceiptForDelivery(
  supabase: Sb,
  deliveryId: string,
  userId: string
): Promise<CreateReceiptResult> {
  // 1) Đã có phiếu thu cho chuyến này chưa?
  const { data: existing } = await supabase
    .from("cash_receipts")
    .select("id, receipt_code, expected_amount, submitted_amount")
    .eq("source_type", "delivery_settle")
    .eq("source_id", deliveryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) {
    const e = existing as {
      id: string
      receipt_code: string
      expected_amount: number | null
      submitted_amount: number | null
    }
    return {
      receiptId: e.id,
      receiptCode: e.receipt_code,
      reused: true,
      expected: Number(e.expected_amount || 0),
      submitted: Number(e.submitted_amount || 0),
    }
  }

  // 2) Fetch delivery + lines
  const [delRes, linesRes] = await Promise.all([
    supabase.from("deliveries").select("id, org_id, driver_id, settled_at").eq("id", deliveryId).single(),
    supabase
      .from("delivery_lines")
      .select(
        "id, order_id, status, payment_method, amount_collected, order:sales_orders(id, total, payment_terms, status)"
      )
      .eq("delivery_id", deliveryId),
  ])

  const delivery = delRes.data as DeliveryRow | null
  if (!delivery) throw new Error("Không tìm thấy chuyến giao")

  const lines = (linesRes.data as unknown as DeliveryLineRow[]) || []

  // 3) Tính expected + per-line defaults
  const collectableLines = lines.filter((l) => {
    const orderStatus = l.order?.status
    if (orderStatus === "cancelled") return false
    if (l.status === "failed" || l.status === "pending") return false
    const terms = l.order?.payment_terms || ""
    const cod = terms.startsWith("cod") || terms === "cash" || terms === "" || l.payment_method?.startsWith("cod")
    return cod
  })

  let expected = 0
  const perLineAmounts = new Map<string, number>()
  for (const l of collectableLines) {
    const orderTotal = Number(l.order?.total || 0)
    const collected = Number(l.amount_collected || 0)
    const amt = collected > 0 ? collected : orderTotal
    expected += orderTotal
    perLineAmounts.set(l.id, amt)
  }
  const submitted = expected // mặc định = expected; user có thể chỉnh trên trang phiếu thu

  // 4) Tạo header
  const receiptCode = generateReceiptCode()
  const { data: receipt, error: receiptErr } = await supabase
    .from("cash_receipts")
    .insert({
      org_id: delivery.org_id,
      receipt_code: receiptCode,
      source_type: "delivery_settle",
      source_id: delivery.id,
      collected_by: delivery.driver_id || null,
      submitted_amount: submitted,
      expected_amount: expected,
      notes: null,
      status: "pending",
      created_by: userId,
    })
    .select("id")
    .single()
  if (receiptErr || !receipt) {
    throw receiptErr || new Error("Không tạo được phiếu thu")
  }
  const receiptId = (receipt as { id: string }).id

  // 5) Tạo receivable + payment + cash_receipt_lines per line
  const receiptLineRows: Array<{
    receipt_id: string
    order_id: string
    receivable_id: string | null
    payment_id: string | null
    amount: number
    notes: string | null
  }> = []

  for (const l of collectableLines) {
    const amt = perLineAmounts.get(l.id) || 0
    if (amt <= 0 || !l.order) continue

    await ensureReceivableForOrder(supabase, l.order.id)
    const { data: rec } = await supabase
      .from("receivables")
      .select("id, amount, paid")
      .eq("order_id", l.order.id)
      .maybeSingle()
    if (!rec) continue
    const recRow = rec as { id: string; amount: number | null; paid: number | null }

    const newPaid = Number(recRow.paid || 0) + amt
    const recAmount = Number(recRow.amount || 0)
    const status =
      newPaid >= recAmount ? "paid" : newPaid > 0 ? "partial" : "open"
    const method = l.payment_method === "cod_transfer" ? "transfer" : "cash"

    const { data: payment } = await supabase
      .from("payments")
      .insert({
        receivable_id: recRow.id,
        collected_by: userId,
        amount: amt,
        method,
        collected_at: new Date().toISOString(),
        verified_at: null,
      })
      .select("id")
      .single()

    await supabase
      .from("receivables")
      .update({ paid: newPaid, status })
      .eq("id", recRow.id)

    // Persist amount_collected back to delivery_line
    if (Number(l.amount_collected || 0) !== amt) {
      await supabase
        .from("delivery_lines")
        .update({ amount_collected: amt })
        .eq("id", l.id)
    }

    receiptLineRows.push({
      receipt_id: receiptId,
      order_id: l.order.id,
      receivable_id: recRow.id,
      payment_id: (payment as { id: string } | null)?.id || null,
      amount: amt,
      notes: null,
    })
  }

  if (receiptLineRows.length > 0) {
    await supabase.from("cash_receipt_lines").insert(receiptLineRows)
  }

  // 6) Stamp delivery as settled
  await supabase
    .from("deliveries")
    .update({
      settled_at: new Date().toISOString(),
      settled_amount: submitted,
    })
    .eq("id", delivery.id)

  return {
    receiptId,
    receiptCode,
    reused: false,
    expected,
    submitted,
  }
}
