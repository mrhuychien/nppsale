import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { daysOverdueOf, getAgingStatus, agingLabel, AGING_RANGE } from "../src/lib/utils"
import {
  receivableStateLabel, receivableStateVariant,
} from "../src/lib/receivables/credit"

/**
 * TUỔI NỢ HIỂN THỊ SAI (chủ nhà báo).
 *
 * Ảnh chụp: 17 khoản hạn 17/09, hôm nay 19/09 — quá hạn 2 ngày — nhưng
 * nằm dưới tấm thẻ ghi "Cảnh báo 31-60 NGÀY". Và cột Trạng thái in ra
 * `open` / `overdue`: hai dòng CÙNG một hạn mà hai chữ khác nhau, cả hai
 * đều là tiếng Anh.
 */

/** Ngày đến hạn sao cho hôm nay (giờ VN) quá hạn đúng `n` ngày. */
function dueBy(n: number): string {
  const todayVN = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
  const [y, m, d] = todayVN.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10)
}

describe("đếm ngày quá hạn", () => {
  it("đến hạn hôm nay thì CHƯA quá hạn", () => {
    expect(daysOverdueOf(dueBy(0))).toBe(0)
  })

  /** ⚠ Chưa tới hạn không phải "quá hạn âm ngày" — kẹp về 0. */
  it("chưa tới hạn thì trả 0, không trả số âm", () => {
    expect(daysOverdueOf(dueBy(-5))).toBe(0)
  })

  it("đếm đúng số ngày", () => {
    expect(daysOverdueOf(dueBy(2))).toBe(2)
    expect(daysOverdueOf(dueBy(45))).toBe(45)
  })

  it("không có hạn thì trả 0", () => {
    expect(daysOverdueOf(null)).toBe(0)
    expect(daysOverdueOf(undefined)).toBe(0)
  })
})

describe("nhãn khoảng ngày của từng nhóm", () => {
  /**
   * ⚠ ĐÂY LÀ LỖI CHỦ NHÀ CHỈ RA. Nhãn cũ ghi 0-30 / 31-60 / 61-90 / >90,
   * lệch hẳn một bậc so với ngưỡng thật, nên khoản quá hạn 2 ngày hiện
   * dưới nhãn "31-60 NGÀY".
   */
  it("khớp đúng ngưỡng của getAgingStatus", () => {
    expect(getAgingStatus(dueBy(0))).toBe("current")
    expect(AGING_RANGE.current).toBe("chưa tới hạn")

    expect(getAgingStatus(dueBy(2))).toBe("warning")
    expect(getAgingStatus(dueBy(30))).toBe("warning")
    expect(AGING_RANGE.warning).toBe("quá hạn 1-30 ngày")

    expect(getAgingStatus(dueBy(31))).toBe("overdue")
    expect(getAgingStatus(dueBy(60))).toBe("overdue")
    expect(AGING_RANGE.overdue).toBe("quá hạn 31-60 ngày")

    expect(getAgingStatus(dueBy(61))).toBe("critical")
    expect(AGING_RANGE.critical).toBe("quá hạn trên 60 ngày")
  })

  /** ⚠ Không nhãn nào được nhắc tới mốc 90 ngày — nhóm ấy không tồn tại. */
  it("không còn nhãn nào nói 90 ngày", () => {
    expect(Object.values(AGING_RANGE).join(" ")).not.toContain("90")
  })
})

describe("nhãn tuổi nợ trên huy hiệu", () => {
  it("nói bằng tiếng Việt và nêu số ngày", () => {
    expect(agingLabel(0)).toBe("Trong hạn")
    expect(agingLabel(2)).toBe("Quá hạn 2 ngày")
  })

  /**
   * ⚠ ĐÃ THU ĐỦ THÌ TUỔI NỢ VÔ NGHĨA. Một dòng trả xong từ lâu mà vẫn ghi
   * "Quá hạn 90 ngày" là đẩy nhân viên đi đòi một khoản không còn.
   */
  it("thu đủ rồi thì không nói quá hạn nữa", () => {
    const r = { amount: 1000, paid: 1000, due_date: dueBy(90) }
    expect(receivableStateLabel(r)).toBe("Đã thu đủ")
    expect(receivableStateVariant(r)).toBe("success")
  })

  /** ⚠ Dư có KHÔNG phải nợ — gắn nhãn quá hạn lên nó là báo động nhầm chiều. */
  it("trả dư thì là Dư có, không phải quá hạn", () => {
    const r = { amount: 1000, paid: 1500, due_date: dueBy(90) }
    expect(receivableStateLabel(r)).toBe("Dư có")
    expect(receivableStateVariant(r)).toBe("success")
  })

  it("còn nợ thì nói đúng số ngày quá hạn", () => {
    expect(receivableStateLabel({ amount: 1000, paid: 0, due_date: dueBy(2) }))
      .toBe("Quá hạn 2 ngày")
    expect(receivableStateLabel({ amount: 1000, paid: 0, due_date: dueBy(-3) }))
      .toBe("Trong hạn")
  })

  it("màu đi theo tuổi nợ", () => {
    expect(receivableStateVariant({ amount: 1000, paid: 0, due_date: dueBy(0) })).toBe("default")
    expect(receivableStateVariant({ amount: 1000, paid: 0, due_date: dueBy(5) })).toBe("warning")
    expect(receivableStateVariant({ amount: 1000, paid: 0, due_date: dueBy(45) })).toBe("danger")
  })
})

describe("màn Công nợ dùng đúng những thứ trên", () => {
  const PAGE = readFileSync("src/app/(dashboard)/receivables/page.tsx", "utf8")
  const PAYABLES = readFileSync("src/app/(dashboard)/payables/page.tsx", "utf8")
  const UTILS = readFileSync("src/lib/utils.ts", "utf8")

  /**
   * ⚠ HUY HIỆU TỪNG MANG HAI NGUỒN: màu theo tuổi nợ, chữ từ cột
   * `receivables.status` — một trạng thái THANH TOÁN do RPC ghi và không
   * ai tính lại mỗi ngày.
   */
  it("huy hiệu không còn in cột status", () => {
    expect(PAGE).not.toContain("<Badge variant={agingVariant(aging)}>{r.status}</Badge>")
    expect(PAGE).toContain("<Badge variant={rowStateVariant(r)}>{rowStateLabel(r)}</Badge>")
  })

  /** ⚠ Phụ đề lấy từ hằng số, đừng gõ tay — gõ tay chính là chỗ đã sai. */
  it("phụ đề thẻ lấy từ AGING_RANGE", () => {
    expect(PAGE).toContain("sub: AGING_RANGE.current")
    expect(PAGE).toContain("sub: AGING_RANGE.critical")
    expect(PAGE).not.toContain('sub: "0-30 ngày"')
    expect(PAGE).not.toContain('sub: "61-90 ngày"')
  })

  /**
   * ⚠ BA BẢN CHÉP CỦA PHÉP TRỪ NGÀY, KHÔNG BẢN NÀO GIỐNG NHAU: một
   * `Math.round` theo giờ máy, một `Math.ceil` theo giờ máy, một theo giờ
   * Việt Nam. Cùng một phiếu cho ra ba con số tuỳ màn đang mở.
   */
  it("chỉ còn một phép trừ ngày trong cả kho", () => {
    expect(PAGE).not.toContain("const daysOverdue = (due: string)")
    expect(PAYABLES).not.toContain("const getDaysOverdue")
    expect(PAYABLES).not.toContain("const agingLabel = (days: number)")
    expect(PAYABLES).toContain("daysOverdueOf(p.due_date)")
    // Và `getAgingStatus` phải xây trên chính nó.
    const fn = UTILS.slice(
      UTILS.indexOf("export function getAgingStatus"),
      UTILS.indexOf("export const AGING_RANGE")
    )
    expect(fn).toContain("daysOverdueOf(dueDate)")
  })
})
