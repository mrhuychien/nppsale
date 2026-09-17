import { describe, it, expect } from "vitest"
import {
  addLine,
  baseQtyOf,
  cartTotals,
  ceilingFor,
  findLine,
  lineKey,
  patchLine,
  priceViolation,
  setQty,
  type CartLine,
} from "../src/lib/sell/cart"
import {
  conversionFor,
  sellableUnits,
  stockInUnit,
  unitPriceFor,
  type PricedProduct,
} from "../src/lib/sell/pricing"

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 1,
  price: 675000,
  listPrice: 675000,
  note: "",
  conversion: 15,
  vatRate: 0,
  ...over,
})

describe("Giỏ hàng — khoá dòng là sản phẩm + ĐƠN VỊ", () => {
  /**
   * ⚠ Cùng một mặt hàng đặt 3 thùng và 5 chai là chuyện thường ngày. Gộp
   * chúng lại là làm hỏng một cách dùng có thật, và cũng không quy ngược
   * được vì hai dòng có thể khác giá.
   */
  it("cùng sản phẩm khác đơn vị là HAI dòng", () => {
    let cart: CartLine[] = []
    cart = addLine(cart, line({ unit: "thùng" }))
    cart = addLine(cart, line({ unit: "chai", conversion: 1, price: 45000, listPrice: 45000 }))
    expect(cart).toHaveLength(2)
    expect(lineKey("p1", "thùng")).not.toBe(lineKey("p1", "chai"))
  })

  it("cùng sản phẩm cùng đơn vị thì CỘNG DỒN", () => {
    let cart = addLine([], line({ qty: 2 }))
    cart = addLine(cart, line({ qty: 3 }))
    expect(cart).toHaveLength(1)
    expect(cart[0].qty).toBe(5)
  })

  /**
   * ⚠ Cộng dồn phải GIỮ NGUYÊN VỊ TRÍ. Đẩy dòng cũ lên đầu thì mỗi lần
   * bấm + danh sách lại nhảy dưới tay người đang bấm.
   */
  it("cộng dồn không làm dòng nhảy chỗ", () => {
    let cart = addLine([], line({ productId: "pA" }))
    cart = addLine(cart, line({ productId: "pB" }))
    // pB ở đầu, pA ở sau. Cộng thêm pA phải giữ pA ở sau.
    expect(cart.map((l) => l.productId)).toEqual(["pB", "pA"])
    cart = addLine(cart, line({ productId: "pA", qty: 4 }))
    expect(cart.map((l) => l.productId)).toEqual(["pB", "pA"])
    expect(cart[1].qty).toBe(5)
  })

  /** Dòng MỚI lên đầu — thứ vừa thêm là thứ sắp phải sửa số lượng. */
  it("dòng mới nằm ở đầu giỏ", () => {
    let cart = addLine([], line({ productId: "pA" }))
    cart = addLine(cart, line({ productId: "pB" }))
    expect(cart[0].productId).toBe("pB")
  })

  it("tìm đúng dòng theo sản phẩm + đơn vị", () => {
    const cart = [line({ productId: "pA", unit: "chai" }), line({ productId: "pA", unit: "thùng" })]
    expect(findLine(cart, "pA", "thùng")).toBe(1)
    expect(findLine(cart, "pA", "lốc")).toBe(-1)
  })
})

describe("Đổi số lượng", () => {
  /** Nút − ở số 1 hiện hình thùng rác — bấm là xoá, không phải về 0. */
  it("số lượng về 0 thì xoá dòng", () => {
    const cart = [line({ productId: "pA" }), line({ productId: "pB" })]
    expect(setQty(cart, 0, 0).map((l) => l.productId)).toEqual(["pB"])
    expect(setQty(cart, 0, -3)).toHaveLength(1)
  })

  it("số lượng dương thì chỉ đổi dòng đó", () => {
    const cart = [line({ qty: 1 }), line({ productId: "pB", qty: 1 })]
    const next = setQty(cart, 1, 7)
    expect(next[1].qty).toBe(7)
    expect(next[0].qty).toBe(1)
  })

  /** ⚠ Chỉ số ngoài phạm vi thì KHÔNG được đụng vào giỏ. */
  it("chỉ số sai thì giỏ không đổi", () => {
    const cart = [line()]
    expect(setQty(cart, 5, 3)).toBe(cart)
    expect(setQty(cart, -1, 3)).toBe(cart)
    expect(patchLine(cart, 9, { note: "x" })).toBe(cart)
  })
})

describe("Vượt tồn tính trên TỔNG mọi dòng cùng sản phẩm", () => {
  /**
   * ⚠ Tồn 10 thùng, đặt 6 thùng ở một dòng và 6 thùng ở dòng khác: từng
   * dòng nhìn riêng đều hợp lệ, tổng 12 mới là vượt.
   */
  it("cộng cả thùng lẫn chai về đơn vị cơ sở", () => {
    const cart = [
      line({ unit: "thùng", qty: 2, conversion: 15 }),
      line({ unit: "chai", qty: 7, conversion: 1 }),
    ]
    expect(baseQtyOf(cart, "p1")).toBe(37)
  })

  it("không tính nhầm sản phẩm khác", () => {
    const cart = [line({ productId: "pA", qty: 2 }), line({ productId: "pB", qty: 9 })]
    expect(baseQtyOf(cart, "pA")).toBe(30)
  })
})

describe("Cộng tiền", () => {
  it("tạm tính theo giá ĐANG áp dụng, không theo giá bảng", () => {
    const t = cartTotals([line({ qty: 2, price: 600000, listPrice: 675000 })])
    expect(t.subtotal).toBe(1200000)
    expect(t.gross).toBe(1350000)
    expect(t.discount).toBe(150000)
  })

  /**
   * ⚠ VAT tính trên giá ĐANG ÁP DỤNG. Tính trên giá bảng là bắt khách trả
   * thuế cho phần đã được giảm.
   */
  it("VAT tính trên tạm tính, không trên giá bảng", () => {
    const t = cartTotals([line({ qty: 1, price: 100000, listPrice: 200000, vatRate: 0.08 })])
    expect(t.vat).toBe(8000)
  })

  it("mỗi dòng dùng thuế suất của chính nó", () => {
    const t = cartTotals([
      line({ qty: 1, price: 100000, listPrice: 100000, vatRate: 0.08 }),
      line({ productId: "pB", qty: 1, price: 100000, listPrice: 100000, vatRate: 0 }),
    ])
    expect(t.vat).toBe(8000)
  })

  /**
   * ⚠ Nhân viên được phép NÂNG giá trong hạn mức. Khi đó `gross < subtotal`
   * và một "chiết khấu âm" hiện trên màn hình thì không ai hiểu là gì.
   */
  it("nâng giá không sinh ra chiết khấu âm", () => {
    const t = cartTotals([line({ qty: 1, price: 700000, listPrice: 675000 })])
    expect(t.discount).toBe(0)
    expect(t.subtotal).toBe(700000)
  })

  it("trừ hàng trả vào tổng phải trả", () => {
    const t = cartTotals([line({ qty: 1, price: 100000, listPrice: 100000 })], 30000)
    expect(t.grandTotal).toBe(70000)
  })

  /** Hàng trả nhiều hơn đơn thì khách không phải trả, chứ không âm tiền. */
  it("tổng phải trả không bao giờ âm", () => {
    const t = cartTotals([line({ qty: 1, price: 10000, listPrice: 10000 })], 999999)
    expect(t.grandTotal).toBe(0)
  })

  it("giỏ rỗng ra toàn số 0", () => {
    const t = cartTotals([])
    expect(t).toMatchObject({ gross: 0, subtotal: 0, vat: 0, grandTotal: 0 })
  })
})

describe("Hạn mức sửa giá", () => {
  const opts = { canEditPrice: true, maxIncreasePct: 5 }

  /** ⚠ SÀN là giá bảng — chốt chặn duy nhất giữa gõ nhầm và cho không hàng. */
  it("thấp hơn giá bảng là vi phạm", () => {
    expect(priceViolation({ price: 674999, listPrice: 675000 }, opts)).toBe("below_list")
  })

  it("đúng giá bảng thì hợp lệ", () => {
    expect(priceViolation({ price: 675000, listPrice: 675000 }, opts)).toBeNull()
  })

  it("nâng trong hạn mức thì hợp lệ, quá thì vi phạm", () => {
    expect(ceilingFor(100000, 5)).toBe(105000)
    expect(priceViolation({ price: 105000, listPrice: 100000 }, opts)).toBeNull()
    expect(priceViolation({ price: 105001, listPrice: 100000 }, opts)).toBe("above_ceiling")
  })

  /**
   * ⚠ Không có quyền sửa giá thì KHÔNG chặn. Giá lệch khi đó là do dữ liệu
   * cũ, và chặn chỉ làm nhân viên không lưu được đơn mà không hiểu vì sao.
   */
  it("không có quyền sửa giá thì không chặn", () => {
    expect(
      priceViolation({ price: 1, listPrice: 675000 }, { canEditPrice: false, maxIncreasePct: 5 })
    ).toBeNull()
  })

  /** Sản phẩm chưa có giá bảng thì không có gì để so. */
  it("chưa có giá bảng thì không chặn", () => {
    expect(priceViolation({ price: 5000, listPrice: 0 }, opts)).toBeNull()
  })

  it("hạn mức 0% nghĩa là đúng giá bảng, không hơn", () => {
    const strict = { canEditPrice: true, maxIncreasePct: 0 }
    expect(priceViolation({ price: 100000, listPrice: 100000 }, strict)).toBeNull()
    expect(priceViolation({ price: 100001, listPrice: 100000 }, strict)).toBe("above_ceiling")
  })
})

describe("Bảng giá và đơn vị", () => {
  const p = {
    id: "p1",
    base_unit: "chai",
    sell_price: 45000,
    units: [
      { unit_name: "thùng", conversion: 15 },
      { unit_name: "chai", conversion: 1 },
    ],
    price_lists: [
      { unit_name: "thùng", group_id: "g1", price: 640000 },
      { unit_name: "thùng", group_id: null, price: 675000 },
    ],
  } as unknown as PricedProduct

  it("giá của nhóm khách đi trước giá chung", () => {
    expect(unitPriceFor(p, "thùng", "g1")).toBe(640000)
    expect(unitPriceFor(p, "thùng", null)).toBe(675000)
    // Nhóm không có bảng riêng → rơi về giá chung, không phải 0.
    expect(unitPriceFor(p, "thùng", "g9")).toBe(675000)
  })

  it("đơn vị cơ sở lấy sell_price khi không có bảng giá", () => {
    expect(unitPriceFor(p, "chai", "g1")).toBe(45000)
  })

  /** Không có bảng giá cho đơn vị quy đổi thì nhân từ giá cơ sở. */
  it("đơn vị quy đổi tính từ giá cơ sở × hệ số", () => {
    const q = { ...p, price_lists: [] } as unknown as PricedProduct
    expect(unitPriceFor(q, "thùng", null)).toBe(45000 * 15)
  })

  /** ⚠ 0 nghĩa là CHƯA CÓ GIÁ — nơi gọi phải nói vậy, đừng in "0đ". */
  it("không tra ra giá nào thì trả 0", () => {
    const q = { id: "x", base_unit: "cái", sell_price: 0, units: [], price_lists: [] } as unknown as PricedProduct
    expect(unitPriceFor(q, "cái", null)).toBe(0)
    expect(unitPriceFor(q, "hộp", null)).toBe(0)
  })

  /**
   * ⚠ Vài sản phẩm khai lại chính đơn vị cơ sở trong `product_units`. Không
   * lọc thì thẻ sản phẩm hiện hai nút giống hệt nhau cạnh nhau.
   */
  it("đơn vị cơ sở đứng đầu và không lặp", () => {
    expect(sellableUnits(p)).toEqual(["chai", "thùng"])
  })

  it("hệ số quy đổi: không tra ra thì là 1, không đoán", () => {
    expect(conversionFor(p, "thùng")).toBe(15)
    expect(conversionFor(p, "chai")).toBe(1)
    expect(conversionFor(p, "pallet")).toBe(1)
  })

  /** Tồn 2,5 thùng thì bán được 2 thùng — làm tròn XUỐNG. */
  it("tồn quy ra đơn vị đang chọn, làm tròn xuống", () => {
    expect(stockInUnit(p, "thùng", 38)).toBe(2)
    expect(stockInUnit(p, "chai", 38)).toBe(38)
    expect(stockInUnit(p, "thùng", 0)).toBe(0)
  })
})
