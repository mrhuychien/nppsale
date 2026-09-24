import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { VAT_RATES } from "../src/lib/constants"
import {
  addLine, cartTotals, lineDiscountAmountOf, netPriceOf, priceViolation, setLinesQty, setVatAll, theoThueChung,
  type CartLine,
} from "../src/lib/sell/cart"
import { toOrderLine } from "../src/lib/sell/create-order"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const SHEET = code(read("src/components/sell/line-edit-sheet.tsx"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const PRODUCT_FORM = code(read("src/components/products/product-form.tsx"))

const l = (over: Partial<CartLine>): CartLine => ({
  productId: "p", unit: "thùng", qty: 1, price: 100_000, listPrice: 100_000,
  note: "", conversion: 1, vatRate: 0, ...over,
})

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Fix ngược cả về phần làm đơn hàng trên sell mobile
 *   -> Bỏ VAT từng dòng. thêm giảm giá từng dòng theo %, giá trị."
 *
 * Luật cũ (ô VAT trong sheet sửa dòng, nhãn "VAT x%" trên từng dòng giỏ)
 * đã BỎ CÓ CHỦ Ý. Thuế nay đặt MỘT lần cho cả đơn — như nút thuế cả đơn của
 * POS — và đi xuống mọi dòng (sổ vẫn giữ `vat_rate` theo dòng, mig 183).
 */
describe("/sell: thuế đặt cả đơn, không đặt từng dòng", () => {
  it("sheet sửa dòng không còn ô thuế", () => {
    expect(SHEET).not.toContain("Thuế VAT")
    expect(SHEET).not.toMatch(/onPatch\(\{ vatRate/)
  })

  it("giỏ không gắn nhãn VAT trên từng dòng; có MỘT nút thuế cả đơn", () => {
    expect(CART).not.toMatch(/VAT \{vatLabel\(r\.line\.vatRate\)\}/)
    expect(CART).toContain('aria-label="Thuế VAT cả đơn"')
    expect(CART).toContain("cart.setVatAll(vatChungKeTiep(vatChung))")
  })

  it("nút cả đơn đặt thuế cho MỌI dòng", () => {
    const g = setVatAll([l({ vatRate: 0.1 }), l({ productId: "q", vatRate: 0 })], 0.08)
    expect(g.map((x) => x.vatRate)).toEqual([0.08, 0.08])
  })

  it("dòng mới theo thuế chung của giỏ; giỏ đang lệch thì giữ thuế danh mục", () => {
    const moi = l({ productId: "m", vatRate: 0.1 })
    expect(addLine([l({ vatRate: 0 })], moi)[0].vatRate).toBe(0)
    expect(addLine([], moi)[0].vatRate).toBe(0.1)
    expect(theoThueChung([l({ vatRate: 0 }), l({ productId: "q", vatRate: 0.08 })], moi).vatRate).toBe(0.1)
    expect(setLinesQty([l({ vatRate: 0.05 })], [{ ...moi, qty: 2 }])[0].vatRate).toBe(0.05)
  })

  /** Bậc thuế vẫn MỘT danh sách cho cả form sản phẩm. */
  it("bậc thuế lấy từ VAT_RATES dùng chung, form sản phẩm cũng vậy", () => {
    expect(PRODUCT_FORM).toContain("VAT_RATES.map((r) => ({ value: String(r.value), label: r.label }))")
    expect(VAT_RATES.map((v) => v.value)).toEqual([0, 0.05, 0.08, 0.1])
  })

  it("tổng đơn cộng VAT theo từng dòng", () => {
    const t = cartTotals([l({ vatRate: 0.08 }), l({ productId: "q", vatRate: 0 })], 0)
    expect(t.vat).toBe(8_000)
    expect(t.grandTotal).toBe(208_000)
  })
})

describe("/sell: giảm giá từng dòng theo % hoặc theo đồng", () => {
  it("khoản giảm và đơn giá sau giảm — %, đồng, kẹp", () => {
    const pct = l({ qty: 3, price: 100_000, discount: { value: 10, unit: "pct" } })
    expect(lineDiscountAmountOf(pct)).toBe(30_000)
    expect(netPriceOf(pct)).toBe(90_000)
    const dong = l({ qty: 4, price: 50_000, discount: { value: 20_000, unit: "vnd" } })
    expect(netPriceOf(dong), "giảm đồng là cả dòng, không phải mỗi món").toBe(45_000)
    expect(netPriceOf(l({ discount: { value: 999_999_999, unit: "vnd" } }))).toBe(0)
    expect(netPriceOf(l({ discount: { value: -5, unit: "vnd" } }))).toBe(100_000)
    expect(netPriceOf(l({}))).toBe(100_000)
  })

  it("tổng tiền trừ giảm dòng; thuế tính trên giá SAU giảm", () => {
    const t = cartTotals([l({ qty: 2, vatRate: 0.1, discount: { value: 10, unit: "pct" } })], 0)
    expect(t).toMatchObject({ gross: 200_000, subtotal: 180_000, discount: 20_000, vat: 18_000, grandTotal: 198_000 })
  })

  it("dòng gửi lên sổ mang giá SAU giảm; line_discount so với giá bảng", () => {
    const o = toOrderLine(l({ qty: 2, price: 100_000, listPrice: 100_000, discount: { value: 10, unit: "pct" } }))
    expect(o).toMatchObject({ unit_price: 90_000, line_discount: 20_000, line_total: 180_000 })
    // Không giảm: y như trước.
    expect(toOrderLine(l({ qty: 2 }))).toMatchObject({ unit_price: 100_000, line_discount: 0, line_total: 200_000 })
  })

  /** Sàn giá bảng xét giá GÕ, như POS — giảm dòng là đường riêng, có khoá quyền. */
  it("chốt giá xét đơn giá gõ, không xét giá sau giảm", () => {
    const g = l({ discount: { value: 10, unit: "pct" } })
    expect(priceViolation(g, { canEditPrice: true, maxIncreasePct: 10 })).toBeNull()
  })

  it("sheet có ô giảm dòng ₫/%, khoá khi không có quyền sửa giá; chỉ giỏ /sell bật", () => {
    expect(SHEET).toMatch(/lineDiscount && \(\s*<DiscountField/)
    expect(SHEET).toContain("disabled={!canEditPrice}")
    expect(SHEET).toContain("onChange={(d) => onPatch({ discount: d })}")
    expect(SHEET).toContain("switchUnit(d, lineGross(line.qty, line.price))")
    expect(CART).toMatch(/<LineEditSheet[\s\S]*?lineDiscount[\s\S]*?\/>/)
    // Thành tiền trên sheet và trên giỏ đọc giá SAU giảm.
    expect(SHEET).toContain("formatCurrency(line.qty * netPriceOf(line))")
    expect(CART).toContain("formatCurrency(r.line.qty * netPriceOf(r.line))")
  })
})
