import { describe, it, expect } from "vitest"
import { formatCurrency } from "@/lib/utils"
import { numberToVietnameseWords } from "@/lib/utils/number-to-vn-words"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { userPriceRulesFrom } from "@/lib/pricing"
import { ceilingFor, priceViolation } from "@/lib/sell/cart"
import { returnCeilingFor, returnPriceViolation } from "@/lib/sell/returns"

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

describe("Luật giá bán và luật giá trả dùng CHUNG một biên độ", () => {
  const nvSua5 = userPriceRulesFrom({
    role: "sales",
    allow_price_edit: true,
    price_edit_max_increase_pct: 5,
  })

  /**
   * ⚠ NGƯỜI DÙNG BÁO. "Nếu người dùng được cho sửa giá bán biên độ 5% thì
   * giá trả về cũng được sửa biên độ 5%." Trước đây dòng trả bị chặn cứng
   * ở đúng giá bảng, nên cùng một nhân viên được nâng giá bán lên 105.000
   * mà trả lại chính món đó ở 105.000 thì không lưu được.
   */
  it("trần giá trả bằng đúng trần giá bán", () => {
    const list = 100_000
    expect(returnCeilingFor(list, { maxIncreasePct: 5 })).toBe(
      ceilingFor(list, nvSua5.price_edit_max_increase_pct)
    )
    expect(returnCeilingFor(list, { maxIncreasePct: 5 })).toBe(105_000)
  })

  it("bán 105.000 được thì trả 105.000 cũng được", () => {
    const list = 100_000
    expect(
      priceViolation({ price: 105_000, listPrice: list }, {
        canEditPrice: true,
        maxIncreasePct: 5,
      })
    ).toBeNull()
    expect(
      returnPriceViolation({ price: 105_000 }, list, { maxIncreasePct: 5 })
    ).toBeNull()
  })

  /** Hai đầu vẫn chặn ở cùng một mốc — hơn một đồng là hỏng cả hai. */
  it("vượt một đồng thì cả hai đều chặn", () => {
    const list = 100_000
    expect(
      priceViolation({ price: 105_001, listPrice: list }, {
        canEditPrice: true,
        maxIncreasePct: 5,
      })
    ).toBe("above_ceiling")
    expect(
      returnPriceViolation({ price: 105_001 }, list, { maxIncreasePct: 5 })
    ).toBe("above_ceiling")
  })

  /**
   * ⚠ ĐÂY LÀ CHỖ HAI LUẬT KHÁC NHAU, và nó có chủ đích: dòng bán có SÀN
   * (bán rẻ là mất tiền), dòng trả KHÔNG có sàn (bù ít cho hàng hư là
   * chiều an toàn — công ty chi ít đi).
   */
  it("bán dưới giá bảng bị chặn, trả dưới giá bảng thì không", () => {
    expect(
      priceViolation({ price: 80_000, listPrice: 100_000 }, {
        canEditPrice: true,
        maxIncreasePct: 5,
      })
    ).toBe("below_list")
    expect(
      returnPriceViolation({ price: 80_000 }, 100_000, { maxIncreasePct: 5 })
    ).toBeNull()
  })
})

describe("Phép kiểm giá chỉ có MỘT bản", () => {
  /**
   * ⚠ `src/lib/pricing.ts` từng giữ thêm ba hàm kiểm giá không màn nào
   * gọi: `validateUserSalesPrice`, `userSalesCeiling` và
   * `validateUserReturnPrice`. Chúng vẫn có chốt kiểm thử xanh nên đọc
   * code là tưởng luật giá nằm ở đó — trong khi `validateUserReturnPrice`
   * ghi "đơn trả: giá ≤ giá đã bán", KHÔNG có biên độ, tức là ngược hẳn
   * với luật đang chạy. Chốt này giữ cho chúng đừng quay lại.
   */
  it("pricing.ts không còn hàm kiểm giá chết nào", () => {
    const src = readFileSync(
      resolve(__dirname, "..", "src/lib/pricing.ts"),
      "utf-8"
    )
    for (const name of [
      "validateUserSalesPrice",
      "userSalesCeiling",
      "validateUserReturnPrice",
    ]) {
      expect(src, `${name} đã sống lại`).not.toContain(`export function ${name}`)
    }
  })
})
