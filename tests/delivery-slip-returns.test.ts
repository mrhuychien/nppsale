import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const PAGE = code(read("src/app/(dashboard)/inventory/entries/[id]/page.tsx"))

/**
 * NGƯỜI DÙNG YÊU CẦU: trong mẫu in phiếu xuất kho / giao hàng TỪNG KHÁCH,
 * bỏ phần viết tay "Hàng trả về (thu về kho) — Đơn chưa có yêu cầu trả …
 * ghi tay vào các dòng trống … Tổng trả (ghi tay): _______".
 *
 * Bảng hàng trả vẫn in khi đơn CÓ phiếu trả thật (đó là số liệu, không
 * phải chỗ trống để viết). Dòng "Số phải thu" giữ nguyên.
 */
describe("Phiếu giao từng khách: không còn phần hàng trả viết tay", () => {
  it("bỏ hẳn câu mời ghi tay, dòng trống và 'Tổng trả (ghi tay)'", () => {
    expect(PAGE).not.toContain("ghi tay vào các dòng trống")
    expect(PAGE).not.toContain("Tổng trả (ghi tay)")
    expect(PAGE).not.toContain("_______")
    expect(PAGE).not.toContain("blank-${i}")
    expect(PAGE).not.toContain("Array.from({ length: 3 }")
  })

  it("bảng hàng trả chỉ dựng khi hasReturns; dòng hàng trả và tổng trừ công nợ vẫn còn", () => {
    const i = PAGE.indexOf("Hàng trả về (thu về kho)")
    expect(i).toBeGreaterThan(0)
    // Tiêu đề nằm TRONG nhánh `{hasReturns && (` — không in cho đơn không có phiếu trả.
    const gate = PAGE.lastIndexOf("{hasReturns && (", i)
    expect(gate).toBeGreaterThan(0)
    expect(PAGE.slice(gate, i)).not.toContain("</div>")
    expect(PAGE).toContain("{allReturnLines.map((l, i) => {")
    expect(PAGE).toContain("Tổng trả (trừ công nợ):")
  })

  it("dòng 'Số phải thu' vẫn in cho mọi đơn, nằm ngoài nhánh hasReturns", () => {
    const due = PAGE.indexOf('{hasReturns ? "Còn phải thu:" : "Số phải thu:"}')
    expect(due).toBeGreaterThan(0)
    const gate = PAGE.lastIndexOf("{hasReturns && (", due)
    // ⚠ Không có nhánh thì "ngoài nhánh" là vô nghĩa — bản cũ từng xanh vì thế.
    expect(gate).toBeGreaterThan(0)
    // Fragment của nhánh đã đóng (`</>`) trước dòng phải thu.
    const close = PAGE.indexOf("</>", gate)
    expect(close).toBeGreaterThan(gate)
    expect(close).toBeLessThan(due)
  })
})
