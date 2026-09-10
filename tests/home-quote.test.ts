import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getDailyQuote, QUOTE_CATEGORY_LABEL } from "../src/lib/sales-quotes"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const RAW = read("src/app/(dashboard)/home/page.tsx")

/**
 * Quét theo dòng, bỏ chú thích — xem ghi chú ở tests/mobile-actions-lines.test.ts.
 *
 * ⚠ CẦN THIẾT, không phải cho gọn: soi cả file thì chính CHÚ THÍCH giải
 * thích "đã bỏ Câu 01/100" lại làm test đỏ. Test phải soi thứ NGƯỜI DÙNG
 * THẤY, không phải thứ lập trình viên viết cho nhau đọc.
 */
const strip = (src: string) => {
  const out: string[] = []
  let inBlock = false
  for (const line of src.split("\n")) {
    const t = line.trim()
    if (inBlock) { if (t.includes("*/")) inBlock = false; continue }
    if (t.startsWith("{/*") || t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(line)
  }
  return out.join("\n")
}
const HOME = strip(RAW)

describe("Câu nói hôm nay nằm ở ĐẦU trang", () => {
  it("đứng trước phần chỉ số bán hàng", () => {
    const quote = HOME.indexOf("{dailyQuote.text}")
    const snapshot = HOME.indexOf("Đơn hôm nay")
    const greeting = HOME.indexOf("Chào {firstName}")
    expect(quote).toBeGreaterThan(0)
    expect(quote).toBeLessThan(snapshot)
    expect(quote).toBeLessThan(greeting)
  })

  /**
   * ⚠ Khối này từng bị đẩy xuống cuối trang vì nó chiếm chỗ đẹp nhất của
   * màn hình đầu và đẩy nút "Tạo đơn hàng mới" xuống dưới mép nhìn thấy.
   * Nay đưa lên đầu theo yêu cầu, nên phải GỌN hết mức để cái giá đó nhỏ
   * nhất có thể — không quay lại kích thước cũ.
   */
  it("giữ dáng gọn: padding nhỏ, chữ nhỏ", () => {
    const block = HOME.slice(HOME.indexOf("{isSales && !searching && ("), HOME.indexOf("{dailyQuote.text}"))
    expect(block).toContain("px-4 py-3")
    expect(block).not.toContain("p-4 shadow-sm")
    expect(block).toContain("text-sm font-bold leading-snug")
    expect(block).not.toContain("text-[15px]")
  })
})

describe("Bỏ số thứ tự câu", () => {
  /**
   * "Câu 01/100" không nói gì với người đọc — nó chỉ tiết lộ kho câu có
   * bao nhiêu và hôm nay đang tới đâu.
   */
  it("không còn hiện số thứ tự trên giao diện", () => {
    expect(HOME).not.toContain("/100")
    expect(HOME).not.toMatch(/dailyQuote\.index/)
  })

  /** Nhãn nhóm vẫn giữ — nó cho biết câu này nói về chuyện gì. */
  it("vẫn hiện nhóm câu nói", () => {
    expect(HOME).toContain("QUOTE_CATEGORY_LABEL[dailyQuote.category]")
  })

  /**
   * `index` vẫn còn trong dữ liệu và vẫn là khoá chọn câu theo ngày — bỏ
   * khỏi GIAO DIỆN không có nghĩa là bỏ khỏi mô hình.
   */
  it("index vẫn còn trong dữ liệu để chọn câu theo ngày", () => {
    const q = getDailyQuote(new Date("2026-09-10T00:00:00Z"))
    expect(q.index).toBeGreaterThan(0)
    expect(q.text.length).toBeGreaterThan(10)
    expect(QUOTE_CATEGORY_LABEL[q.category]).toBeTruthy()
  })

  /** Cùng một ngày thì mọi người thấy cùng một câu. */
  it("cùng ngày ra cùng câu, khác ngày thì đổi", () => {
    const a = getDailyQuote(new Date("2026-09-10T01:00:00Z"))
    const b = getDailyQuote(new Date("2026-09-10T23:00:00Z"))
    const c = getDailyQuote(new Date("2026-09-11T01:00:00Z"))
    expect(a.index).toBe(b.index)
    expect(c.index).not.toBe(a.index)
  })
})
