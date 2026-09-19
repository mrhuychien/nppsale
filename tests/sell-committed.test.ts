import { describe, it, expect } from "vitest"
import {
  availableMapFrom,
  committedOf,
  committedMapFrom,
  stockDisplayFor,
} from "@/lib/sell/committed"

/**
 * Chốt cho "hàng đã đặt nhưng chưa rời kho".
 *
 * Mọi con số ở đây quyết định có cho nhân viên ghi thêm một dòng hàng
 * hay không. Sai theo chiều lỏng là ba người cùng bán một lô hàng; sai
 * theo chiều chặt là nhân viên đứng ở quầy không lưu được đơn hợp lệ.
 */

describe("availableMapFrom", () => {
  it("trừ đúng phần đã đặt", () => {
    expect(availableMapFrom({ a: 100, b: 50 }, { a: 30 })).toEqual({ a: 70, b: 50 })
  })

  it("KHÔNG kẹp về 0 — đã hứa quá tay phải thấy được là quá bao nhiêu", () => {
    expect(availableMapFrom({ a: 10 }, { a: 25 }).a).toBe(-15)
  })

  it("đã đặt một mặt hàng không có trong bảng tồn thì tồn tính là 0", () => {
    expect(availableMapFrom({}, { x: 7 }).x).toBe(-7)
  })

  it("chưa đọc được (null) thì trả NGUYÊN bảng tồn, không tự bịa 0 đã đặt", () => {
    const stock = { a: 100 }
    expect(availableMapFrom(stock, null)).toBe(stock)
  })

  it("không sửa bảng tồn gốc", () => {
    const stock = { a: 100 }
    availableMapFrom(stock, { a: 30 })
    expect(stock.a).toBe(100)
  })
})

describe("committedOf", () => {
  it("chưa đọc được trả null, KHÁC với đã đọc và bằng 0", () => {
    expect(committedOf(null, "a")).toBeNull()
    expect(committedOf({}, "a")).toBe(0)
  })
})

describe("committedMapFrom", () => {
  it("cộng dồn và ép kiểu số — PostgREST trả numeric dưới dạng chuỗi", () => {
    expect(
      committedMapFrom([
        { product_id: "a", committed_base: "12.5" },
        { product_id: "a", committed_base: 7.5 },
        { product_id: "b", committed_base: "3" },
      ])
    ).toEqual({ a: 20, b: 3 })
  })

  it("bỏ dòng không có mã hàng thay vì tạo khoá rỗng", () => {
    expect(committedMapFrom([{ product_id: "", committed_base: 5 }])).toEqual({})
  })
})

describe("stockDisplayFor", () => {
  it("chưa đọc được số đã đặt: khả dụng = tồn, và committed vẫn là null", () => {
    const d = stockDisplayFor(100, null)
    expect(d.committed).toBeNull()
    expect(d.available).toBe(100)
    expect(d.out).toBe(false)
    expect(d.reservedOut).toBe(false)
  })

  it("có hàng đã đặt thì khả dụng là hiệu", () => {
    const d = stockDisplayFor(2838, 120)
    expect(d.available).toBe(2718)
    expect(d.out).toBe(false)
  })

  it("kho còn hàng nhưng đã hứa hết là câu KHÁC với hết hàng", () => {
    const reserved = stockDisplayFor(100, 100)
    expect(reserved.out).toBe(true)
    expect(reserved.reservedOut).toBe(true)

    const empty = stockDisplayFor(0, 0)
    expect(empty.out).toBe(true)
    expect(empty.reservedOut).toBe(false)
  })

  it("hứa quá tay: khả dụng âm và vẫn là 'đã hứa hết', không phải 'hết hàng'", () => {
    const d = stockDisplayFor(10, 25)
    expect(d.available).toBe(-15)
    expect(d.reservedOut).toBe(true)
  })

  it("chưa đọc được mà tồn 0 thì vẫn là hết hàng thật", () => {
    const d = stockDisplayFor(0, null)
    expect(d.out).toBe(true)
    expect(d.reservedOut).toBe(false)
  })
})
