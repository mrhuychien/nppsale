/**
 * Ghi sổ phiếu xuất — trừ tồn theo FIFO, đóng giá vốn, đổi trạng thái.
 *
 * Toàn bộ việc nằm trong RPC `post_stock_export` (mig 107), không phải ở
 * đây. Lý do: mã cũ trừ tồn bằng một chuỗi lệnh update rời từ trình
 * duyệt — bấm hai lần, hoặc mạng chập rồi bấm lại, là trừ HAI LẦN, và
 * trừ hai lần thì không dò ngược ra được. Trong RPC thì khoá phiếu, trừ
 * tồn, đóng giá vốn và đổi trạng thái nằm chung một giao dịch.
 *
 * Hàm này chỉ làm một việc: dịch kết quả và lỗi của RPC sang câu người
 * dùng đọc được.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface PostExportResult {
  /** false = phiếu đã được ghi sổ từ trước. Không phải lỗi. */
  posted: boolean
  totalCost: number
  /** Số lượng thiếu so với tồn. Chỉ > 0 khi tổ chức cho phép bán âm. */
  shortQty: number
  /** Số lần FIFO lấy một lô có hạn xa hơn lô cận hạn nhất đang có. */
  nearExpirySkipped: number
}

/**
 * Đổi lỗi của RPC sang câu tiếng Việt.
 *
 * ⚠ Không nuốt lỗi lạ thành một câu chung chung. Lỗi không nhận ra thì
 * trả về NGUYÊN VĂN — người dùng đọc không hiểu còn hơn tôi đoán sai rồi
 * họ đi sửa nhầm chỗ.
 */
export function explainPostError(message: string): string {
  const m = message || ""
  if (m.includes("INSUFFICIENT_STOCK")) {
    // Thông điệp của RPC đã nói rõ thiếu bao nhiêu, sản phẩm nào.
    return m.replace(/^.*INSUFFICIENT_STOCK:\s*/, "Không đủ tồn: ")
  }
  if (m.includes("NOT_AN_EXPORT")) return "Phiếu này không phải phiếu xuất kho."
  if (m.includes("ENTRY_NOT_FOUND")) return "Không tìm thấy phiếu."
  if (m.includes("ORG_MISMATCH")) return "Phiếu không thuộc đơn vị của bạn."
  if (m.includes("post_stock_export") && m.includes("does not exist")) {
    // Mã đã deploy nhưng migration 107 chưa chạy. Nói đúng việc cần làm,
    // đừng để người ta tưởng phiếu hỏng.
    return "Chưa chạy migration 107 trên cơ sở dữ liệu — chạy `supabase db push` rồi thử lại."
  }
  return m
}

/** Câu cảnh báo kèm theo khi ghi sổ xong, hoặc null nếu không có gì. */
export function warningsFor(r: PostExportResult): string | null {
  const parts: string[] = []
  if (r.shortQty > 0) {
    parts.push(
      `⚠ Thiếu ${r.shortQty} đơn vị so với tồn — đã ghi sổ vì đơn vị cho phép bán âm. Tồn kho giờ đang âm.`
    )
  }
  if (r.nearExpirySkipped > 0) {
    // Cái giá phải trả của FIFO, nói thẳng ra thay vì để nó âm thầm.
    parts.push(
      `⚠ ${r.nearExpirySkipped} lượt lấy lô nhập trước trong khi còn lô có hạn gần hơn — hàng cận hạn đang nằm lại trong kho.`
    )
  }
  return parts.length > 0 ? parts.join(" ") : null
}

export async function postStockExport(
  supabase: SupabaseClient,
  entryId: string
): Promise<PostExportResult> {
  const { data, error } = await supabase.rpc("post_stock_export", {
    p_entry_id: entryId,
  })
  if (error) throw new Error(explainPostError(error.message || String(error)))

  const row = (Array.isArray(data) ? data[0] : data) as
    | { posted?: boolean; total_cost?: number; short_qty?: number; near_expiry_skipped?: number }
    | null
    | undefined

  return {
    posted: row?.posted === true,
    totalCost: Number(row?.total_cost ?? 0),
    shortQty: Number(row?.short_qty ?? 0),
    nearExpirySkipped: Number(row?.near_expiry_skipped ?? 0),
  }
}
