import { describe, it, expect } from "vitest"
import {
  getConversionFactor,
  toBaseQty,
  formatQtyWithBase,
} from "@/lib/inventory/uom"
import type { Product, ProductUnit } from "@/types"

/**
 * Quy đổi đơn vị là chỗ sai một lần là lệch tồn kho thật.
 * Bộ test này KHOÁ hành vi hiện tại làm lưới an toàn khi bàn giao.
 */

const sp = { base_unit: "hộp" } as Pick<Product, "base_unit">
const donVi = (unit_name: string, conversion: number) =>
  ({ unit_name, conversion } as ProductUnit)

describe("getConversionFactor — hệ số quy đổi", () => {
  it("trả 1 khi đơn vị giao dịch trùng đơn vị cơ sở", () => {
    expect(getConversionFactor(sp, [donVi("thùng", 10)], "hộp")).toBe(1)
  })

  it("trả đúng hệ số khi bán theo thùng", () => {
    expect(getConversionFactor(sp, [donVi("thùng", 10)], "thùng")).toBe(10)
  })

  it("trả 1 khi không có sản phẩm (không được nhân bừa)", () => {
    expect(getConversionFactor(null, [donVi("thùng", 10)], "thùng")).toBe(1)
    expect(getConversionFactor(undefined, [donVi("thùng", 10)], "thùng")).toBe(1)
  })

  it("trả 1 khi tên đơn vị rỗng", () => {
    expect(getConversionFactor(sp, [donVi("thùng", 10)], "")).toBe(1)
  })

  it("trả 1 khi đơn vị không có trong bảng quy đổi", () => {
    expect(getConversionFactor(sp, [donVi("thùng", 10)], "lốc")).toBe(1)
    expect(getConversionFactor(sp, null, "thùng")).toBe(1)
    expect(getConversionFactor(sp, [], "thùng")).toBe(1)
  })

  it("chặn hệ số 0 và số âm — luôn tối thiểu là 1", () => {
    // Quan trọng: hệ số 0 sẽ làm mọi phép trừ kho ra 0 (mất hàng không
    // ai biết); hệ số âm sẽ CỘNG kho khi bán.
    expect(getConversionFactor(sp, [donVi("thùng", 0)], "thùng")).toBe(1)
    expect(getConversionFactor(sp, [donVi("thùng", -5)], "thùng")).toBe(1)
  })

  it("hệ số nhỏ hơn 1 bị nâng lên 1 (không hỗ trợ đơn vị nhỏ hơn đơn vị cơ sở)", () => {
    // Ghi nhận hành vi hiện tại: Math.max(1, ...) khiến đơn vị nhỏ hơn
    // đơn vị cơ sở (vd 0.5) KHÔNG biểu diễn được.
    expect(getConversionFactor(sp, [donVi("nửa hộp", 0.5)], "nửa hộp")).toBe(1)
  })
})

describe("toBaseQty — quy về đơn vị cơ sở", () => {
  it("nhân số lượng với hệ số", () => {
    expect(toBaseQty(4, 10)).toBe(40)
  })

  it("coi số lượng rỗng/NaN là 0", () => {
    expect(toBaseQty(0, 10)).toBe(0)
    expect(toBaseQty(NaN, 10)).toBe(0)
  })

  it("hệ số 0 hoặc âm bị ép về 1 thay vì làm mất số lượng", () => {
    expect(toBaseQty(4, 0)).toBe(4)
    expect(toBaseQty(4, -3)).toBe(4)
  })

  it("giữ nguyên số lẻ", () => {
    expect(toBaseQty(2.5, 2)).toBe(5)
  })
})

describe("formatQtyWithBase — hiển thị trên phiếu", () => {
  it("hiện cả hai đơn vị khi bán theo thùng", () => {
    expect(formatQtyWithBase(4, "thùng", 40, "hộp")).toBe("4 thùng (40 hộp)")
  })

  it("chỉ hiện một đơn vị khi giao dịch bằng đơn vị cơ sở", () => {
    expect(formatQtyWithBase(40, "hộp", 40, "hộp")).toBe("40 hộp")
  })

  it("chỉ hiện một đơn vị khi số quy đổi bằng số giao dịch", () => {
    expect(formatQtyWithBase(5, "thùng", 5, "hộp")).toBe("5 hộp")
  })

  it("không để lại khoảng trắng thừa khi thiếu tên đơn vị", () => {
    expect(formatQtyWithBase(3, "", 3, "hộp")).toBe("3 hộp")
  })
})
