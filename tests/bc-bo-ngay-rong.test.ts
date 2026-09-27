/** Chủ nhà 27/09/2026: bảng Bán hàng theo thời gian bỏ ngày doanh số 0; chân trang NVBH đổi Công nợ → Báo cáo. */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { coBan, coDat } from "@/components/bao-cao/man-ban-hang"

describe("bảng theo thời gian bỏ kỳ không có doanh số", () => {
  it("bỏ ngày 0; giữ ngày có bán hoặc chỉ có trả (DT thuần âm)", () => {
    expect(coBan({ rev: 0, ret: 0 })).toBe(false)
    expect(coBan({})).toBe(false)
    expect(coBan({ rev: 100, ret: 0 })).toBe(true)
    expect(coBan({ rev: 0, ret: 50 })).toBe(true)
    expect(coDat({ val: 0 })).toBe(false)
    expect(coDat({ val: 1 })).toBe(true)
  })
  it("chỉ bảng lọc — biểu đồ vẫn đủ trục ngày", () => {
    const s = readFileSync("src/components/bao-cao/man-ban-hang.tsx", "utf8")
    expect(s).toContain('dong={view === "time" ? nhom.filter(coBan) : nhom}')
    expect(s).toContain('dong={view === "time" ? nhom.filter(coDat) : nhom}')
  })
})

describe("chân trang điện thoại của NVBH", () => {
  it("không còn Công nợ; có Báo cáo mở Bán hàng, sáng ở mọi /bao-cao", () => {
    const s = readFileSync("src/components/layout/mobile-nav.tsx", "utf8")
    const sales = s.slice(s.indexOf("  sales: ["), s.indexOf("  warehouse: ["))
    expect(sales).not.toContain('"/receivables"')
    expect(sales).toContain('{ label: "Báo cáo", href: "/bao-cao/ban-hang", icon: BarChart3, khop: "/bao-cao" }')
  })
})
