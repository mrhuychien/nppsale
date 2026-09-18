/**
 * Xuất hàng — gọi RPC `complete_order` (migration 120) và ĐỌC thứ nó trả về.
 *
 * Toàn bộ việc nằm trong RPC: trừ kho FIFO, sinh công nợ, đổi trạng thái
 * đơn, đẩy phiếu trả kèm đơn sang phiếu tạm, báo cho nhân viên bán hàng —
 * tất cả trong MỘT giao dịch. Ở đây chỉ dịch kết quả và lỗi sang câu
 * người dùng đọc được.
 *
 * ⚠ VÌ SAO PHẢI CÓ TỆP NÀY. Bản trước gọi thẳng
 * `const { error } = await supabase.rpc(...)` — destructure bỏ `data`,
 * tức vứt cả năm cột RPC trả về. Với `organizations.allow_oversell = true`
 * thì `post_stock_export` KHÔNG ném lỗi khi thiếu hàng: nó trừ hết tồn
 * có, cho tồn ÂM, vẫn đổi đơn sang hoàn thành, vẫn sinh công nợ ĐỦ tiền,
 * và trả về `error = null`. Giao diện in "Đã xuất hàng 1 đơn", nhà phân
 * phối đóng hàng theo đúng số trên phiếu, tài xế tới nơi thì thiếu — còn
 * thẻ kho âm mà không ai biết cho tới kỳ kiểm kê. Cột `short_qty` sinh ra
 * đúng để chặn cảnh đó.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface CompleteOrderResult {
  /** Phiếu xuất kho vừa dựng. */
  entryId: string | null
  /** Công nợ vừa sinh. */
  receivableId: string | null
  /** Phiếu trả kèm đơn vừa được đẩy sang phiếu tạm, nếu có. */
  returnId: string | null
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
   * của FIFO theo ngày nhập, và phép đếm còn đếm DƯ: mốc hạn gần nhất đo
   * một lần trước vòng lặp và không cập nhật, nên lô cận hạn nhất bị lấy
   * sạch rồi thì mọi lượt sau vẫn bị tính. Chỉ đủ tin cho một dòng nhắc
   * nhẹ — đừng dựng cảnh báo đỏ hay chặn trên nó.
   */
  nearExpirySkipped: number
}

/**
 * Đổi lỗi của RPC sang câu tiếng Việt.
 *
 * ⚠ Không nuốt lỗi lạ thành một câu chung chung. Lỗi không nhận ra thì
 * trả về NGUYÊN VĂN — người dùng đọc không hiểu còn hơn tôi đoán sai rồi
 * họ đi sửa nhầm chỗ.
 *
 * ⚠ Mọi RPC của workflow v2 RAISE với `ERRCODE = 'P0001'` và message mở
 * đầu bằng MÃ LỖI (`INSUFFICIENT_STOCK: …`). `errorMessage` dùng chung
 * không biết mã P0001 nên nó in nguyên văn kỹ thuật kèm "(mã P0001)" —
 * đó là lý do hàm này tồn tại thay vì gọi thẳng hàm kia.
 */
export function explainCompleteError(message: string): string {
  const m = message || ""
  if (m.includes("INSUFFICIENT_STOCK")) {
    // Thông điệp của RPC đã nói rõ thiếu bao nhiêu, sản phẩm nào.
    return m.replace(/^.*INSUFFICIENT_STOCK:\s*/, "Không đủ tồn: ")
  }
  if (m.includes("ORDER_NOT_SUBMITTED")) {
    return m.replace(
      /^.*ORDER_NOT_SUBMITTED:\s*/,
      "Đơn không còn ở Phiếu tạm — có thể ai đó vừa xuất hoặc huỷ. Tải lại trang. "
    )
  }
  if (m.includes("ORDER_NOT_FOUND")) return "Không tìm thấy đơn."
  if (m.includes("ORG_MISMATCH")) return "Đơn không thuộc đơn vị của bạn."
  if (m.includes("FORBIDDEN")) {
    return m.replace(/^.*FORBIDDEN:\s*/, "")
  }
  if (m.includes("USE_RPC")) {
    // Ai đó ghi thẳng vào cột status thay vì gọi RPC — trigger 119 chặn.
    return "Bước này phải đi qua nút Xuất hàng, không đổi trạng thái trực tiếp được."
  }
  if (m.includes("complete_order") && m.includes("does not exist")) {
    // Mã đã deploy nhưng migration 120 chưa chạy. Nói đúng việc cần làm,
    // đừng để người ta tưởng đơn hỏng.
    return "Chưa chạy migration 119 + 120 trên cơ sở dữ liệu — chạy `supabase db push` rồi thử lại."
  }
  return m
}

/**
 * Câu cảnh báo kèm theo khi xuất hàng xong, hoặc null nếu không có gì.
 *
 * ⚠ Xuất hàng THÀNH CÔNG và xuất hàng ĐỦ là hai chuyện khác nhau. Hàm
 * này là chỗ duy nhất nói ra sự khác nhau đó.
 */
export function completeWarnings(r: CompleteOrderResult): string | null {
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

/**
 * Xuất hàng cho MỘT đơn.
 *
 * Ném lỗi khi RPC từ chối; trả về kết quả đã đọc khi thành công.
 */
export async function completeOrder(
  supabase: SupabaseClient,
  orderId: string
): Promise<CompleteOrderResult> {
  const { data, error } = await supabase.rpc("complete_order", { p_order_id: orderId })
  if (error) throw new Error(explainCompleteError(error.message || String(error)))

  /**
   * ⚠ `RETURNS TABLE` NÊN `data` LÀ MỘT MẢNG, không phải object. Viết
   * `data.short_qty` ra `undefined`, rồi `Number(undefined ?? 0)` ra NaN,
   * và cảnh báo im lặng biến mất y như bản cũ — nhưng lần này lại trông
   * như đã sửa.
   */
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        entry_id?: string | null
        receivable_id?: string | null
        return_id?: string | null
        short_qty?: number | null
        near_expiry_skipped?: number | null
      }
    | null
    | undefined

  return {
    entryId: row?.entry_id ?? null,
    receivableId: row?.receivable_id ?? null,
    returnId: row?.return_id ?? null,
    shortQty: Number(row?.short_qty ?? 0),
    nearExpirySkipped: Number(row?.near_expiry_skipped ?? 0),
  }
}
