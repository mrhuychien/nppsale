import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SHEET_CLOSE_MS } from "../src/components/ui/sheet"
import { addLine, type CartLine } from "../src/lib/sell/cart"
import {
  isSaleLineOverstock,
  type StockCheckLine,
  type StockCheckProduct,
} from "../src/lib/orders/stock-check"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const POS = read("src/app/(dashboard)/sell/page.tsx")
const SHEET = read("src/components/ui/sheet.tsx")

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 1,
  price: 1000,
  listPrice: 1000,
  note: "",
  conversion: 1,
  vatRate: 0,
  ...over,
})

describe("Dòng vừa thêm nằm ở ĐẦU giỏ", () => {
  /**
   * ⚠ Thứ vừa thêm là thứ sắp phải sửa: nhập số lượng, đổi đơn vị, có khi
   * sửa giá. Nối vào đuôi thì đơn 15 dòng đẩy nó xuống dưới mép màn, và
   * mỗi mặt hàng tốn thêm một lượt kéo chỉ để chạm tới ô số lượng.
   */
  it("dòng mới đứng trước, dòng cũ giữ đủ phía sau", () => {
    const cart = addLine(addLine([], line({ productId: "a" })), line({ productId: "b" }))
    expect(cart.map((l) => l.productId)).toEqual(["b", "a"])
  })

  /**
   * ⚠ Cộng dồn KHÔNG được làm dòng nhảy lên đầu. Thêm lại một mặt hàng đã
   * có thì người dùng nhìn số lượng của nó tăng tại chỗ; kéo nó lên đầu là
   * xáo lại cả danh sách vì một cú chạm.
   */
  it("cộng dồn giữ nguyên chỗ của dòng cũ", () => {
    const cart = addLine(addLine([], line({ productId: "a" })), line({ productId: "b" }))
    const after = addLine(cart, line({ productId: "a" }))
    expect(after.map((l) => l.productId)).toEqual(["b", "a"])
    expect(after.find((l) => l.productId === "a")!.qty).toBe(2)
  })

  /**
   * ⚠ Một sản phẩm có thể đặt hai đơn vị khác nhau (3 thùng + 5 chai) nên
   * hai dòng cùng sản phẩm là hợp lệ. Khoá gộp là sản phẩm + ĐƠN VỊ.
   */
  it("cùng sản phẩm khác đơn vị vẫn là hai dòng", () => {
    const cart = addLine(addLine([], line({ unit: "thùng" })), line({ unit: "chai" }))
    expect(cart).toHaveLength(2)
  })
})

describe("Thêm xong phải NHÌN THẤY dòng vừa thêm", () => {
  /**
   * ⚠ Ở màn tạo đơn cũ, thêm hàng xong danh sách nằm im tại chỗ — trông hệt
   * như bấm hụt, và phải kéo màn mới thấy dòng mới. Màn bán hàng bỏ hẳn vấn
   * đề đó: chạm một cái là đi thẳng vào giỏ, nơi dòng vừa thêm nằm trên
   * cùng kèm bộ đếm số lượng.
   */
  it("chạm vào thẻ hàng là mở giỏ ngay", () => {
    const i = POS.indexOf("const addToCart = (p: PricedProduct) => {")
    expect(i, "không tìm thấy addToCart").toBeGreaterThanOrEqual(0)
    const body = POS.slice(i, POS.indexOf("\n  }", i))
    expect(body).toContain('router.push("/sell/cart")')
  })

  /**
   * ⚠ `SHEET_CLOSE_MS` phải KHỚP thời lượng trong class của Sheet. Đây là
   * hai con số ở hai nơi nói về cùng một khoảng thời gian; lệch nhau thì
   * mọi thao tác hẹn giờ sau khi đóng tấm trượt rơi vào lúc trang còn bị
   * khoá cuộn — hỏng trong im lặng, không báo gì.
   */
  it("hằng số chờ khớp đúng thời lượng đóng trong class", () => {
    const m = /data-\[state=closed\]:duration-(\d+)/.exec(SHEET)
    expect(m, "Sheet không khai thời lượng đóng").toBeTruthy()
    expect(SHEET_CLOSE_MS).toBe(Number(m![1]))
  })
})

describe("Đổi thứ tự dòng KHÔNG làm sai phép kiểm tồn", () => {
  /**
   * Đây là giả định mà việc đảo thứ tự dựa vào. Nếu phép kiểm vượt tồn
   * phụ thuộc dòng nào đứng trước, thì đưa dòng mới lên đầu sẽ đổi luôn
   * kết quả cảnh báo — và một đơn hợp lệ có thể bị chặn.
   */
  const products: StockCheckProduct[] = [
    { id: "p1", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 12 }] },
  ]
  const stock = { p1: 10 }

  it("hai dòng cùng sản phẩm: đảo thứ tự cho cùng kết quả", () => {
    const a: StockCheckLine = { product_id: "p1", unit_name: "hộp", quantity: 6 }
    const b: StockCheckLine = { product_id: "p1", unit_name: "hộp", quantity: 6 }
    // Tổng 12 > tồn 10 → CẢ HAI dòng đều bị đánh dấu, bất kể thứ tự.
    expect(isSaleLineOverstock(0, [a, b], products, stock)).toBe(true)
    expect(isSaleLineOverstock(1, [a, b], products, stock)).toBe(true)
    expect(isSaleLineOverstock(0, [b, a], products, stock)).toBe(true)
    expect(isSaleLineOverstock(1, [b, a], products, stock)).toBe(true)
  })

  it("đơn hợp lệ vẫn hợp lệ sau khi đảo", () => {
    const a: StockCheckLine = { product_id: "p1", unit_name: "hộp", quantity: 4 }
    const b: StockCheckLine = { product_id: "p1", unit_name: "hộp", quantity: 5 }
    for (const lines of [[a, b], [b, a]]) {
      expect(isSaleLineOverstock(0, lines, products, stock)).toBe(false)
      expect(isSaleLineOverstock(1, lines, products, stock)).toBe(false)
    }
  })

  /** Quy đổi đơn vị cũng không phụ thuộc thứ tự: 1 thùng = 12 hộp > 10. */
  it("dòng theo thùng đứng trước hay sau đều vượt tồn như nhau", () => {
    const box: StockCheckLine = { product_id: "p1", unit_name: "thùng", quantity: 1 }
    const piece: StockCheckLine = { product_id: "p1", unit_name: "hộp", quantity: 1 }
    expect(isSaleLineOverstock(0, [box, piece], products, stock)).toBe(true)
    expect(isSaleLineOverstock(1, [piece, box], products, stock)).toBe(true)
  })
})
