/**
 * GHI DÒNG HÀNG CỦA HAI CHỨNG TỪ MUA HÀNG — phiếu nhập và phiếu trả NCC,
 * cho cả màn tạo lẫn màn sửa. Bốn màn, một phép ghi.
 *
 * ⚠ VÌ SAO TÁCH RA. Bốn màn cùng phải quy đổi thuế suất phần trăm → tỉ
 * lệ, cùng phải đánh `sort_order`, cùng phải tính `line_total`, cùng
 * phải quy giảm giá phần trăm ra tiền. Bốn việc ấy chép nhiều bản là
 * chỗ để một bản quên quy đổi thuế — đúng cái lỗi đã làm thuế phiếu trả
 * NCC hụt 100 lần (xem migration 141).
 *
 * ⚠ TÊN BẢNG VIẾT THẲNG Ở TỪNG HÀM, KHÔNG TRUYỀN VÀO BẰNG BIẾN. Chốt
 * `tests/purchasing-columns.test.ts` đối chiếu tên cột với lược đồ bằng
 * cách đọc chuỗi trong `.from("…")`; đưa tên bảng thành biến là chốt ấy
 * không còn biết payload này thuộc bảng nào, và một cột gõ sai lại đi
 * lọt như lần `note` / `notes` vừa rồi.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import { lineDiscountAmountOf, lineTotalOf, type ReceiptLine } from "./receipt-form"

/**
 * Phần chung của một dòng, đúng những cột mà CẢ HAI bảng đều có.
 *
 * ⚠ GHI XUỐNG LUÔN LÀ TIỀN, KHÔNG PHẢI PHẦN TRĂM. Cột `line_discount`
 * là số tiền; `discount_mode` chỉ sống trong biểu mẫu. Ghi thẳng ô nhập
 * xuống là cột ấy mang hai nghĩa tuỳ dòng — đúng cái bẫy đã làm thuế
 * phiếu trả NCC hụt 100 lần.
 *
 * ⚠ CỘT GHI CHÚ TÊN LÀ `notes`, SỐ NHIỀU, ở cả hai bảng. Trường trong
 * biểu mẫu tên `note`; gõ theo trí nhớ thành `note` ở đây là PostgREST
 * từ chối cả phép ghi với "Could not find the 'note' column" — chủ nhà
 * đã gặp đúng lỗi này.
 */
function linePayloadOf(
  l: ReceiptLine,
  i: number,
  percentToRatio: (p: string | number | null | undefined) => number
) {
  return {
    product_id: l.product_id,
    unit_name: l.unit_name || l.base_unit,
    quantity: Number(l.quantity) || 0,
    unit_price: Number(l.unit_price) || 0,
    line_discount: lineDiscountAmountOf(l),
    // ⚠ Cột là TỈ LỆ, ô nhập là PHẦN TRĂM.
    vat_rate: percentToRatio(l.vat_percent),
    conversion_factor: Number(l.conversion_factor) || 1,
    line_total: lineTotalOf(l),
    notes: l.note.trim() || null,
    // STT người dùng nhìn thấy, 1-based.
    sort_order: i + 1,
  }
}

/**
 * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Nên phép chèn phải
 * `.select("id")` rồi đếm — không đếm là một chứng từ KHÔNG CÓ DÒNG NÀO
 * được báo "đã lưu", và người dùng chỉ biết khi bấm Hoàn thành và nhận
 * "phiếu chưa có dòng hàng nào".
 */
function assertWrote(data: unknown[] | null, what: string): void {
  if (!data || data.length === 0) {
    throw new Error(
      `Không ghi được dòng hàng nào — nhiều khả năng bạn không có quyền sửa ${what}.`
    )
  }
}

/**
 * Xoá sạch dòng cũ của PHIẾU NHẬP rồi ghi lại.
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

  const invoicePayload = lines.map((l, i) => ({
    invoice_id: invoiceId,
    ...linePayloadOf(l, i, percentToRatio),
  }))

  const { data, error } = await supabase
    .from("purchase_invoice_lines")
    .insert(invoicePayload)
    .select("id")
  if (error) throw new Error(error.message)
  assertWrote(data, "phiếu nhập")
}

/** Xoá sạch dòng cũ của PHIẾU TRẢ NCC rồi ghi lại — cùng phép ghi. */
export async function saveReturnLines(
  supabase: SupabaseClient,
  returnId: string,
  lines: ReceiptLine[],
  percentToRatio: (p: string | number | null | undefined) => number
): Promise<void> {
  const { error: delErr } = await supabase
    .from("supplier_return_lines")
    .delete()
    .eq("return_id", returnId)
  if (delErr) throw new Error(delErr.message)

  if (lines.length === 0) return

  const returnPayload = lines.map((l, i) => ({
    return_id: returnId,
    ...linePayloadOf(l, i, percentToRatio),
  }))

  const { data, error } = await supabase
    .from("supplier_return_lines")
    .insert(returnPayload)
    .select("id")
  if (error) throw new Error(error.message)
  assertWrote(data, "phiếu trả NCC")
}
