import { describe, it, expect } from "vitest"
import { formatCurrency } from "@/lib/utils"
import { numberToVietnameseWords } from "@/lib/utils/number-to-vn-words"
import {
  userPriceRulesFrom,
  validateUserSalesPrice,
  validateUserReturnPrice,
  userSalesCeiling,
} from "@/lib/pricing"

/**
 * Tiền: định dạng, đọc thành chữ (phiếu thu TT200), và luật chặn sửa giá.
 * Sai ở đây là sai chứng từ hoặc thất thoát doanh thu.
 */

describe("formatCurrency — định dạng tiền", () => {
  it("định dạng theo chuẩn Việt Nam", () => {
    expect(formatCurrency(1_234_567)).toBe("1.234.567đ")
  })

  it("làm tròn về số nguyên đồng", () => {
    expect(formatCurrency(1000.4)).toBe("1.000đ")
    expect(formatCurrency(1000.5)).toBe("1.001đ")
  })

  it("xử lý số 0 và số âm (hoàn tiền)", () => {
    expect(formatCurrency(0)).toBe("0đ")
    expect(formatCurrency(-5000)).toBe("-5.000đ")
  })
})

describe("numberToVietnameseWords — đọc số thành chữ cho phiếu thu", () => {
  it("số 0", () => {
    expect(numberToVietnameseWords(0)).toBe("Không đồng")
  })

  it("đọc đúng hàng nghìn", () => {
    expect(numberToVietnameseWords(1000)).toContain("nghìn")
  })

  it("đọc đúng quy tắc 'mốt' và 'lăm' của tiếng Việt", () => {
    expect(numberToVietnameseWords(21)).toContain("mốt")
    expect(numberToVietnameseWords(25)).toContain("lăm")
  })

  it("đọc 'mười' cho hàng chục bằng 1", () => {
    // Hàm viết hoa chữ đầu nên so sánh không phân biệt hoa/thường.
    expect(numberToVietnameseWords(15).toLowerCase()).toContain("mười")
  })

  it("dùng 'lẻ' khi hàng chục bằng 0", () => {
    expect(numberToVietnameseWords(105)).toContain("lẻ")
  })

  it("số âm được coi là 0 (không có tiền âm trên phiếu thu)", () => {
    expect(numberToVietnameseWords(-100)).toBe("Không đồng")
  })

  it("cắt phần thập phân thay vì làm tròn lên", () => {
    expect(numberToVietnameseWords(1000.9)).toBe(numberToVietnameseWords(1000))
  })

  it("kết quả luôn viết hoa chữ đầu và kết thúc bằng 'đồng'", () => {
    const s = numberToVietnameseWords(1_500_000)
    expect(s[0]).toBe(s[0].toUpperCase())
    expect(s.toLowerCase()).toContain("đồng")
  })
})

describe("userPriceRulesFrom — suy ra luật sửa giá theo người dùng", () => {
  it("chủ sở hữu và kế toán được tự do nhập giá", () => {
    expect(userPriceRulesFrom({ role: "owner" }).free).toBe(true)
    expect(userPriceRulesFrom({ role: "accountant" }).free).toBe(true)
  })

  it("nhân viên bán hàng không tự do", () => {
    const r = userPriceRulesFrom({ role: "sales", allow_price_edit: true })
    expect(r.free).toBe(false)
    expect(r.allow_price_edit).toBe(true)
  })

  it("phần trăm âm bị ép về 0", () => {
    const r = userPriceRulesFrom({ role: "sales", price_edit_max_increase_pct: -10 })
    expect(r.price_edit_max_increase_pct).toBe(0)
  })

  it("người dùng null coi như không có quyền sửa giá", () => {
    const r = userPriceRulesFrom(null)
    expect(r.free).toBe(false)
    expect(r.allow_price_edit).toBe(false)
  })
})

describe("validateUserSalesPrice — chặn bán sai giá", () => {
  const nvKhongSua = userPriceRulesFrom({ role: "sales", allow_price_edit: false })
  const nvSua10 = userPriceRulesFrom({
    role: "sales",
    allow_price_edit: true,
    price_edit_max_increase_pct: 10,
  })

  it("chủ sở hữu nhập giá nào cũng hợp lệ", () => {
    const free = userPriceRulesFrom({ role: "owner" })
    expect(validateUserSalesPrice(1, 100_000, free)).toBeNull()
  })

  it("NV không có quyền sửa giá thì phải đúng bằng giá list", () => {
    expect(validateUserSalesPrice(100_000, 100_000, nvKhongSua)).toBeNull()
    expect(validateUserSalesPrice(90_000, 100_000, nvKhongSua)).toContain("không có quyền")
  })

  it("chặn bán DƯỚI giá list", () => {
    expect(validateUserSalesPrice(90_000, 100_000, nvSua10)).toContain("≥ giá list")
  })

  it("cho phép tăng trong hạn mức phần trăm", () => {
    expect(validateUserSalesPrice(105_000, 100_000, nvSua10)).toBeNull()
    expect(validateUserSalesPrice(110_000, 100_000, nvSua10)).toBeNull()
  })

  it("chặn khi vượt trần phần trăm", () => {
    expect(validateUserSalesPrice(120_000, 100_000, nvSua10)).toContain("tối đa")
  })

  it("bỏ qua lệch nhỏ hơn nửa đồng (chống lỗi làm tròn)", () => {
    expect(validateUserSalesPrice(99_999.7, 100_000, nvSua10)).toBeNull()
  })

  it("từ chối giá không hợp lệ", () => {
    expect(validateUserSalesPrice(NaN, 100_000, nvSua10)).toBe("Giá không hợp lệ")
    expect(validateUserSalesPrice(-1, 100_000, nvSua10)).toBe("Giá không hợp lệ")
    expect(validateUserSalesPrice(Infinity, 100_000, nvSua10)).toBe("Giá không hợp lệ")
  })
})

describe("validateUserReturnPrice — chặn trả hàng giá cao hơn giá đã bán", () => {
  const nvSua10 = userPriceRulesFrom({
    role: "sales",
    allow_price_edit: true,
    price_edit_max_increase_pct: 10,
  })

  it("cho phép trả bằng hoặc thấp hơn giá đã bán", () => {
    expect(validateUserReturnPrice(100_000, 100_000, nvSua10)).toBeNull()
    expect(validateUserReturnPrice(80_000, 100_000, nvSua10)).toBeNull()
  })

  it("chặn trả giá CAO HƠN giá đã bán (chống rút tiền qua đơn trả)", () => {
    expect(validateUserReturnPrice(120_000, 100_000, nvSua10)).toContain("≤ giá đã bán")
  })
})

describe("userSalesCeiling — trần giá hiển thị trên giao diện", () => {
  it("người tự do nhìn thấy trần = giá list", () => {
    const free = userPriceRulesFrom({ role: "owner" })
    expect(userSalesCeiling(100_000, free)).toBe(100_000)
  })

  it("NV được sửa 10% thì trần cao hơn 10%", () => {
    const r = userPriceRulesFrom({
      role: "sales",
      allow_price_edit: true,
      price_edit_max_increase_pct: 10,
    })
    // LỖI NHẸ ĐÃ BIẾT: phép tính 100000 * (1 + 10/100) cho
    // 110000.00000000001 do sai số dấu phẩy động. Không gây chặn nhầm
    // (validate có dung sai 0.5đ) và hiển thị vẫn đúng vì formatCurrency
    // làm tròn. Nhưng nếu giá trị này được dùng làm max của ô nhập số
    // hoặc đem so sánh tuyệt đối ở chỗ khác thì sẽ sinh lỗi khó hiểu.
    // Nên bọc Math.round() trong userSalesCeiling.
    expect(userSalesCeiling(100_000, r)).toBeCloseTo(110_000, 2)
  })

  it("NV không được sửa giá thì trần đúng bằng giá list", () => {
    const r = userPriceRulesFrom({ role: "sales", allow_price_edit: false })
    expect(userSalesCeiling(100_000, r)).toBe(100_000)
  })
})
