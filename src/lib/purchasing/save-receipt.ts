/**
 * GHI DÒNG HÀNG CỦA PHIẾU NHẬP — một chỗ cho cả màn tạo lẫn màn sửa.
 *
 * ⚠ VÌ SAO TÁCH RA. Hai màn cùng phải quy đổi thuế suất phần trăm →
 * tỉ lệ, cùng phải đánh `sort_order`, cùng phải tính `line_total`. Ba
 * việc ấy chép hai bản là chỗ để một bản quên quy đổi thuế — đúng cái
 * lỗi đã làm thuế phiếu trả NCC hụt 100 lần (xem migration 141).
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { lineTotalOf, type ReceiptLine } from "./receipt-form"

/**
 * Xoá sạch dòng cũ rồi ghi lại.
 *
 * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Nên phép chèn phải
 * `.select("id")` rồi đếm — không đếm là một phiếu KHÔNG CÓ DÒNG NÀO
 * được báo "đã lưu", và người dùng chỉ biết khi bấm Hoàn thành và nhận
 * "phiếu chưa có dòng hàng nào".
 *
 * ⚠ `percentToRatio` TRUYỀN VÀO chứ không import thẳng — để chốt kiểm
 * được rằng có quy đổi thật, và để không buộc lib này phụ thuộc ngược
 * vào module phiếu trả.
 */
export async function saveReceiptLines(
  supabase: SupabaseClient,
  invoiceId: string,
  lines: ReceiptLine[],
  percentToRatio: (p: string | number | null | undefined) => number
): Promise<void> {
  const { error: delErr } = await supabase
    .from("purchase_invoice_lines")
    .delete()
    .eq("invoice_id", invoiceId)
  if (delErr) throw new Error(delErr.message)

  if (lines.length === 0) return

  const payload = lines.map((l, i) => ({
    invoice_id: invoiceId,
    product_id: l.product_id,
    unit_name: l.unit_name || l.base_unit,
    quantity: Number(l.quantity) || 0,
    unit_price: Number(l.unit_price) || 0,
    line_discount: Number(l.line_discount) || 0,
    // ⚠ Cột là TỈ LỆ, ô nhập là PHẦN TRĂM.
    vat_rate: percentToRatio(l.vat_percent),
    conversion_factor: Number(l.conversion_factor) || 1,
    line_total: lineTotalOf(l),
    // ⚠ CỘT TÊN LÀ `notes`, SỐ NHIỀU. Trường trong biểu mẫu tên `note`;
    //   gõ theo trí nhớ thành `note` ở đây là PostgREST từ chối cả phép
    //   ghi với "Could not find the 'note' column" — chủ nhà đã gặp.
    notes: l.note.trim() || null,
    // STT người dùng nhìn thấy, 1-based.
    sort_order: i + 1,
  }))

  const { data, error } = await supabase
    .from("purchase_invoice_lines")
    .insert(payload)
    .select("id")
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error(
      "Không ghi được dòng hàng nào — nhiều khả năng bạn không có quyền sửa phiếu nhập."
    )
  }
}
