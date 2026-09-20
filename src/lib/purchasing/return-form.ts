/**
 * NHỮNG THỨ RIÊNG CỦA PHIẾU TRẢ HÀNG NCC, cộng với phép quy đổi thuế
 * suất dùng chung cho cả module mua hàng.
 *
 * ⚠ TIỀN VÀ HÌNH DẠNG DÒNG NẰM Ở `receipt-form.ts`, không còn ở đây
 * (chủ nhà chốt 20/09/2026: "hãy làm phiếu trả NCC tương tự"). Tệp này
 * trước đây có bản RIÊNG của `ReturnLine`, `lineFromProduct`,
 * `returnTotals`, `lineTotalOf`, `validReturnLines`, `linePayload` — và
 * đúng vì có hai bản mà phiếu trả không có ghi chú dòng, không có giảm
 * giá và không có tiền thuế gõ tay trong khi phiếu nhập đã có cả ba.
 * Một bản cho cả hai chứng từ; phần riêng của phiếu trả chỉ còn lý do
 * trả, ô tìm hàng và câu dịch lỗi.
 *
 * ⚠ VÌ SAO TÁCH KHỎI GIAO DIỆN. Màn tạo phiếu và màn sửa phiếu trước
 * đây là hai bản SAO CHÉP của nhau: cùng kiểu `Line`, cùng `newLine`,
 * cùng `totals`, cùng `pickProduct`, cùng `pickUnit`, cùng cả khối JSX.
 * Sửa một phép tính ở một bên mà quên bên kia là phiếu tạo ra một số,
 * phiếu sửa lại ra số khác cho đúng cùng mấy dòng hàng — và không màn
 * nào nói gì.
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
 * ⚠ KHÔNG ĐỊNH NGHĨA `ReturnLine` Ở ĐÂY NỮA. Dòng của phiếu trả và dòng
 * của phiếu nhập là CÙNG một hình dạng — dùng `ReceiptLine` của
 * `receipt-form.ts`. Xem chú thích đầu tệp.
 */

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

/**
 * MẶT HÀNG NÀY CÓ THUỘC NCC ĐANG CHỌN KHÔNG.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "khi chọn ncc nào thì chỉ hiện ra hàng của
 * ncc đó thôi". Lý do có thật: một phiếu nhập trộn hai NCC là công nợ
 * ghi sai chỗ — và trên ô tìm 1.700 mã thì chạm nhầm là chuyện thường.
 *
 * ⚠ CHƯA CHỌN NCC THÌ KHÔNG LỌC GÌ. Lọc theo một ô còn trống là giấu
 * sạch danh mục ngay lúc mở màn.
 *
 * ⚠ HÀNG CHƯA GÁN NCC (`primary_supplier_id` NULL) VẪN HIỆN. Đây KHÔNG
 * phải nới lỏng cho qua — nó là quy ước đã có sẵn của kho mã này:
 * migration 081 viết thẳng "SP có primary_supplier_id NULL → ai cũng
 * thấy (legacy)", và chính sách RLS của `products` cũng làm đúng như
 * vậy. Cột ấy được BACKFILL từ phiếu nhập gần nhất (migration 030), nên
 * mã nào chưa từng nhập về thì nó trống — trống nghĩa là CHƯA BIẾT, chứ
 * không phải "của NCC khác". Giấu nhóm chưa biết đi là người nhập gõ
 * đúng tên hàng mà ô tìm im lặng trả về rỗng, và họ không có cách nào
 * đoán ra vì sao.
 *
 * Thứ thật sự phải chặn là hàng của NCC KHÁC — và chốt này chặn đúng nó.
 */
export function inSupplierScope(
  p: { primary_supplier_id?: string | null },
  supplierId: string | null | undefined
): boolean {
  if (!supplierId) return true
  if (p.primary_supplier_id == null) return true
  return p.primary_supplier_id === supplierId
}

/**
 * Danh mục đã thu về đúng NCC đang chọn.
 *
 * ⚠ KHÔNG TỰ QUYẾT LẠI LUẬT Ở ĐÂY. Hàm này chỉ lọc qua
 * `inSupplierScope` — một chỗ duy nhất biết "thế nào là thuộc NCC
 * này". Bản đầu chép lại phép `if (!supplierId) return products` vào
 * đây cho nhanh, và đúng vì thế mà chốt của `inSupplierScope` phá
 * được mà `scopeToSupplier` vẫn xanh: hai bản luật, chốt chỉ canh một.
 */
export function scopeToSupplier<T extends { primary_supplier_id?: string | null }>(
  products: T[],
  supplierId: string | null | undefined
): T[] {
  return products.filter((p) => inSupplierScope(p, supplierId))
}

/**
 * DÒNG NÀO TRÊN PHIẾU ĐANG THUỘC NCC KHÁC.
 *
 * ⚠ LỌC Ô TÌM CHỈ CHẶN LÚC THÊM. Thêm hàng xong rồi mới ĐỔI NCC ở đầu
 * phiếu thì những dòng đã có vẫn nằm nguyên — phiếu thành trộn hai NCC,
 * đúng cái mà phép lọc sinh ra để chặn, chỉ là đi vào bằng cửa sau.
 * Không ai thấy, vì trên bảng hàng không có cột NCC.
 *
 * ⚠ CHỈ CẢNH BÁO, KHÔNG CHẶN. Cột `primary_supplier_id` mang NCC nhập
 * GẦN NHẤT (migration 030), nên một mã vừa chuyển sang NCC mới còn treo
 * tên NCC cũ cho tới lần nhập kế — chặn cứng là chặn oan đúng cái phiếu
 * hợp lệ đang sửa chuyện đó. Việc ở đây là NÓI RA để người lập phiếu tự
 * quyết.
 *
 * ⚠ MÃ ĐÃ XOÁ KHỎI DANH MỤC THÌ KHÔNG KẾT TỘI. Tra không ra sản phẩm là
 * CHƯA BIẾT nó của ai — cùng quy ước với `inSupplierScope`. Hô lên
 * "thuộc NCC khác" cho một mã mình không tra được là nói bừa, và người
 * dùng sẽ học cách bỏ qua mọi cảnh báo của màn này.
 */
export function linesOutOfSupplierScope<T extends { product_id: string }>(
  lines: T[],
  products: Array<{ id: string; primary_supplier_id?: string | null }>,
  supplierId: string | null | undefined
): T[] {
  /**
   * ⚠ KHÔNG CHẶN SỚM BẰNG `if (!supplierId) return []`. Nghe thì hợp
   *   lý, nhưng đó là chép lại luật của `inSupplierScope` ra bản thứ
   *   hai — và bản thứ hai thì chốt không canh. Đã thử phá: gỡ dòng
   *   chặn sớm ấy đi mà cả 85 chốt vẫn XANH, vì hành vi không đổi.
   *   Một dòng mã mà xoá đi không chốt nào kêu là một dòng không ai
   *   canh; đúng kiểu ấy đã làm `scopeToSupplier` nói dối một lần rồi.
   *   Luật nằm ở MỘT chỗ: `inSupplierScope`.
   */
  const byId = new Map(products.map((p) => [p.id, p]))
  return lines.filter((l) => {
    const p = byId.get(l.product_id)
    if (!p) return false
    return !inSupplierScope(p, supplierId)
  })
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
