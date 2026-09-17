import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { VAT_RATES, vatLabel } from "../src/lib/constants"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const SHEET = code(read("src/components/sell/line-edit-sheet.tsx"))
const CART = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const PRODUCT_FORM = code(read("src/components/products/product-form.tsx"))

/**
 * ⚠ NGƯỜI DÙNG BÁO: "khi bấm vào chi tiết hàng trong đơn chưa có chỗ để
 * tuỳ chọn VAT". Dòng lấy thuế suất của sản phẩm lúc thêm vào giỏ và
 * không có đường nào đổi — cùng một mặt hàng có lúc xuất có hoá đơn, có
 * lúc không, mà muốn đổi thì phải ra sửa sản phẩm rồi thêm lại dòng.
 */
describe("Sheet sửa dòng có chỗ chọn VAT", () => {
  it("có bộ chọn thuế và ghi thẳng vào dòng", () => {
    expect(SHEET).toContain("<Label>Thuế VAT</Label>")
    expect(SHEET).toContain("onClick={() => onPatch({ vatRate: v.value })}")
  })

  /**
   * ⚠ MỘT danh sách bậc thuế cho cả form sản phẩm lẫn sheet. Bản trước
   * form sản phẩm giữ bản riêng của nó; hai nơi hai danh sách là có ngày
   * một bên thêm bậc mà bên kia không hiểu.
   */
  it("bậc thuế lấy từ VAT_RATES dùng chung, form sản phẩm cũng vậy", () => {
    expect(SHEET).toContain("[...VAT_RATES]")
    expect(PRODUCT_FORM).toContain("VAT_RATES.map((r) => ({ value: String(r.value), label: r.label }))")
    expect(PRODUCT_FORM).not.toMatch(/\{ value: "0\.08", label: "8%" \}/)
    expect(VAT_RATES.map((v) => v.value)).toEqual([0, 0.05, 0.08, 0.1])
  })

  /**
   * ⚠ Thuế suất LẠ (sản phẩm khai 7%) không bị ép về bậc gần nhất. Ép là
   * lặng lẽ đổi số thuế người ta đã khai; và nếu không ép mà cũng không
   * hiện thì mở sheet ra không nút nào sáng — người dùng tưởng dòng chưa
   * có thuế.
   */
  it("thuế suất ngoài bậc chuẩn vẫn hiện thành một nút riêng, đúng chỗ", () => {
    expect(SHEET).toContain("if (base.some((v) => Math.abs(v.value - cur) < 1e-9)) return base")
    expect(SHEET).toContain("return [...base, { value: cur, label: vatLabel(cur) }].sort((a, b) => a.value - b.value)")
    expect(vatLabel(0.07)).toBe("7%")
    expect(vatLabel(0.08)).toBe("8%")
    expect(vatLabel(0)).toBe("0%")
  })

  /** Đổi VAT phải thấy tiền đổi ngay trong sheet — không phải đóng ra mới biết. */
  it("sheet hiện thành tiền có VAT khi dòng chịu thuế", () => {
    expect(SHEET).toContain("Thành tiền{(line.vatRate || 0) > 0 ? ` (chưa VAT)` : \"\"}")
    expect(SHEET).toContain("Có VAT {vatLabel(line.vatRate)}")
    expect(SHEET).toContain("formatCurrency(line.qty * line.price * (1 + line.vatRate))")
  })

  /** Và dòng chịu thuế phải nhìn thấy được từ danh sách trong giỏ. */
  it("giỏ hàng gắn nhãn VAT trên dòng chịu thuế", () => {
    expect(CART).toContain("{(r.line.vatRate || 0) > 0 && <span>VAT {vatLabel(r.line.vatRate)}</span>}")
  })

  /** Phép cộng tiền đọc đúng thuế suất của TỪNG dòng, không phải một số chung. */
  it("tổng đơn cộng VAT theo từng dòng", () => {
    const l = (over: Partial<CartLine>): CartLine => ({
      productId: "p",
      unit: "thùng",
      qty: 1,
      price: 100_000,
      listPrice: 100_000,
      note: "",
      conversion: 1,
      vatRate: 0,
      ...over,
    })
    const t = cartTotals([l({ vatRate: 0.08 }), l({ productId: "q", vatRate: 0 })], 0)
    expect(t.vat).toBe(8_000)
    expect(t.grandTotal).toBe(208_000)
  })
})
