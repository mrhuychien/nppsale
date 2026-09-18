import type { OfflineOrderPayload, OfflineReturnLine } from "@/lib/orders/create"
import { insertReturnLines } from "@/lib/orders/create"
import type { ReturnCartLine } from "@/lib/sell/returns"
import { conversionFor, unitPriceFor } from "@/lib/sell/pricing"
import type { SellProduct } from "@/lib/sell/ref-data"
import type { CartLine } from "@/lib/sell/cart"
import { toOrderLine } from "@/lib/sell/create-order"
import { decideStatus, type StatusDecisionInput } from "@/lib/sell/submit"

/**
 * Sửa một đơn đã lưu, bằng CHÍNH màn bán hàng.
 *
 * VÌ SAO KHÔNG SỬA Ở MÀN CHI TIẾT ĐƠN
 *   Màn chi tiết là màn ĐỌC: bảng dòng hàng, lịch sử trạng thái, công nợ,
 *   hoá đơn. Nhét phần sửa vào đó thì NVBH phải học hai cách nhập hàng
 *   khác nhau cho cùng một việc — một cách để tạo đơn, một cách để sửa nó.
 *   Nay "Sửa đơn" nạp đơn ngược vào giỏ và mở đúng màn đã dùng lúc tạo.
 */

export interface OrderLineRow {
  product_id: string
  unit_name: string
  quantity: number
  unit_price: number
  conversion_factor?: number | null
  note?: string | null
}

/**
 * Đổi dòng đơn đã lưu thành dòng giỏ.
 *
 * ⚠ `listPrice` TÍNH LẠI theo bảng giá hiện tại, không lấy `unit_price`.
 * Hai con số đó khác nhau chính là thứ màn giỏ dùng để gắn nhãn "Giá sửa"
 * và để chặn giá dưới sàn. Gán bằng nhau là xoá sạch dấu vết một đơn từng
 * bị sửa giá — và lần lưu sau nó đi qua mọi chốt như một đơn bình thường.
 *
 * ⚠ `conversion` ưu tiên HỆ SỐ ĐÃ CHỐT trong đơn. Quy cách đóng gói có
 * thể đã đổi từ lúc tạo; lấy hệ số mới là âm thầm đổi số lượng xuất kho
 * của một đơn đã thoả thuận với khách.
 */
export function orderLinesToCart(
  rows: OrderLineRow[],
  products: SellProduct[],
  groupId: string | null | undefined
): CartLine[] {
  const byId = new Map(products.map((p) => [p.id, p]))
  return rows.map((r) => {
    const p = byId.get(r.product_id)
    return {
      productId: r.product_id,
      unit: r.unit_name,
      qty: Number(r.quantity) || 1,
      price: Number(r.unit_price) || 0,
      listPrice: p ? unitPriceFor(p, r.unit_name, groupId) : Number(r.unit_price) || 0,
      note: r.note ?? "",
      conversion:
        Number(r.conversion_factor) || (p ? conversionFor(p, r.unit_name) : 1),
      vatRate: Number(p?.vat_rate ?? 0),
    }
  })
}

/**
 * Trạng thái đơn SAU khi lưu bản sửa.
 *
 * ⚠ KHÔNG dùng thẳng `decideStatus` như lúc tạo đơn mới. Đơn ĐÃ DUYỆT có
 * thêm một vế: người vừa sửa có tự duyệt được mức đó không. Bắt quản lý
 * duyệt lại đơn do chính quản lý vừa sửa là thêm một bước mà không thêm
 * chốt chặn nào — `needsReapprovalAfterEdit` giữ đúng vế đó, và màn chi
 * tiết đơn cũng đang dùng chính nó. Hai đường sửa phải ra cùng kết quả,
 * nếu không thì sửa cùng một đơn ở hai màn cho ra hai trạng thái khác nhau.
 */
export function decideEditStatus(i: {
  /** Trạng thái đơn TRƯỚC khi sửa. */
  prevStatus: "draft" | "submitted"
  decision: StatusDecisionInput
}): { status: "draft" | "submitted"; reason: string } {
  // Workflow v2 bỏ bước duyệt, nên sửa đơn không còn khái niệm "duyệt
  // lại": bấm Lưu nháp thì rút đơn về nháp, bấm Gửi đơn thì nó là phiếu
  // tạm. Trạng thái trước khi sửa không đổi được kết quả đó.
  void i.prevStatus
  return decideStatus(i.decision)
}

/** Đơn ở trạng thái này thì sửa được bằng màn bán hàng. */
export const SELL_EDITABLE_STATUSES = ["draft", "submitted"] as const

export function isSellEditable(status: string): boolean {
  return (SELL_EDITABLE_STATUSES as readonly string[]).includes(status)
}

/**
 * Câu nhắc trên đầu giỏ khi đang sửa đơn.
 *
 * ⚠ Nói rõ đơn đang ở đâu. Phiếu tạm là đã gửi cho nhà phân phối nhưng
 * hàng chưa rời kho; bấm Lưu nháp là RÚT ĐƠN VỀ, nhà phân phối không thấy
 * nữa. Biết điều đó sau khi bấm thì đã muộn.
 */
export function editHint(status: string): string {
  return status === "submitted"
    ? "Đơn đang là phiếu tạm. Lưu nháp sẽ rút đơn về, nhà phân phối không thấy nữa."
    : "Đơn chưa gửi. Sửa xong bấm Gửi đơn để nhà phân phối xuất hàng."
}

type Client = {
  from: (t: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/* ===================================================================
 * HÀNG TRẢ / HÀNG ĐỔI KÈM ĐƠN, KHI SỬA ĐƠN
 * ===================================================================
 *
 * Chủ nhà báo: bấm "Sửa đơn" thì phần hàng trả lại và hàng đổi biến mất.
 *
 * Đúng vậy, và nó cố ý — màn `/sell/edit/[id]` nạp `returnLines: []` kèm
 * chú thích "lưu lại sẽ tạo thêm một phiếu trả thứ hai cho cùng số hàng".
 * Lý do đó thật: `createOrderRecords` luôn CHÈN phiếu trả mới, còn
 * `applyOrderEdit` thì không hề đụng tới phiếu trả.
 *
 * ⚠ NHƯNG GIẢI PHÁP ẤY SAI CHỖ. Nó tránh nhân đôi dữ liệu bằng cách GIẤU
 * dữ liệu: người sửa đơn không thấy hàng trả của chính đơn mình đang
 * sửa, nên tưởng nó mất, và có người sẽ nhập lại — đúng cái nhân đôi mà
 * nó định tránh. Cách đúng là NẮM lấy phiếu trả ấy: nạp lên để sửa, và
 * lúc lưu thì ghi đè chính nó.
 */

/** Phiếu trả kèm đơn, đọc lên để màn sửa đơn nạp vào giỏ. */
export interface PendingReturnRow {
  id: string
  reason: string | null
  notes: string | null
  status: string
  invoice_id: string | null
  lines: Array<{
    product_id: string
    unit_name: string
    quantity: number
    unit_price: number
    vat_rate?: number | null
    is_exchange?: boolean | null
    note?: string | null
  }>
}

/**
 * Phiếu trả mà màn sửa đơn được phép nắm và ghi đè.
 *
 * ⚠ CHỈ PHIẾU CÒN NHÁP VÀ CHƯA GẮN HÓA ĐƠN. Phiếu đã 'submitted' là hàng
 * đã theo chuyến đi rồi; phiếu đã gắn `invoice_id` thuộc về một tờ hóa
 * đơn đã ghi sổ. Ghi đè hai loại đó từ màn bán hàng là sửa một chứng từ
 * đang có hiệu lực mà không đi qua RPC nào.
 *
 * ⚠ CÓ TỪ HAI PHIẾU NHÁP TRỞ LÊN THÌ KHÔNG NẮM CÁI NÀO. Màn giỏ chỉ có
 * MỘT ô hàng trả với MỘT lý do; nạp hai phiếu vào đó rồi lưu là gộp
 * chúng thành một và xoá mất phiếu kia. Trả `null` để màn sửa đơn để
 * nguyên và nói ra.
 */
export function editableReturnOf(
  rows: readonly PendingReturnRow[]
): PendingReturnRow | null {
  const own = rows.filter((r) => r.status === "draft" && !r.invoice_id)
  return own.length === 1 ? own[0] : null
}

/** Dòng phiếu trả đã lưu → dòng giỏ hàng trả. */
export function returnLinesToCart(r: PendingReturnRow): ReturnCartLine[] {
  return r.lines.map((l) => ({
    productId: l.product_id,
    unit: l.unit_name,
    qty: Number(l.quantity) || 0,
    price: Number(l.unit_price) || 0,
    vatRate: Number(l.vat_rate ?? 0),
    // ⚠ MẶC ĐỊNH `false` LÀ ĐÚNG HƯỚNG AN TOÀN. Cột thiếu / null thì coi
    //   là dòng TRẢ (có trừ tiền) chứ không phải dòng ĐỔI. Đoán ngược lại
    //   là âm thầm bỏ mất một khoản giảm công nợ của khách.
    isExchange: l.is_exchange === true,
    note: l.note ?? "",
  }))
}

/**
 * Ghi thay đổi xuống đơn đã có.
 *
 * ⚠ XOÁ RỒI CHÈN LẠI TOÀN BỘ DÒNG. Chỉ an toàn vì màn này chỉ sửa được
 * đơn `draft`/`confirmed` — hai trạng thái chưa có phiếu xuất kho nào trỏ
 * vào dòng hàng. Nới sang `picking` là làm đứt liên kết lô đã pick.
 */
export async function applyOrderEdit(
  supabase: Client,
  opts: {
    orderId: string
    payload: OfflineOrderPayload
    cart: CartLine[]
    status: "draft" | "submitted"
    reason: string
    userId: string
    orgId: string
    /**
     * Phiếu trả màn sửa đơn đang nắm (`editableReturnOf`), hoặc `null`.
     * `undefined` nghĩa là chưa đọc được — khi đó KHÔNG đụng gì tới phiếu
     * trả, xem `syncOrderReturn`.
     */
    heldReturnId?: string | null
  }
): Promise<void> {
  // ⚠ THỨ TỰ Ở ĐÂY LÀ CÓ CHỦ Ý: DÒNG HÀNG TRƯỚC, ĐẦU ĐƠN SAU.
  //
  // Phép xoá là phép DUY NHẤT hỏng mà không báo — RLS từ chối thì Postgres
  // xoá 0 dòng, PostgREST trả HTTP 200 và `error` là null. Để nó chạy
  // trước và bắt lỗi ngay thì khi từ chối, CHƯA có gì bị đổi. Làm ngược
  // lại — sửa đầu đơn xong mới xoá — thì đơn còn tổng tiền mới trên bộ
  // dòng hàng cũ, và không ai biết vì sao hai con số không khớp.
  const { error: delErr } = await supabase
    .from("sales_order_lines")
    .delete()
    .eq("order_id", opts.orderId)
  if (delErr) throw delErr

  // ⚠ ĐỌC LẠI, BẮT PHẢI RỖNG, TRƯỚC KHI CHÈN. Xoá bị từ chối mà vẫn chèn
  // tiếp thì đơn có HAI bộ dòng hàng: bộ cũ còn nguyên cộng bộ mới. Kho
  // lấy gấp đôi số hàng và hoá đơn ghi gấp đôi tiền.
  const { data: left, error: checkErr } = await supabase
    .from("sales_order_lines")
    .select("id")
    .eq("order_id", opts.orderId)
    .limit(1)
  if (checkErr) throw checkErr
  if (left && left.length > 0) {
    throw new Error(
      "Không xoá được dòng hàng cũ nên chưa lưu được — bạn không còn quyền sửa đơn này. Tải lại đơn để xem trạng thái mới."
    )
  }

  if (opts.cart.length > 0) {
    const lines = opts.cart.map((l) => ({ order_id: opts.orderId, ...toOrderLine(l) }))
    const { error: insErr } = await supabase.from("sales_order_lines").insert(lines)
    if (insErr) throw insErr
  }

  const header: Record<string, unknown> = {
    payment_terms: opts.payload.order.payment_terms,
    expected_delivery: opts.payload.order.expected_delivery,
    subtotal: opts.payload.order.subtotal,
    vat: opts.payload.order.vat,
    total: opts.payload.order.total,
    notes: opts.payload.order.notes,
    status: opts.status,
    approval_reason: opts.reason || null,
    // Workflow v2 không còn bước duyệt: hai cột này là dấu vết của luồng
    // cũ, dọn hẳn để không ai đọc nhầm là đơn đã được ai đó thông qua.
    approved_by: null,
    approved_at: null,
  }

  const { data: rows, error: headErr } = await supabase
    .from("sales_orders")
    .update(header)
    .eq("id", opts.orderId)
    .select("id")
  if (headErr) throw headErr
  // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi.
  if (!rows || rows.length === 0) {
    throw new Error(
      "Đã sửa dòng hàng nhưng KHÔNG cập nhật được tổng đơn — bạn không còn quyền sửa đơn này. Mở lại đơn để kiểm tra."
    )
  }

  await syncOrderReturn(supabase, {
    orderId: opts.orderId,
    customerId: opts.payload.order.customer_id,
    orgId: opts.orgId,
    userId: opts.userId,
    heldReturnId: opts.heldReturnId,
    reason: opts.payload.returns?.reason ?? null,
    notes: opts.payload.returns?.notes ?? null,
    lines: opts.payload.returnLines,
  })
}

/**
 * Ghi phần hàng trả / hàng đổi của bản sửa xuống đúng MỘT phiếu trả.
 *
 * ⚠ `heldReturnId === undefined` LÀ "KHÔNG BIẾT", KHÔNG PHẢI "KHÔNG CÓ".
 * Màn sửa đơn đọc phiếu trả hỏng, hoặc đơn có nhiều phiếu nháp nên không
 * nắm cái nào — cả hai đều về đây là `undefined`. Khi đó đứng yên: tạo
 * phiếu mới là nhân đôi hàng trả, xoá phiếu cũ là mất hẳn nó.
 *
 * ⚠ CHẠY SAU CÙNG, SAU KHI ĐẦU ĐƠN ĐÃ LƯU. Phiếu trả là phần phụ; hỏng ở
 * đây thì đơn vẫn đúng và người dùng mở lại đơn là thấy phiếu trả cũ còn
 * nguyên. Làm trước rồi đầu đơn hỏng mới là cảnh xấu: hàng trả theo số
 * mới, đơn theo số cũ.
 */
export async function syncOrderReturn(
  supabase: Client,
  o: {
    orderId: string
    customerId: string
    orgId: string
    userId: string
    heldReturnId?: string | null
    reason: string | null
    notes: string | null
    lines: OfflineReturnLine[]
  }
): Promise<void> {
  if (o.heldReturnId === undefined) return

  // Không còn dòng nào: người sửa đã bỏ hết hàng trả. Xoá hẳn phiếu —
  // phiếu nháp rỗng không nói được gì, và nó vẫn nằm trên màn chi tiết
  // đơn như một phiếu trả có thật.
  if (o.lines.length === 0) {
    if (!o.heldReturnId) return
    // ⚠ RLS từ chối = 0 dòng, HTTP 200, `error` null. Phải `.select` rồi
    //   đếm, nếu không thì người dùng thấy "đã lưu" mà phiếu trả vẫn còn.
    const { data: del, error: delErr } = await supabase
      .from("returns")
      .delete()
      .eq("id", o.heldReturnId)
      .select("id")
    if (delErr) throw delErr
    if (!del || del.length === 0) {
      throw new Error(
        "Đã lưu đơn nhưng KHÔNG xoá được phiếu trả cũ — bạn không có quyền sửa phiếu trả này. Mở đơn ra xoá tay."
      )
    }
    return
  }

  if (o.heldReturnId) {
    /**
     * ⚠ KHÔNG GHI `notes` Ở ĐÂY. `buildOrderPayload` luôn đặt
     * `returns.notes = null` vì màn giỏ không có ô ghi chú cho phiếu trả.
     * Ghi nó xuống là mỗi lần sửa đơn lại xoá trắng ghi chú ai đó đã viết
     * ở màn Trả hàng — đúng kiểu "gán null vào cột đang có giá trị tốt".
     * Khi nào màn giỏ có ô ghi chú riêng cho hàng trả thì mở lại.
     */
    const { data: upd, error: updErr } = await supabase
      .from("returns")
      .update({ reason: o.reason })
      .eq("id", o.heldReturnId)
      .select("id")
    if (updErr) throw updErr
    if (!upd || upd.length === 0) {
      throw new Error(
        "Đã lưu đơn nhưng KHÔNG cập nhật được phiếu trả kèm theo — bạn không có quyền sửa phiếu trả này."
      )
    }

    // ⚠ XOÁ RỒI CHÈN LẠI, VÀ ĐỌC LẠI BẮT PHẢI RỖNG. Giống hệt lý do ở
    //   dòng hàng bên trên: xoá bị từ chối mà vẫn chèn tiếp thì phiếu trả
    //   có hai bộ dòng, và công nợ của khách bị trừ gấp đôi khi phiếu
    //   được hoàn thành.
    const { error: dlErr } = await supabase
      .from("return_lines")
      .delete()
      .eq("return_id", o.heldReturnId)
    if (dlErr) throw dlErr
    const { data: left, error: chkErr } = await supabase
      .from("return_lines")
      .select("id")
      .eq("return_id", o.heldReturnId)
      .limit(1)
    if (chkErr) throw chkErr
    if (left && left.length > 0) {
      throw new Error(
        "Đã lưu đơn nhưng KHÔNG xoá được dòng hàng trả cũ — chưa ghi hàng trả mới để tránh ghi đôi. Mở phiếu trả ra sửa tay."
      )
    }
    await insertReturnLines(supabase, o.heldReturnId, o.lines)
    return
  }

  // Đơn chưa có phiếu trả nào mà bản sửa vừa nhập vào: tạo mới, đúng
  // khuôn `createOrderRecords` dùng lúc tạo đơn.
  const { data: retRow, error: retErr } = await supabase
    .from("returns")
    .insert({
      org_id: o.orgId,
      order_id: o.orderId,
      customer_id: o.customerId,
      requested_by: o.userId,
      reason: o.reason,
      notes: o.notes,
      status: "draft",
    })
    .select("id")
    .single()
  if (retErr || !retRow) {
    throw new Error(
      `Đã lưu đơn nhưng KHÔNG lưu được phiếu trả kèm theo${
        retErr ? `: ${retErr.message}` : ""
      }. Mở đơn ra nhập lại hàng trả.`
    )
  }
  await insertReturnLines(supabase, (retRow as { id: string }).id, o.lines)
}
