import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { giaTriVonDongKho, slCoSoDong, slCoSoDongKho } from "../src/lib/analytics/quy-doi-dong"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Rà soát các lỗi sai tương tự trong các báo cáo" — số
 *   lượng theo đơn vị dòng (thùng/khay) nhân giá / giá vốn đơn vị cơ sở, và
 *   cộng số lượng lẫn đơn vị rồi dán nhãn đơn vị cơ sở.
 *   "Doanh số tính theo Hoá đơn. Báo cáo Đặt hàng mới tính theo Đơn hàng."
 */

const read = (p: string) => readFileSync(p, "utf8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const D = "src/app/(dashboard)"

const THUNG = { base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 12 }] }

describe("hàm quy đổi dòng", () => {
  it("dòng có số chụp: 3 thùng × 12 = 36 hộp, ưu tiên số chụp hơn danh mục", () => {
    expect(slCoSoDong({ quantity: 3, unit_name: "thùng", conversion_factor: 12 })).toBe(36)
    expect(slCoSoDong({ quantity: 3, unit_name: "thùng", conversion_factor: 10 }, THUNG)).toBe(30)
  })

  it("dòng không có số chụp (đơn mua): tra danh mục", () => {
    expect(slCoSoDong({ quantity: 2, unit_name: "thùng" }, THUNG)).toBe(24)
    expect(slCoSoDong({ quantity: 5, unit_name: "hộp" }, THUNG)).toBe(5)
  })

  it("3 thùng + 5 hộp là 41 hộp, không phải 8", () => {
    const dong = [
      { quantity: 3, unit_name: "thùng", conversion_factor: 12 },
      { quantity: 5, unit_name: "hộp", conversion_factor: 1 },
    ]
    expect(dong.reduce((s, l) => s + slCoSoDong(l, THUNG), 0)).toBe(41)
  })

  it("dòng phiếu kho: lấy qty_in_base_uom, giá trị = SL cơ sở × giá vốn cơ sở", () => {
    // Phiếu xuất mig 120: quantity = 2 (thùng), qty_in_base_uom = 24 (hộp).
    const l = { quantity: 2, qty_in_base_uom: 24, unit_cost: 1000 }
    expect(slCoSoDongKho(l)).toBe(24)
    expect(giaTriVonDongKho(l)).toBe(24000)
    expect(slCoSoDongKho({ quantity: -7, qty_in_base_uom: -7 })).toBe(7)
    expect(slCoSoDongKho({ quantity: 4, qty_in_base_uom: null })).toBe(4)
  })
})

describe("báo cáo đặt hàng: theo ĐƠN, số lượng quy về đơn vị cơ sở", () => {
  const S = code(read(`${D}/reports/orders/page.tsx`))
  it("đọc sales_orders / sales_order_lines, không đọc hóa đơn", () => {
    expect(S).toContain("fetchAllOrdersDu(")
    expect(S).toContain('.from("sales_order_lines")')
    expect(S).not.toMatch(/sales_invoices|fetchRevenueInvoices|fetchInvoiceLines/)
  })
  it("đọc conversion_factor + danh mục đơn vị, cộng bằng slCoSoDong", () => {
    expect(S).toMatch(/\.select\("[^"]*conversion_factor[^"]*"/)
    expect(S).toContain("units:product_units(unit_name, conversion)")
    expect(S).not.toMatch(/\+=\s*Number\(l\.quantity/)
    expect(S).not.toMatch(/\+\s*Number\(l\.quantity/)
    expect(S).toMatch(/slCoSoDong\(l, p\)/)
    // Tổng SL một đơn nay giữ theo đơn vị cơ sở (sl-theo-don-vi) — vẫn quy đổi từng dòng.
    expect(S).toMatch(/congSL\(q, p\?\.base_unit, slCoSoDong\(l, p\)\)/)
  })
})

describe("báo cáo tồn kho", () => {
  const S = code(read(`${D}/reports/inventory/page.tsx`))
  it("giá trị tồn = tồn lô × giá vốn lô, không còn giá bịa 50.000", () => {
    expect(S).not.toMatch(/\*\s*50000/)
    expect(S).toMatch(/qty_on_hand[^\n]*\*\s*Number\(b\.unit_cost/)
    expect(S).toMatch(/qty_on_hand, unit_cost/)
  })
  it("SL bán (bán chậm) quy về đơn vị cơ sở", () => {
    expect(S).toMatch(/"id, product_id, unit_name, conversion_factor, quantity, don:sales_orders!inner/)
    expect(S).toContain("slCoSoDong(l)")
    expect(S).not.toMatch(/\+\s*l\.quantity\b/)
  })
})

describe("báo cáo nhà cung cấp", () => {
  const S = code(read(`${D}/reports/suppliers/page.tsx`))
  it("dòng phiếu nhập: SL cơ sở × giá vốn cơ sở", () => {
    expect(S).toContain('"entry_id, product_id, quantity, qty_in_base_uom, unit_cost"')
    expect(S).toContain("giaTriVonDongKho(l)")
    expect(S).not.toMatch(/Number\(l\.quantity[^)]*\)\)?\s*\*\s*Number\(l\.unit_cost/)
    expect(S).not.toMatch(/\bq\s*\*\s*Number\(l\.unit_cost/)
  })
  it("dòng đơn mua (dự phòng) quy theo unit_name của dòng", () => {
    expect(S).toContain('"po_id, product_id, unit_name, quantity, line_total, received_qty"')
    expect(S).toMatch(/slCoSoDong\(\{ quantity: l\.received_qty \|\| l\.quantity \|\| 0, unit_name: l\.unit_name \}, p\)/)
  })
})

describe("Phân tích: SL bán theo HÓA ĐƠN, quy về đơn vị cơ sở", () => {
  it.each([
    "analytics/business/overview/page.tsx",
    "analytics/products/overview/page.tsx",
    "analytics/products/categories/page.tsx",
  ])("%s", (f) => {
    const S = code(read(`${D}/${f}`))
    expect(S).toContain("fetchInvoiceLines(")
    expect(S).not.toMatch(/sales_order_lines|fetchOrderLines/)
    expect(S).not.toMatch(/Number\(l\.quantity/)
    expect(S).toContain("slCoSoDong(l)")
  })
})

describe("doanh thu các màn còn lại vẫn theo hóa đơn", () => {
  it.each([
    "reports/finance/page.tsx",
    "reports/end-of-day/page.tsx",
    "reports/channels/page.tsx",
    "analytics/business/cost-profit/page.tsx",
    "analytics/customers/overview/page.tsx",
    "analytics/customers/categories/page.tsx",
  ])("%s", (f) => {
    const S = code(read(`${D}/${f}`))
    expect(S).toMatch(/fetchRevenueInvoices(Du)?\(/)
  })
})
