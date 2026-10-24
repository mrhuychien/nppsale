import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm" → rà soát lại: chi tiết khách trên điện thoại NVBH 42 câu xếp
 *   thành 8 đợt chờ nhau (3,1 s) — cùng bộ câu chạy HAI LẦN vì `laNvbh` đổi khi hồ sơ về; bảng giá hàng nghìn dòng
 *   tải ngay lúc mở dù chỉ dùng ở một tab.
 */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const S = code(readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8"))
const than = S.slice(S.indexOf("const fetchData = useCallback("), S.indexOf("}, [id, laNvbh])"))

describe("chi tiết khách tải nhanh (chủ nhà 23/10/2026)", () => {
  it("chờ biết người rồi mới tải — hồ sơ về đổi `laNvbh` không làm chạy lại cả bộ câu", () => {
    expect(S).toMatch(/useEffect\(\(\) => \{\s*if \(authLoading\) return\s*fetchData\(\)\s*\}, \[fetchData, authLoading\]\)/)
  })

  it("fetchData đúng HAI đợt Promise.all — không câu nào chờ nối đuôi", () => {
    expect(than.length).toBeGreaterThan(1000)
    expect(than.match(/\bawait\b/g)?.length).toBe(2)
    expect(than.match(/await Promise\.all\(/g)?.length).toBe(2)
  })

  it("đợt 1 gom mọi câu chỉ cần id: khách, phân công, hoá đơn, đơn, công nợ, hàng trả hai kỳ, ghé thăm", () => {
    const dot2 = than.indexOf("await Promise.all(", than.indexOf("await Promise.all(") + 1)
    const dot1 = than.slice(0, dot2)
    for (const b of [
      'from("customers")',
      'from("customer_assignments")',
      'from("sales_invoices")',
      'from("sales_orders")',
      'from("receivables")',
      'from("payments")',
      'from("customer_photos")',
      'from("pjp_routes")',
      'from("visit_logs")',
      "traCuaKhach(supabase, id, ngayDauThang, null)",
    ]) {
      expect(dot1, b).toContain(b)
    }
    /* Đợt 2 chỉ còn câu cần kết quả đợt 1. */
    const sau = than.slice(dot2)
    for (const b of ['from("users")', 'from("user_suppliers")', 'from("sales_routes")', 'from("sales_order_lines")', "traTheoHoaDon("]) {
      expect(sau, b).toContain(b)
      expect(dot1, `${b} không được ở đợt 1`).not.toContain(b)
    }
  })

  it("bảng giá không nằm trong fetchData — chỉ tải khi mở tab 'prices', và nhớ theo khách + nhóm", () => {
    expect(than).not.toContain('from("price_lists")')
    const i = S.indexOf('from("price_lists")')
    expect(i).toBeGreaterThan(0)
    const truoc = S.slice(S.lastIndexOf("useEffect(", i), i)
    expect(truoc).toContain('if (activeTab !== "prices" || nhomGia === undefined) return')
    expect(truoc).toContain("if (giaDaTai.current === khoa) return")
    expect(S).toContain("{priceLoading ? (")
  })
})
