import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { SHEET_CLOSE_MS } from "../src/components/ui/sheet"
import {
  isSaleLineOverstock,
  type StockCheckLine,
  type StockCheckProduct,
} from "../src/lib/orders/stock-check"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const FORM = read("src/components/orders/order-form.tsx")
const SHEET = read("src/components/ui/sheet.tsx")
const CSS = read("src/app/globals.css")

/** Thân hàm `addLine` — cắt tới khai báo cùng cấp thụt lề kế tiếp. */
const ADD_LINE = (() => {
  const i = FORM.indexOf("const addLine = (productId: string) => {")
  expect(i, "không tìm thấy addLine").toBeGreaterThanOrEqual(0)
  const j = FORM.indexOf("\n  const ", i + 10)
  expect(j, "không tìm thấy điểm kết thúc addLine").toBeGreaterThan(i)
  return FORM.slice(i, j)
})()

describe("Dòng vừa thêm nằm ở ĐẦU danh sách", () => {
  /**
   * ⚠ Thứ vừa thêm là thứ sắp phải sửa: nhập số lượng, đổi đơn vị, có khi
   * sửa giá. Nối vào đuôi thì đơn 15 dòng đẩy nó xuống dưới mép màn, và
   * mỗi mặt hàng tốn thêm một lượt kéo chỉ để chạm tới ô số lượng.
   */
  it("mảng mới bắt đầu bằng dòng mới, không bắt đầu bằng ...prev", () => {
    expect(ADD_LINE).toMatch(/setLines\(\(prev\) => \[\s*\{/)
    expect(ADD_LINE).not.toMatch(/setLines\(\(prev\) => \[\s*\.\.\.prev/)
  })

  it("các dòng cũ vẫn giữ đủ, nằm phía sau", () => {
    expect(ADD_LINE).toMatch(/\.\.\.prev,\s*\]\)/)
  })

  /**
   * ⚠ KHÔNG ĐƯỢC GỘP DÒNG TRÙNG. Một sản phẩm có thể đặt hai đơn vị khác
   * nhau (3 thùng + 5 hộp) nên hai dòng cùng sản phẩm là hợp lệ. Gộp lại
   * là làm hỏng một cách dùng có thật.
   */
  it("không tự gộp dòng cùng sản phẩm", () => {
    expect(ADD_LINE).not.toContain("findIndex")
    expect(ADD_LINE).not.toMatch(/prev\.map\(/)
  })
})

describe("Thêm xong phải NHÌN THẤY dòng vừa thêm", () => {
  /**
   * ⚠ Dòng mới ở đầu danh sách, mà đầu danh sách có thể đang ở trên mép
   * màn hình — nhất là sau khi ô tìm thành ô DÍNH, vì nay thêm hàng được
   * từ bất kỳ chỗ nào trong danh sách. Không kéo màn thì thêm xong màn
   * hình không đổi gì, trông hệt như bấm hụt.
   */
  it("thêm dòng thì kéo thẻ Sản phẩm lên đầu màn", () => {
    expect(ADD_LINE).toContain("scrollToProductsTop()")
    expect(FORM).toContain("productsCardRef.current?.scrollIntoView(")
    expect(FORM).toContain('block: "start"')
  })

  it("thẻ Sản phẩm có neo và chừa chỗ cho app bar", () => {
    expect(FORM).toMatch(/<Card ref=\{productsCardRef\}[^>]*scroll-mt-appbar/)
    expect(CSS).toContain(".scroll-mt-appbar { scroll-margin-top: var(--app-bar-h); }")
  })

  /**
   * ⚠ Tấm trượt chọn sản phẩm KHOÁ cuộn trang lúc đang mở, nên lệnh kéo
   * gọi trong `addLine` không có tác dụng gì khi thêm từ đó. Phải kéo lại
   * sau khi tấm trượt đóng hẳn.
   */
  it("đóng tấm trượt xong cũng kéo lại một lần", () => {
    const i = FORM.indexOf("<ProductPickerSheet")
    const block = FORM.slice(i, FORM.indexOf("/>", i))
    expect(block).toMatch(/if \(!o\) setTimeout\(scrollToProductsTop, SHEET_CLOSE_MS \+ \d+\)/)
  })

  /**
   * ⚠ Chờ phải ĐỦ LÂU. Khoá cuộn chỉ nhả khi tấm trượt rời khỏi DOM, tức
   * sau đúng thời lượng đóng của nó. Chờ hụt thì lệnh kéo rơi vào lúc
   * trang còn bị khoá và không có gì xảy ra — lỗi im lặng, không báo gì.
   */
  it("thời gian chờ không ngắn hơn thời lượng đóng tấm trượt", () => {
    const m = /if \(!o\) setTimeout\(scrollToProductsTop, SHEET_CLOSE_MS \+ (\d+)\)/.exec(FORM)
    expect(m, "không đọc được thời gian chờ").toBeTruthy()
    expect(Number(m![1])).toBeGreaterThan(0)
  })

  /**
   * ⚠ `SHEET_CLOSE_MS` phải KHỚP thời lượng trong class của Sheet. Đây là
   * hai con số ở hai nơi nói về cùng một khoảng thời gian — đổi một chỗ mà
   * quên chỗ kia thì lệnh kéo lại rơi vào lúc trang còn khoá.
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
