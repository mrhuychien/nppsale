import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dongCongNoTheoNcc } from "@/lib/payables/theo-ncc"

/**
 * Chủ nhà 08/10/2026: "Phần công nợ theo NCC thêm cột hàng trả lại, đã trả đổi tên thành đã thanh toán cho dễ theo
 * dõi" (mig 239). Tổng nợ (gộp) − Hàng trả lại − Đã thanh toán = Còn lại.
 */
const DONG = {
  supplier_id: "s1", supplier_name: "Vinamilk", supplier_code: "NCC1", invoice_count: 2,
  total_debt: "250000", total_paid: "100000", remaining: "150000", overdue_count: 0,
}

describe("công nợ theo NCC: cột hàng trả lại", () => {
  it("Tổng nợ gộp = ròng + hàng trả lại; Tổng nợ − Hàng trả lại − Đã thanh toán = Còn lại", () => {
    const d = dongCongNoTheoNcc({ ...DONG, total_returned: "50000" })
    expect(d.totalDebt).toBe(300000)
    expect(d.totalReturned).toBe(50000)
    expect(d.totalPaid).toBe(100000)
    expect(d.totalDebt - (d.totalReturned ?? 0) - d.totalPaid).toBe(d.remaining)
  })

  it("sổ chưa chạy mig 239 (không có total_returned): hàng trả lại null, Tổng nợ giữ số ròng", () => {
    const d = dongCongNoTheoNcc(DONG)
    expect(d.totalReturned).toBeNull()
    expect(d.totalDebt).toBe(250000)
    expect(d.remaining).toBe(150000)
  })

  it("màn Công nợ theo NCC: có cột Hàng trả lại, chữ 'Đã trả' đổi thành 'Đã thanh toán'", () => {
    const s = readFileSync("src/app/(dashboard)/payables/by-supplier/page.tsx", "utf8")
    expect(s).toContain(">Hàng trả lại<")
    expect(s).toContain(">Đã thanh toán<")
    expect(s).not.toMatch(/>Đã trả</)
    expect(s).toContain("raw.map(dongCongNoTheoNcc)")
    const ncc = readFileSync("src/app/(dashboard)/suppliers/[id]/page.tsx", "utf8")
    expect(ncc).toContain(">Đã thanh toán</TableHead>")
    expect(ncc).not.toMatch(/"Đã trả"/)
  })
})
