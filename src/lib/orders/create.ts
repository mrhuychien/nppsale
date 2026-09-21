import type { SupabaseClient } from "@supabase/supabase-js"
import { DRAFT_APPROVAL_REASON } from "@/lib/orders/save-gate"

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
    /**
     * NHÂN VIÊN ĐỨNG TÊN ĐƠN — rỗng nghĩa là chính người đang lập.
     *
     * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "NPP tạo đơn xong chọn nhân viên ->
     *   thành đơn hàng của nhân viên".
     *
     * ⚠ NẰM TRONG TẢI TRỌNG, KHÔNG NẰM Ở `ctx`. Đơn lập lúc mất mạng
     *   nằm trong hàng đợi rồi mới ghi khi có mạng, và `ctx` lúc ấy
     *   dựng lại từ người ĐANG đăng nhập. Để lựa chọn ở `ctx` là NPP
     *   chọn nhân viên A, mạng về, đơn ghi tên chính NPP — sai âm thầm,
     *   và chỉ lộ ra ở kỳ tính hoa hồng.
     *
     * ⚠ AI ĐƯỢC ĐẶT CỘT NÀY DO TRIGGER `trg_orders_guard_sales_user`
     *   (mig 153) QUYẾT, không do màn hình. RLS không canh cột này, mà
     *   hoa hồng và lương đều đếm theo nó.
     */
    sales_user_id?: string | null
  }
  lines: OfflineOrderLine[]
  /**
   * Trạng thái đơn sẽ mang khi được ghi xuống.
   *
   * ⚠ ĐI CÙNG ĐƠN VÀO HÀNG ĐỢI NGOẠI TUYẾN. Trước đây mọi đơn đều insert
   * `draft` rồi mới UPDATE lên trạng thái thật; đơn tạo lúc mất mạng thì
   * không có ai chạy bước UPDATE đó, nên nó nằm mãi ở nháp và nhà phân
   * phối không bao giờ nhìn thấy. Ghi thẳng trạng thái người dùng chọn.
   */
  targetStatus?: "draft" | "submitted"
  /** Cảnh báo kèm đơn cho NPP đọc trước khi xuất hàng. */
  approvalReason?: string | null
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
): Promise<{ orderId: string; orderCode: string; alreadyExisted: boolean }> {
  // 1) Đơn — idempotent trên client_request_id.
  const { data: inserted, error: orderErr } = await supabase
    .from("sales_orders")
    .insert({
      org_id: ctx.orgId,
      /* ⚠ TẢI TRỌNG THẮNG `ctx` — xem chú thích của trường ấy. Trigger
         mig 153 mới là chỗ quyết ai được đặt gì. */
      sales_user_id: payload.order.sales_user_id || ctx.userId,
      client_request_id: payload.clientRequestId,
      order_code: payload.order.order_code,
      customer_id: payload.order.customer_id,
      payment_terms: payload.order.payment_terms || "COD",
      expected_delivery: payload.order.expected_delivery,
      subtotal: payload.order.subtotal,
      vat: payload.order.vat,
      total: payload.order.total,
      notes: payload.order.notes,
      status: payload.targetStatus ?? "draft",
      approval_reason:
        payload.approvalReason ??
        (payload.targetStatus === "submitted"
          ? "Tạo offline — NPP kiểm tồn/công nợ trước khi xuất hàng"
          : DRAFT_APPROVAL_REASON),
    })
    .select("id, order_code")
    .single()

  if (orderErr) {
    // 23505 = trùng client_request_id → đơn đã được đẩy ở lần thử trước.
    if ((orderErr as { code?: string }).code === "23505") {
      const { data: existing, error: existingErr } = await supabase
        .from("sales_orders")
        .select("id, order_code")
        .eq("client_request_id", payload.clientRequestId)
        .maybeSingle()
      if (existingErr) console.error("[orders] truy vấn lỗi:", existingErr.message)
      if (existing?.id) {
        const row = existing as { id: string; order_code: string }
        return { orderId: row.id, orderCode: row.order_code, alreadyExisted: true }
      }
    }
    throw orderErr
  }

  /**
   * ⚠ ĐỌC LẠI MÃ TỪ DÒNG VỪA GHI, đừng dùng mã trình duyệt gửi lên.
   *   Trigger `trg_sales_orders_assign_code` (mig 130) cấp số thật và
   *   GHI ĐÈ mã tạm — mã tạm chỉ để xếp hàng ngoại tuyến. Trả mã tạm về
   *   cho màn "Đặt hàng xong" là in ra một số không tồn tại trong sổ, và
   *   nhân viên đọc số đó cho khách qua điện thoại.
   */
  const insertedRow = inserted as { id: string; order_code: string }
  const orderId = insertedRow.id

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
        // Phiếu trả kèm đơn nằm chờ: nó chỉ thành phiếu tạm khi đơn được
        // xuất hàng (RPC complete_order làm việc đó).
        status: "draft",
      })
      .select("id")
      .single()
    /**
     * ⚠ GHI HỎNG THÌ PHẢI NÓI RA. Trước đây cả khối dưới bọc trong
     * `if (!retErr && retRow)` mà KHÔNG có nhánh else: phiếu trả ghi
     * hỏng thì hàm này im lặng chạy tiếp và trả về thành công. Nhân viên
     * thấy màn "Đã gửi đơn", còn hàng trả của khách thì không tồn tại ở
     * đâu cả — và không ai biết cho tới lúc đối chiếu công nợ.
     *
     * ⚠ RLS từ chối cũng vào đây: `.single()` trên 0 dòng trả về lỗi
     * PGRST116 chứ không phải `retRow = null` lặng lẽ, nhưng kiểm cả hai
     * cho chắc — đây là chỗ đã từng nuốt lỗi một lần rồi.
     */
    if (retErr || !retRow) {
      throw new Error(
        `Đã lưu đơn ${payload.order.order_code} nhưng KHÔNG lưu được phiếu trả kèm theo${
          retErr ? `: ${retErr.message}` : ""
        }. Mở đơn ra nhập lại hàng trả.`
      )
    }
    await insertReturnLines(supabase, (retRow as { id: string }).id, payload.returnLines)
  }

  return { orderId, orderCode: insertedRow.order_code, alreadyExisted: false }
}

/**
 * Chèn dòng phiếu trả, có đường lùi khi cơ sở dữ liệu chưa có cột mới.
 *
 * ⚠ TÁCH RA VÌ CÓ HAI CHỖ GHI. Tạo đơn ghi phiếu trả lần đầu, sửa đơn
 * ghi lại phiếu trả ấy. Hai bản chép của cái phễu lùi này là chuyện
 * "máy chủ thiếu cột `is_exchange`" xử lý đúng ở một màn và nổ ở màn kia.
 *
 * ⚠ ĐƯỜNG LÙI BỎ MẤT `is_exchange` — và đó là một mất mát THẬT. Dòng đổi
 * hàng không trừ tiền; ghi nó thành dòng trả thường là trừ công nợ của
 * khách một khoản không có. Nên đường lùi chỉ để cứu dữ liệu khỏi mất
 * hẳn, và phải chạy trên máy chủ đã chạy đủ migration thì mới đúng.
 */
export async function insertReturnLines(
  // ⚠ NHẬN KIỂU TỐI THIỂU, không nhận `SupabaseClient`. `applyOrderEdit`
  //   dùng một kiểu rút gọn để test dựng được client giả; bắt nó dựng cả
  //   `SupabaseClient` thật chỉ để gọi `.from()` là biến mọi chốt thành
  //   một đống `as any`.
  supabase: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  returnId: string,
  lines: OfflineReturnLine[]
): Promise<void> {
  if (lines.length === 0) return
  const rows = lines.map((l) => ({
    return_id: returnId,
    product_id: l.product_id,
    unit_name: l.unit_name,
    quantity: l.quantity,
    unit_price: l.unit_price,
    vat_rate: l.vat_rate,
    line_total: l.line_total,
    is_exchange: l.is_exchange,
    ...(l.note ? { note: l.note } : {}),
  }))
  const { error } = await supabase.from("return_lines").insert(rows)
  if (error && isMissingColumn(error)) {
    const stripped = lines.map((l) => ({
      return_id: returnId,
      product_id: l.product_id,
      unit_name: l.unit_name,
      quantity: l.quantity,
      unit_price: l.unit_price,
      line_total: l.line_total,
    }))
    const { error: strippedErr } = await supabase.from("return_lines").insert(stripped)
    if (strippedErr) throw strippedErr
  } else if (error) {
    throw error
  }
}
