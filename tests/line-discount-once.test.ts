import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { lineDiscountOf, lineTotalOf, toOrderLine } from "../src/lib/sell/create-order"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"
import { invoiceToMisaPayload } from "../src/lib/misa/mapper"
import type { SellerInfo } from "../src/lib/misa/types"

/**
 * CHIẾT KHẤU CHỈ ĐƯỢC TRỪ MỘT LẦN.
 *
 * `sales_order_lines.unit_price` là giá ĐÃ giảm; `line_discount` chỉ GHI
 * NHỚ đã giảm bao nhiêu so với giá bảng. Ba chỗ trong kho mã từng trừ nó
 * thêm một lần nữa:
 *
 *   1. `orders/[id]/page.tsx` — hiển thị thành tiền khi đang sửa dòng;
 *   2. cùng tệp đó — và GHI con số ấy xuống `sales_order_lines.line_total`;
 *   3. `api/einvoice/publish/route.ts` — nạp giá đã giảm vào mapper MISA,
 *      nơi hợp đồng đòi giá BẢNG, nên hoá đơn gửi cơ quan thuế thấp hơn
 *      thực tế đúng bằng khoản giảm.
 *
 * ⚠ VÌ SAO NÓ SỐNG LÂU: dòng bán đúng giá bảng có `line_discount = 0`,
 *   và khi đó hai cách tính bằng nhau. Mọi chốt ở đây vì thế phải dùng
 *   dòng CÓ giảm giá — chốt nào chạy với chiết khấu 0 là chốt nói dối.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const cart = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 4,
  price: 90_000,
  listPrice: 100_000,
  note: "",
  conversion: 10,
  vatRate: 0.1,
  ...over,
})

describe("Công thức gốc: một nguồn sự thật", () => {
  it("thành tiền = số lượng × giá đang áp, không trừ chiết khấu", () => {
    const l = cart()
    expect(lineDiscountOf(l)).toBe(40_000)
    expect(lineTotalOf(l)).toBe(360_000)
    // Trừ thêm lần nữa ra 320.000 — lệch đúng bằng khoản giảm.
    expect(lineTotalOf(l)).not.toBe(320_000)
  })

  it("dòng đơn ghi xuống dùng đúng hai hàm đó", () => {
    const row = toOrderLine(cart())
    expect(row.line_total).toBe(lineTotalOf(cart()))
    expect(row.line_discount).toBe(lineDiscountOf(cart()))
  })

  /**
   * ⚠ Σ line_total PHẢI BẰNG subtotal của giỏ. Lệch ở đây là tổng đơn
   * khác tổng các dòng của chính nó, và không màn hình nào chỉ ra được
   * dòng nào sai.
   */
  it("tổng các dòng khớp subtotal của cartTotals", () => {
    const lines = [cart(), cart({ qty: 3, price: 50_000, listPrice: 50_000 })]
    const sum = lines.reduce((s, l) => s + lineTotalOf(l), 0)
    expect(sum).toBe(cartTotals(lines).subtotal)
  })

  it("nâng giá trên giá bảng thì chiết khấu là 0, không âm", () => {
    expect(lineDiscountOf(cart({ price: 120_000 }))).toBe(0)
  })

  it("lineTotalOf không trả số âm", () => {
    expect(lineTotalOf(cart({ price: -5_000 }))).toBe(0)
  })
})

describe("Màn chi tiết đơn không trừ chiết khấu lần hai", () => {
  const PAGE = read("src/app/(dashboard)/orders/[id]/page.tsx")
  const code = PAGE.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")

  /**
   * ⚠ ĐỌC BẢN ĐÃ LƯỢC CHÚ THÍCH. Tệp này có hẳn một khối chú thích kể
   * lại công thức sai để giải thích vì sao không được viết thế; đọc bản
   * thô thì chốt đỏ oan, và cách "sửa" tự nhiên nhất là nới lỏng nó.
   */
  it("không còn phép trừ qty × price − discount ở bất cứ đâu", () => {
    expect(code).not.toMatch(/\*\s*\w*[Pp]rice\s*-\s*\(?\w*[Dd]iscount/)
    expect(code).not.toMatch(/unit_price\s*-\s*\(l\.line_discount/)
    expect(code).not.toMatch(/livePrice\s*-\s*liveDiscount/)
  })

  it("dùng chung lineTotalOf thay vì viết lại công thức", () => {
    expect(code).toContain('from "@/lib/sell/create-order"')
    expect((code.match(/lineTotalOf\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  /**
   * ⚠ CHỖ NGHIÊM TRỌNG NHẤT LÀ CHỖ GHI. Hai chỗ kia chỉ hiện sai trên
   * màn hình; chỗ này ghi con số sai xuống `sales_order_lines.line_total`
   * và nó nằm lại đó.
   */
  it("khi lưu, line_total lấy từ lineTotalOf", () => {
    expect(code).toContain("line_total: lineTotalOf(money)")
  })

  /**
   * ⚠ `line_discount` LÀ SỐ TIỀN, KHÔNG PHẢI TỈ LỆ. Sửa 10 thùng xuống 5
   * mà giữ nguyên khoản giảm là ghi nhớ một khoản chiết khấu chưa từng
   * cho, và nó đi thẳng vào hoá đơn điện tử.
   */
  it("khi lưu, line_discount được tính lại theo số lượng và giá mới", () => {
    expect(code).toContain("line_discount: lineDiscountOf(money)")
  })

  /**
   * ⚠ GIÁ BẢNG SUY NGƯỢC TỪ CHÍNH DÒNG ĐANG CÓ, không lấy
   * `products.sell_price`. Giá bảng là giá theo ĐƠN VỊ BÁN và theo NHÓM
   * GIÁ của khách, nên `sell_price` trần trụi sai với dòng bán theo thùng
   * hoặc khách có bảng giá riêng — sai theo kiểu vẫn ra số trông hợp lý.
   */
  it("giá bảng suy từ unit_price + line_discount / quantity", () => {
    expect(code).toContain("list_price: qty > 0 ? price + disc / qty : price")
    expect(code).not.toMatch(/list_price:\s*Number\(\w*\.?sell_price/)
  })

  it("đổi mặt hàng thì không mang theo giá bảng của mặt hàng cũ", () => {
    expect(code).toContain("list_price: price,")
  })
})

describe("Hoá đơn điện tử: mapper nhận giá BẢNG, không nhận giá đã giảm", () => {
  const seller = {} as SellerInfo
  const build = (line: Record<string, unknown>) =>
    invoiceToMisaPayload({
      buyer: { name: "Tạp hoá A" },
      seller,
      lines: [
        {
          product_name: "Sữa",
          unit_name: "thùng",
          quantity: 4,
          unit_price: 100_000,
          vat_rate: 10,
          ...line,
        },
      ],
    })[0]

  /**
   * Hợp đồng của mapper, viết ra thành số: 4 × 100.000 = 400.000 gộp,
   * giảm 40.000 → doanh thu 360.000, thuế 36.000, tổng 396.000.
   */
  it("giá bảng + chiết khấu ra đúng doanh thu và thuế", () => {
    const h = build({ line_discount: 40_000 })
    expect(h.InvoiceDetails[0].AmountOC).toBe(400_000)
    expect(h.TotalAmountWithoutVATOC).toBe(360_000)
    expect(h.TotalVATAmountOC).toBe(36_000)
    expect(h.TotalAmountOC).toBe(396_000)
  })

  /**
   * ⚠ ĐÂY LÀ HÌNH DẠNG CỦA LỖI. Nạp giá ĐÃ giảm (90.000) mà vẫn kèm
   * chiết khấu thì doanh thu ra 320.000 thay vì 360.000 — kê thiếu cả
   * doanh thu lẫn thuế, mỗi dòng có giảm giá một ít.
   */
  it("nạp giá đã giảm mà vẫn kèm chiết khấu thì kê THIẾU", () => {
    const h = build({ unit_price: 90_000, line_discount: 40_000 })
    expect(h.TotalAmountWithoutVATOC).toBe(320_000)
    expect(h.TotalAmountWithoutVATOC).toBeLessThan(360_000)
  })

  it("hợp đồng được ghi ngay trên kiểu dữ liệu", () => {
    const M = read("src/lib/misa/mapper.ts")
    expect(M).toContain("⚠ GIÁ BẢNG — giá TRƯỚC chiết khấu.")
  })
})

describe("Nơi nạp dữ liệu cho hoá đơn điện tử cộng ngược chiết khấu", () => {
  const ROUTE = read("src/app/api/einvoice/publish/route.ts")
  const code = ROUTE.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")

  it("tính giá gộp trước khi truyền vào mapper", () => {
    expect(code).toContain(
      "const grossPrice = qty > 0 ? netPrice + discount / qty : netPrice"
    )
    expect(code).toContain("unit_price: grossPrice,")
  })

  /**
   * ⚠ CHỐT NGƯỢC. Không có nó thì thêm lại `unit_price: netPrice` bên
   * cạnh dòng gross vẫn xanh, vì `grossPrice` vẫn được tính.
   */
  it("không còn truyền thẳng giá đã giảm", () => {
    expect(code).not.toMatch(/unit_price:\s*Number\(l\.unit_price/)
    expect(code).not.toContain("unit_price: netPrice,")
  })

  /**
   * ⚠ DÒNG TỔNG HỢP (hoá đơn không gắn đơn hàng) KHÔNG ĐƯỢC CỘNG NGƯỢC:
   * nó lấy thẳng `invoice.subtotal` và khai `line_discount: 0`. Cộng
   * ngược ở đó là cộng một khoản không tồn tại.
   */
  it("dòng tổng hợp giữ nguyên, chiết khấu 0", () => {
    expect(code).toContain("line_discount: 0,")
  })
})
