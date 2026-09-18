import type { OfflineOrderPayload } from "@/lib/orders/create"
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
}
