import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { RETURN_COLUMNS, DEFAULT_RETURN_COLUMNS, RETURN_FILTERS, DEFAULT_RETURN_FILTERS } from "../src/app/(dashboard)/returns/list-config"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Danh sách trả hàng thêm cột hiển thị Tính cho nhân viên".
 *   Cột đọc `returns.sales_user_id` (người được tính khoản trừ), không phải
 *   `requested_by` (người lập). Máy chủ giả của e2e bỏ qua phần ghép bảng,
 *   nên phần đọc được chốt ở đây.
 */
describe("danh sách trả hàng: cột Tính cho NV", () => {
  it("có trong danh mục cột và bật mặc định", () => {
    expect(RETURN_COLUMNS.find((c) => c.key === "seller")?.label).toBe("Tính cho NV")
    expect(DEFAULT_RETURN_COLUMNS).toContain("seller")
  })

  it("bộ lọc theo NV có trong danh mục và bật mặc định (chủ nhà 24/09/2026)", () => {
    expect(RETURN_FILTERS.find((f) => f.key === "seller")?.label).toBe("Lọc theo NV")
    expect(DEFAULT_RETURN_FILTERS).toContain("seller")
  })

  it("trang đọc người được tính qua khoá returns_sales_user_id_fkey", () => {
    const S = readFileSync("src/app/(dashboard)/returns/page.tsx", "utf8")
    expect(S).toContain("seller:users!returns_sales_user_id_fkey(full_name)")
  })

  it("khoá ấy có thật: returns.sales_user_id REFERENCES users", () => {
    const sql = readdirSync("supabase/migrations").map((f) => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n")
    expect(sql).toMatch(/ALTER TABLE (public\.)?returns[\s\S]{0,80}ADD COLUMN IF NOT EXISTS sales_user_id uuid REFERENCES users\(id\)/)
  })
})
