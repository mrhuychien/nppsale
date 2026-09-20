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
  /**
   * Giảm giá của dòng — SỐ NGƯỜI DÙNG GÕ, chưa phải số tiền.
   *
   * ⚠ NGHĨA CỦA NÓ PHỤ THUỘC `discount_mode`. Ở chế độ `amount` nó là
   * tiền; ở chế độ `percent` nó là phần trăm. Đọc thẳng nó như tiền là
   * biến một dòng "giảm 10%" thành "giảm 10 đồng".
   */
  line_discount: string
  /**
   * Giảm giá theo TIỀN hay theo PHẦN TRĂM (chủ nhà chốt 20/09/2026).
   *
   * ⚠ LƯU XUỐNG LUÔN LÀ TIỀN. Cột `purchase_invoice_lines.line_discount`
   * là số tiền; chế độ chỉ sống trong biểu mẫu. Lưu phần trăm xuống là
   * cột ấy mang hai nghĩa tuỳ dòng, đúng cái bẫy đã làm thuế phiếu trả
   * NCC hụt 100 lần (xem migration 141).
   */
  discount_mode: "amount" | "percent"
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

/** Tiền hàng của một dòng TRƯỚC khi trừ giảm giá. */
export function lineGrossOf(l: ReceiptLine): number {
  return num(l.quantity) * num(l.unit_price)
}

/**
 * SỐ TIỀN giảm giá thật của dòng — quy từ ô nhập theo chế độ đang chọn.
 *
 * ⚠ PHẦN TRĂM TÍNH TRÊN TIỀN HÀNG CỦA CHÍNH DÒNG ĐÓ, không phải trên
 * cả phiếu. "Giảm 5%" trên một dòng nghĩa là 5% của dòng ấy.
 *
 * ⚠ KẸP TRẦN 100%. Gõ 500% là số tiền giảm lớn hơn tiền hàng, và dòng
 * ra âm — `lineNetOf` có kẹp về 0, nhưng kẹp ở đây thì con số hiện trên
 * màn cũng đúng chứ không chỉ con số cuối.
 *
 * ⚠ KHÔNG ĐỂ ÂM. Gõ -10 ở chế độ tiền là CỘNG thêm vào tiền hàng qua
 * đường giảm giá.
 */
export function lineDiscountAmountOf(l: ReceiptLine): number {
  const raw = Math.max(0, num(l.line_discount))
  if (l.discount_mode === "percent") {
    return (lineGrossOf(l) * Math.min(100, raw)) / 100
  }
  return raw
}

/**
 * Tiền hàng của MỘT dòng, đã trừ giảm giá dòng, CHƯA có thuế.
 *
 * ⚠ KHÔNG ĐỂ ÂM. Người nhập gõ nhầm giảm giá lớn hơn tiền hàng là cả
 * phiếu ra số âm và công nợ NCC thành một khoản NCC nợ lại mình.
 */
export function lineNetOf(l: ReceiptLine): number {
  return Math.max(0, lineGrossOf(l) - lineDiscountAmountOf(l))
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
  /** Tiền thuế thật sự dùng — là số gõ tay nếu có, không thì số tự cộng. */
  vat: number
  /** Tiền thuế TỰ CỘNG từ thuế suất từng dòng. Để đối chiếu với số gõ tay. */
  vatComputed: number
  /** Người dùng có đang đè tiền thuế không. */
  vatOverridden: boolean
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
export function receiptTotals(
  lines: ReceiptLine[],
  headerDiscount: string | number,
  /**
   * Tiền thuế GTGT gõ tay theo hoá đơn giấy của NCC.
   *
   * ⚠ Ô TRỐNG KHÁC SỐ 0. Trống (`""` / `null`) nghĩa là "để máy tự
   * cộng"; số 0 nghĩa là "hoá đơn này KHÔNG có thuế". Gộp hai thứ làm
   * một là người dùng không có cách nào khai một hoá đơn thuế 0.
   */
  vatOverride?: string | number | null
): ReceiptTotals {
  let subtotal = 0
  let vatComputed = 0
  for (const l of lines) {
    subtotal += lineNetOf(l)
    vatComputed += lineVatOf(l)
  }
  const vatOverridden =
    vatOverride !== undefined && vatOverride !== null && String(vatOverride).trim() !== ""
  const vat = vatOverridden ? Math.max(0, num(vatOverride)) : vatComputed
  const discount = Math.max(0, num(headerDiscount))
  return {
    subtotal, vat, vatComputed, vatOverridden, discount,
    total: Math.max(0, subtotal + vat - discount),
  }
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
