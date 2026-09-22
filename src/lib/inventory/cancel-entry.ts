/**
 * HUỶ MỘT PHIẾU KHO — qua RPC, không bao giờ bằng lệnh ghi thẳng.
 *
 * ⚠ BẢN CŨ HUỶ BẰNG `UPDATE stock_entries SET status='cancelled'` TỪ
 * TRÌNH DUYỆT. Nó không đụng `batches`, không kiểm trạng thái hiện tại,
 * và không kiểm xem có dòng nào bị RLS từ chối — nên:
 *   · huỷ phiếu NHẬP đã ghi sổ → kho giữ lại hàng chưa từng có thật
 *     (đúng chuyện chủ nhà báo: "huỷ phiếu nhập kho, kho không thay đổi");
 *   · huỷ phiếu XUẤT đã ghi sổ → kho thiếu hàng vĩnh viễn;
 *   · RLS từ chối → 0 dòng, HTTP 200, app vẫn báo "Đã hủy phiếu".
 *
 * Hoàn kho và đổi trạng thái phải nằm trong CÙNG một giao dịch, và chỉ
 * database làm được điều đó. Xem `cancel_stock_entry` (migration 139).
 */

import type { SupabaseClient } from "@supabase/supabase-js"

export interface CancelEntryResult {
  cancelled: boolean
  /** `false` khi phiếu vốn là nháp, hoặc đã huỷ từ trước. */
  reversed: boolean
  linesReversed: number
}

/**
 * Dịch mã lỗi của RPC sang câu người dùng đọc được.
 *
 * ⚠ GIỮ NGUYÊN VĂN KHI KHÔNG NHẬN RA. Đoán sai rồi họ đi sửa nhầm chỗ
 * còn tệ hơn là đọc một câu kỹ thuật.
 */
export function explainCancelEntryError(raw: string): string {
  const m = raw || ""
  if (m.includes("does not exist") && m.includes("cancel_stock_entry")) {
    return "Máy chủ chưa có bản vá 139 nên chưa huỷ phiếu được. Chạy `supabase db push` rồi thử lại."
  }
  // RPC đã viết sẵn câu tiếng Việt sau dấu hai chấm — cắt tiền tố kỹ thuật.
  const known = [
    "ENTRY_NOT_FOUND", "ORG_MISMATCH", "CANNOT_REVERSE_TYPE",
    "ENTRY_HAS_INVOICE", "NO_CONSUMPTION_TRACE", "NO_BATCH_LINK", "ALREADY_ISSUED",
    "ENTRY_HAS_SOURCE", "FORBIDDEN",
  ]
  for (const code of known) {
    const i = m.indexOf(code + ": ")
    if (i >= 0) return m.slice(i + code.length + 2)
  }
  return m
}

export async function cancelStockEntry(
  supabase: SupabaseClient,
  entryId: string,
  reason: string
): Promise<CancelEntryResult> {
  const { data, error } = await supabase.rpc("cancel_stock_entry", {
    p_entry_id: entryId,
    p_reason: reason || null,
  })
  if (error) throw new Error(explainCancelEntryError(error.message || String(error)))

  // `RETURNS TABLE` nên `data` là MỘT MẢNG, không phải object.
  const row = (Array.isArray(data) ? data[0] : data) as
    | { cancelled?: boolean; reversed?: boolean; lines_reversed?: number }
    | null
  return {
    cancelled: row?.cancelled === true,
    reversed: row?.reversed === true,
    linesReversed: Number(row?.lines_reversed ?? 0),
  }
}

/** Câu báo sau khi huỷ xong — nói rõ kho có đổi hay không. */
export function cancelEntryMessage(code: string, r: CancelEntryResult): string {
  if (!r.reversed) return `Đã huỷ phiếu ${code} (phiếu chưa ghi sổ nên kho không đổi).`
  return `Đã huỷ phiếu ${code} và hoàn kho ${r.linesReversed} lô.`
}
