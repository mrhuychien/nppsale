/**
 * ĐỘI TEST HOÁ ĐƠN — LỖI ĐÃ XÁC MINH (ĐỎ tới khi sửa; sửa xong phải xanh).
 *
 * LỖI: màn POS Xuất hàng / Sửa HĐ (src/components/pos/invoice-screen.tsx) cho gõ số lượng lẻ (QtyStepper là
 *   <input type="number">, máy chủ nhận numeric — SQL A6 xuất 1,5 lốc ghi đúng 82.500), nhưng tiền hàng của dòng
 *   tính bằng `lineGross(qty, price)` (src/lib/pos/discount.ts:36) — hàm này LÀM TRÒN SỐ LƯỢNG
 *   (`Math.round(qty) * price`). Hệ quả:
 *     · `toDraftCoGiam` (src/lib/orders/invoice-editor.ts:250-256) quy giảm giá dòng về đơn giá bằng
 *       `(lineGross − giảm) / qty` → đơn giá gửi lên SAI: 1,5 × 55.000 giảm 10% thành đơn giá 66.000
 *       (HĐ ghi 99.000 thay vì 74.250 — khách bị ghi nợ thừa 24.750); 2,4 × 10.000 giảm 1.000 ghi 19.000
 *       thay vì 23.000 (thiếu tiền).
 *     · Cột "Thành tiền" của dòng (invoice-screen.tsx:871-873) hiện 110.000 cho 1,5 × 55.000, trong khi tổng
 *       HĐ (`invoiceTotals`) và máy chủ ghi 82.500.
 *   Luật: CLAUDE.md §1 "Tiền = SL × giá thì giá phải là giá của đúng đơn vị đó"; post-invoice.ts:87 "PHẢI RA
 *   ĐÚNG CON SỐ MÀ post_invoice SẼ GHI. Màn hình hiện một số, hóa đơn in ra một số khác, thì không ai tin được
 *   màn hình nữa"; invoice-editor.ts:239-240 "QUY KHOẢN GIẢM VỀ ĐƠN GIÁ, vì line_total máy chủ tính là SL × giá".
 */
import { describe, it, expect } from "vitest"
import { toDraftCoGiam, seedForNew } from "@/lib/orders/invoice-editor"
import { invoiceTotals, type InvoiceableLine } from "@/lib/orders/post-invoice"
import { lineGross } from "@/lib/pos/discount"

const dongDon = (x: Partial<InvoiceableLine> = {}): InvoiceableLine => ({
  orderLineId: "sol1", returnLineId: null, productId: "p1", productName: "Coca", sku: "SNP-001", unitName: "Loc 6",
  conversionFactor: 6, orderedQty: 2, invoicedQty: 0, remainingQty: 2, unitPrice: 55000, listPrice: 9000,
  lineDiscount: 0, vatRate: 0, availableBase: 1000, isExchange: false, note: null, ...x,
})

describe("LỖI: số lượng lẻ + giảm giá dòng trên màn soạn HĐ", () => {
  it("tiền hàng của dòng 1,5 × 55.000 = 82.500 (đúng như máy chủ ghi)", () => {
    expect(lineGross(1.5, 55000)).toBe(82500)
  })

  it("1,5 lốc × 55.000 giảm 10% → HĐ phải ghi 74.250 (đơn giá 49.500)", () => {
    const [r] = seedForNew([dongDon()])
    const [d] = toDraftCoGiam([{ ...r, qty: 1.5 }], { sol1: { value: 10, unit: "pct" } })
    expect(d.unitPrice).toBe(49500)
    expect(invoiceTotals([d]).total).toBe(74250)
  })

  it("2,4 × 10.000 giảm 1.000đ → HĐ phải ghi 23.000", () => {
    const [r] = seedForNew([dongDon({ unitName: "lon", conversionFactor: 1, unitPrice: 10000, remainingQty: 3 })])
    const [d] = toDraftCoGiam([{ ...r, qty: 2.4 }], { sol1: { value: 1000, unit: "vnd" } })
    expect(Math.abs(invoiceTotals([d]).total - 23000)).toBeLessThanOrEqual(1)
  })
})
