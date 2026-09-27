import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { CUSTOMER_COLUMNS, DEFAULT_CUSTOMER_COLUMNS } from "../src/app/(dashboard)/customers/list-config"

/**
 * ⚠ Chủ nhà 27/09/2026: "kiểm tra sao danh sách khách hàng load lâu vậy?" → "bỏ luôn phần chậm"
 *   → "hai cột Đơn gần nhất và Lần ghé gần nhất". Hai cột ấy đọc 1.000 dòng đơn + 1.000 dòng ghé
 *   thăm cho mỗi trang rồi hỏi bù từng khách — phần chậm nhất của màn.
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("danh sách khách: không còn hai cột đọc chậm", () => {
  it("không còn cột Đơn gần nhất / Ghé thăm (kể cả trong cột đã lưu)", () => {
    const keys: string[] = CUSTOMER_COLUMNS.map((c) => c.key)
    expect(keys).not.toContain("lastOrder")
    expect(keys).not.toContain("lastVisit")
    expect(DEFAULT_CUSTOMER_COLUMNS as string[]).not.toContain("lastOrder")
  })
  it("màn không còn đọc đơn / lần ghé của từng khách", () => {
    const man = doc("src/app/(dashboard)/customers/page.tsx")
    expect(man).not.toMatch(/from\("sales_orders"\)/)
    expect(man).not.toMatch(/from\("visit_logs"\)\s*\.select\("customer_id, visit_date, check_in_at/)
    expect(man).not.toContain("moiNhatTheoKhach")
    const bang = doc("src/components/customers/customer-table.tsx")
    expect(bang).not.toContain("Đơn gần nhất")
  })
})
