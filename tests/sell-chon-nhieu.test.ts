import { describe, it, expect } from "vitest"
import { setLinesQty, addLine, type CartLine } from "../src/lib/sell/cart"

const L = (productId: string, unit: string, qty: number, price = 10_000): CartLine => ({
  productId, unit, qty, price, listPrice: price, note: "", conversion: 1, vatRate: 0,
})

/**
 * ⚠ CHẾ ĐỘ CHỌN NHIỀU Ở /sell (chủ nhà yêu cầu 23/09/2026): gõ số lượng cho
 *   nhiều mặt hàng rồi mới sang đơn. Số trong ô là số TUYỆT ĐỐI sẽ nằm trong
 *   giỏ — không cộng dồn như chạm từng món.
 */
describe("setLinesQty — đặt số lượng cho nhiều mặt hàng một lần", () => {
  it("dòng đã có: lấy đúng số mới, KHÔNG cộng dồn", () => {
    const gio = [L("a", "hộp", 2)]
    expect(setLinesQty(gio, [L("a", "hộp", 5)])[0].qty).toBe(5)
    // Đối chứng: addLine thì cộng dồn — đó là luật của chạm từng món.
    expect(addLine(gio, L("a", "hộp", 5))[0].qty).toBe(7)
  })

  it("0 là bỏ dòng đang có; 0 cho món chưa có thì không thêm gì", () => {
    const gio = [L("a", "hộp", 2), L("b", "hộp", 1)]
    expect(setLinesQty(gio, [L("a", "hộp", 0), L("c", "hộp", 0)])).toEqual([L("b", "hộp", 1)])
  })

  it("dòng mới lên đầu theo thứ tự chọn; dòng cũ giữ vị trí", () => {
    const gio = [L("x", "hộp", 1), L("y", "hộp", 1)]
    const sau = setLinesQty(gio, [L("m", "hộp", 3), L("y", "hộp", 4), L("n", "thùng", 1)])
    expect(sau.map((l) => `${l.productId}:${l.qty}`)).toEqual(["m:3", "n:1", "x:1", "y:4"])
  })

  /**
   * ⚠ LỖI MÀ PHÉP NÀY SINH RA ĐỂ TRÁNH: vòng `addLine` rồi `setQty(index)`.
   *   `addLine` đẩy dòng mới lên đầu, chỉ số tính trước lệch đi, và
   *   `setQty` sửa nhầm dòng. Ở đây mọi thứ theo khoá (sản phẩm + đơn vị).
   */
  it("thêm mới và sửa dòng cũ cùng lúc không sửa nhầm dòng", () => {
    const gio = [L("a", "hộp", 1), L("b", "hộp", 1)]
    const sau = setLinesQty(gio, [L("moi", "hộp", 9), L("b", "hộp", 6)])
    expect(sau.find((l) => l.productId === "a")!.qty).toBe(1)
    expect(sau.find((l) => l.productId === "b")!.qty).toBe(6)
    expect(sau.find((l) => l.productId === "moi")!.qty).toBe(9)
  })

  it("cùng mặt hàng khác đơn vị là hai dòng", () => {
    const sau = setLinesQty([], [L("a", "hộp", 3), L("a", "thùng", 2)])
    expect(sau.map((l) => `${l.unit}:${l.qty}`)).toEqual(["hộp:3", "thùng:2"])
  })

  it("dòng đã sửa giá tay giữ giá của nó", () => {
    const gio = [{ ...L("a", "hộp", 2), price: 9_000 }]
    expect(setLinesQty(gio, [L("a", "hộp", 4, 10_000)])[0]).toMatchObject({ qty: 4, price: 9_000 })
  })

  it("hai lựa chọn trùng khoá: lựa chọn sau thắng", () => {
    expect(setLinesQty([], [L("a", "hộp", 3), L("a", "hộp", 7)])).toEqual([L("a", "hộp", 7)])
  })

  it("không đụng tới mảng giỏ cũ", () => {
    const gio = [L("a", "hộp", 2)]
    setLinesQty(gio, [L("a", "hộp", 0)])
    expect(gio).toEqual([L("a", "hộp", 2)])
  })
})
