import type { OfflineOrderLine, OfflineOrderPayload, OfflineReturnLine } from "@/lib/orders/create"
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

/** Dòng hàng ĐÃ CÓ của đơn — đúng những cột cần để so khớp. */
export interface ExistingOrderLine {
  id: string
  product_id: string
  unit_name: string
}

export interface OrderLinePlan {
  /** Dòng cũ giữ lại, ghi đè bằng số mới. */
  update: Array<{ id: string; row: OfflineOrderLine }>
  /** Dòng chưa từng có — chèn mới. */
  insert: OfflineOrderLine[]
  /** Dòng người dùng đã bỏ khỏi giỏ — xoá. */
  remove: Array<{ id: string; product_id: string }>
}

/**
 * SO KHỚP DÒNG CŨ VỚI DÒNG MỚI, THAY VÌ XOÁ SẠCH RỒI CHÈN LẠI.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026, kèm nguyên văn lỗi: `update or delete on
 * table "sales_order_lines" violates foreign key constraint
 * "sales_invoice_lines_order_line_id_fkey"` (mã 23503).
 *
 * NGUYÊN NHÂN. `applyOrderEdit` xoá HẾT `sales_order_lines` của đơn rồi
 * chèn lại bộ mới. Nhưng `sales_invoice_lines.order_line_id` trỏ vào
 * chính những dòng ấy, và khoá ngoại ấy là NO ACTION — nên hễ đơn TỪNG
 * được xuất hóa đơn là lệnh xoá bị từ chối.
 *
 * ⚠ VÀ HUỶ HÓA ĐƠN KHÔNG GỠ ĐƯỢC. `cancel_invoice` chỉ đổi
 * `sales_invoices.status`; dòng hóa đơn nằm nguyên, vì đó là bản ghi
 * của thứ đã bị huỷ — xoá đi là mất dấu vết. Hệ quả: một đơn đã xuất
 * hàng rồi huỷ hết hóa đơn thì VĨNH VIỄN không sửa được nữa, dù trạng
 * thái đã quay về Phiếu tạm và màn hình vẫn mời người dùng bấm Sửa.
 *
 * ⚠ KHOÁ SO KHỚP LÀ (SẢN PHẨM + ĐƠN VỊ), đúng khoá dòng của giỏ hàng.
 * Cùng một mặt hàng đặt 3 thùng và 5 chai là hai dòng khác nhau, và
 * chúng có thể khác giá.
 *
 * ⚠ HAI DÒNG CŨ TRÙNG KHOÁ THÌ CHỈ GIỮ MỘT. Dữ liệu cũ có thể có hai
 * dòng cùng (sản phẩm, đơn vị); khớp cả hai vào một dòng giỏ là ghi đè
 * hai lần rồi đơn cộng gấp đôi. Dòng thừa đi vào `remove`.
 */
export function planOrderLines(
  existing: readonly ExistingOrderLine[],
  next: readonly OfflineOrderLine[]
): OrderLinePlan {
  const key = (p: string, u: string) => `${p}|${u}`
  const con = new Map<string, ExistingOrderLine>()
  const thua: ExistingOrderLine[] = []
  for (const e of existing) {
    const k = key(e.product_id, e.unit_name)
    if (con.has(k)) thua.push(e)
    else con.set(k, e)
  }

  const plan: OrderLinePlan = { update: [], insert: [], remove: [] }
  const daDung = new Set<string>()
  for (const row of next) {
    const k = key(row.product_id, row.unit_name)
    const cu = con.get(k)
    /* ⚠ MỘT DÒNG CŨ CHỈ NHẬN MỘT DÒNG MỚI. Giỏ cũng khoá theo cùng cặp
       ấy nên thường không trùng, nhưng tải trọng đến từ hàng đợi ngoại
       tuyến của bản cũ thì có thể. */
    if (cu && !daDung.has(cu.id)) {
      daDung.add(cu.id)
      plan.update.push({ id: cu.id, row })
    } else {
      plan.insert.push(row)
    }
  }
  for (const e of Array.from(con.values()).concat(thua)) {
    if (!daDung.has(e.id)) plan.remove.push({ id: e.id, product_id: e.product_id })
  }
  return plan
}

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
    /**
     * Tên mặt hàng, để câu báo lỗi gọi đúng tên thay vì một mã UUID.
     *
     * ⚠ NHẬN QUA HÀM, KHÔNG NHẬN CẢ DANH MỤC. Nơi gọi đã có sẵn
     * `productById`; bắt nó truyền cả danh mục 1.700 mã vào đây chỉ để
     * dựng một câu lỗi là kéo theo một phụ thuộc không cần thiết.
     */
    productName?: (productId: string) => string | undefined
    /**
     * Người đứng tên đơn sau khi sửa.
     *
     * ⚠ BA GIÁ TRỊ, KHÔNG PHẢI HAI — giống `heldReturnId`.
     *   `string`    = ghi đè `sales_user_id` bằng người này;
     *   `undefined` = KHÔNG ĐỤNG TỚI cột (người sửa không có quyền đổi);
     *   `null`      = cũng KHÔNG ĐỤNG TỚI.
     *
     * ⚠ VÌ SAO `null` KHÔNG ĐƯỢC GHI XUỐNG. Đơn không có người đứng tên
     *   là một dòng doanh số không ai nhận, và nó chỉ lộ ra ở kỳ tính
     *   lương. `createOrderRecords` cũng không bao giờ để cột này rỗng
     *   (`payload.order.sales_user_id || ctx.userId`). Muốn chuyển đơn
     *   về tên mình thì truyền THẲNG mã của mình, đừng truyền rỗng.
     */
    salesUserId?: string | null
  }
): Promise<void> {
  /**
   * ⚠ SO KHỚP RỒI SỬA TẠI CHỖ — KHÔNG XOÁ SẠCH RỒI CHÈN LẠI.
   *
   * Bản cũ xoá hết `sales_order_lines` của đơn rồi chèn bộ mới. Chủ nhà
   * báo 21/09/2026 kèm nguyên văn: khoá ngoại
   * `sales_invoice_lines_order_line_id_fkey` (mã 23503) chặn lệnh xoá,
   * vì dòng hóa đơn trỏ vào chính những dòng đơn ấy — kể cả hóa đơn ĐÃ
   * HUỶ, vì `cancel_invoice` chỉ đổi trạng thái chứ không xoá dòng.
   *
   * Hệ quả của bản cũ: một đơn từng xuất hàng rồi huỷ hết hóa đơn thì
   * VĨNH VIỄN không sửa được, dù trạng thái đã quay về Phiếu tạm và màn
   * hình vẫn mời người dùng bấm Sửa. Xem `planOrderLines`.
   *
   * ⚠ THỨ TỰ: XOÁ TRƯỚC, RỒI SỬA, RỒI CHÈN. Xoá là phép duy nhất có thể
   * bị từ chối — cả bởi RLS (0 dòng, HTTP 200, `error` null) lẫn bởi
   * khoá ngoại. Để nó chạy đầu thì khi hỏng, CHƯA có gì bị đổi.
   */
  const { data: cu, error: readErr } = await supabase
    .from("sales_order_lines")
    .select("id, product_id, unit_name")
    .eq("order_id", opts.orderId)
  if (readErr) throw readErr

  const plan = planOrderLines(
    (cu as ExistingOrderLine[]) ?? [],
    opts.cart.map(toOrderLine)
  )

  if (plan.remove.length > 0) {
    const ids = plan.remove.map((r) => r.id)
    const { data: del, error: delErr } = await supabase
      .from("sales_order_lines")
      .delete()
      .in("id", ids)
      .select("id")
    if (delErr) {
      /**
       * ⚠ DỊCH MÃ 23503 THÀNH CÂU NGƯỜI ĐỌC ĐƯỢC. Dòng bị bỏ khỏi giỏ
       *   nhưng đang nằm trên một hóa đơn CÒN HIỆU LỰC; xoá nó là mất
       *   dấu vết của hàng đã rời kho, nên cơ sở dữ liệu từ chối và
       *   ĐÚNG. Việc của chỗ này là nói ra mặt hàng nào, và lối đi tiếp.
       *
       * ⚠ CÂU NÀY TỪNG NÓI SAI MỘT VẾ, và chủ nhà bắt được 22/09/2026:
       *   nó ghi "kể cả khi đã huỷ". Hồi ấy đúng — hóa đơn huỷ rồi mà
       *   dòng hóa đơn vẫn trỏ vào dòng đơn, nên khoá ngoại chặn vĩnh
       *   viễn. Migration 162 sửa chỗ ấy: huỷ hóa đơn là nhả móc nối.
       *   Giữ nguyên câu cũ thì màn hình dạy người dùng một luật đã
       *   chết, và họ đi huỷ hóa đơn xong vẫn tin là mình bó tay.
       */
      if ((delErr as { code?: string }).code === "23503") {
        const ten = plan.remove
          .map((r) => opts.productName?.(r.product_id))
          .filter(Boolean)
          .join(", ")
        throw new Error(
          `Không bỏ được ${ten ? `mặt hàng ${ten}` : "một mặt hàng"} khỏi đơn: ` +
            "nó đang nằm trên một tờ hóa đơn CÒN HIỆU LỰC của đơn này, tức " +
            "hàng đã rời kho. Giữ dòng đó lại và đặt số lượng về 0, sửa các " +
            "dòng khác rồi lưu, hoặc huỷ tờ hóa đơn ấy trước rồi bỏ dòng."
        )
      }
      throw delErr
    }
    // ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi.
    if (!del || del.length !== ids.length) {
      throw new Error(
        "Không xoá được dòng hàng cũ nên chưa lưu được — bạn không còn quyền sửa đơn này. Tải lại đơn để xem trạng thái mới."
      )
    }
  }

  for (const u of plan.update) {
    const { data: upd, error: updErr } = await supabase
      .from("sales_order_lines")
      .update(u.row)
      .eq("id", u.id)
      .select("id")
    if (updErr) throw updErr
    if (!upd || upd.length === 0) {
      throw new Error(
        "Không sửa được dòng hàng nên chưa lưu được — bạn không còn quyền sửa đơn này. Tải lại đơn để xem trạng thái mới."
      )
    }
  }

  if (plan.insert.length > 0) {
    const rows = plan.insert.map((r) => ({ order_id: opts.orderId, ...r }))
    const { error: insErr } = await supabase.from("sales_order_lines").insert(rows)
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

  /**
   * ⚠ CHỦ NHÀ BÁO 21/09/2026: "Sửa -> gán nhân viên lưu lại đơn ko hiệu
   *   lực, đơn vẫn đứng tên NPP".
   *
   * Đúng vậy: đầu đơn ở trên KHÔNG hề có `sales_user_id`. Màn giỏ có ô
   * chọn nhân viên, nhưng ô ấy chỉ đi vào tải trọng dùng lúc TẠO đơn —
   * đường SỬA đơn đọc xong rồi bỏ đi. Người dùng chọn, bấm Lưu, thấy
   * "đã lưu", và không có gì đổi.
   *
   * ⚠ CHỈ GHI KHI THẬT SỰ CÓ NGƯỜI. Xem chú thích ở `salesUserId`: rỗng
   *   là "không đụng tới", không phải "xoá tên người phụ trách".
   */
  if (typeof opts.salesUserId === "string" && opts.salesUserId) {
    header.sales_user_id = opts.salesUserId
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
