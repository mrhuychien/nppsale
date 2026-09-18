/**
 * Xuất hàng — gọi RPC `post_invoice` (migration 125) và ĐỌC thứ nó trả về.
 *
 * Thay cho `complete-order.ts` của workflow v2. Khác biệt không nằm ở tên
 * hàm: v2 xuất TOÀN BỘ đơn trong một lần và không có gì để chọn, còn v2b
 * cho nhà phân phối chọn xuất bao nhiêu, giá nào, và xuất tiếp đợt sau.
 *
 * Toàn bộ việc nặng nằm trong RPC: trừ kho FIFO, dựng hóa đơn, sinh công
 * nợ, đổi trạng thái đơn, đẩy phiếu trả kèm đơn sang phiếu tạm — tất cả
 * trong MỘT giao dịch. Ở đây chỉ dịch kết quả và lỗi sang câu người dùng
 * đọc được.
 *
 * ⚠ VÌ SAO PHẢI ĐỌC KẾT QUẢ, không chỉ đọc `error`. Với
 * `organizations.allow_oversell = true` thì `post_stock_export` KHÔNG ném
 * lỗi khi thiếu hàng: nó trừ hết tồn có, cho tồn ÂM, vẫn ghi sổ hóa đơn,
 * vẫn sinh công nợ ĐỦ tiền, và trả `error = null`. Giao diện in "Đã xuất
 * hàng", nhà phân phối đóng hàng theo đúng số trên phiếu, tài xế tới nơi
 * thì thiếu — còn thẻ kho âm mà không ai biết cho tới kỳ kiểm kê.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Một dòng có thể xuất, do `get_invoiceable_lines` trả về.
 *
 * ⚠ `remainingQty = 0` KHÔNG BỊ LOẠI khỏi danh sách. Giấu đi thì màn Xuất
 * hàng đợt hai trông như đơn bị mất dòng, và không cách nào biết dòng đó
 * đã xuất rồi hay chưa từng có.
 */
export interface InvoiceableLine {
  /** Rỗng với hàng đem đổi của phiếu trả — nó không thuộc dòng đơn nào. */
  orderLineId: string | null
  returnLineId: string | null
  productId: string
  productName: string
  sku: string | null
  unitName: string
  conversionFactor: number
  orderedQty: number
  invoicedQty: number
  remainingQty: number
  unitPrice: number
  /** Giá bảng theo đơn vị cơ sở — chỉ để so, không để tính tiền. */
  listPrice: number
  lineDiscount: number
  vatRate: number
  /**
   * Tồn kho bán hiện có, tính bằng ĐƠN VỊ CƠ SỞ.
   *
   * ⚠ ĐÂY LÀ THÔNG TIN, KHÔNG PHẢI CHỐT CHẶN. Tổ chức bật cho phép bán âm
   * thì vẫn xuất được; chặn ở giao diện là đặt ra một luật thứ hai mâu
   * thuẫn với cấu hình của chính tổ chức đó.
   */
  availableBase: number
  isExchange: boolean
  note: string | null
}

export interface InvoiceDraftLine {
  orderLineId: string | null
  productId: string
  unitName: string
  conversionFactor: number
  quantity: number
  unitPrice: number
  lineDiscount: number
  vatRate: number
  isExchange: boolean
  note: string | null
}

export interface InvoiceTotals {
  subtotal: number
  vat: number
  total: number
}

/**
 * Cộng tiền của hóa đơn sắp lập.
 *
 * ⚠ PHẢI RA ĐÚNG CON SỐ MÀ `post_invoice` SẼ GHI. Màn hình hiện một số,
 * hóa đơn in ra một số khác, thì không ai tin được màn hình nữa.
 *
 * ⚠ LÀM TRÒN Ở TỔNG, KHÔNG Ở DÒNG — và `total` làm tròn tổng
 * `subtotal + vat` CHƯA làm tròn, không phải `round(subtotal) +
 * round(vat)`. Đó là đúng từng bước của `cartTotals` và của SQL. Port sai
 * chỗ làm tròn là lệch vài đồng mỗi hóa đơn.
 *
 * ⚠ KHÔNG trừ `lineDiscount`: chiết khấu đã nằm trong `unitPrice`.
 */
export function invoiceTotals(lines: InvoiceDraftLine[]): InvoiceTotals {
  let subRaw = 0
  let vatRaw = 0
  for (const l of lines) {
    const qty = Number(l.quantity) || 0
    if (qty <= 0) continue
    const line = qty * (Number(l.unitPrice) || 0)
    subRaw += line
    vatRaw += line * (Number(l.vatRate) || 0)
  }
  return {
    subtotal: Math.round(subRaw),
    vat: Math.round(vatRaw),
    total: Math.max(0, Math.round(subRaw + vatRaw)),
  }
}

/**
 * Số đơn vị cơ sở còn THIẾU của một dòng so với tồn kho bán.
 *
 * ⚠ QUY VỀ ĐƠN VỊ CƠ SỞ TRƯỚC KHI SO. Dòng đặt "2 thùng" mà tồn ghi "20
 * hộp" thì so thẳng hai con số ra kết luận thừa hàng, trong khi thực tế
 * vừa đủ. Trả 0 khi đủ — số dương mới là vấn đề.
 */
export function shortageOf(
  line: Pick<InvoiceableLine, "conversionFactor" | "availableBase">,
  quantity: number
): number {
  const need = (Number(quantity) || 0) * (Number(line.conversionFactor) || 1)
  const have = Number(line.availableBase) || 0
  return Math.max(0, need - have)
}

export interface PostInvoiceResult {
  invoiceId: string | null
  invoiceCode: string | null
  /** Phiếu xuất kho vừa dựng. */
  entryId: string | null
  /** Công nợ vừa sinh. */
  receivableId: string | null
  /**
   * Số lượng thiếu so với tồn, tính bằng ĐƠN VỊ CƠ SỞ và GỘP mọi sản
   * phẩm. Chỉ > 0 khi tổ chức bật cho phép bán âm.
   *
   * ⚠ ĐƠN VỊ CƠ SỞ, không phải đơn vị bán. Đơn 2 thùng loại 24 chai mà
   * thiếu đúng một thùng thì số này là 24, không phải 1 — ghép thẳng nó
   * với chữ "thùng" là báo sai 24 lần. Và nó không nói thiếu sản phẩm
   * nào, nên câu cảnh báo phải nói chung chung rồi mời người ta đi kiểm.
   */
  shortQty: number
  /**
   * Số LƯỢT FIFO lấy hàng từ một lô có hạn xa hơn lô cận hạn nhất đang
   * nằm trong kho.
   *
   * ⚠ KHÔNG PHẢI "số lô hết hạn bị bỏ qua". Đây là chuyện bình thường
   * của FIFO theo ngày nhập, và phép đếm còn đếm DƯ. Chỉ đủ tin cho một
   * dòng nhắc nhẹ — đừng dựng cảnh báo đỏ hay chặn trên nó.
   */
  nearExpirySkipped: number
  /** Trạng thái đơn sau khi ghi sổ — do RPC suy ra, không tự đoán. */
  orderStatus: string | null
}

/**
 * Đổi lỗi của RPC sang câu tiếng Việt.
 *
 * ⚠ Không nuốt lỗi lạ thành một câu chung chung. Lỗi không nhận ra thì
 * trả về NGUYÊN VĂN — người dùng đọc không hiểu còn hơn tôi đoán sai rồi
 * họ đi sửa nhầm chỗ.
 *
 * ⚠ Mọi RPC của v2/v2b RAISE với `ERRCODE = 'P0001'` và message mở đầu
 * bằng MÃ LỖI. `errorMessage` dùng chung không biết mã P0001 nên nó in
 * nguyên văn kỹ thuật kèm "(mã P0001)" — đó là lý do hàm này tồn tại.
 */
export function explainInvoiceError(message: string): string {
  const m = message || ""

  // Mã đã deploy nhưng migration chưa chạy. Nói đúng việc cần làm, đừng
  // để người ta tưởng đơn hỏng.
  if (m.includes("does not exist") && /post_invoice|cancel_invoice|reissue_invoice|close_order|get_invoiceable_lines/.test(m)) {
    return "Chưa chạy migration 124 + 125 + 126 trên cơ sở dữ liệu — chạy `supabase db push` rồi thử lại."
  }

  if (m.includes("INSUFFICIENT_STOCK")) {
    // Thông điệp của RPC đã nói rõ thiếu bao nhiêu, sản phẩm nào.
    return m.replace(/^.*INSUFFICIENT_STOCK:\s*/, "Không đủ tồn: ")
  }
  if (m.includes("ORDER_NOT_INVOICEABLE")) {
    return m.replace(
      /^.*ORDER_NOT_INVOICEABLE:\s*/,
      "Đơn không còn xuất hàng được — có thể ai đó vừa xuất, đóng hoặc huỷ. Tải lại trang. "
    )
  }
  if (m.includes("NO_LINES")) {
    return "Chưa chọn dòng nào để xuất — nhập số lượng cho ít nhất một dòng."
  }
  if (m.includes("HAS_INVOICE")) {
    return m.replace(/^.*HAS_INVOICE:\s*/, "")
  }
  if (m.includes("ORDER_NOT_PARTIAL")) {
    return m.replace(/^.*ORDER_NOT_PARTIAL:\s*/, "")
  }
  if (m.includes("ORDER_LOCKED")) {
    return m.replace(/^.*ORDER_LOCKED:\s*/, "")
  }
  if (m.includes("INVOICE_NOT_POSTED")) {
    return m.replace(
      /^.*INVOICE_NOT_POSTED:\s*/,
      "Hóa đơn không còn hiệu lực — có thể ai đó vừa huỷ. Tải lại trang. "
    )
  }
  if (m.includes("INVOICE_NOT_FOUND")) return "Không tìm thấy hóa đơn."
  if (m.includes("LOCKED_HAS_PAYMENT")) {
    return m.replace(/^.*LOCKED_HAS_PAYMENT:\s*/, "")
  }
  if (m.includes("LOCKED_EINVOICE")) {
    return m.replace(/^.*LOCKED_EINVOICE:\s*/, "")
  }
  if (m.includes("LOCKED_RETURN_DONE")) {
    return m.replace(/^.*LOCKED_RETURN_DONE:\s*/, "")
  }
  if (m.includes("REISSUE_BREAKS_RETURN")) {
    return m.replace(/^.*REISSUE_BREAKS_RETURN:\s*/, "")
  }
  if (m.includes("RETURN_NEEDS_INVOICE")) {
    return m.replace(/^.*RETURN_NEEDS_INVOICE:\s*/, "")
  }
  if (m.includes("RETURN_QTY_EXCEEDS")) {
    return m.replace(/^.*RETURN_QTY_EXCEEDS:\s*/, "Trả quá số đã xuất: ")
  }
  if (m.includes("REASON_REQUIRED")) {
    return m.replace(/^.*REASON_REQUIRED:\s*/, "")
  }
  if (m.includes("ORDER_NOT_FOUND")) return "Không tìm thấy đơn."
  if (m.includes("ORG_MISMATCH")) return "Đơn không thuộc đơn vị của bạn."
  if (m.includes("FORBIDDEN_NOT_OWNER")) {
    return m.replace(/^.*FORBIDDEN_NOT_OWNER:\s*/, "")
  }
  if (m.includes("FORBIDDEN")) {
    return m.replace(/^.*FORBIDDEN:\s*/, "")
  }
  if (m.includes("USE_RPC")) {
    // Ai đó ghi thẳng vào cột status thay vì gọi RPC — trigger 124 chặn.
    return "Bước này phải đi qua nút Xuất hàng / Huỷ hóa đơn / Đóng đơn, không đổi trạng thái trực tiếp được."
  }
  return m
}

/**
 * Câu cảnh báo kèm theo khi xuất hàng xong, hoặc null nếu không có gì.
 *
 * ⚠ Xuất hàng THÀNH CÔNG và xuất hàng ĐỦ là hai chuyện khác nhau. Hàm
 * này là chỗ duy nhất nói ra sự khác nhau đó.
 */
export function invoiceWarnings(r: PostInvoiceResult): string | null {
  const parts: string[] = []
  if (r.shortQty > 0) {
    parts.push(
      `⚠ Thiếu ${r.shortQty} đơn vị cơ sở so với tồn — vẫn xuất vì đơn vị cho phép bán âm. Tồn kho giờ đang âm, kiểm lại trước khi giao.`
    )
  }
  if (r.nearExpirySkipped > 0) {
    // Cái giá phải trả của FIFO theo ngày nhập, nói thẳng ra thay vì để
    // nó âm thầm.
    parts.push(
      `⚠ ${r.nearExpirySkipped} lượt lấy lô nhập trước trong khi còn lô có hạn gần hơn — hàng cận hạn đang nằm lại trong kho.`
    )
  }
  return parts.length > 0 ? parts.join(" ") : null
}

/** `RETURNS TABLE` nên `data` là MỘT MẢNG, không phải object. */
function firstRow<T>(data: unknown): T | null {
  return ((Array.isArray(data) ? data[0] : data) ?? null) as T | null
}

export async function loadInvoiceableLines(
  supabase: SupabaseClient,
  orderId: string
): Promise<InvoiceableLine[]> {
  const { data, error } = await supabase.rpc("get_invoiceable_lines", {
    p_order_id: orderId,
  })
  if (error) throw new Error(explainInvoiceError(error.message || String(error)))

  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>
  return rows.map((r) => ({
    orderLineId: (r.order_line_id as string) ?? null,
    returnLineId: (r.return_line_id as string) ?? null,
    productId: String(r.product_id ?? ""),
    productName: (r.product_name as string) || "—",
    sku: (r.sku as string) ?? null,
    unitName: (r.unit_name as string) || "",
    conversionFactor: Number(r.conversion_factor ?? 1) || 1,
    orderedQty: Number(r.ordered_qty ?? 0),
    invoicedQty: Number(r.invoiced_qty ?? 0),
    remainingQty: Number(r.remaining_qty ?? 0),
    unitPrice: Number(r.unit_price ?? 0),
    listPrice: Number(r.list_price ?? 0),
    lineDiscount: Number(r.line_discount ?? 0),
    vatRate: Number(r.vat_rate ?? 0),
    availableBase: Number(r.available_base ?? 0),
    isExchange: r.is_exchange === true,
    note: (r.note as string) ?? null,
  }))
}

export interface PostInvoicePayload {
  orderId: string
  lines: InvoiceDraftLine[]
  invoiceDate?: string | null
  paymentTerms?: string | null
  notes?: string | null
}

/**
 * Lập và ghi sổ MỘT hóa đơn.
 *
 * ⚠ LỌC DÒNG SỐ LƯỢNG 0 NGAY Ở ĐÂY. RPC cũng bỏ qua chúng, nhưng gửi lên
 * rồi để nó lọc thì `NO_LINES` báo về sau khi người dùng đã bấm — chặn
 * sớm và nói rõ hơn.
 */
export async function postInvoice(
  supabase: SupabaseClient,
  payload: PostInvoicePayload
): Promise<PostInvoiceResult> {
  const lines = payload.lines.filter((l) => (Number(l.quantity) || 0) > 0)
  if (lines.length === 0) {
    throw new Error("Chưa chọn dòng nào để xuất — nhập số lượng cho ít nhất một dòng.")
  }

  const { data, error } = await supabase.rpc("post_invoice", {
    p: {
      order_id: payload.orderId,
      invoice_date: payload.invoiceDate || null,
      payment_terms: payload.paymentTerms || null,
      notes: payload.notes || null,
      lines: lines.map((l) => ({
        order_line_id: l.orderLineId,
        product_id: l.productId,
        unit_name: l.unitName,
        conversion_factor: l.conversionFactor,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        line_discount: l.lineDiscount,
        is_exchange: l.isExchange,
        note: l.note,
      })),
    },
  })
  if (error) throw new Error(explainInvoiceError(error.message || String(error)))

  const row = firstRow<{
    invoice_id?: string | null
    invoice_code?: string | null
    entry_id?: string | null
    receivable_id?: string | null
    short_qty?: number | null
    near_expiry_skipped?: number | null
    order_status?: string | null
  }>(data)

  return {
    invoiceId: row?.invoice_id ?? null,
    invoiceCode: row?.invoice_code ?? null,
    entryId: row?.entry_id ?? null,
    receivableId: row?.receivable_id ?? null,
    shortQty: Number(row?.short_qty ?? 0),
    nearExpirySkipped: Number(row?.near_expiry_skipped ?? 0),
    orderStatus: row?.order_status ?? null,
  }
}

export interface CancelInvoiceResult {
  importEntryId: string | null
  orderStatus: string | null
}

/**
 * Huỷ hóa đơn — hoàn hàng về ĐÚNG các lô đã lấy, xoá công nợ của nó.
 *
 * ⚠ KHÔNG CÓ "SỬA HÓA ĐƠN" TRỰC TIẾP. Hàng đã rời kho theo lô nào thì
 * phải về đúng lô ấy; phép tính chênh lệch tổng số không làm được điều
 * đó. `reissue_invoice` bên dưới chính là huỷ + lập lại trong một giao
 * dịch.
 */
export async function cancelInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  reason: string
): Promise<CancelInvoiceResult> {
  const { data, error } = await supabase.rpc("cancel_invoice", {
    p_invoice_id: invoiceId,
    p_reason: reason,
  })
  if (error) throw new Error(explainInvoiceError(error.message || String(error)))
  const row = firstRow<{ import_entry_id?: string | null; order_status?: string | null }>(data)
  return {
    importEntryId: row?.import_entry_id ?? null,
    orderStatus: row?.order_status ?? null,
  }
}

/**
 * Sửa hóa đơn — về nghiệp vụ là sửa, về kỹ thuật là huỷ rồi lập lại
 * trong MỘT giao dịch.
 *
 * ⚠ TRẢ VỀ HÓA ĐƠN MỚI, MÃ MỚI. Màn hình gọi hàm này phải điều hướng
 * sang bản mới; đứng lại ở trang cũ là người dùng nhìn một hóa đơn vừa
 * bị huỷ và tưởng việc sửa thất bại.
 */
export async function reissueInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  payload: Omit<PostInvoicePayload, "orderId">
): Promise<PostInvoiceResult> {
  const lines = payload.lines.filter((l) => (Number(l.quantity) || 0) > 0)
  if (lines.length === 0) {
    throw new Error("Hóa đơn phải còn ít nhất một dòng — muốn bỏ hết thì huỷ hóa đơn.")
  }

  const { data, error } = await supabase.rpc("reissue_invoice", {
    p_invoice_id: invoiceId,
    p: {
      invoice_date: payload.invoiceDate || null,
      payment_terms: payload.paymentTerms || null,
      notes: payload.notes || null,
      lines: lines.map((l) => ({
        order_line_id: l.orderLineId,
        product_id: l.productId,
        unit_name: l.unitName,
        conversion_factor: l.conversionFactor,
        quantity: l.quantity,
        unit_price: l.unitPrice,
        line_discount: l.lineDiscount,
        is_exchange: l.isExchange,
        note: l.note,
      })),
    },
  })
  if (error) throw new Error(explainInvoiceError(error.message || String(error)))

  const row = firstRow<{
    invoice_id?: string | null
    invoice_code?: string | null
    entry_id?: string | null
    receivable_id?: string | null
    short_qty?: number | null
    near_expiry_skipped?: number | null
    order_status?: string | null
  }>(data)

  return {
    invoiceId: row?.invoice_id ?? null,
    invoiceCode: row?.invoice_code ?? null,
    entryId: row?.entry_id ?? null,
    receivableId: row?.receivable_id ?? null,
    shortQty: Number(row?.short_qty ?? 0),
    nearExpirySkipped: Number(row?.near_expiry_skipped ?? 0),
    orderStatus: row?.order_status ?? null,
  }
}

/**
 * Đóng đơn — thôi không giao phần còn lại.
 *
 * ⚠ KHÁC HUỶ ĐƠN. Huỷ là "đơn này không có thật"; đóng là "phần đã giao
 * vẫn tính, phần còn lại thì thôi". Gộp hai nút vào một là mất luôn câu
 * trả lời cho "đơn này có giao thiếu không".
 */
export async function closeOrder(
  supabase: SupabaseClient,
  orderId: string,
  reason: string
): Promise<void> {
  const { error } = await supabase.rpc("close_order", {
    p_order_id: orderId,
    p_reason: reason,
  })
  if (error) throw new Error(explainInvoiceError(error.message || String(error)))
}
