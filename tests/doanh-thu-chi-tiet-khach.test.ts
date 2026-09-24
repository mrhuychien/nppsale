import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const S = code(readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8"))

/** ⚠ CHỦ NHÀ 24/09/2026: "làm tiếp phần doanh thu tính theo hoá đơn". */
describe("chi tiết khách: doanh thu tháng theo HÓA ĐƠN đã ghi sổ", () => {
  it("hai ô doanh thu đọc sales_invoices posted theo ngày hóa đơn", () => {
    const i = S.indexOf("prevMonthOrdersRes,")
    const dau = S.slice(i, S.indexOf("fetchAllForAggregate<OrderRow>", i))
    expect(dau.match(/\.from\("sales_invoices"\)\s*\.select\("total"\)/g)?.length).toBe(2)
    expect(dau).toContain('.eq("status", "posted")')
    expect(dau).toContain('.gte("invoice_date", ngayDauThang)')
    expect(dau).toContain('.lt("invoice_date", ngayDauThang)')
    expect(dau, "doanh thu vẫn cộng tổng đơn").not.toMatch(/from\("sales_orders"\)\s*\.select\("total"\)/)
  })

  /** `invoice_date` là DATE — mốc UTC làm lọt cả ngày cuối tháng trước. */
  it("mốc tháng là NGÀY theo giờ VN, không phải chuỗi ISO", () => {
    expect(S).toContain("vnDateKey(now)")
    expect(S).not.toMatch(/gte\("invoice_date", [a-zA-Z]*\.toISOString/)
    expect(S).toMatch(/const ngayDauThang = `\$\{nam\}-\$\{String\(thang\)\.padStart\(2, "0"\)\}-01`/)
  })
})

describe("trang chủ NVBH: 'Đơn hôm nay' so theo NGÀY giờ VN", () => {
  const H = code(readFileSync("src/app/(dashboard)/home/page.tsx", "utf8"))
  it("không so cột DATE với mốc ISO/UTC", () => {
    expect(H).toContain('.gte("order_date", todayDate)')
    expect(H).toContain("return vnDateKey(new Date())")
    expect(H).not.toContain("toISOString()")
  })
})
