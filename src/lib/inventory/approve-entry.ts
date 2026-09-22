import type { SupabaseClient } from "@supabase/supabase-js"
import { postStockExport, warningsFor } from "@/lib/inventory/post-export"
import { friendlyIssueError } from "@/lib/inventory/stock-issue"

/**
 * Duyệt (ghi sổ) một phiếu kho NHÁP — chọn đúng RPC theo loại phiếu.
 *
 * ⚠ KHÔNG BAO GIỜ UPDATE THẲNG `status = 'posted'`. Bản cũ của nút "Duyệt"
 *   ở danh sách phiếu kho làm đúng thế cho mọi phiếu không phải xuất. Đã
 *   đo: phiếu chuyển kho nháp sale→date, UPDATE posted = 1 dòng, tồn vùng
 *   sale 1000 → 1000, vùng date 0 → 0 — sổ ghi đã chuyển mà hàng đứng yên.
 *
 * ⚠ PHIẾU XUẤT CÓ VÙNG KHO (lập ở `/inventory/stock-issue`) đi qua
 *   `post_stock_issue` — trừ ĐÚNG vùng của phiếu. `post_stock_export` luôn
 *   trừ vùng `sale`; đã đo: phiếu xuất vùng `date` 5 → vùng sale 1000 →
 *   995, vùng date giữ nguyên 10. Nó chỉ còn dành cho phiếu xuất cũ chưa
 *   ghi vùng.
 *
 * ⚠ PHIẾU NHẬP / KIỂM KÊ NHÁP KHÔNG DUYỆT Ở ĐÂY. Nhập kho ghi sổ ngay
 *   trong một giao dịch (mig 168); kiểm kê duyệt ở màn Điều chỉnh qua
 *   `post_stock_adjustment`. Không có RPC nào ghi sổ một phiếu nhập nháp
 *   — nên nói thẳng thay vì đổi trạng thái mà kho không đổi.
 */
export interface PhieuCanDuyet {
  id: string
  type: string
  warehouse_zone?: string | null
}

export interface KetQuaDuyet {
  posted: boolean
  canhBao?: string
}

export class KhongDuyetDuocOday extends Error {}

export async function ghiSoPhieuNhap(supabase: SupabaseClient, e: PhieuCanDuyet): Promise<KetQuaDuyet> {
  if (e.type === "transfer") {
    const { error } = await supabase.rpc("post_stock_transfer", { p_entry_id: e.id })
    if (error) throw new Error(friendlyIssueError(error.message))
    return { posted: true }
  }
  if (e.type === "export") {
    if (e.warehouse_zone) {
      const { error } = await supabase.rpc("post_stock_issue", { p_entry_id: e.id })
      if (error) throw new Error(friendlyIssueError(error.message))
      return { posted: true }
    }
    const r = await postStockExport(supabase, e.id)
    return { posted: r.posted, canhBao: warningsFor(r) ?? undefined }
  }
  if (e.type === "stocktake") {
    throw new KhongDuyetDuocOday("Phiếu kiểm kê duyệt ở màn Điều chỉnh tồn kho.")
  }
  throw new KhongDuyetDuocOday(
    "Phiếu nhập nháp không ghi sổ từ đây được — không có đường nào cộng kho cho nó. Mở phiếu để kiểm tra, hoặc lập lại phiếu ở màn Nhập kho."
  )
}
