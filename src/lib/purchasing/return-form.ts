/**
 * PHÉP TÍNH CỦA PHIẾU TRẢ HÀNG NCC — tách khỏi giao diện để chốt được.
 *
 * ⚠ VÌ SAO TÁCH RA. Màn tạo phiếu và màn sửa phiếu trước đây là hai bản
 * SAO CHÉP của nhau: cùng kiểu `Line`, cùng `newLine`, cùng `totals`,
 * cùng `pickProduct`, cùng `pickUnit`, cùng cả khối JSX. Sửa một phép
 * tính ở một bên mà quên bên kia là phiếu tạo ra một số, phiếu sửa lại
 * ra số khác cho đúng cùng mấy dòng hàng — và không màn nào nói gì.
 *
 * ⚠ HAI ĐƠN VỊ, GỌI TÊN KHÁC NHAU. Trong BIỂU MẪU thuế suất là PHẦN
 * TRĂM và trường tên `vat_percent` — vì ô nhập ghi nhãn "VAT %" và
 * người dùng gõ 10 chứ không gõ 0,1. Trong CƠ SỞ DỮ LIỆU thuế suất là
 * TỈ LỆ ở cột `vat_rate`, giống `products.vat_rate` và
 * `sales_invoice_lines.vat_rate` (migration 141 đổi cột này từ phần
 * trăm sang tỉ lệ).
 *
 * Hai cái tên khác nhau là cố ý: trước đây cả hai đều tên `vat_rate` và
 * đúng vì thế mà giá trị 0,1 của danh mục chui thẳng vào ô phần trăm
 * mà không ai nhận ra. Mọi phép quy đổi nằm ở `percentToRatio` /
 * `ratioToPercent` bên dưới — hai chỗ duy nhất, và đều có chốt.
 */

import type { Product, ProductUnit } from "@/types"
import { viMatchAllWords } from "@/lib/search"

/** Sản phẩm kèm danh sách đơn vị quy đổi, đúng hình dạng hai màn đang đọc. */
export type ReturnProduct = Product & { units?: ProductUnit[] }

/**
 * TỈ LỆ (cột `vat_rate`) → PHẦN TRĂM (ô nhập). 0.1 → "10".
 *
 * ⚠ LÀM TRÒN TỚI MỘT CHỮ SỐ THẬP PHÂN. `0.08 * 100` trong dấu phẩy động
 * ra `8.000000000000002`, và chuỗi đó rơi thẳng vào ô nhập cho người
 * dùng nhìn. Một chữ số là đủ cho mọi thuế suất có thật (0 · 5 · 8 · 10)
 * và vẫn giữ được những mức lẻ như 1,5%.
 *
 * ⚠ KHÔNG PHẢI SỐ THÌ TRẢ "0", đừng trả "NaN". Chuỗi "NaN" trong một ô
 * `type="number"` là một ô không xoá được — gõ gì cũng không sửa nổi.
 */
export function ratioToPercent(ratio: number | string | null | undefined): string {
  const n = Number(ratio)
  if (!Number.isFinite(n)) return "0"
  return String(Math.round(n * 1000) / 10)
}

/**
 * PHẦN TRĂM (ô nhập) → TỈ LỆ (cột `vat_rate`). "10" → 0.1.
 *
 * ⚠ Ô TRỐNG LÀ 0. Phiếu soạn dở có ô thuế trắng là chuyện thường; để nó
 * thành `NaN` là gửi `NaN` lên máy chủ, và cột `numeric` nhận về một giá
 * trị không ai đọc được.
 *
 * ⚠ LÀM TRÒN TỚI SÁU CHỮ SỐ. `8 / 100` ra `0.08` gọn, nhưng `0.1 / 100`
 * kiểu dấu phẩy động sinh đuôi rác; sáu chữ số dư sức cho mọi thuế suất
 * và không để đuôi rác đi vào cơ sở dữ liệu.
 */
export function percentToRatio(percent: number | string | null | undefined): number {
  const n = Number(percent)
  if (!Number.isFinite(n)) return 0
  return Math.round((n / 100) * 1_000_000) / 1_000_000
}

/**
 * Một dòng hàng trả.
 *
 * ⚠ CÁC Ô SỐ GIỮ DẠNG CHUỖI. Đây là giá trị của ô `<input>`: người dùng
 * gõ dở "1." hay xoá trắng ô là những trạng thái hợp lệ mà `number`
 * không diễn đạt được (xoá trắng thành `NaN`, và `NaN` vẽ ra ô là một ô
 * không xoá được nữa).
 */
export interface ReturnLine {
  id: string
  product_id: string
  product_name: string
  sku: string
  unit_name: string
  quantity: string
  unit_price: string
  /** PHẦN TRĂM (10 = 10%) — giá trị của ô nhập, xem đầu tệp. */
  vat_percent: string
  conversion_factor: string
  available_units: ProductUnit[]
  base_unit: string
}

/**
 * Dựng một dòng từ sản phẩm vừa chọn, điền sẵn những gì đã biết.
 *
 * ⚠ SỐ LƯỢNG ĐỂ TRỐNG, KHÔNG ĐIỀN 1. Người dùng chọn mặt hàng xong là
 * gõ ngay số lượng thật; điền sẵn 1 là để một con số KHÔNG AI GÕ có cơ
 * hội đi thẳng vào phiếu khi họ bấm nhầm hoặc bỏ qua ô đó.
 *
 * ⚠ ĐƠN VỊ MẶC ĐỊNH LÀ ĐƠN VỊ CƠ SỞ (hệ số 1). Kho trừ theo đơn vị cơ
 * sở; mặc định vào một đơn vị quy đổi là trả 20 hộp khi người ta định
 * trả 1 thùng, hoặc ngược lại.
 *
 * ⚠ `products.vat_rate` LÀ TỈ LỆ (0,1) CÒN Ô NÀY LÀ PHẦN TRĂM. Chép
 * thẳng sang là ghi 0,1% thay cho 10% — thuế hụt 100 lần, và không có
 * chỗ nào kêu. Đó là lỗi có thật của bản cũ.
 */
export function lineFromProduct(p: ReturnProduct, seq: number): ReturnLine {
  return {
    id: `${p.id}-${seq}`,
    product_id: p.id,
    product_name: p.name,
    sku: p.sku ?? "",
    base_unit: p.base_unit,
    available_units: p.units ?? [],
    unit_name: p.base_unit,
    conversion_factor: "1",
    quantity: "",
    unit_price: p.cost_price ? String(p.cost_price) : "",
    vat_percent: p.vat_rate != null ? ratioToPercent(p.vat_rate) : "0",
  }
}

/**
 * Đổi đơn vị của một dòng, kéo theo hệ số quy đổi.
 *
 * ⚠ ĐƠN VỊ CƠ SỞ LUÔN CÓ HỆ SỐ 1, kể cả khi nó cũng nằm trong bảng
 * `product_units` với một hệ số khác. Tra bảng trước rồi mới xét là mở
 * đường cho một dòng "hộp × 20" trong khi hộp chính là đơn vị cơ sở.
 */
export function unitPatch(line: ReturnLine, unitName: string): Partial<ReturnLine> {
  if (unitName === line.base_unit) return { unit_name: unitName, conversion_factor: "1" }
  const u = line.available_units.find((x) => x.unit_name === unitName)
  return { unit_name: unitName, conversion_factor: u ? String(u.conversion) : "1" }
}

export interface ReturnTotals {
  sub: number
  vat: number
  total: number
}

/**
 * Cộng phiếu.
 *
 * ⚠ Ô TRỐNG LÀ 0, KHÔNG PHẢI `NaN`. Một dòng vừa thêm chưa gõ số lượng
 * mà làm cả phiếu thành "NaN đ" là màn hình nói dối về một phiếu hoàn
 * toàn bình thường đang soạn dở.
 */
export function returnTotals(lines: ReturnLine[]): ReturnTotals {
  let sub = 0
  let vat = 0
  for (const l of lines) {
    const lineSub = (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0)
    sub += lineSub
    vat += (lineSub * (parseFloat(l.vat_percent) || 0)) / 100
  }
  return { sub, vat, total: sub + vat }
}

/** Thành tiền của MỘT dòng — đã gồm thuế, đúng như cột `line_total`. */
export function lineTotalOf(l: ReturnLine): number {
  const q = parseFloat(l.quantity) || 0
  const p = parseFloat(l.unit_price) || 0
  const v = parseFloat(l.vat_percent) || 0
  return q * p * (1 + v / 100)
}

/**
 * Những dòng thật sự được ghi xuống.
 *
 * ⚠ SỐ LƯỢNG PHẢI DƯƠNG. Dòng số lượng 0 ghi xuống là một dòng phiếu
 * không trả gì, và RPC vẫn đi tìm lô để trừ cho nó.
 */
export function validReturnLines(lines: ReturnLine[]): ReturnLine[] {
  return lines.filter(
    (l) => l.product_id && parseFloat(l.quantity) > 0 && parseFloat(l.unit_price) >= 0
  )
}

/** Tải trọng một dòng, đúng hình dạng bảng `supplier_return_lines`. */
export function linePayload(returnId: string, l: ReturnLine) {
  return {
    return_id: returnId,
    product_id: l.product_id,
    unit_name: l.unit_name || l.base_unit,
    quantity: parseFloat(l.quantity),
    unit_price: parseFloat(l.unit_price),
    vat_rate: percentToRatio(l.vat_percent),
    conversion_factor: parseFloat(l.conversion_factor) || 1,
    line_total: lineTotalOf(l),
  }
}

/**
 * Ô TÌM HÀNG của phiếu — thay cho danh sách xổ 1.700 mục ở mỗi dòng.
 *
 * ⚠ BỎ DẤU TRƯỚC KHI SO, dùng chung `viMatchAllWords` với mọi ô tìm
 * khác trong kho mã. Người nhập kho gõ "banh" để tìm "Bánh".
 *
 * ⚠ LOẠI MÃ ĐÃ CÓ TRÊN PHIẾU. Thêm lần hai thành hai dòng cùng một mã
 * trong một phiếu, và người đối chiếu với NCC không hiểu vì sao một mặt
 * hàng xuất hiện hai lần.
 *
 * ⚠ CHƯA GÕ GÌ THÌ KHÔNG GỢI Ý GÌ. Đổ cả danh mục xuống dưới ô tìm là
 * dựng lại đúng cái danh sách phải cuộn mà ô tìm sinh ra để thay thế.
 */
export function searchReturnProducts(
  products: ReturnProduct[],
  term: string,
  alreadyOnSlip: ReadonlySet<string>,
  limit = 12
): ReturnProduct[] {
  if (!term.trim()) return []
  const out: ReturnProduct[] = []
  for (const p of products) {
    if (alreadyOnSlip.has(p.id)) continue
    if (!viMatchAllWords(term, p.name, p.sku, p.barcode)) continue
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

/** Nhãn lý do trả — định nghĩa cạnh tập giá trị, không rải ra JSX. */
export const RETURN_REASONS = [
  { value: "near_expiry", label: "Hàng gần hạn" },
  { value: "expired", label: "Hàng hết hạn" },
  { value: "damaged", label: "Hàng hư hỏng" },
  { value: "wrong_item", label: "Sai hàng" },
  { value: "other", label: "Khác" },
] as const

/**
 * Lỗi của `complete_supplier_return` dịch sang tiếng người.
 *
 * ⚠ GIỮ NGUYÊN PHẦN SAU DẤU `|`. RPC liệt kê đúng mặt hàng nào thiếu và
 * thiếu bao nhiêu; nuốt phần đó đi là bắt người dùng tự dò cả phiếu.
 */
export function friendlyReturnError(msg: string): string {
  if (msg.includes("INSUFFICIENT_STOCK")) {
    const parts = msg.split("|").map((s) => s.trim())
    if (parts.length > 1) {
      return `Không đủ tồn để xuất — ${parts.slice(1).join(" · ")}. Đổi kho khác hoặc giảm số lượng / nhập đủ rồi gửi lại.`
    }
    return "Không đủ tồn kho trong kho đã chọn để xuất. Kiểm tra số lượng / chọn kho khác."
  }
  return msg
}
