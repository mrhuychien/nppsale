/**
 * Duyệt phiếu kiểm kê — gọi RPC `post_stock_adjustment` (migration 123).
 *
 * ⚠ VÌ SAO KHÔNG GHI THẲNG TỪ TRÌNH DUYỆT NỮA.
 *
 * Bản cũ ở `/inventory/adjustments` duyệt bằng một vòng lặp: đọc từng lô,
 * cộng/trừ, ghi lại, rồi ghi chi phí, rồi đóng dấu phiếu — mỗi bước một
 * lượt mạng. Với vai `manager` thì hai trong ba bước đó bị RLS từ chối
 * (`batches` và `stock_entries` chỉ cho `owner`/`warehouse` ghi), mà
 * **RLS từ chối không phải là lỗi**: PostgREST trả 0 dòng, HTTP 200,
 * `error` null. `.throwOnError()` im, vòng lặp chạy hết, màn báo
 * "Kho đã cập nhật" — và kho không đổi một con số nào.
 *
 * Tệ hơn: bước ghi chi phí hao hụt CHẠY ĐƯỢC (policy `expenses` có cho
 * `manager`). Sổ chi phí có khoản hao hụt, kho thì không giảm, và vì
 * phiếu chưa đóng dấu nên bấm lại là ghi thêm một khoản trùng nữa.
 *
 * Giờ cả ba bước nằm trong MỘT giao dịch phía cơ sở dữ liệu.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface AdjustmentResult {
  /** Số lô thật sự bị cộng/trừ. */
  batchesTouched: number
  shrinkQty: number
  shrinkValue: number
  surplusQty: number
  surplusValue: number
  /** Khoản chi phí hao hụt vừa ghi, null nếu không có hao hụt. */
  expenseId: string | null
}

/**
 * Đổi mã lỗi của RPC sang câu tiếng Việt.
 *
 * ⚠ RPC RAISE với `ERRCODE = 'P0001'` mà `errorMessage` dùng chung không
 * biết mã đó — nó in nguyên văn kèm "(mã P0001)". ⚠ Lỗi lạ trả NGUYÊN
 * VĂN: đoán sai rồi người ta đi sửa nhầm chỗ còn tệ hơn.
 */
export function explainAdjustmentError(message: string): string {
  const m = message || ""
  if (m.includes("ALREADY_POSTED")) {
    return m.replace(/^.*ALREADY_POSTED:\s*/, "").replace(/^phiếu/, "Phiếu")
  }
  if (m.includes("BAD_STATUS")) return m.replace(/^.*BAD_STATUS:\s*/, "")
  if (m.includes("STOCK_MOVED")) return m.replace(/^.*STOCK_MOVED:\s*/, "")
  if (m.includes("NOT_ENOUGH_STOCK")) return m.replace(/^.*NOT_ENOUGH_STOCK:\s*/, "")
  if (m.includes("NO_BATCH")) return m.replace(/^.*NO_BATCH:\s*/, "")
  if (m.includes("BATCH_GONE")) return m.replace(/^.*BATCH_GONE:\s*/, "")
  if (m.includes("ENTRY_NOT_FOUND")) return "Không tìm thấy phiếu kiểm kê."
  if (m.includes("ORG_MISMATCH")) return "Phiếu không thuộc đơn vị của bạn."
  if (m.includes("FORBIDDEN")) return m.replace(/^.*FORBIDDEN:\s*/, "")
  if (m.includes("does not exist") && m.includes("post_stock_adjustment")) {
    return "Chưa chạy migration 123 trên cơ sở dữ liệu — chạy `supabase db push` rồi thử lại."
  }
  return m
}

/**
 * Câu mô tả việc vừa xảy ra, dựng từ SỐ THẬT rpc trả về.
 *
 * ⚠ ĐỪNG DỰNG TỪ SỐ TÍNH SẴN Ở MÀN HÌNH. Con số trên màn là thứ người
 * dùng MONG đợi; con số ở đây là thứ cơ sở dữ liệu ĐÃ LÀM. Chính chỗ
 * lệch giữa hai cái đó là lỗi vừa sửa.
 */
export function describeAdjustment(r: AdjustmentResult, fmt: (n: number) => string): string {
  const parts = [`${r.batchesTouched} lô đã cập nhật`]
  if (r.shrinkQty > 0) parts.push(`hao hụt ${r.shrinkQty} đơn vị (${fmt(r.shrinkValue)})`)
  if (r.surplusQty > 0) parts.push(`thừa ${r.surplusQty} đơn vị (${fmt(r.surplusValue)})`)
  return `${parts.join(" • ")}.`
}

/** Duyệt một phiếu kiểm kê. */
export async function postStockAdjustment(
  supabase: SupabaseClient,
  entryId: string
): Promise<AdjustmentResult> {
  const { data, error } = await supabase.rpc("post_stock_adjustment", {
    p_entry_id: entryId,
  })
  if (error) throw new Error(explainAdjustmentError(error.message || String(error)))

  /**
   * ⚠ `RETURNS TABLE` TRẢ VỀ MỘT MẢNG. Đọc thẳng `data.shrink_value` ra
   * `undefined`, và `Number(undefined ?? 0)` ra NaN — con số hao hụt in
   * ra màn thành "NaN" mà không lỗi nào bắn. Đây là cái bẫy đã cắn nhiều
   * lần trong kho này.
   */
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        batches_touched?: number | null
        shrink_qty?: number | null
        shrink_value?: number | null
        surplus_qty?: number | null
        surplus_value?: number | null
        expense_id?: string | null
      }
    | undefined

  return {
    batchesTouched: Number(row?.batches_touched ?? 0),
    shrinkQty: Number(row?.shrink_qty ?? 0),
    shrinkValue: Number(row?.shrink_value ?? 0),
    surplusQty: Number(row?.surplus_qty ?? 0),
    surplusValue: Number(row?.surplus_value ?? 0),
    expenseId: row?.expense_id ?? null,
  }
}
