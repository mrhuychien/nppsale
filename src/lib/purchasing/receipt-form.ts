/**
 * PHÉP TÍNH TIỀN CỦA PHIẾU NHẬP HÀNG — tách khỏi giao diện để chốt được.
 *
 * ⚠ QUY ƯỚC KHÁC HẲN PHIẾU BÁN, và đây là chỗ dễ sai nhất của cả module.
 *   Bên bán, `line_discount` chỉ GHI NHỚ đã giảm bao nhiêu so với giá
 *   bảng — chiết khấu đã nằm sẵn trong `unit_price` (xem
 *   `src/lib/sell/create-order.ts`). Bên mua thì NCC ghi giảm giá thành
 *   một dòng riêng trên hoá đơn giấy, nên ở đây nó TRỪ THẬT:
 *
 *     tiền dòng = quantity × unit_price − line_discount
 *     subtotal  = Σ tiền dòng
 *     vat       = Σ (tiền dòng × vat_rate)
 *     total     = subtotal + vat − discount      ← "Cần trả NCC"
 *
 * ⚠ PHÉP NÀY CÓ MỘT BẢN THỨ HAI Ở SQL — `complete_purchase_invoice`
 *   (migration 142) tính lại từ dòng hàng và ghi số của NÓ vào công nợ
 *   NCC. Bản ở đây chỉ để NGƯỜI DÙNG XEM TRƯỚC. Hai bản lệch nhau là
 *   màn hình đọc cho người ta một con số rồi ghi xuống sổ một con số
 *   khác, và không có gì kêu lên. Có chốt khoá hai bên lại với nhau
 *   trong `tests/purchase-receipt.test.ts`.
 *
 * ⚠ `vat_rate` Ở ĐÂY LÀ TỈ LỆ (0,1), giống `products.vat_rate` và
 *   `purchase_invoice_lines.vat_rate`. Ô nhập trên biểu mẫu là PHẦN
 *   TRĂM và quy đổi bằng `percentToRatio` / `ratioToPercent` của
 *   `@/lib/purchasing/return-form` — một chỗ quy đổi cho cả module mua
 *   hàng, vì đã có một lần cột lẻ loi giữ phần trăm và nó làm thuế hụt
 *   100 lần (xem migration 141).
 */

import type { Product, ProductUnit } from "@/types"

/** Sản phẩm kèm bảng quy đổi đơn vị. */
export type ReceiptProduct = Product & { units?: ProductUnit[] }

/**
 * Một dòng của phiếu nhập.
 *
 * ⚠ CÁC Ô SỐ GIỮ DẠNG CHUỖI — đây là giá trị của `<input>`. Người dùng
 * gõ dở "1." hay xoá trắng ô là trạng thái hợp lệ mà `number` không
 * diễn đạt được (xoá trắng thành `NaN`, và `NaN` vẽ ra ô là một ô không
 * xoá được nữa).
 */
export interface ReceiptLine {
  id: string
  product_id: string
  product_name: string
  sku: string
  /** Ghi chú của DÒNG — chủ nhà chốt phải có cột này trên bảng hàng. */
  note: string
  unit_name: string
  quantity: string
  unit_price: string
  /** Giảm giá của dòng, TRỪ THẬT — xem đầu tệp. */
  line_discount: string
  /** PHẦN TRĂM (10 = 10%) trong biểu mẫu; lưu xuống là tỉ lệ. */
  vat_percent: string
  conversion_factor: string
  available_units: ProductUnit[]
  base_unit: string
}

const num = (s: string | number | null | undefined): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Tiền hàng của MỘT dòng, đã trừ giảm giá dòng, CHƯA có thuế.
 *
 * ⚠ KHÔNG ĐỂ ÂM. Người nhập gõ nhầm giảm giá lớn hơn tiền hàng là cả
 * phiếu ra số âm và công nợ NCC thành một khoản NCC nợ lại mình.
 */
export function lineNetOf(l: ReceiptLine): number {
  return Math.max(0, num(l.quantity) * num(l.unit_price) - num(l.line_discount))
}

/** Thuế của MỘT dòng, tính trên tiền đã trừ giảm giá dòng. */
export function lineVatOf(l: ReceiptLine): number {
  return lineNetOf(l) * (num(l.vat_percent) / 100)
}

/** Thành tiền của MỘT dòng — đã gồm thuế, đúng như cột `line_total`. */
export function lineTotalOf(l: ReceiptLine): number {
  return lineNetOf(l) + lineVatOf(l)
}

export interface ReceiptTotals {
  /** Σ tiền dòng, chưa thuế, đã trừ giảm giá dòng. */
  subtotal: number
  vat: number
  /** Giảm giá đầu phiếu. */
  discount: number
  /** Cần trả NCC. */
  total: number
}

/**
 * Cộng cả phiếu.
 *
 * ⚠ GIẢM GIÁ ĐẦU PHIẾU TRỪ SAU THUẾ. Nó là khoản NCC bớt lúc thanh
 * toán, không phải khoản làm đổi căn cứ tính thuế. Nếu thực tế ngược
 * lại thì phải sửa ở CẢ ĐÂY LẪN `complete_purchase_invoice`.
 *
 * ⚠ KẸP VỀ 0. Giảm giá lớn hơn tiền hàng không sinh ra một khoản NCC
 * phải trả ngược cho mình — SQL cũng kẹp đúng như vậy (`GREATEST(0,…)`).
 */
export function receiptTotals(lines: ReceiptLine[], headerDiscount: string | number): ReceiptTotals {
  let subtotal = 0
  let vat = 0
  for (const l of lines) {
    subtotal += lineNetOf(l)
    vat += lineVatOf(l)
  }
  const discount = Math.max(0, num(headerDiscount))
  return { subtotal, vat, discount, total: Math.max(0, subtotal + vat - discount) }
}

/**
 * Giá vốn theo ĐƠN VỊ CƠ SỞ — đúng con số SQL ghi vào `batches.unit_cost`.
 *
 * ⚠ CHIA CHO SỐ LƯỢNG CƠ SỞ, KHÔNG PHẢI SỐ LƯỢNG GÕ VÀO. Lấy thẳng
 * `unit_price` là ghi giá một thùng thành giá một hộp, và mọi báo cáo
 * lãi lỗ sau đó sai gấp bằng hệ số quy đổi.
 *
 * ⚠ TRỪ GIẢM GIÁ DÒNG. Bỏ qua nó là ghi giá vốn cao hơn số thật sự đã
 * trả, và lãi báo về thấp hơn thực tế.
 */
export function unitCostOf(l: ReceiptLine): number {
  const base = num(l.quantity) * (num(l.conversion_factor) || 1)
  if (base <= 0) return 0
  return lineNetOf(l) / base
}

/**
 * Dòng nào thật sự được ghi xuống.
 *
 * ⚠ SỐ LƯỢNG PHẢI DƯƠNG — `complete_purchase_invoice` từ chối cả phiếu
 * nếu gặp một dòng số lượng 0, nên lọc ở đây là để người dùng không
 * phải đọc một thông báo lỗi cho một dòng họ đã bỏ trống có chủ ý.
 */
export function validReceiptLines(lines: ReceiptLine[]): ReceiptLine[] {
  return lines.filter((l) => l.product_id && num(l.quantity) > 0)
}

/** Kho đích — hàng nhập về vào kho nào. */
export const RECEIPT_ZONES = [
  { value: "sale", label: "Kho hàng bán" },
  { value: "date", label: "Kho hàng date (gần hạn)" },
] as const

/**
 * Lỗi của `complete_purchase_invoice` / `cancel_purchase_invoice` dịch
 * sang tiếng người.
 *
 * ⚠ RPC ĐÃ TRẢ VỀ TIẾNG VIỆT SẴN, kèm mã ở đầu. Việc ở đây chỉ là CẮT
 * MÃ đi cho người dùng đọc — đừng viết lại câu, vì RPC là chỗ duy nhất
 * biết mặt hàng nào đang kẹt và kẹt bao nhiêu.
 */
export function friendlyReceiptError(msg: string): string {
  // ⚠ `[\s\S]` chứ không phải cờ `s` — cờ đó đòi target es2018,
  //   mà dự án này chưa bật. Câu lỗi của RPC có thể có xuống dòng.
  const m = /^[A-Z_]+:\s*([\s\S]+)$/.exec(msg.trim())
  return m ? m[1] : msg
}
