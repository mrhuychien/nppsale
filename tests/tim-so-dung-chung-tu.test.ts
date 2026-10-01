/**
 * Chủ nhà 01/10/2026: "Tìm kiếm ở Đơn hàng, Trả hàng, Hóa đơn: tìm kiếm số theo đúng tài liệu: Đơn hàng ->
 * chỉ tìm số đơn hàng. Trả hàng -> tìm đúng số phiếu trả, hóa đơn tìm đúng theo số hóa đơn."
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { buildOrFilter } from "@/lib/search/list-search"

const KHACH = { column: "customer_id", match: { ids: ["k1"], truncated: false } }
const DON = { column: "order_id", match: { ids: ["o1"], truncated: false } }

describe("số chỉ tìm mã của chính chứng từ", () => {
  it("gõ số ở Hoá đơn: chỉ số HĐ — không ra HĐ của đơn có số đó, không ra khách có SĐT chứa số đó", () => {
    const f = buildOrFilter("0123", ["invoice_code"], [KHACH, DON], { soChiTimMa: true }).filter!
    expect(f).toContain("invoice_code.ilike")
    expect(f).not.toContain("customer_id.in")
    expect(f).not.toContain("order_id.in")
  })
  it("gõ mã có chữ lẫn số (DH-0123) cũng là số chứng từ", () => {
    const f = buildOrFilter("DH-0123", ["return_code"], [DON], { soChiTimMa: true }).filter!
    expect(f).not.toContain("order_id.in")
  })
  it("gõ chữ: vẫn tìm theo khách như cũ", () => {
    expect(buildOrFilter("minh", ["order_code"], [KHACH], { soChiTimMa: true }).filter).toContain("customer_id.in.(k1)")
  })
  it("chữ + số: phiếu có số đó CỦA khách đó (tra trộn giữ nguyên)", () => {
    const f = buildOrFilter("minh 0123", ["order_code"], [KHACH], { soChiTimMa: true, tron: [{ ids: ["k1"], truncated: false }] }).filter!
    expect(f).toMatch(/and\(order_code\.ilike[^)]*0123[^)]*,customer_id\.in\.\(k1\)\)/)
  })
  it("màn khác (không bật) giữ cách cũ: số vẫn tra khách", () => {
    expect(buildOrFilter("0911", ["code"], [KHACH]).filter).toContain("customer_id.in.(k1)")
  })
  it("ba màn Đơn hàng / Hoá đơn / Trả hàng bật luật này", () => {
    for (const [f, bang] of [["orders", "sales_orders"], ["sales-invoices", "sales_invoices"], ["returns", "returns"]]) {
      const s = readFileSync(`src/app/(dashboard)/${f}/page.tsx`, "utf8")
      expect(s, f).toMatch(new RegExp(`"${bang}",\\s*// số chỉ tìm[^\\n]*\\n\\s*true\\s*\\)`))
    }
  })
})
