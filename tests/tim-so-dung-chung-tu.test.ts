/**
 * Chủ nhà 01/10/2026: "Tìm kiếm ở Đơn hàng, Trả hàng, Hóa đơn: tìm kiếm số theo đúng tài liệu: Đơn hàng ->
 * chỉ tìm số đơn hàng. Trả hàng -> tìm đúng số phiếu trả, hóa đơn tìm đúng theo số hóa đơn."
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { buildOrFilter, menhDeTimDanhSach } from "@/lib/search/list-search"
import { doiMaCuPhieuTra } from "@/lib/returns/ma-phieu"

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

/**
 * Chủ nhà 08/10/2026: "Danh sách Phiếu trả hàng cho phép tìm kiếm theo số hoá đơn hoặc số đơn hàng".
 * Lượt tra MÃ CHỨNG TỪ (`laMa`) vẫn chạy khi gõ số; tra khách / người lập vẫn tắt như luật 01/10.
 */
describe("phiếu trả: gõ số ra cả theo số hoá đơn / số đơn hàng", () => {
  const HD = { column: "invoice_id", match: { ids: ["h1"], truncated: false }, laMa: true }
  const DON_MA = { ...DON, laMa: true }

  it("gõ số: số phiếu trả + số HĐ + số đơn của phiếu; không ra theo SĐT khách", () => {
    const f = buildOrFilter("0123", ["return_code"], [KHACH, DON_MA, HD], { soChiTimMa: true }).filter!
    expect(f).toContain("return_code.ilike")
    expect(f).toContain("order_id.in.(o1)")
    expect(f).toContain("invoice_id.in.(h1)")
    expect(f).not.toContain("customer_id.in")
  })

  it("gõ đúng mã hoá đơn HD-0012: ra phiếu của hoá đơn đó", () => {
    const f = buildOrFilter("HD-0012", ["return_code"], [KHACH, DON_MA, HD], { soChiTimMa: true }).filter!
    expect(f).toContain("invoice_id.in.(h1)")
  })

  it("lượt tra thật: gõ số thì hỏi bảng hoá đơn + đơn hàng, KHÔNG hỏi bảng khách / người dùng", async () => {
    const hoi: string[] = []
    const sb = {
      from: (bang: string) => {
        hoi.push(bang)
        const kq = { data: bang === "returns" ? [] : [{ id: `${bang}-1` }], error: null }
        const chain: Record<string, unknown> = {
          then: (ok: (v: typeof kq) => unknown, loi: (e: unknown) => unknown) => Promise.resolve(kq).then(ok, loi),
        }
        for (const m of ["select", "or", "order", "eq", "limit"]) chain[m] = () => chain
        return chain
      },
    }
    const r = await menhDeTimDanhSach(sb as never, "returns", "0012", "org", ["return_code"], [
      { column: "customer_id", table: "customers", columns: ["store_name", "phone"] },
      { column: "requested_by", table: "users", columns: ["full_name"] },
      { column: "order_id", table: "sales_orders", columns: ["order_code"], laMa: true },
      { column: "invoice_id", table: "sales_invoices", columns: ["invoice_code"], laMa: true },
    ], true)
    expect(hoi).toContain("sales_orders")
    expect(hoi).toContain("sales_invoices")
    expect(hoi).not.toContain("customers")
    expect(hoi).not.toContain("users")
    expect(r.filter).toContain("order_id.in.(sales_orders-1)")
    expect(r.filter).toContain("invoice_id.in.(sales_invoices-1)")
  })

  it("màn Trả hàng bật tra số HĐ / số đơn (laMa), không bật cho khách", () => {
    const s = readFileSync("src/app/(dashboard)/returns/page.tsx", "utf8")
    expect(s).toMatch(/\{ column: "invoice_id", table: "sales_invoices", columns: \["invoice_code"\], laMa: true \}/)
    expect(s).toMatch(/\{ column: "order_id", table: "sales_orders", columns: \["order_code"\], laMa: true \}/)
    expect(s).toMatch(/\{ column: "customer_id", table: "customers", columns: \[[^\]]*\] \}/)
    expect(s).toContain("doiMaCuPhieuTra(debouncedSearch)")
  })

  it("số phiếu cũ TH-xxxx in trên giấy hiểu là PT-xxxx; chữ khác giữ nguyên", () => {
    expect(doiMaCuPhieuTra("TH-0012")).toBe("PT-0012")
    expect(doiMaCuPhieuTra("th12")).toBe("PT12")
    expect(doiMaCuPhieuTra("minh TH-0003")).toBe("minh PT-0003")
    expect(doiMaCuPhieuTra("Thảo")).toBe("Thảo")
    expect(doiMaCuPhieuTra("HD-0012")).toBe("HD-0012")
    expect(doiMaCuPhieuTra("THU-12")).toBe("THU-12")
  })
})
