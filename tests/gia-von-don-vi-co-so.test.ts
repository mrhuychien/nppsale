import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(p, "utf8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/^\s*--.*$/gm, "")

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Rà soát các lỗi sai tương tự trong các báo cáo" (giá
 *   theo đơn vị cơ sở × SL theo đơn vị trung gian). Phiếu xuất ghi `quantity`
 *   theo đơn vị giao dịch; `unit_cost` là giá mỗi đơn vị cơ sở.
 */
describe("giá vốn lãi/lỗ (SQL) theo đơn vị cơ sở — mig 187", () => {
  const M = read("supabase/migrations/187_gia_von_lai_lo_don_vi_co_so.sql")
  const C = code(M)
  it("giá vốn nhân qty_in_base_uom, không nhân quantity thô", () => {
    expect(C).toContain("ABS(COALESCE(l.qty_in_base_uom, COALESCE(l.quantity, 0) * COALESCE(l.conversion_factor_snapshot, 1)))")
    expect(C).not.toContain("SUM(ABS(COALESCE(l.quantity, 0)) * COALESCE(l.unit_cost, 0))")
  })
  it("idempotent, giữ quyền gọi, khép bằng NOTIFY + SELECT; có dòng khám sổ", () => {
    expect(C).toContain("CREATE OR REPLACE FUNCTION public.finance_pnl(p_from date, p_to date)")
    expect(C).toContain("GRANT EXECUTE ON FUNCTION public.finance_pnl(date, date) TO authenticated;")
    expect(C).toContain("NOTIFY pgrst, 'reload schema';")
    expect(read("scripts/sql/kham-so-that.sql")).toContain("Mig 187")
  })
  /** Doanh thu trong hàm vẫn theo hóa đơn đã ghi sổ (mig 126) — không đụng. */
  it("doanh thu vẫn theo hóa đơn đã ghi sổ", () => {
    expect(C).toMatch(/FROM sales_invoices[\s\S]*is_revenue_invoice_status\(status\)/)
  })
})

describe("thẻ kho: tồn chạy và giá trị theo đơn vị cơ sở", () => {
  const S = code(read("src/app/(dashboard)/inventory/stock-card/[productId]/page.tsx"))
  it("đọc qty_in_base_uom và dùng nó làm SL", () => {
    expect(S).toContain("qty_in_base_uom, conversion_factor_snapshot, unit_cost")
    expect(S).toMatch(/quantity:\s*l\.qty_in_base_uom != null\s*\?\s*Number\(l\.qty_in_base_uom\)/)
    expect(S).toContain("qtyGd: Number(l.quantity) || 0")
    expect(S).not.toMatch(/quantity: Number\(l\.quantity\) \|\| 0,/)
  })
})
