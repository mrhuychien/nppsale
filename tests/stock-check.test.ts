import { describe, it, expect } from "vitest"
import {
  toBaseQty,
  saleDemandByProduct,
  exchangeDemandByProduct,
  availableForSaleLine,
  isSaleLineOverstock,
  availableForExchangeLine,
  isReturnLineOverstock,
  hasOverstock,
} from "@/lib/orders/stock-check"
import type {
  StockCheckProduct,
  StockCheckLine,
  StockCheckReturnLine,
} from "@/lib/orders/stock-check"

/**
 * Kiểm tồn khi soạn đơn. Sai chiều lỏng → bán quá tồn, kho không có hàng
 * để giao. Sai chiều chặt → chặn nhầm đơn hợp lệ, nhân viên đứng ở cửa
 * hàng không lưu được đơn.
 */

// Thùng = 12 hộp. "hộp" là đơn vị cơ sở.
const PRODUCTS: StockCheckProduct[] = [
  { id: "p1", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 12 }] },
  { id: "p2", base_unit: "chai", units: [] },
]

const sale = (product_id: string, unit_name: string, quantity: number): StockCheckLine =>
  ({ product_id, unit_name, quantity })

const ret = (
  product_id: string, unit_name: string, quantity: number, is_exchange: boolean
): StockCheckReturnLine => ({ product_id, unit_name, quantity, is_exchange })

describe("toBaseQty — quy về đơn vị cơ sở", () => {
  it("đơn vị cơ sở thì giữ nguyên", () => {
    expect(toBaseQty(sale("p1", "hộp", 5), PRODUCTS)).toBe(5)
  })

  it("đơn vị lớn thì nhân hệ số quy đổi", () => {
    expect(toBaseQty(sale("p1", "thùng", 2), PRODUCTS)).toBe(24)
  })

  it("không tìm thấy sản phẩm → giữ nguyên, không nhân bừa", () => {
    expect(toBaseQty(sale("khong-co", "thùng", 3), PRODUCTS)).toBe(3)
  })

  it("đơn vị lạ không có trong danh sách quy đổi → hệ số 1", () => {
    // Thà cảnh báo hụt còn hơn đoán hệ số rồi chặn nhầm đơn hợp lệ.
    expect(toBaseQty(sale("p1", "pallet", 3), PRODUCTS)).toBe(3)
  })

  it("sản phẩm không có bảng quy đổi cũng không gây lỗi", () => {
    expect(toBaseQty(sale("p2", "chai", 7), PRODUCTS)).toBe(7)
  })
})

describe("isSaleLineOverstock — vượt tồn ở từng dòng bán", () => {
  const stock = { p1: 10 }

  it("bán trong tồn thì không vượt", () => {
    expect(isSaleLineOverstock(0, [sale("p1", "hộp", 10)], PRODUCTS, stock)).toBe(false)
  })

  it("bán quá tồn thì vượt", () => {
    expect(isSaleLineOverstock(0, [sale("p1", "hộp", 11)], PRODUCTS, stock)).toBe(true)
  })

  it("SO SÁNH THEO ĐƠN VỊ CƠ SỞ: 1 thùng (12 hộp) vượt tồn 10 hộp", () => {
    // Đây là chỗ dễ sai nhất — nhìn số thì "1 < 10".
    expect(isSaleLineOverstock(0, [sale("p1", "thùng", 1)], PRODUCTS, stock)).toBe(true)
  })

  it("hai dòng CÙNG sản phẩm phải cộng dồn, không xét riêng từng dòng", () => {
    const lines = [sale("p1", "hộp", 6), sale("p1", "hộp", 6)]
    // Từng dòng nhìn riêng đều "6 < 10", nhưng dòng kia đã chiếm mất 6.
    expect(isSaleLineOverstock(0, lines, PRODUCTS, stock)).toBe(true)
    expect(isSaleLineOverstock(1, lines, PRODUCTS, stock)).toBe(true)
  })

  it("dòng của sản phẩm KHÁC không ảnh hưởng", () => {
    const lines = [sale("p1", "hộp", 10), sale("p2", "chai", 999)]
    expect(isSaleLineOverstock(0, lines, PRODUCTS, { p1: 10, p2: 9999 })).toBe(false)
  })

  it("sản phẩm không có trong bảng tồn coi như tồn 0", () => {
    expect(isSaleLineOverstock(0, [sale("p1", "hộp", 1)], PRODUCTS, {})).toBe(true)
  })

  it("availableForSaleLine trừ đúng phần các dòng khác đã chiếm", () => {
    const lines = [sale("p1", "hộp", 4), sale("p1", "hộp", 3)]
    expect(availableForSaleLine(0, lines, PRODUCTS, stock)).toBe(7)
    expect(availableForSaleLine(1, lines, PRODUCTS, stock)).toBe(6)
  })
})

describe("dòng trả hàng — chỉ hàng ĐỔI mới trừ tồn", () => {
  const stock = { p1: 10 }

  it("trả thường không bao giờ bị coi là vượt tồn (hàng nhập lại kho)", () => {
    const rl = [ret("p1", "hộp", 999, false)]
    expect(isReturnLineOverstock(0, rl, [], PRODUCTS, stock)).toBe(false)
  })

  it("hàng đổi vượt tồn thì bị chặn", () => {
    const rl = [ret("p1", "hộp", 11, true)]
    expect(isReturnLineOverstock(0, rl, [], PRODUCTS, stock)).toBe(true)
  })

  it("hàng đổi phải trừ SAU nhu cầu bán", () => {
    const lines = [sale("p1", "hộp", 8)]
    const rl = [ret("p1", "hộp", 3, true)]
    // Còn 2 sau khi bán 8 → đổi 3 là vượt.
    expect(availableForExchangeLine(0, rl, lines, PRODUCTS, stock)).toBe(2)
    expect(isReturnLineOverstock(0, rl, lines, PRODUCTS, stock)).toBe(true)
  })

  it("nhiều dòng đổi cùng sản phẩm cũng cộng dồn", () => {
    const rl = [ret("p1", "hộp", 6, true), ret("p1", "hộp", 6, true)]
    expect(isReturnLineOverstock(0, rl, [], PRODUCTS, stock)).toBe(true)
  })

  it("dòng trả thường KHÔNG chiếm chỗ của dòng đổi", () => {
    const rl = [ret("p1", "hộp", 5, true), ret("p1", "hộp", 100, false)]
    expect(isReturnLineOverstock(0, rl, [], PRODUCTS, stock)).toBe(false)
  })
})

describe("hasOverstock — điều kiện CHẶN LƯU đơn", () => {
  const stock = { p1: 10 }

  it("đúng bằng tồn thì cho lưu", () => {
    expect(hasOverstock([sale("p1", "hộp", 10)], [], PRODUCTS, stock)).toBe(false)
  })

  it("bán 9 + đổi 2 = 11 > tồn 10 → chặn, dù từng dòng đều dưới tồn", () => {
    expect(
      hasOverstock([sale("p1", "hộp", 9)], [ret("p1", "hộp", 2, true)], PRODUCTS, stock)
    ).toBe(true)
  })

  it("bán 9 + TRẢ THƯỜNG 2 → không chặn (trả thường nhập kho, không xuất)", () => {
    expect(
      hasOverstock([sale("p1", "hộp", 9)], [ret("p1", "hộp", 2, false)], PRODUCTS, stock)
    ).toBe(false)
  })

  it("đơn rỗng thì không chặn", () => {
    expect(hasOverstock([], [], PRODUCTS, stock)).toBe(false)
  })

  it("chỉ có dòng đổi, không có dòng bán, vẫn kiểm tồn", () => {
    expect(hasOverstock([], [ret("p1", "hộp", 11, true)], PRODUCTS, stock)).toBe(true)
  })

  it("xét MỌI sản phẩm, không chỉ sản phẩm đầu tiên", () => {
    const lines = [sale("p1", "hộp", 1), sale("p2", "chai", 50)]
    expect(hasOverstock(lines, [], PRODUCTS, { p1: 10, p2: 5 })).toBe(true)
  })

  it("quy đổi đơn vị được áp dụng ở cả mức tổng", () => {
    expect(hasOverstock([sale("p1", "thùng", 1)], [], PRODUCTS, { p1: 12 })).toBe(false)
    expect(hasOverstock([sale("p1", "thùng", 1)], [], PRODUCTS, { p1: 11 })).toBe(true)
  })
})

describe("gộp nhu cầu theo sản phẩm", () => {
  it("saleDemandByProduct cộng dồn và quy đổi", () => {
    const m = saleDemandByProduct([sale("p1", "thùng", 1), sale("p1", "hộp", 3)], PRODUCTS)
    expect(m.p1).toBe(15)
  })

  it("exchangeDemandByProduct bỏ qua dòng trả thường", () => {
    const m = exchangeDemandByProduct(
      [ret("p1", "hộp", 2, true), ret("p1", "hộp", 100, false)],
      PRODUCTS
    )
    expect(m.p1).toBe(2)
  })

  it("không có dòng nào thì trả object rỗng", () => {
    expect(saleDemandByProduct([], PRODUCTS)).toEqual({})
    expect(exchangeDemandByProduct([], PRODUCTS)).toEqual({})
  })
})
