import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * ⚠ CHỦ NHÀ 25/09/2026 (mig 192): "Rà soát lại toàn bộ doanh số tính bằng số đi - số trả".
 *   Mọi con số doanh thu / doanh số ở các màn dưới đây là số THUẦN = hóa đơn đã ghi sổ
 *   − hàng trả trừ trong kỳ (`fetchReturnsRows(Du)` / `fetchReturnLines`, cùng luật công
 *   nợ). Màn lợi nhuận: doanh thu thuần VÀ giá vốn thuần (giá vốn − giá vốn hàng trả
 *   đã nhập lại kho, `fetchReturnCosts`). Trừ một vế mà quên vế kia là lãi lệch.
 *
 *   Trước đợt này: Lợi nhuận theo khách / theo mặt hàng, Top nhóm / hàng / kênh / NV,
 *   Doanh thu / Khách, phân loại khách / hàng đều cộng hóa đơn TRẦN (số đi).
 */

const D = "src/app/(dashboard)"
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const read = (f: string) => code(readFileSync(`${D}/${f}`, "utf8"))

/** Thân một khối `const <ten> = useMemo(` / `useCallback(` tới dấu đóng `}, [`. */
function khoi(src: string, ten: string): string {
  const i = src.indexOf(`const ${ten}`)
  expect(i, `không còn ${ten}`).toBeGreaterThan(-1)
  const j = src.indexOf("}, [", i)
  return src.slice(i, j === -1 ? undefined : j)
}

describe("reports/customers — Lợi nhuận theo khách: doanh thu thuần, giá vốn thuần", () => {
  const S = read("reports/customers/page.tsx")
  const P = khoi(S, "profitRows")

  it("nạp giá vốn hàng trả theo phiếu trong kỳ", () => {
    expect(S).toMatch(/fetchReturnCosts\(supabase, returnIds\)/)
    expect(S).toContain("setReturnCosts(retCosts)")
  })

  it("trừ tiền trả và giá vốn hàng trả của đúng khách", () => {
    expect(P).toMatch(/for \(const r of returns\)/)
    expect(P).toContain("e.returnValue += Number(r.credit_note_amount || 0)")
    expect(P).toContain("e.returnCost += returnCosts.get(r.id)?.total || 0")
    expect(P).toContain("const netRevenue = r.revenue - r.returnValue")
    expect(P).toContain("const cogs = r.cogs - r.returnCost")
    expect(P).toContain("const profit = netRevenue - cogs")
    expect(P).toMatch(/margin: netRevenue > 0 \? \(profit \/ netRevenue\)/)
    expect(P).not.toContain("const profit = r.revenue - r.cogs")
  })

  it("bảng Lợi nhuận hiện doanh thu THUẦN", () => {
    const V = S.slice(S.indexOf("function ProfitView("), S.indexOf("function ReceivablesView("))
    expect(V).toContain('label: "Doanh thu thuần"')
    expect(V).toContain("formatCurrency(r.netRevenue)")
    expect(V).not.toContain("formatCurrency(r.revenue)")
  })

  it("màn Bán hàng vẫn trừ trả như cũ", () => {
    expect(khoi(S, "salesRows")).toContain("netRevenue: r.revenue - r.returnValue")
  })
})

describe("reports/products — Lợi nhuận theo mặt hàng", () => {
  const S = read("reports/products/page.tsx")
  const P = khoi(S, "profitRows")

  it("gộp giá vốn hàng trả theo mặt hàng", () => {
    expect(S).toMatch(/fetchReturnCosts\(supabase, returnIds\)/)
    expect(S).toMatch(/c\.byProduct\.forEach/)
  })

  it("doanh thu − dòng trả, giá vốn − giá vốn hàng trả", () => {
    expect(P).toMatch(/for \(const l of returnLines\)[\s\S]*?e\.revenue -= Number\(l\.line_total \|\| 0\)/)
    expect(P).toMatch(/returnCostByProduct\.forEach[\s\S]*?e\.cogs -= cost/)
    expect(P).toContain("const profit = r.revenue - r.cogs")
  })
})

describe("analytics/business/overview — các bảng Top là số thuần", () => {
  const S = read("analytics/business/overview/page.tsx")

  it("đọc phiếu trả (không chỉ tổng), dòng trả và giá vốn hàng trả của cả hai kỳ", () => {
    expect(S).not.toMatch(/\bfetchReturnsValue\(/)
    expect(S).toContain("fetchReturnsRows(supabase, orgId, range)")
    expect(S).toContain("fetchReturnsRows(supabase, orgId, prev)")
    expect(S).toContain("fetchReturnLines(supabase, retIds)")
    expect(S).toContain("fetchReturnLines(supabase, prevRetIds)")
    expect(S).toContain("setCogs(cogsRes.cogs - giaVonTra)")
    expect(S).toContain("setPrevCogs(prevCogsRes.cogs - giaVonTraTruoc)")
  })

  it.each([
    ["topGroups", "truTra(cur, returns)", "truTra(prev, prevReturns)"],
    ["topProducts", "truTra(cur, returnLines)", "truTra(prev, prevReturnLines)"],
    ["topChannels", "truTra(cur, returns)", "truTra(prev, prevReturns)"],
    ["topEmployees", "truTra(cur, returns)", "truTra(prev, prevReturns)"],
  ])("%s trừ hàng trả kỳ này và kỳ trước", (ten, a, b) => {
    const K = khoi(S, ten)
    expect(K).toContain(a)
    expect(K).toContain(b)
    expect(K).toMatch(/e\.revenue -= Number\((r\.credit_note_amount|l\.line_total) \|\| 0\)/)
  })

  it("NV của phiếu trả: NV phiếu → NV hóa đơn gắn phiếu → chưa gán", () => {
    expect(S).toContain(
      'nvTra.set(r.id, r.sales_user_id || (r.invoice_id ? nvHoaDon.get(r.invoice_id) : "") || "")'
    )
    expect(khoi(S, "topEmployees")).toContain('const uid = returnUser.get(r.id) ?? ""')
  })

  it("nhãn các bảng Top là Doanh thu thuần", () => {
    expect(S.match(/label: "Doanh thu thuần", align: "right", render: \(r\) => <MoneyCell value=\{r\.revenue\}/g)).toHaveLength(4)
  })
})

describe("analytics/business/cost-profit — giá vốn thuần", () => {
  const S = read("analytics/business/cost-profit/page.tsx")
  it("giá vốn trừ giá vốn hàng trả đã nhập kho, cả hai kỳ", () => {
    expect(S).toContain("fetchReturnCosts(supabase, retRows.map((r) => r.id))")
    expect(S).toContain("setCogs(cogsRes.cogs - tongGiaVonTra(retCosts))")
    expect(S).toContain("setPrevCogs(prevCogsRes.cogs - tongGiaVonTra(prevRetCosts))")
    expect(S).toContain("const netRevenue = revenue - returnsValue")
    expect(S).toContain("const grossProfit = netRevenue - cogs")
  })
})

describe("analytics/customers — doanh thu thuần theo khách", () => {
  it("overview: Doanh thu / Khách và Top khách trừ hàng trả", () => {
    const S = read("analytics/customers/overview/page.tsx")
    const st = khoi(S, "stats")
    expect(st).toContain("- tra(returns)")
    expect(st).toContain("- tra(prevReturns)")
    expect(st).toContain("arpu: buyers.size > 0 ? revenue / buyers.size : 0")
    const top = khoi(S, "topCustomers")
    expect(top).toContain("truTra(cur, returns)")
    expect(top).toContain("truTra(prev, prevReturns)")
    expect(top).toContain("e.revenue -= Number(r.credit_note_amount || 0)")
  })

  it("categories: nhóm / kênh / tỉnh trừ hàng trả theo khách của phiếu", () => {
    const S = read("analytics/customers/categories/page.tsx")
    const ag = khoi(S, "aggregate")
    expect(ag).toContain("const k = extractor(customerMap.get(r.customer_id))")
    expect(ag).toContain("e.revenue -= Number(r.credit_note_amount || 0)")
    expect(ag).toContain("truTra(cur, returns)")
    expect(ag).toContain("truTra(prev, prevReturns)")
    expect(S).toMatch(/prevReturns\.reduce\(\(a, r\) => a \+ Number\(r\.credit_note_amount \|\| 0\), 0\)/)
  })
})

describe("analytics/products — doanh thu thuần theo mặt hàng", () => {
  it("overview: tổng, Top theo doanh thu, Top theo SL đều trừ dòng trả", () => {
    const S = read("analytics/products/overview/page.tsx")
    expect(S).toContain("fetchReturnLines(supabase, retRows.map((r) => r.id))")
    expect(S).toContain("fetchReturnLines(supabase, prevRetRows.map((r) => r.id))")
    const st = khoi(S, "stats")
    expect(st).toContain("const totalRevenue = tien(lines) - tien(returnLines)")
    expect(st).toContain("const prevRevenue = tien(prevLines) - tien(prevReturnLines)")
    const top = khoi(S, "topByRevenue")
    expect(top).toContain("truTra(cur, returnLines)")
    expect(top).toContain("truTra(prev, prevReturnLines)")
    expect(khoi(S, "topByQty")).toContain("if (e) e.revenue -= Number(l.line_total || 0)")
  })

  it("categories: nhóm hàng / thương hiệu trừ dòng trả, kỳ trước cũng thế", () => {
    const S = read("analytics/products/categories/page.tsx")
    const ag = khoi(S, "aggregate")
    expect(ag).toMatch(/for \(const l of retRows\)[\s\S]*?e\.revenue -= Number\(l\.line_total \|\| 0\)/)
    expect(S).toContain('aggregate(lines, returnLines, "category")')
    expect(S).toContain('aggregate(prevLines, prevReturnLines, "category")')
    expect(S).toContain('aggregate(lines, returnLines, "brand")')
    expect(S).toContain('aggregate(prevLines, prevReturnLines, "brand")')
  })
})
