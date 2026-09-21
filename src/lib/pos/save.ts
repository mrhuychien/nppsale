/**
 * GHI SỔ TỪ CÁC MÀN `/pos`.
 *
 * ⚠ KHÔNG MỘT DÒNG NGHIỆP VỤ MỚI NÀO Ở ĐÂY. Spec §"Không đụng vào"
 * cấm RPC mới và đổi schema; Coder Pack cấm ghi thẳng vào tồn kho /
 * công nợ / trạng thái đơn từ trình duyệt. Nên mọi hàm dưới đây chỉ
 * DỊCH state của màn POS sang đúng tải trọng mà lib/RPC đang chạy đã
 * nhận, rồi gọi chúng:
 *
 *   đơn hàng   → `createOrderRecords` / `applyOrderEdit`
 *   hóa đơn    → `postInvoice` / `reissueInvoice`
 *   phiếu trả  → bảng `returns` + `completeReturn`
 *   phiếu nhập → bảng `purchase_invoices` + `saveReceiptLines`
 *                + RPC `complete_purchase_invoice`
 *   trả NCC    → bảng `supplier_returns` + `saveReturnLines`
 *                + RPC `complete_supplier_return`
 *
 * ⚠ ĐÂY LÀ CHỖ THỨ HAI GỌI HAI RPC MUA HÀNG (màn `/purchasing` và
 * `/purchase-returns` đang gọi thẳng trong page). Hai chỗ gọi cùng một
 * RPC là hai chỗ trôi xa nhau được, nên có chốt đối chiếu tên RPC và
 * tên tham số giữa chúng. Không gộp màn cũ vào đây: sửa một module
 * đang chạy ngoài thị trường không nằm trong đợt này.
 *
 * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` NULL. Mọi `insert`/`update`
 * dưới đây `.select("id")` rồi đếm — im lặng ở đây là người dùng thấy
 * "đã lưu" mà sổ không có gì.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { createOrderRecords, type OfflineOrderPayload } from "@/lib/orders/create"
import { applyOrderEdit } from "@/lib/sell/order-edit"
import { postInvoice, reissueInvoice, type InvoiceDraftLine } from "@/lib/orders/post-invoice"
import { completeReturn, type ReturnZone } from "@/lib/returns/complete-return"
import { saveReceiptLines, saveReturnLines } from "@/lib/purchasing/save-receipt"
import { percentToRatio } from "@/lib/purchasing/return-form"
import type { ReceiptLine } from "@/lib/purchasing/receipt-form"
import { lineGross, discountAmount } from "@/lib/pos/discount"
import type { PosLine } from "@/lib/pos/types"
import type { CartLine } from "@/lib/sell/cart"
import type { ReturnCartLine } from "@/lib/sell/returns"

/** ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. */
function assertWrote(rows: unknown[] | null, what: string): void {
  if (!rows || rows.length === 0) {
    throw new Error(
      `Không ghi được ${what} — nhiều khả năng bạn không có quyền, hoặc phiên đã hết hạn. ` +
        "Tải lại trang rồi thử lại."
    )
  }
}

/* ==================================================================
 * ĐƠN HÀNG — màn 1 / 1b
 * ================================================================== */

/** Dòng POS → dòng giỏ, đúng hình dạng `applyOrderEdit` và `buildOrderPayload` nhận. */
export function posLinesToCart(lines: readonly PosLine[]): CartLine[] {
  return lines.map((l) => {
    const g = lineGross(l.qty, l.price)
    const giam = discountAmount(l.discount, g)
    return {
      productId: l.productId,
      unit: l.unit,
      qty: l.qty,
      /**
       * ⚠ QUY KHOẢN GIẢM VỀ ĐƠN GIÁ. Bảng `sales_order_lines` không có
       * cột giảm theo dòng; giỏ của `/sell` cũng chỉ mang một `price`.
       * Gửi giá gốc rồi bỏ khoản giảm là đơn ghi cao hơn số đã thoả
       * thuận. Quy về đơn giá giữ đúng TIỀN — thứ duy nhất đi vào sổ.
       *
       * Hệ quả: mở lại đơn sẽ thấy đơn giá đã trừ, không thấy "giảm 5%".
       * Đó chính là mục 1 của `docs/pos-todo.md`.
       */
      price: l.qty > 0 ? Math.round((g - giam) / l.qty) : 0,
      listPrice: l.price,
      note: l.note ?? "",
      conversion: l.units.find((u) => u.unit_name === l.unit)?.conversion || 1,
      vatRate: 0,
    }
  })
}

/**
 * Dòng hàng trả/đổi kèm đơn (bảng dưới bảng hàng, `F8`/`F9`) → dòng giỏ
 * hàng trả, đúng hình dạng `buildOrderPayload.returnLines` nhận.
 *
 * ⚠ BỎ DÒNG CHƯA CHỌN MẶT HÀNG VÀ DÒNG SỐ LƯỢNG 0. `F8` thêm một dòng
 * trống để người dùng chọn; họ đổi ý và để nguyên thì dòng ấy không
 * được đi vào phiếu trả — `return_lines.product_id` là `NOT NULL`, và
 * một dòng rỗng là cả lệnh lưu nổ ở bước phụ sau khi đầu đơn đã ghi.
 */
export function posLinesToReturnCart(lines: readonly PosLine[]): ReturnCartLine[] {
  return lines
    .filter((l) => l.productId && l.qty > 0)
    .map((l) => ({
      productId: l.productId,
      unit: l.unit,
      qty: l.qty,
      price: l.price,
      vatRate: 0,
      isExchange: l.isExchange === true,
      note: l.note ?? "",
    }))
}

export async function savePosOrder(
  sb: SupabaseClient,
  o: {
    /** `null` = đơn mới. */
    orderId: string | null
    payload: OfflineOrderPayload
    lines: PosLine[]
    status: "draft" | "submitted"
    reason: string
    userId: string
    orgId: string
    salesUserId?: string | null
    /**
     * Phiếu trả kèm đơn mà màn đang nắm — cùng ba giá trị với
     * `applyOrderEdit`: `string` ghi đè phiếu ấy, `null` là đơn chưa có
     * phiếu (tạo mới nếu có dòng), `undefined` là KHÔNG BIẾT và đứng yên.
     */
    heldReturnId?: string | null
    productName?: (id: string) => string | undefined
  }
): Promise<{ orderId: string; orderCode: string }> {
  const cart = posLinesToCart(o.lines)
  if (o.orderId) {
    await applyOrderEdit(sb as never, {
      orderId: o.orderId,
      payload: o.payload,
      cart,
      status: o.status,
      reason: o.reason,
      userId: o.userId,
      orgId: o.orgId,
      /* ⚠ `undefined` = KHÔNG BIẾT phiếu trả nào, và `syncOrderReturn`
         phải đứng yên — không ép về `null` (ép là nó tạo thêm một
         phiếu). Màn đơn đọc phiếu trả nháp của đơn rồi truyền xuống. */
      heldReturnId: o.heldReturnId,
      salesUserId: o.salesUserId,
      productName: o.productName,
    })
    return { orderId: o.orderId, orderCode: o.payload.order.order_code }
  }
  const r = await createOrderRecords(sb as never, o.payload, {
    userId: o.userId,
    orgId: o.orgId,
  })
  return { orderId: r.orderId, orderCode: r.orderCode }
}

/* ==================================================================
 * HÓA ĐƠN — màn 2 / 7
 * ================================================================== */

/**
 * Dòng POS → dòng hóa đơn.
 *
 * @param vatRate thuế suất theo TỈ LỆ (0.1 = 10%) áp cho MỌI dòng.
 *
 * ⚠ THUẾ CỦA MÀN POS ĐẶT Ở CẤP CHỨNG TỪ (ô `Thuế GTGT` trên panel),
 * nhưng `sales_invoices` KHÔNG có cột thuế suất — RPC cộng thuế từ
 * `vat_rate` của TỪNG DÒNG. Nên ô cấp chứng từ được đẩy xuống mọi dòng.
 * Bản đầu gửi 0 ở đây trong khi panel vẫn vẽ số thuế: người dùng thấy
 * tổng có thuế, lưu xong hóa đơn không thuế.
 */
export function posLinesToInvoice(lines: readonly PosLine[], vatRate = 0): InvoiceDraftLine[] {
  return lines.map((l) => {
    const g = lineGross(l.qty, l.price)
    return {
      orderLineId: null,
      productId: l.productId,
      unitName: l.unit,
      conversionFactor: l.units.find((u) => u.unit_name === l.unit)?.conversion || 1,
      quantity: l.qty,
      unitPrice: l.price,
      /* ⚠ HÓA ĐƠN CÓ CỘT GIẢM THEO DÒNG — gửi số tiền đã quy, đừng nhét
         vào đơn giá như bên đơn hàng. */
      lineDiscount: discountAmount(l.discount, g),
      vatRate,
      isExchange: l.isExchange === true,
      note: l.note ?? null,
    }
  })
}

export async function savePosInvoice(
  sb: SupabaseClient,
  o: {
    /** `null` = lập hóa đơn mới cho đơn `orderId`. */
    invoiceId: string | null
    orderId?: string
    lines: PosLine[]
    paymentTerms?: string | null
    notes?: string | null
    /** Thuế suất theo tỉ lệ (0.1 = 10%), áp cho mọi dòng. */
    vatRate?: number
  }
) {
  const lines = posLinesToInvoice(o.lines, o.vatRate ?? 0)
  if (o.invoiceId) {
    return reissueInvoice(sb, o.invoiceId, {
      lines,
      paymentTerms: o.paymentTerms ?? null,
      notes: o.notes ?? null,
    })
  }
  if (!o.orderId) throw new Error("Chưa có đơn hàng để lập hóa đơn.")
  return postInvoice(sb, {
    orderId: o.orderId,
    lines,
    paymentTerms: o.paymentTerms ?? null,
    notes: o.notes ?? null,
  })
}

/* ==================================================================
 * PHIẾU TRẢ HÀNG — màn 3 / 8
 * ================================================================== */

export async function savePosReturn(
  sb: SupabaseClient,
  o: {
    /** `null` = phiếu mới. */
    returnId: string | null
    orgId: string
    userId: string
    customerId: string
    /** Hóa đơn gốc, nếu có. */
    invoiceId?: string | null
    reason: string
    notes: string
    lines: PosLine[]
    /** `true` = ghi nhận và nhập kho ngay; `false` = để nháp. */
    complete: boolean
    /**
     * Vùng kho nhận hàng trả.
     *
     * ⚠ CHỈ CÓ HAI VÙNG (`ReturnZone` của `complete-return.ts`): `sale`
     * và `date`. Không có vùng "hàng lỗi" riêng ở mức này — hàng hỏng
     * đi vào kho cận date rồi xử lý tiếp. Bịa thêm một vùng thứ ba là
     * gửi cho RPC một giá trị nó không nhận.
     */
    zone: ReturnZone
  }
): Promise<{ returnId: string }> {
  let id = o.returnId
  if (!id) {
    const { data, error } = await sb
      .from("returns")
      .insert({
        org_id: o.orgId,
        customer_id: o.customerId,
        invoice_id: o.invoiceId ?? null,
        requested_by: o.userId,
        reason: o.reason || null,
        notes: o.notes || null,
        status: "draft",
      })
      .select("id")
    if (error) throw error
    assertWrote(data as unknown[], "phiếu trả")
    id = ((data as unknown) as Array<{ id: string }>)[0].id
  } else {
    const { data, error } = await sb
      .from("returns")
      .update({
        customer_id: o.customerId,
        invoice_id: o.invoiceId ?? null,
        reason: o.reason || null,
        notes: o.notes || null,
      })
      .eq("id", id)
      .select("id")
    if (error) throw error
    assertWrote(data as unknown[], "phiếu trả")
  }

  /**
   * ⚠ XOÁ RỒI CHÈN LẠI, VÀ ĐỌC LẠI BẮT PHẢI RỖNG. Cùng luật với
   * `syncOrderReturn`: xoá bị RLS từ chối mà vẫn chèn tiếp thì phiếu có
   * hai bộ dòng, và công nợ của khách bị trừ gấp đôi lúc hoàn thành.
   */
  const { error: dlErr } = await sb.from("return_lines").delete().eq("return_id", id)
  if (dlErr) throw dlErr
  const { data: con, error: chkErr } = await sb
    .from("return_lines")
    .select("id")
    .eq("return_id", id)
    .limit(1)
  if (chkErr) throw chkErr
  if (con && con.length > 0) {
    throw new Error(
      "Không xoá được dòng hàng trả cũ — chưa ghi dòng mới để tránh trừ công nợ hai lần."
    )
  }

  const rows = o.lines
    .filter((l) => l.productId && l.qty > 0)
    .map((l) => ({
      return_id: id,
      product_id: l.productId,
      unit_name: l.unit,
      quantity: l.qty,
      unit_price: l.price,
      vat_rate: 0,
      is_exchange: l.isExchange === true,
      note: l.note || null,
    }))
  if (rows.length > 0) {
    const { data, error } = await sb.from("return_lines").insert(rows).select("id")
    if (error) throw error
    assertWrote(data as unknown[], "dòng hàng trả")
  }

  // ⚠ GHI KHO ĐI QUA RPC, một giao dịch. Không loop update từ trình duyệt.
  if (o.complete) await completeReturn(sb, id, o.zone)
  return { returnId: id }
}

/* ==================================================================
 * MUA HÀNG — màn 9 / 10 / 11 / 12
 * ================================================================== */

/** Dòng POS → `ReceiptLine`, đúng hình dạng `saveReceiptLines` nhận. */
export function posLinesToReceipt(lines: readonly PosLine[]): ReceiptLine[] {
  return lines.map((l, i) => {
    const g = lineGross(l.qty, l.price)
    return {
      id: `${l.key}-${i}`,
      product_id: l.productId,
      product_name: l.name,
      sku: l.sku,
      note: l.note ?? "",
      unit_name: l.unit,
      quantity: String(l.qty),
      unit_price: String(l.price),
      /**
       * ⚠ GỬI SỐ TIỀN ĐÃ QUY, VÀ ĐẶT `discount_mode: "amount"`. Cột
       * `purchase_invoice_lines.line_discount` là SỐ TIỀN; gửi phần
       * trăm xuống là cột ấy mang hai nghĩa tuỳ dòng — đúng cái bẫy đã
       * làm thuế phiếu trả NCC hụt 100 lần (xem migration 141).
       */
      line_discount: String(discountAmount(l.discount, g)),
      discount_mode: "amount" as const,
      /* ⚠ Ô NÀY LÀ PHẦN TRĂM (10 = 10%), không phải tỉ lệ. Thuế của màn
         POS đặt ở cấp chứng từ nên dòng để 0. */
      vat_percent: "0",
      conversion_factor: String(l.units.find((u) => u.unit_name === l.unit)?.conversion || 1),
      available_units: [],
      base_unit: l.units[0]?.unit_name || l.unit,
      /**
       * ⚠ KHÔNG GỬI MÃ LÔ, VÀ ĐÓ LÀ SỬA MỘT LỖI CỦA CHÍNH BẢN NÀY. Bản
       * đầu nhét `batch_code` và `shelf_life_days` vào đây qua một phép
       * ép kiểu — `ReceiptLine` không có hai trường ấy, và
       * `linePayloadOf` (`lib/purchasing/save-receipt.ts:34`) ghi đúng
       * 10 cột, không cột nào nhận mã lô. Hai trường ấy rơi vào hư
       * không trong khi màn hình bắt người dùng gõ chúng. Lô do
       * `complete_purchase_invoice` sinh — xem `generatedLotCode`.
       */
    } satisfies ReceiptLine
  })
}

export async function savePosPurchase(
  sb: SupabaseClient,
  o: {
    receiptId: string | null
    orgId: string
    userId: string
    supplierId: string
    invoiceNumber: string
    invoiceDate: string
    zone: string
    discount: number
    notes: string
    lines: PosLine[]
    complete: boolean
    subtotal: number
    vat: number
    total: number
  }
): Promise<{ receiptId: string }> {
  const head = {
    supplier_id: o.supplierId,
    invoice_number: o.invoiceNumber.trim() || null,
    invoice_date: o.invoiceDate,
    warehouse_zone: o.zone,
    discount: o.discount,
    notes: o.notes.trim() || null,
    /* ⚠ BA SỐ NÀY CHỈ ĐỂ XEM Ở DANH SÁCH KHI CÒN LÀ PHIẾU TẠM. Lúc
       hoàn thành, `complete_purchase_invoice` tính lại từ dòng hàng và
       ghi đè — nó mới là số đi vào công nợ NCC. */
    subtotal: o.subtotal,
    vat: o.vat,
    total: o.total,
    /**
     * ⚠ THUẾ GÕ Ở CẤP PHIẾU PHẢI ĐI QUA `vat_override`. Dòng gửi xuống
     * mang `vat_rate = 0` (thuế của màn POS đặt ở panel), nên lúc hoàn
     * thành RPC tự cộng ra 0 — và cột `vat` ở trên bị ghi đè bằng 0.
     * `vat_override` là đúng cái cổng migration 145 mở cho trường hợp
     * "số gõ tay thắng số tự cộng"; `/purchasing` cũng gửi qua đó.
     * Không có thuế thì để `null` để RPC tự cộng như thường.
     */
    vat_override: o.vat > 0 ? o.vat : null,
  }

  let id = o.receiptId
  if (!id) {
    const { data, error } = await sb
      .from("purchase_invoices")
      .insert({ ...head, org_id: o.orgId, status: "draft", created_by: o.userId })
      .select("id")
    if (error) throw error
    assertWrote(data as unknown[], "phiếu nhập")
    id = ((data as unknown) as Array<{ id: string }>)[0].id
  } else {
    const { data, error } = await sb.from("purchase_invoices").update(head).eq("id", id).select("id")
    if (error) throw error
    assertWrote(data as unknown[], "phiếu nhập")
  }

  await saveReceiptLines(sb, id, posLinesToReceipt(o.lines), percentToRatio)

  if (o.complete) {
    const { error } = await sb.rpc("complete_purchase_invoice", { p_invoice_id: id })
    if (error) throw error
  }
  return { receiptId: id }
}

export async function savePosSupplierReturn(
  sb: SupabaseClient,
  o: {
    returnId: string | null
    orgId: string
    userId: string
    supplierId: string
    returnDate: string
    zone: string
    reason: string
    notes: string
    discount: number
    lines: PosLine[]
    complete: boolean
    subtotal: number
    vat: number
    total: number
  }
): Promise<{ returnId: string }> {
  const head = {
    supplier_id: o.supplierId,
    return_date: o.returnDate,
    warehouse_zone: o.zone,
    reason: o.reason || null,
    notes: o.notes.trim() || null,
    discount: o.discount,
    subtotal: o.subtotal,
    vat: o.vat,
    total: o.total,
  }

  let id = o.returnId
  if (!id) {
    const { data, error } = await sb
      .from("supplier_returns")
      .insert({ ...head, org_id: o.orgId, status: "draft", created_by: o.userId })
      .select("id")
    if (error) throw error
    assertWrote(data as unknown[], "phiếu trả NCC")
    id = ((data as unknown) as Array<{ id: string }>)[0].id
  } else {
    const { data, error } = await sb.from("supplier_returns").update(head).eq("id", id).select("id")
    if (error) throw error
    assertWrote(data as unknown[], "phiếu trả NCC")
  }

  await saveReturnLines(sb, id, posLinesToReceipt(o.lines), percentToRatio)

  if (o.complete) {
    const { error } = await sb.rpc("complete_supplier_return", { p_return_id: id })
    if (error) throw error
  }
  return { returnId: id }
}
