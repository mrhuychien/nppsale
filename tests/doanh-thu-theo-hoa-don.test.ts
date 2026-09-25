import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  fetchRevenueInvoicesDu,
  giamGiaHoaDon,
  REVENUE_INVOICE_STATUS,
} from "../src/lib/analytics/sales"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "làm tiếp phần doanh thu tính theo hoá đơn".
 *   Doanh thu = Σ `sales_invoices.total` của hóa đơn `status = 'posted'`,
 *   theo `invoice_date` — như `dashboard_summary` (mig 126). Không cộng
 *   `sales_orders.total` của đơn "Hoàn thành". Đơn chỉ còn cho số liệu
 *   HOẠT ĐỘNG (đơn đã đặt, nháp…).
 */

const read = (p: string) => readFileSync(p, "utf8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

function moiTep(dir: string, acc: string[] = []): string[] {
  for (const ten of readdirSync(dir)) {
    const p = join(dir, ten)
    if (statSync(p).isDirectory()) moiTep(p, acc)
    else if (ten.endsWith(".ts") || ten.endsWith(".tsx")) acc.push(p)
  }
  return acc
}

/** Từng câu truy vấn: từ `.from("x")` tới `.from(` kế tiếp (tối đa 700 ký tự). */
function cauTruyVan(src: string, bang: string): string[] {
  const out: string[] = []
  const mo = `.from("${bang}")`
  let i = src.indexOf(mo)
  while (i !== -1) {
    const ke = src.indexOf(".from(", i + mo.length)
    out.push(src.slice(i, ke === -1 ? i + 700 : Math.min(ke, i + 700)))
    i = src.indexOf(mo, i + mo.length)
  }
  return out
}

/** Đọc đơn "Hoàn thành" / đã giao để lấy TIỀN — hình dạng cũ của doanh thu. */
const donLamDoanhThu = (src: string) =>
  cauTruyVan(src, "sales_orders").filter((q) => /"completed"|"delivered"/.test(q) && /\btotal\b/.test(q))

const SALES = "src/lib/analytics/sales.ts"
const REPORTS_INDEX = "src/app/(dashboard)/reports/page.tsx"
const HOME = "src/app/(dashboard)/home/page.tsx"

/** Màn báo cáo gọi bản `…Du` (có cờ chạm trần). */
const BAO_CAO = [
  "src/app/(dashboard)/reports/customers/page.tsx",
  "src/app/(dashboard)/reports/sales/page.tsx",
  "src/app/(dashboard)/reports/employees/page.tsx",
  "src/app/(dashboard)/reports/finance/page.tsx",
  "src/app/(dashboard)/reports/channels/page.tsx",
  "src/app/(dashboard)/reports/products/page.tsx",
  "src/app/(dashboard)/reports/end-of-day/page.tsx",
]
/** Màn phân tích gọi bản thường. */
const PHAN_TICH = [
  "src/app/(dashboard)/analytics/business/overview/page.tsx",
  "src/app/(dashboard)/analytics/business/cost-profit/page.tsx",
  "src/app/(dashboard)/analytics/customers/overview/page.tsx",
  "src/app/(dashboard)/analytics/customers/categories/page.tsx",
  "src/app/(dashboard)/analytics/products/overview/page.tsx",
  "src/app/(dashboard)/analytics/products/categories/page.tsx",
]
/** Màn cần doanh thu theo MẶT HÀNG — phải đọc dòng hóa đơn. */
const THEO_DONG = [
  "src/app/(dashboard)/reports/customers/page.tsx",
  "src/app/(dashboard)/reports/sales/page.tsx",
  "src/app/(dashboard)/reports/employees/page.tsx",
  "src/app/(dashboard)/reports/products/page.tsx",
  "src/app/(dashboard)/analytics/business/overview/page.tsx",
  "src/app/(dashboard)/analytics/products/overview/page.tsx",
  "src/app/(dashboard)/analytics/products/categories/page.tsx",
]

describe("lib/analytics/sales: doanh thu đọc hóa đơn đã ghi sổ", () => {
  const S = code(read(SALES))
  const than = (ten: string) => {
    const i = S.indexOf(`export async function ${ten}(`)
    expect(i, `không còn ${ten}`).toBeGreaterThan(-1)
    return S.slice(i, S.indexOf("\n}\n", i))
  }

  it("fetchRevenueInvoicesDu: sales_invoices, status posted, theo invoice_date", () => {
    const f = than("fetchRevenueInvoicesDu")
    expect(f).toContain('.from("sales_invoices")')
    expect(f).toContain(".eq(\"status\", REVENUE_INVOICE_STATUS)")
    expect(REVENUE_INVOICE_STATUS).toBe("posted")
    expect(f).toMatch(/\.gte\("invoice_date", range\.from\)/)
    expect(f).toMatch(/\.lte\("invoice_date", range\.to\)/)
    expect(f).toMatch(/\.order\("id"\)\s*\.range\(/)
  })

  it("fetchInvoiceLines: dòng hóa đơn, chia lô theo invoice_id", () => {
    const f = than("fetchInvoiceLines")
    expect(f).toContain('.from("sales_invoice_lines")')
    expect(f).toContain('.in("invoice_id", lo)')
  })

  it("không còn hàm đọc đơn 'Hoàn thành' làm doanh thu", () => {
    expect(S).not.toMatch(/export async function fetchDeliveredOrders/)
    expect(S).not.toContain('.eq("status", "completed")')
    expect(donLamDoanhThu(S)).toEqual([])
  })

  it("chạy thật: chỉ lấy hóa đơn posted trong kỳ, mốc là chuỗi ngày", async () => {
    const hd = [
      { id: "a", org_id: "o", status: "posted", invoice_date: "2026-09-01", total: 100, sales_user_id: "u" },
      { id: "b", org_id: "o", status: "cancelled", invoice_date: "2026-09-02", total: 999, sales_user_id: "u" },
      { id: "c", org_id: "o", status: "posted", invoice_date: "2026-08-31", total: 999, sales_user_id: "u" },
      { id: "d", org_id: "o", status: "posted", invoice_date: "2026-09-30", total: 50, sales_user_id: null },
    ]
    const seen: Record<string, unknown> = {}
    const client = {
      from(bang: string) {
        seen.bang = bang
        const loc: Array<(r: Record<string, unknown>) => boolean> = []
        const q = {
          select: () => q,
          eq: (c: string, v: unknown) => { seen[`eq:${c}`] = v; loc.push((r) => r[c] === v); return q },
          gte: (c: string, v: string) => { seen[`gte:${c}`] = v; loc.push((r) => String(r[c]) >= v); return q },
          lte: (c: string, v: string) => { loc.push((r) => String(r[c]) <= v); return q },
          order: () => q,
          range: () => {
            const rows = hd.filter((r) => loc.every((f) => f(r)))
            return { then: (res: (x: unknown) => unknown) => res({ data: rows, error: null, count: rows.length }) }
          },
        }
        return q
      },
    }
    const r = await fetchRevenueInvoicesDu(client as never, "o", { from: "2026-09-01", to: "2026-09-30" })
    expect(seen.bang).toBe("sales_invoices")
    expect(seen["eq:status"]).toBe("posted")
    expect(seen["gte:invoice_date"]).toBe("2026-09-01")
    expect(r.rows.map((x) => x.id).sort()).toEqual(["a", "d"])
    expect(r.rows.reduce((s, x) => s + x.total, 0)).toBe(150)
  })

  it("giảm giá cả đơn trên hóa đơn = Σ dòng − subtotal (mig 183)", () => {
    expect(giamGiaHoaDon({ subtotal: 900 }, [{ line_total: 600 }, { line_total: 400 }])).toBe(100)
    expect(giamGiaHoaDon({ subtotal: 1000 }, [{ line_total: 1000.4 }])).toBe(0)
    expect(giamGiaHoaDon({ subtotal: 1000 }, [])).toBe(0)
  })
})

describe("màn báo cáo / phân tích: doanh thu từ hóa đơn, không từ đơn", () => {
  it.each(BAO_CAO)("%s đọc fetchRevenueInvoicesDu, không đọc đơn làm doanh thu", (f) => {
    const s = code(read(f))
    expect(s).toContain("fetchRevenueInvoicesDu(")
    expect(s).not.toMatch(/\bfetchDeliveredOrders/)
    expect(donLamDoanhThu(s)).toEqual([])
  })

  it.each(PHAN_TICH)("%s đọc fetchRevenueInvoices, không đọc đơn làm doanh thu", (f) => {
    const s = code(read(f))
    expect(s).toMatch(/\bfetchRevenueInvoices\(/)
    expect(s).not.toMatch(/\bfetchDeliveredOrders/)
    expect(donLamDoanhThu(s)).toEqual([])
  })

  it.each(THEO_DONG)("%s: doanh thu theo mặt hàng từ dòng hóa đơn", (f) => {
    const s = code(read(f))
    expect(s).toContain("fetchInvoiceLines(")
    expect(s).not.toContain("fetchOrderLines(")
    expect(s).not.toMatch(/\bl\.order_id\b/)
  })

  it("báo cáo cuối ngày: 'Đơn tạo trong ngày' vẫn đếm đơn (hoạt động), doanh thu từ hóa đơn", () => {
    const s = code(read("src/app/(dashboard)/reports/end-of-day/page.tsx"))
    expect(s).toContain("fetchAllOrdersDu(")
    expect(s).toMatch(/const revenue = filteredDelivered\.reduce/)
    expect(s).toMatch(/useState<RevenueInvoiceRow\[\]>\(\[\]\)/)
  })

  it("báo cáo tài chính: không trừ giảm giá hai lần (total đã sau giảm)", () => {
    const s = code(read("src/app/(dashboard)/reports/finance/page.tsx"))
    expect(s).toContain("totalRevenue += Number(o.total || 0) + giam")
    expect(s).not.toContain("o.discount")
  })

  it("mọi màn trong reports/** và analytics/** không cộng tiền đơn 'Hoàn thành'", () => {
    const bad: string[] = []
    for (const goc of ["src/app/(dashboard)/reports", "src/app/(dashboard)/analytics"]) {
      for (const p of moiTep(goc)) {
        const s = code(read(p))
        if (donLamDoanhThu(s).length) bad.push(p)
        if (/fetchDeliveredOrders/.test(s)) bad.push(`${p}: fetchDeliveredOrders`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe("trang Báo cáo (reports/page.tsx)", () => {
  const S = code(read(REPORTS_INDEX))

  it("doanh thu đọc sales_invoices posted, theo invoice_date, phân trang có mốc id", () => {
    const q = cauTruyVan(S, "sales_invoices")
    expect(q).toHaveLength(1)
    expect(q[0]).toContain(".eq(\"status\", REVENUE_INVOICE_STATUS)")
    expect(q[0]).toContain("invoice_date")
    expect(q[0]).toMatch(/\.order\("id"\)\s*\.range\(/)
  })

  it("đơn chỉ còn để ĐẾM — không đọc `total`, không cộng tiền đơn completed", () => {
    for (const q of cauTruyVan(S, "sales_orders")) expect(q).not.toMatch(/\btotal\b/)
    expect(S).not.toMatch(/status === "completed"/)
    /* Chủ nhà 25/09/2026: "Rà soát lại toàn bộ doanh số tính bằng số đi - số trả"
       — "Doanh thu thuần" = hóa đơn − hàng trả (xem tests/doanh-so-thuan-man-tong-hop.test.ts). */
    expect(S).toMatch(/const totalRevenue = sumInvoices\(filteredInvoices\) - sumReturns\(filteredReturns\)/)
    expect(S).toMatch(/const prevRevenue = sumInvoices\(prevPeriodInvoices\) - sumReturns\(prevPeriodReturns\)/)
  })

  it("doanh số theo nhân viên cộng hóa đơn", () => {
    const i = S.indexOf("const salesByUser")
    expect(S.slice(i, i + 400)).toContain("filteredInvoices.forEach")
  })

  it("so kỳ bằng ngày giờ VN (vnDateKey), không mốc ISO", () => {
    expect(S).toContain("vnDateKey(periodWindows.start)")
    expect(S).toContain("vnDateKey(periodWindows.prevStart)")
  })
})

describe("Trang chủ NVBH: ô 'Đơn hôm nay' là số liệu HOẠT ĐỘNG", () => {
  /* Ô ấy đếm đơn NVBH đã đặt hôm nay (kèm giá trị đặt), không mang nhãn
     doanh thu — nên được phép ở lại trên `sales_orders`. Chốt này để ai
     thêm nhãn "Doanh thu/Doanh số" vào đó phải chuyển sang hóa đơn. */
  it("không có nhãn doanh thu/doanh số nào đọc từ đơn", () => {
    const s = code(read(HOME))
    if (/Doanh (thu|số)/i.test(s)) expect(s).toContain('.from("sales_invoices")')
    expect(s).toContain(">Đơn hôm nay<")
  })
})
