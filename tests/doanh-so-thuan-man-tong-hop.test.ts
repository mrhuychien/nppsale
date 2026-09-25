import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { quaLocCuoiNgay } from "../src/lib/analytics/loc-cuoi-ngay"

/**
 * DOANH SỐ THUẦN trên các màn TỔNG HỢP: trang Báo cáo, Kênh bán, Cuối ngày, Dashboard.
 *
 * ⚠ CHỦ NHÀ 25/09/2026: "Rà soát lại toàn bộ doanh số tính bằng số đi - số trả".
 *   Doanh thu = Σ hóa đơn đã ghi sổ (theo `invoice_date`) − hàng trả trừ trong kỳ
 *   (`returns.revenue_date`, mig 192 — một luật khớp công nợ).
 *   · Trang Báo cáo: ô "Doanh thu thuần" từng là tổng hóa đơn GỘP; top NV cũng gộp.
 *   · Kênh bán: không trừ hàng trả nào.
 *   · Cuối ngày: trừ TỔNG hàng trả cả ngày vào doanh thu ĐÃ LỌC theo khách / NV.
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("trang Báo cáo (reports/page.tsx) — Doanh thu thuần thật sự thuần", () => {
  const S = code(read("src/app/(dashboard)/reports/page.tsx"))

  it("đọc phiếu trả theo luật chung, chạm trần thì báo", () => {
    expect(S).toMatch(/fetchReturnsRowsDu\(supabase, orgId,/)
    expect(S).toMatch(/setTruncated\([^)]*returnsRes\.truncated/)
  })

  it("lọc kỳ phiếu trả bằng NGÀY TRỪ theo giờ VN, cùng mốc với hóa đơn", () => {
    const i = S.indexOf("const filteredReturns")
    expect(S.slice(i, i + 250)).toContain("vnDateKey(periodWindows.start)")
    expect(S.slice(i, i + 250)).toContain("String(r.created_at).slice(0, 10) >= tu")
    const j = S.indexOf("const prevPeriodReturns")
    expect(S.slice(j, j + 300)).toContain("vnDateKey(periodWindows.prevStart)")
  })

  it("doanh thu kỳ này / kỳ trước = hóa đơn − hàng trả; AOV trên số thuần", () => {
    expect(S).toContain("const totalRevenue = sumInvoices(filteredInvoices) - sumReturns(filteredReturns)")
    expect(S).toContain("const prevRevenue = sumInvoices(prevPeriodInvoices) - sumReturns(prevPeriodReturns)")
    expect(S).toContain("const aov = completedOrders > 0 ? totalRevenue / completedOrders : 0")
    expect(S).toMatch(/label="Doanh thu thuần"\s*value=\{formatCurrency\(totalRevenue\)\}/)
    // Không kẹp từng phiếu về 0.
    expect(S).not.toMatch(/Math\.(max|abs)\([^)]*credit_note_amount/)
  })

  it("top NV: trừ hàng trả của chính NV (NV phiếu trả → NV hóa đơn gắn phiếu)", () => {
    const i = S.indexOf("const salesByUser")
    const k = S.indexOf("const topPerformers", i)
    const khoi = S.slice(i, k)
    expect(khoi).toContain("filteredInvoices.forEach")
    expect(khoi).toContain("filteredReturns.forEach")
    expect(khoi).toContain("r.sales_user_id ?? (r.invoice_id ? nvCuaHoaDon.get(r.invoice_id) : undefined) ?? \"\"")
    expect(khoi).toMatch(/\(salesByUser\.get\(uid\) \|\| 0\) - Number\(r\.credit_note_amount \|\| 0\)/)
    // Tra NV trên CẢ sổ hóa đơn (phiếu tháng này có thể gắn HĐ tháng trước).
    expect(khoi).toContain("new Map(data.invoices.map(")
  })
})

describe("Kênh bán (reports/channels) — trừ hàng trả vào kênh của khách trả", () => {
  const S = code(read("src/app/(dashboard)/reports/channels/page.tsx"))

  it("đọc phiếu trả cùng kỳ, chạm trần thì báo", () => {
    expect(S).toContain("fetchReturnsRowsDu(supabase, user.org_id, range)")
    expect(S).toMatch(/setTruncated\([^)]*returnsRes\.truncated/)
  })

  it("mỗi phiếu trả trừ vào kênh của khách, qua cùng bộ lọc khách / kênh", () => {
    const i = S.indexOf("for (const r of returns)")
    expect(i).toBeGreaterThan(S.indexOf("const rows = useMemo"))
    const khoi = S.slice(i, S.indexOf("return Array.from(m.entries())", i))
    expect(khoi).toContain("customerFilter.includes(r.customer_id)")
    expect(khoi).toContain("customerMap.get(r.customer_id)?.channel || fallback")
    expect(khoi).toContain("matchVals && !matchVals.has(ch)")
    expect(khoi).toContain("e.revenue -= Number(r.credit_note_amount || 0)")
    // Phiếu trả không phải hóa đơn.
    expect(khoi).not.toContain("e.orders")
    expect(S).toMatch(/\[invoices, returns, customerMap/)
  })
})

describe("Cuối ngày (reports/end-of-day) — hàng trả qua CÙNG bộ lọc", () => {
  const S = code(read("src/app/(dashboard)/reports/end-of-day/page.tsx"))

  it("không còn trừ tổng hàng trả cả ngày", () => {
    expect(S).not.toContain("fetchReturnsValueDu")
    expect(S).toContain("fetchReturnsRowsDu(supabase, orgId, range)")
  })

  it("phiếu trả mang khách / NV / người lập / hình thức của hóa đơn gắn phiếu", () => {
    expect(S).toContain("customer_id: r.customer_id")
    expect(S).toContain('sales_user_id: r.sales_user_id ?? hd?.sales_user_id ?? ""')
    expect(S).toContain('created_by: lapBoi.get(r.id) ?? ""')
    expect(S).toContain("payment_terms: hd?.payment_terms ?? null")
    expect(S).toContain('.select("id, requested_by", { count: "exact" })')
  })

  it("doanh thu thuần = HĐ đã lọc − hàng trả đã lọc; lãi gộp trừ giá vốn hàng trả", () => {
    expect(S).toContain("returnRows.filter(passesFilters)")
    expect(S).toContain("const returnsValue = filteredReturns.reduce((s, r) => s + r.amount, 0)")
    expect(S).toContain("const netRevenue = revenue - returnsValue")
    expect(S).toContain("const grossProfit = netRevenue - (cogs - returnsCost)")
  })

  it("luật lọc chung loại phiếu trả của khách khác / NV khác", () => {
    const KHONG = { khach: [], nhanVien: [], nguoiTao: "", hinhThuc: "" }
    const tra = { customer_id: "kA", sales_user_id: "nv1", created_by: "u1", payment_terms: null }
    expect(quaLocCuoiNgay(tra, { ...KHONG, khach: ["kB"] })).toBe(false)
    expect(quaLocCuoiNgay(tra, { ...KHONG, khach: ["kA"] })).toBe(true)
    expect(quaLocCuoiNgay(tra, { ...KHONG, nhanVien: ["nv2"] })).toBe(false)
    expect(quaLocCuoiNgay(tra, { ...KHONG, nguoiTao: "u1" })).toBe(true)
    expect(quaLocCuoiNgay(tra, { ...KHONG, nguoiTao: "u2" })).toBe(false)
  })
})

describe("Dashboard — số thuần đã tính ở SQL (mig 192), không trừ lần hai", () => {
  const S = code(read("src/app/(dashboard)/dashboard/page.tsx"))
  it("dùng ba RPC thuần, không tự đọc phiếu trả để trừ thêm", () => {
    for (const fn of ["dashboard_summary", "dashboard_top_customers", "dashboard_channel_revenue"]) {
      expect(S).toContain(`supabase.rpc("${fn}"`)
    }
    expect(S).not.toMatch(/fetchReturns|from\("returns"\)/)
  })
})
