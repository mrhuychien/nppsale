/**
 * NCC VÀ TỒN KHO CHO Ô TÌM HÀNG của bốn màn mua hàng (tạo/sửa phiếu
 * nhập, tạo/sửa phiếu trả NCC).
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "thêm thông tin ncc, lượng tồn". Bốn màn
 * cần đúng hai con số ấy; chép bốn bản là chỗ để một bản quên
 * `fetchAllForAggregate` và báo tồn thiếu ở đúng một màn.
 *
 * ⚠ HAI CÂU ĐỌC GỘP, KHÔNG ĐỌC TỪNG MẶT HÀNG. Danh mục có 1.700 mã;
 * hỏi tồn từng mã lúc gõ là 1.700 lượt gọi. Kéo một lần lúc mở màn rồi
 * tra trong bộ nhớ.
 *
 * ⚠ CHỈ ĐỌC, KHÔNG GHI. `batches` ở đây là một phép ĐỌC để hiện ra;
 * mọi phép cộng/trừ kho vẫn phải đi qua RPC một giao dịch.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchAllForAggregate } from "@/lib/supabase/aggregate"
import type { ReceiptProduct } from "./receipt-form"

/**
 * Mặt hàng trong ô tìm, kèm hai thứ người nhập hàng cần biết TRƯỚC khi
 * chạm.
 *
 * ⚠ `onHand === null` NGHĨA LÀ CHƯA ĐỌC ĐƯỢC, không phải "hết hàng".
 * In 0 khi chưa biết là một câu nói dối, và người nhập sẽ nhập bù một
 * mặt hàng đang đầy kho.
 */
export interface PickerExtra {
  supplierName: string | null
  onHand: number | null
}

export async function loadPickerExtras(
  supabase: SupabaseClient,
  prods: ReceiptProduct[]
): Promise<Record<string, PickerExtra>> {
  const next: Record<string, PickerExtra> = {}
  for (const p of prods) {
    next[p.id] = { supplierName: null, onHand: null }
  }

  const supIds = Array.from(
    new Set(
      prods
        .map((p) => (p as { primary_supplier_id?: string | null }).primary_supplier_id)
        .filter(Boolean)
    )
  ) as string[]
  if (supIds.length > 0) {
    const { data } = await supabase.from("suppliers").select("id, name").in("id", supIds)
    const byId = new Map(((data as Array<{ id: string; name: string }>) || []).map((s) => [s.id, s.name]))
    for (const p of prods) {
      const sid = (p as { primary_supplier_id?: string | null }).primary_supplier_id
      if (sid && next[p.id]) next[p.id].supplierName = byId.get(sid) ?? null
    }
  }

  /**
   * ⚠ `fetchAllForAggregate` CHO TỒN. PostgREST cắt ở 1.000 dòng, mà số
   *   lô thì nhiều hơn số mặt hàng — cắt ở đây là báo tồn THIẾU.
   *
   * ⚠ ĐỌC HỎNG HAY BỊ CẮT THÌ ĐỂ TRỐNG, KHÔNG ĐỂ 0. `onHand: null` hiện
   *   "…" trên ô tìm; số 0 đọc như "hết hàng" và đó là một câu nói dối.
   */
  const res = await fetchAllForAggregate((from, to) =>
    supabase
      .from("batches")
      .select("product_id, qty_on_hand", { count: "exact" })
      .eq("status", "available")
      .order("id")
      .range(from, to)
  )
  if (!res.truncated) {
    const sum: Record<string, number> = {}
    for (const b of res.rows as Array<{ product_id: string; qty_on_hand: number | null }>) {
      sum[b.product_id] = (sum[b.product_id] ?? 0) + Number(b.qty_on_hand ?? 0)
    }
    for (const id of Object.keys(next)) next[id].onHand = sum[id] ?? 0
  }
  return next
}
