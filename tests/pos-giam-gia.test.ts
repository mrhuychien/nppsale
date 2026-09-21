import { describe, it, expect } from "vitest"
import {
  discountAmount,
  switchUnit,
  lineGross,
  unitAriaLabel,
  unitLabel,
} from "../src/lib/pos/discount"
import { posTotals, lineAmount, cashSuggestions } from "../src/lib/pos/totals"

/**
 * GIẢM GIÁ ₫/% VÀ PHÉP CỘNG TIỀN CỦA MÀN POS.
 *
 * ⚠ SPEC CHỐT 21/09/2026 §5 + §6. Mọi con số dưới đây lấy THẲNG từ
 * spec và từ bản thiết kế, không phải số tôi tự nghĩ ra — để chốt đo
 * đúng cái chủ nhà đã duyệt bằng mắt.
 */

const vnd = (value: number) => ({ value, unit: "vnd" as const })
const pct = (value: number) => ({ value, unit: "pct" as const })

describe("giảm giá theo dòng", () => {
  /** ⚠ Spec §5 nguyên văn: "Đang `5%` trên 670.000 = 33.500". */
  it("phần trăm tính trên tiền hàng của dòng", () => {
    expect(lineGross(5, 134_000)).toBe(670_000)
    expect(discountAmount(pct(5), 670_000)).toBe(33_500)
  })

  /**
   * ⚠ LUẬT 1 — ĐỔI ĐƠN VỊ THÌ TIỀN KHÔNG ĐỔI. Spec §5: "bấm `₫` thì
   * input thành `33.500`, tiền không đổi". Đây là chỗ dễ viết sai
   * thành "đổi đơn vị rồi diễn lại con số cũ theo nghĩa mới" — `5%`
   * thành `5₫`, và khoản giảm bốc hơi mà không ai thấy.
   */
  it("đổi % sang ₫ giữ nguyên số tiền đã giảm", () => {
    const g = 670_000
    const d = switchUnit(pct(5), g)
    expect(d.unit).toBe("vnd")
    expect(d.value).toBe(33_500)
    expect(discountAmount(d, g)).toBe(discountAmount(pct(5), g))
  })

  it("đổi ₫ sang % giữ nguyên số tiền đã giảm", () => {
    const g = 670_000
    const d = switchUnit(vnd(33_500), g)
    expect(d.unit).toBe("pct")
    expect(discountAmount(d, g)).toBe(33_500)
  })

  /**
   * ⚠ KHÔNG LÀM TRÒN PHẦN TRĂM VỀ SỐ NGUYÊN. 33.501 trên 670.000 không
   * phải 5%; làm tròn về `5` là lặng lẽ đổi số tiền người dùng vừa gõ.
   */
  it("quy sang % không làm tròn mất tiền", () => {
    const g = 670_000
    expect(discountAmount(switchUnit(vnd(33_501), g), g)).toBe(33_501)
    expect(discountAmount(switchUnit(vnd(1), g), g)).toBe(1)
  })

  /** ⚠ Tiền hàng 0 thì không quy được sang % — chia cho 0 ra `Infinity`. */
  it("tiền hàng bằng 0 thì đổi đơn vị vẫn ra số dùng được", () => {
    const d = switchUnit(vnd(5_000), 0)
    expect(Number.isFinite(d.value)).toBe(true)
    expect(d.value).toBe(0)
  })

  /**
   * ⚠ LUẬT 2 — ĐANG `%` MÀ ĐỔI SỐ LƯỢNG THÌ TIỀN GIẢM CHẠY THEO.
   * Spec §12: "Đang `%`, đổi SL 5 → 10 → tiền giảm tự nhân đôi".
   */
  it("đang % mà tăng gấp đôi số lượng thì tiền giảm gấp đôi", () => {
    const truoc = discountAmount(pct(5), lineGross(5, 134_000))
    const sau = discountAmount(pct(5), lineGross(10, 134_000))
    expect(sau).toBe(truoc * 2)
  })

  /**
   * ⚠ LUẬT 3 — ĐANG `₫` MÀ ĐỔI SỐ LƯỢNG THÌ TIỀN GIẢM ĐỨNG YÊN.
   * Spec §12: "Đang `₫`, đổi SL → tiền giảm giữ nguyên". Người dùng gõ
   * "bớt 20.000" là bớt đúng 20.000, không phải 20.000 mỗi món.
   */
  it("đang ₫ mà đổi số lượng thì tiền giảm đứng yên", () => {
    expect(discountAmount(vnd(20_000), lineGross(5, 134_000))).toBe(20_000)
    expect(discountAmount(vnd(20_000), lineGross(10, 134_000))).toBe(20_000)
  })

  /**
   * ⚠ KHÔNG GIẢM QUÁ TIỀN HÀNG. Dòng âm trên chứng từ là thứ không ai
   * đối chiếu được, và nó đi thẳng vào công nợ.
   */
  it("giảm quá tiền hàng thì kẹp lại, không ra dòng âm", () => {
    expect(discountAmount(vnd(999_999), 670_000)).toBe(670_000)
    expect(discountAmount(pct(300), 670_000)).toBe(670_000)
    expect(lineAmount({ qty: 5, price: 134_000, discount: vnd(999_999) })).toBe(0)
  })

  /** ⚠ Giảm âm là "cộng thêm tiền" núp dưới ô giảm giá. */
  it("giảm âm thì coi như không giảm", () => {
    expect(discountAmount(vnd(-50_000), 670_000)).toBe(0)
    expect(discountAmount(pct(-5), 670_000)).toBe(0)
  })

  /** ⚠ Nút một ký tự phải tự nói ra trạng thái VÀ việc nó sẽ làm. */
  it("nút đơn vị nói cả trạng thái lẫn hành động", () => {
    expect(unitLabel("pct")).toBe("%")
    expect(unitLabel("vnd")).toBe("₫")
    const a = unitAriaLabel("pct", 3)
    expect(a).toContain("dòng 3")
    expect(a).toContain("đang là phần trăm")
    expect(a).toContain("đổi sang đồng")
    expect(unitAriaLabel("vnd", 1)).toContain("đang là đồng")
  })
})

describe("cộng tiền cấp chứng từ", () => {
  /** Đúng bốn dòng của bản thiết kế màn 1. */
  const lines = [
    { qty: 5, price: 1_368_000, discount: vnd(0) },
    { qty: 20, price: 8_000, discount: vnd(0) },
    { qty: 5, price: 134_000, discount: pct(5) },
    { qty: 6, price: 43_000, discount: vnd(0) },
  ]

  /**
   * ⚠ ĐO ĐÚNG BẢN THIẾT KẾ, TỪNG ĐỒNG:
   *   7.928.000 − 33.500 − 100.000 + 0 − 3.900 = 7.790.600
   */
  it("ra đúng con số trên bản thiết kế", () => {
    const t = posTotals({ lines, docDiscount: vnd(100_000), other: 0, returnCredit: 3_900 })
    expect(t.gross).toBe(7_928_000)
    expect(t.lineDiscount).toBe(33_500)
    expect(t.docDiscount).toBe(100_000)
    expect(t.returnCredit).toBe(3_900)
    expect(t.due).toBe(7_790_600)
  })

  /**
   * ⚠ "TỔNG TIỀN HÀNG" LÀ TIỀN GỘP, CHƯA TRỪ GIẢM DÒNG. Bản thiết kế
   * liệt kê "Giảm giá dòng" thành một dòng RIÊNG ngay dưới nó — tổng
   * mà đã trừ sẵn thì dòng ấy bị trừ hai lần.
   */
  it("tổng tiền hàng chưa trừ giảm dòng", () => {
    const t = posTotals({ lines })
    expect(t.gross).toBe(7_928_000)
    expect(t.gross).not.toBe(7_928_000 - 33_500)
  })

  /**
   * ⚠ GIẢM GIÁ ĐƠN THEO `%` TÍNH TRÊN TIỀN GỘP. Spec §6 ghi
   * `Giảm giá đơn [5][%] → 396.400`, và 7.928.000 × 5% = 396.400 đúng
   * từng đồng. Tính trên số đã trừ giảm dòng sẽ ra 394.725 — lệch
   * 1.675đ, loại chênh chỉ lộ ra lúc đối chiếu với kế toán.
   */
  it("giảm giá đơn theo % tính trên tiền gộp, không trên số đã trừ giảm dòng", () => {
    const t = posTotals({ lines, docDiscount: pct(5) })
    expect(t.docDiscount).toBe(396_400)
    expect(t.docDiscount).not.toBe(Math.round((7_928_000 - 33_500) * 0.05))
  })

  /** ⚠ Hàng trả lớn hơn đơn là chuyện có thật — kẹp về 0, đừng hiện số âm. */
  it("hàng trả lớn hơn đơn thì về 0, không âm", () => {
    const t = posTotals({
      lines: [{ qty: 1, price: 100_000, discount: vnd(0) }],
      returnCredit: 500_000,
    })
    expect(t.due).toBe(0)
  })

  /** ⚠ Thu khác CỘNG vào, không trừ. */
  it("thu khác cộng thêm", () => {
    const t = posTotals({ lines: [{ qty: 1, price: 100_000, discount: vnd(0) }], other: 8_000 })
    expect(t.due).toBe(108_000)
  })
})

describe("chip mệnh giá gợi ý", () => {
  /** ⚠ Chip đầu LUÔN là đúng số phải trả — việc hay làm nhất, bấm một nhịp. */
  it("chip đầu là đúng số phải trả", () => {
    expect(cashSuggestions(7_790_600)[0]).toBe(7_790_600)
  })

  /** ⚠ KHÔNG gợi ý số NHỎ HƠN số phải trả — một chip trả thiếu bấm nhầm là một khoản nợ. */
  it("không gợi ý số nhỏ hơn số phải trả", () => {
    for (const d of [7_790_600, 57_000, 1_000, 12_345_678]) {
      for (const c of cashSuggestions(d)) expect(c).toBeGreaterThanOrEqual(d)
    }
  })

  it("không nợ thì không gợi ý gì", () => {
    expect(cashSuggestions(0)).toEqual([])
  })

  it("gợi ý không trùng nhau", () => {
    const c = cashSuggestions(7_790_600)
    expect(new Set(c).size).toBe(c.length)
  })
})
