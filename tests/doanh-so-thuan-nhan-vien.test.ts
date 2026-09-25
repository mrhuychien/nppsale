import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  congLoiNhuanNhanVien,
  congLoiNhuanTheoNgay,
  giaVonTraCuaPhieu,
  nhanVienPhieuTra,
} from "@/lib/analytics/hang-ban-nhan-vien"

/**
 * DOANH SỐ THUẦN ở báo cáo Bán hàng (Lợi nhuận, Nhân viên) và báo cáo Nhân viên
 * (Lợi nhuận, Theo sản phẩm, Theo khách hàng).
 *
 * ⚠ CHỦ NHÀ 25/09/2026 (mig 192): "Rà soát lại toàn bộ doanh số tính bằng số đi -
 *   số trả". Doanh thu = hóa đơn đã ghi sổ − hàng trả trừ trong kỳ; lãi gộp = doanh
 *   thu thuần − (giá vốn xuất − giá vốn hàng trả đã nhập lại kho). Bản cũ của các
 *   tab này lấy nguyên tiền hóa đơn − giá vốn xuất: lãi / hoa hồng phồng đúng bằng
 *   số hàng khách trả.
 */
const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
const SALES = code(read("src/app/(dashboard)/reports/sales/page.tsx"))
const NV = code(read("src/app/(dashboard)/reports/employees/page.tsx"))

/** Thân một `useMemo` gán cho `ten` — tới `}, [` đầu tiên sau nó. */
const memo = (src: string, ten: string) => {
  const i = src.indexOf(`const ${ten}`)
  expect(i, `không còn ${ten}`).toBeGreaterThan(-1)
  return src.slice(i, src.indexOf("}, [", i))
}

describe("nhanVienPhieuTra — một luật quy phiếu trả về nhân viên", () => {
  const hoaDon = [
    { id: "hd1", customer_id: "k1", sales_user_id: "an", invoice_date: "2026-09-01" },
    { id: "hd2", customer_id: "k1", sales_user_id: "binh", invoice_date: "2026-09-20" },
  ]
  it("tên trên phiếu → NV hóa đơn gắn → NV hóa đơn gần nhất của khách", () => {
    const m = nhanVienPhieuTra(
      [
        { id: "r1", customer_id: "k1", sales_user_id: "chi", invoice_id: "hd1" },
        { id: "r2", customer_id: "k1", sales_user_id: null, invoice_id: "hd1" },
        { id: "r3", customer_id: "k1", sales_user_id: null, invoice_id: null },
        { id: "r4", customer_id: "k9", sales_user_id: null, invoice_id: null },
      ],
      hoaDon
    )
    expect(m.get("r1")).toBe("chi")
    // Gắn HĐ của An — không được đoán sang Bình (HĐ gần nhất của khách).
    expect(m.get("r2")).toBe("an")
    expect(m.get("r3")).toBe("binh")
    expect(m.has("r4")).toBe(false)
  })
})

describe("congLoiNhuanNhanVien — doanh thu thuần + giá vốn thuần", () => {
  const base = {
    hoaDon: [
      { id: "hd1", sales_user_id: "an", total: 1_000_000 },
      { id: "hd2", sales_user_id: "an", total: 500_000 },
    ],
    giaVonHoaDon: (id: string) => (id === "hd1" ? 600_000 : 300_000),
    phieuTra: [
      { id: "r1", credit_note_amount: 200_000 },
      { id: "r2", credit_note_amount: 50_000 },
    ],
    nvPhieuTra: new Map([["r1", "an"]]),
    giaVonTra: new Map([
      ["r1", { total: 120_000, byProduct: new Map([["sp1", 100_000], ["sp2", 20_000]]) }],
      ["r2", { total: 30_000, byProduct: new Map([["sp1", 30_000]]) }],
    ]),
  }
  it("trừ hàng trả khỏi doanh thu và giá vốn hàng trả khỏi giá vốn", () => {
    const an = congLoiNhuanNhanVien(base).find((r) => r.id === "an")!
    expect(an.orders).toBe(2)
    expect(an.grossRevenue).toBe(1_500_000)
    expect(an.revenue).toBe(1_300_000)
    expect(an.grossCogs).toBe(900_000)
    expect(an.cogs).toBe(780_000)
    // 1.300.000 − 780.000; bản cũ: 1.500.000 − 900.000 = 600.000.
    expect(an.profit).toBe(520_000)
  })
  it("phiếu không quy được về ai gom vào khoá rỗng — không rơi khỏi tổng", () => {
    const rows = congLoiNhuanNhanVien(base)
    const chuaGan = rows.find((r) => r.id === "")!
    expect(chuaGan.revenue).toBe(-50_000)
    expect(chuaGan.cogs).toBe(-30_000)
    expect(rows.reduce((s, r) => s + r.revenue, 0)).toBe(1_500_000 - 250_000)
  })
  it("lọc mặt hàng: giá vốn hàng trả chỉ tính mặt hàng qua lọc (như dòng hóa đơn)", () => {
    const an = congLoiNhuanNhanVien({ ...base, matHangQua: (p) => p === "sp2" }).find((r) => r.id === "an")!
    expect(an.returnCost).toBe(20_000)
    expect(giaVonTraCuaPhieu(undefined)).toBe(0)
  })
})

describe("congLoiNhuanTheoNgay — lãi gộp thuần theo ngày", () => {
  it("ngày có hàng trả: doanh thu, giá vốn, biên đều tính trên số thuần", () => {
    const rows = congLoiNhuanTheoNgay({
      hoaDon: [
        { invoice_date: "2026-09-10", total: 1_000_000 },
        { invoice_date: "2026-09-11", total: 400_000 },
      ],
      phieuTra: [{ created_at: "2026-09-10", credit_note_amount: 200_000 }],
      giaVonXuat: [
        { ngay: "2026-09-10", giaVon: 700_000 },
        { ngay: "2026-09-11", giaVon: 300_000 },
      ],
      giaVonTra: [{ ngay: "2026-09-10", giaVon: 140_000 }],
    })
    expect(rows.map((r) => r.date)).toEqual(["2026-09-10", "2026-09-11"])
    const d10 = rows[0]
    expect(d10.label).toBe("10/09/2026")
    expect(d10.revenue).toBe(800_000)
    expect(d10.cogs).toBe(560_000)
    expect(d10.profit).toBe(240_000)
    expect(d10.margin).toBeCloseTo(30, 6)
    expect(rows[1].profit).toBe(100_000)
  })
  it("ngày CHỈ có hàng trả vẫn hiện, doanh thu âm", () => {
    const [r] = congLoiNhuanTheoNgay({
      hoaDon: [],
      phieuTra: [{ created_at: "2026-09-12", credit_note_amount: 90_000 }],
      giaVonXuat: [],
      giaVonTra: [{ ngay: "2026-09-12", giaVon: 60_000 }],
    })
    expect(r.revenue).toBe(-90_000)
    expect(r.cogs).toBe(-60_000)
    expect(r.profit).toBe(-30_000)
  })
})

describe("reports/sales — tab Lợi nhuận / Nhân viên dùng số thuần", () => {
  it("đọc giá vốn hàng trả (hỏng thì ném, không nuốt)", () => {
    const i = SALES.indexOf("const load = useCallback")
    const than = SALES.slice(i, SALES.indexOf("}, [", i))
    expect(than).toContain("fetchReturnCosts(supabase, returnsRes.rows.map((r) => r.id))")
    expect(than).toContain("setLoadError(errorMessage(err))")
  })
  it("Lợi nhuận: hóa đơn − hàng trả, giá vốn xuất − giá vốn hàng trả", () => {
    const f = memo(SALES, "profitRows")
    expect(f).toContain("congLoiNhuanTheoNgay({ hoaDon: filteredInvoices, phieuTra: filteredReturns, giaVonXuat, giaVonTra })")
    expect(f).toContain("returnCosts.get(r.id)")
  })
  it("Nhân viên: doanh thu / giá vốn / TB-HĐ thuần, phiếu chưa gán không rơi", () => {
    const f = memo(SALES, "employeeRows")
    expect(f).toContain("congLoiNhuanNhanVien({")
    expect(f).toContain("phieuTra: filteredReturns")
    expect(f).toContain("giaVonTra: returnCosts")
    expect(f).toContain("aov: r.orders > 0 ? r.revenue / r.orders : 0")
    expect(f).toContain("Chưa gán nhân viên")
    expect(SALES).toContain("nhanVienPhieuTra(returns, invoices)")
  })
  it("Thời gian vẫn thuần, và phiếu trả qua cùng bộ lọc khách với hóa đơn", () => {
    const f = memo(SALES, "timeBuckets")
    expect(f).toContain("for (const r of filteredReturns)")
    expect(f).toContain("netRevenue: b.revenue - b.returnValue")
    expect(memo(SALES, "filteredReturns")).toContain("customerPasses(r.customer_id)")
  })
})

describe("reports/employees — Lợi nhuận / Theo sản phẩm / Theo khách hàng dùng số thuần", () => {
  it("đọc giá vốn hàng trả cùng lượt với ba bảng dòng", () => {
    expect(NV).toContain("fetchReturnCosts(supabase, returnIds)")
    expect(NV).toContain("setReturnCosts(returnCostMap)")
  })
  it("Lợi nhuận: congLoiNhuanNhanVien với phiếu trả đã quy NV + giá vốn hàng trả", () => {
    const f = memo(NV, "profitRows: ProfitRow[]")
    expect(f).toContain("congLoiNhuanNhanVien({")
    expect(f).toContain("giaVonTra: returnCosts")
    expect(f).toContain("matHangQua: productPasses")
    expect(f).toContain("returnsTheoNv")
  })
  it("Theo sản phẩm: NV trừ tiền phiếu, mặt hàng / khách trừ tiền dòng trả", () => {
    const f = memo(NV, "employeeProductRows")
    expect(f).toContain("dongNv(uid).revenue -= Number(r.credit_note_amount || 0)")
    expect(f).toContain("for (const { uid, customerId, line } of returnLinesTheoNv)")
    expect((f.match(/revenue -= Number\(line\.line_total \|\| 0\)/g) || []).length).toBe(2)
  })
  it("Theo khách hàng: NV + khách trừ tiền phiếu, mặt hàng của khách trừ tiền dòng", () => {
    const f = memo(NV, "employeeCustomerRows")
    expect(f).toContain("e.revenue -= amt")
    expect(f).toContain("dongKhach(e, r.customer_id).revenue -= amt")
    expect(f).toContain("pr.revenue -= Number(line.line_total || 0)")
  })
  it("dòng trả qua CÙNG bộ lọc người bán / khách / mặt hàng với dòng bán", () => {
    const f = memo(NV, "returnLinesTheoNv")
    for (const s of ["matchSearchUser(uid)", "customerPasses(r.customer_id)", "productPasses(rl.product_id)"]) {
      expect(f).toContain(s)
    }
  })
})
