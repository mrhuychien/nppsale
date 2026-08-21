import type { SupabaseClient } from "@supabase/supabase-js"

/** Payload đơn hàng dạng tuần tự hoá — lưu được vào IndexedDB (outbox)
 *  và phát lại khi đồng bộ. Mọi giá trị đã tính sẵn tại thời điểm tạo
 *  (kể cả conversion_factor) nên khi đẩy lên không cần dữ liệu sản phẩm. */
export interface OfflineOrderLine {
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  line_discount: number
  line_total: number
  conversion_factor: number
  note?: string
}

export interface OfflineReturnLine {
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  vat_rate: number
  line_total: number
  is_exchange: boolean
  note?: string
}

export interface OfflineOrderPayload {
  clientRequestId: string
  order: {
    order_code: string
    customer_id: string
    payment_terms: string
    expected_delivery: string | null
    subtotal: number
    vat: number
    total: number
    notes: string | null
  }
  lines: OfflineOrderLine[]
  returns: { reason: string; notes: string | null } | null
  returnLines: OfflineReturnLine[]
  /** Thông tin hiển thị trong danh sách đơn chờ đồng bộ. */
  meta: { customerName: string; total: number; createdAt: string; lineCount: number }
}

type Client = SupabaseClient

function isMissingColumn(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false
  const msg = (err.message || "").toLowerCase()
  return (
    err.code === "PGRST204" ||
    msg.includes("column") ||
    msg.includes("note") ||
    msg.includes("conversion_factor") ||
    msg.includes("is_exchange") ||
    msg.includes("vat_rate")
  )
}

/**
 * Ghi 1 đơn (đã tạo offline) vào DB, luôn ở trạng thái `draft` để luồng
 * duyệt/kiểm tồn hiện có xử lý khi lên mạng. Idempotent theo
 * client_request_id: gọi lại (thử đồng bộ nhiều lần) không tạo đơn trùng.
 * Chạy ở phía online (khi đồng bộ) nên có mạng.
 */
export async function createOrderRecords(
  supabase: Client,
  payload: OfflineOrderPayload,
  ctx: { userId: string; orgId: string }
): Promise<{ orderId: string; alreadyExisted: boolean }> {
  // 1) Đơn — idempotent trên client_request_id.
  const { data: inserted, error: orderErr } = await supabase
    .from("sales_orders")
    .insert({
      org_id: ctx.orgId,
      sales_user_id: ctx.userId,
      client_request_id: payload.clientRequestId,
      order_code: payload.order.order_code,
      customer_id: payload.order.customer_id,
      payment_terms: payload.order.payment_terms || "COD",
      expected_delivery: payload.order.expected_delivery,
      subtotal: payload.order.subtotal,
      vat: payload.order.vat,
      total: payload.order.total,
      notes: payload.order.notes,
      status: "draft",
      approval_reason: "Tạo offline — chờ kiểm tra tồn/công nợ khi lên mạng",
    })
    .select("id")
    .single()

  if (orderErr) {
    // 23505 = trùng client_request_id → đơn đã được đẩy ở lần thử trước.
    if ((orderErr as { code?: string }).code === "23505") {
      const { data: existing } = await supabase
        .from("sales_orders")
        .select("id")
        .eq("client_request_id", payload.clientRequestId)
        .maybeSingle()
      if (existing?.id) return { orderId: existing.id as string, alreadyExisted: true }
    }
    throw orderErr
  }

  const orderId = (inserted as { id: string }).id

  // 2) Dòng hàng — có fallback nếu DB thiếu cột note/conversion_factor.
  const lineRows = payload.lines.map((l) => ({
    order_id: orderId,
    product_id: l.product_id,
    unit_name: l.unit_name,
    quantity: l.quantity,
    unit_price: l.unit_price,
    line_discount: l.line_discount,
    line_total: l.line_total,
    conversion_factor: l.conversion_factor,
    ...(l.note ? { note: l.note } : {}),
  }))
  const { error: linesErr } = await supabase.from("sales_order_lines").insert(lineRows)
  if (linesErr) {
    if (!isMissingColumn(linesErr)) throw linesErr
    const stripped = payload.lines.map((l) => ({
      order_id: orderId,
      product_id: l.product_id,
      unit_name: l.unit_name,
      quantity: l.quantity,
      unit_price: l.unit_price,
      line_discount: l.line_discount,
      line_total: l.line_total,
    }))
    const { error: retryErr } = await supabase.from("sales_order_lines").insert(stripped)
    if (retryErr) throw retryErr
  }

  // 3) Hàng trả kèm theo (nếu có).
  if (payload.returns && payload.returnLines.length > 0) {
    const { data: retRow, error: retErr } = await supabase
      .from("returns")
      .insert({
        org_id: ctx.orgId,
        order_id: orderId,
        customer_id: payload.order.customer_id,
        requested_by: ctx.userId,
        reason: payload.returns.reason,
        notes: payload.returns.notes,
        status: "pending",
      })
      .select("id")
      .single()
    if (!retErr && retRow) {
      const retId = (retRow as { id: string }).id
      const retLineRows = payload.returnLines.map((l) => ({
        return_id: retId,
        product_id: l.product_id,
        unit_name: l.unit_name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        vat_rate: l.vat_rate,
        line_total: l.line_total,
        is_exchange: l.is_exchange,
        ...(l.note ? { note: l.note } : {}),
      }))
      const { error: rlErr } = await supabase.from("return_lines").insert(retLineRows)
      if (rlErr && isMissingColumn(rlErr)) {
        const stripped = payload.returnLines.map((l) => ({
          return_id: retId,
          product_id: l.product_id,
          unit_name: l.unit_name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: l.line_total,
        }))
        const { error: strippedErr } = await supabase.from("return_lines").insert(stripped)
        if (strippedErr) throw strippedErr
      }
    }
  }

  return { orderId, alreadyExisted: false }
}
