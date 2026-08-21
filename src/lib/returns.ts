import type { SupabaseClient } from "@supabase/supabase-js"

interface ReturnRow {
  id: string
  org_id: string
  order_id: string | null
  customer_id: string
  credit_note_amount: number | null
  status: string
  notes: string | null
}

interface ReturnLineRow {
  id: string
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_total: number
}

interface ProcessResult {
  ok: boolean
  entryId?: string
  error?: string
}

/**
 * Restock a single approved return:
 *  1. Create a stock_entries row (type='import', status='posted')
 *  2. For each return line: pick the latest existing batch (same product) and
 *     bump qty_on_hand, falling back to a new RESTOCK-<entryCode> batch.
 *  3. Insert a stock_entry_lines row with the chosen batch_id + qty.
 *  4. Recompute the receivable for the linked order (if any) so the credit
 *     note nets out from the customer's bill.
 *  5. Mark the return as 'completed'.
 *
 * Idempotent: if the return already has status='completed', short-circuits.
 */
export async function processApprovedReturn(
  supabase: SupabaseClient,
  returnId: string,
  userId: string
): Promise<ProcessResult> {
  const { data: ret } = await supabase
    .from("returns")
    .select("id, org_id, order_id, customer_id, credit_note_amount, status, notes")
    .eq("id", returnId)
    .single()
  const r = (ret as ReturnRow | null) ?? null
  if (!r) return { ok: false, error: "Không tìm thấy phiếu trả hàng" }
  if (r.status === "completed") return { ok: true }

  const { data: linesData } = await supabase
    .from("return_lines")
    .select("id, product_id, unit_name, quantity, unit_price, line_total")
    .eq("return_id", returnId)
  const lines = (linesData as ReturnLineRow[]) || []

  // 1. Stock entry header (skip when there are no lines — the return is
  //    a credit-note-only adjustment, just net the receivable).
  let entryId: string | undefined
  if (lines.length > 0) {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const entryCode = `NL-${today}-${Math.floor(1000 + Math.random() * 9000)}`
    const { data: entry, error: entryErr } = await supabase
      .from("stock_entries")
      .insert({
        org_id: r.org_id,
        entry_code: entryCode,
        type: "import",
        status: "posted",
        posted_at: new Date().toISOString(),
        created_by: userId,
        notes: `Nhập lại từ phiếu trả • ref: ${returnId.slice(0, 8)}`,
      })
      .select("id")
      .single()
    if (entryErr || !entry) {
      return { ok: false, error: entryErr?.message || "Không tạo được phiếu nhập" }
    }
    entryId = (entry as { id: string }).id

    // 2. Aggregate qty per product (lines may repeat with different units —
    //    we collapse to base for the batch step but keep one entry_line per
    //    return_line so the audit trail matches).
    const byProduct: Record<string, number> = {}
    for (const l of lines) {
      byProduct[l.product_id] = (byProduct[l.product_id] || 0) + Number(l.quantity || 0)
    }

    const productBatchMap: Record<string, { id: string; unit_cost: number }> = {}
    for (const productId of Object.keys(byProduct)) {
      const qty = byProduct[productId]
      if (qty <= 0) continue
      const { data: existingBatches } = await supabase
        .from("batches")
        .select("id, qty_on_hand, unit_cost")
        .eq("product_id", productId)
        .order("expires_at", { ascending: false })
        .limit(1)
      type B = { id: string; qty_on_hand: number; unit_cost: number }
      const first = (existingBatches as B[] | null)?.[0]
      if (first) {
        const newQty = Number(first.qty_on_hand || 0) + qty
        const { error: upErr } = await supabase
          .from("batches")
          .update({ qty_on_hand: newQty })
          .eq("id", first.id)
        if (upErr) {
          return { ok: false, error: `Không cộng được tồn kho khi nhập lại hàng trả: ${upErr.message}` }
        }
        productBatchMap[productId] = {
          id: first.id,
          unit_cost: Number(first.unit_cost) || 0,
        }
      } else {
        const batchCode = `RESTOCK-${entryCode}-${productId.slice(0, 4)}`
        const { data: newBatch, error: newBatchErr } = await supabase
          .from("batches")
          .insert({
            org_id: r.org_id,
            product_id: productId,
            batch_code: batchCode,
            expires_at: "2099-12-31",
            qty_initial: qty,
            qty_on_hand: qty,
            unit_cost: 0,
          })
          .select("id")
          .single()
        if (newBatchErr) {
          return { ok: false, error: `Không tạo được lô nhập lại hàng trả: ${newBatchErr.message}` }
        }
        const id = (newBatch as { id?: string } | null)?.id
        if (id) productBatchMap[productId] = { id, unit_cost: 0 }
      }
    }

    // 3. One stock_entry_lines row per return_line for traceability
    const entryLineRows = lines.map((l) => {
      const q = Number(l.quantity || 0)
      return {
        entry_id: entryId,
        product_id: l.product_id,
        batch_id: productBatchMap[l.product_id]?.id || null,
        unit_name: l.unit_name,
        quantity: q,
        qty_in_base_uom: q,
        qty_in_transaction_uom: q,
        transaction_uom: l.unit_name,
        conversion_factor_snapshot: 1,
        unit_cost: productBatchMap[l.product_id]?.unit_cost || 0,
        notes: "Nhập lại từ đơn trả",
      }
    })
    if (entryLineRows.length > 0) {
      const { error: linesErr } = await supabase
        .from("stock_entry_lines")
        .insert(entryLineRows)
      if (linesErr) {
        return { ok: false, error: `Không ghi được chi tiết phiếu nhập lại: ${linesErr.message}` }
      }
    }
  }

  // 4. Net receivable
  if (r.order_id) {
    await recomputeReceivableForOrder(supabase, r.order_id)
  }

  // 5. Mark return completed
  const { error: doneErr } = await supabase
    .from("returns")
    .update({ status: "completed" })
    .eq("id", returnId)
  if (doneErr) {
    return { ok: false, error: `Đã nhập kho nhưng không cập nhật được trạng thái phiếu trả: ${doneErr.message}` }
  }

  return { ok: true, entryId }
}

/**
 * Receivable = order.total minus the sum of credit_note_amount across all
 * approved+completed returns linked to that order. Creates the receivable
 * row if missing, updates the existing one otherwise, and adjusts paid/
 * status conservatively so partial collections aren't overwritten.
 */
export async function recomputeReceivableForOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<void> {
  const { data: order, error: orderErr } = await supabase
    .from("sales_orders")
    .select("id, org_id, customer_id, sales_user_id, total, payment_terms, order_date")
    .eq("id", orderId)
    .single()
  if (orderErr) console.error("[lib/returns] truy vấn lỗi:", orderErr.message)
  if (!order) return
  const o = order as {
    id: string
    org_id: string
    customer_id: string
    sales_user_id: string
    total: number
    payment_terms: string | null
    order_date: string | null
  }

  // Sum approved/completed return credits — pending/rejected returns don't
  // affect AR yet (they're proposed, not finalized).
  const { data: returns, error: returnsErr } = await supabase
    .from("returns")
    .select("credit_note_amount, status")
    .eq("order_id", orderId)
    .in("status", ["approved", "completed"])
  if (returnsErr) console.error("[lib/returns] truy vấn lỗi:", returnsErr.message)
  const credits = ((returns as Array<{ credit_note_amount: number | null; status: string }>) || [])
    .reduce((s, r) => s + Number(r.credit_note_amount || 0), 0)

  const netAmount = Math.max(0, Number(o.total || 0) - credits)

  const { data: existing, error: existingErr } = await supabase
    .from("receivables")
    .select("id, paid")
    .eq("order_id", orderId)
    .maybeSingle()
  if (existingErr) console.error("[lib/returns] truy vấn lỗi:", existingErr.message)

  if (existing) {
    const ex = existing as { id: string; paid: number }
    const paid = Number(ex.paid || 0)
    const status = paid >= netAmount ? "paid" : paid > 0 ? "partial" : "open"
    const { error: updErr } = await supabase
      .from("receivables")
      .update({ amount: netAmount, status })
      .eq("id", ex.id)
    if (updErr) {
      // Cùng lý do với nhánh insert bên dưới: hàm trả void nên không chặn
      // được luồng gọi. Công nợ giữ số cũ sau khi trả hàng = sai tiền thật.
      console.error("[recomputeReceivableForOrder] không cập nhật được công nợ:", updErr.message)
    }
    return
  }

  // No receivable yet → create with net amount
  const days = paymentTermsToDays(o.payment_terms)
  const baseDate = o.order_date ? new Date(o.order_date) : new Date()
  const dueDate = new Date(baseDate)
  dueDate.setDate(baseDate.getDate() + days)

  const { error: recErr } = await supabase.from("receivables").insert({
    org_id: o.org_id,
    order_id: o.id,
    customer_id: o.customer_id,
    sales_user_id: o.sales_user_id,
    amount: netAmount,
    paid: 0,
    due_date: dueDate.toISOString().slice(0, 10),
    status: "open",
  })
  if (recErr) {
    // Hàm này trả void nên không chặn được luồng gọi; ít nhất phải để lại
    // dấu vết thay vì nuốt im lặng — công nợ thiếu là sai tiền thật.
    console.error("[recomputeReceivableForOrder] không tạo được công nợ:", recErr.message)
  }
}

function paymentTermsToDays(terms: string | null | undefined): number {
  if (!terms) return 0
  const m = terms.match(/NET(\d+)/i)
  return m ? parseInt(m[1], 10) : 0
}
