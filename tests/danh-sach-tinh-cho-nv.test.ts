import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { ORDER_COLUMNS, DEFAULT_ORDER_COLUMNS } from "../src/app/(dashboard)/orders/list-config"
import { INVOICE_COLUMNS, DEFAULT_INVOICE_COLUMNS } from "../src/app/(dashboard)/sales-invoices/list-config"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Danh sách đơn hàng và Danh sách hóa đơn -> thêm cột
 *   Tính cho NV (đặt mặc định) còn cột người tạo (option)".
 */
const sql = readdirSync("supabase/migrations").map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n")

describe.each([
  ["đơn hàng", ORDER_COLUMNS, DEFAULT_ORDER_COLUMNS, "src/app/(dashboard)/orders/page.tsx", "creator:users!sales_orders_created_by_fkey(full_name)"],
  ["hóa đơn", INVOICE_COLUMNS, DEFAULT_INVOICE_COLUMNS, "src/app/(dashboard)/sales-invoices/page.tsx", "creator:users!sales_invoices_posted_by_fkey(full_name)"],
] as const)("danh sách %s", (_ten, cot, macDinh, trang, nhung) => {
  it("salesUser mang nhãn 'Tính cho NV' và bật mặc định", () => {
    expect(cot.find((c) => c.key === "salesUser")?.label).toBe("Tính cho NV")
    expect(macDinh as readonly string[]).toContain("salesUser")
  })
  it("'Người tạo' có trong danh mục nhưng TẮT mặc định", () => {
    expect(cot.find((c) => c.key === "createdBy")?.label).toBe("Người tạo")
    expect(macDinh as readonly string[]).not.toContain("createdBy")
  })
  it("trang đọc người tạo qua đúng khoá ngoại", () => {
    expect(readFileSync(trang, "utf8")).toContain(nhung)
  })
})

describe("khoá ngoại người tạo có thật", () => {
  it("sales_orders.created_by (mig 178) và sales_invoices.posted_by (mig 124) trỏ users", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public\.users\(id\)/)
    expect(sql).toMatch(/posted_by\s+uuid REFERENCES users\(id\)/)
  })
})
