/**
 * "TỔNG CHÊNH LỆCH" — chủ nhà 12/10/2026: "Thêm cột tổng chênh lệch = chênh lệch thuần - giảm giá đơn".
 * Một luật (`tongChenhLech`) cho Báo cáo › Nhân viên ("Hàng bán theo nhân viên") và Báo cáo tổng hợp › Theo nhân viên.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { chenhThuan, tongChenhLech } from "@/lib/analytics/chenh-lech"
import { chotTienChungTu, congHangBanNhanVien } from "@/lib/analytics/hang-ban-nhan-vien"

const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

// Bảng giá: lon 100; thùng (24 lon) giá riêng 2.300.
const SP = {
  id: "p", sku: "P", name: "Bia", base_unit: "lon", sell_price: 100, units: [{ unit_name: "thùng", conversion: 24 }],
  price_lists: [{ unit_name: "lon", price: 100, group_id: null }, { unit_name: "thùng", price: 2300, group_id: null }],
}

describe("tongChenhLech = chênh thuần − giảm giá đơn", () => {
  it("trừ đúng số tiền giảm giá cả đơn (dương); không có giảm giá thì bằng chênh thuần", () => {
    expect(tongChenhLech(80_000, 30_000)).toBe(50_000)
    expect(tongChenhLech(-750, 720)).toBe(-1_470)
    expect(tongChenhLech(1_200, 0)).toBe(1_200)
    expect(tongChenhLech(1_200, null)).toBe(1_200)
    expect(tongChenhLech(1_200, undefined)).toBe(1_200)
  })

  it("congHangBanNhanVien: bán 3 thùng × 2.400 (+300), trả 1 thùng ghi 2.200 (−100, thu hồi), giảm giá đơn 120 → thuần +200, tổng +80", () => {
    const [r] = congHangBanNhanVien({
      ban: [{ uid: "nv", line: { product_id: "p", unit_name: "thùng", conversion_factor: 24, quantity: 3, unit_price: 2400, line_total: 7200 } }],
      tra: [{ uid: "nv", line: { product_id: "p", unit_name: "thùng", quantity: 1, unit_price: 2200, line_total: 2200 } }],
      sanPham: new Map([["p", SP]]),
      giamDon: [{ uid: "nv", tien: 120 }],
    })
    expect([r.diff, r.diffReturn, r.diffNet, r.docDiscount, r.tongChenh]).toEqual([300, -100, 200, 120, 80])
    // Cùng luật ở cấp mặt hàng / đơn vị tính.
    expect([r.products[0].diffNet, r.products[0].donVi[0].diffNet]).toEqual([200, 200])
  })

  it("nhân viên không có giảm giá đơn: tổng chênh = chênh thuần; chốt tiền chứng từ giữ nguyên tổng chênh", () => {
    const rows = congHangBanNhanVien({
      ban: [{ uid: "a", line: { product_id: "p", unit_name: "lon", conversion_factor: 1, quantity: 10, unit_price: 110, line_total: 1100 } }],
      tra: [],
      sanPham: new Map([["p", SP]]),
      giamDon: [],
    })
    expect(rows[0].tongChenh).toBe(100)
    const [chot] = chotTienChungTu(rows, new Map([["a", 1210]]), new Map())
    expect(chot.tongChenh).toBe(100)
    expect(chot.revenue).toBe(1210)
  })
})

describe("chenhThuan = chênh bán + chênh trả (chủ nhà 12/10/2026: chênh trả âm là phần thu hồi)", () => {
  it("cộng, không trừ: chênh trả âm làm chênh thuần NHỎ đi", () => {
    expect(chenhThuan(300, -100)).toBe(200)
    expect(chenhThuan(-800, -50)).toBe(-850)
    expect(chenhThuan(10_000, 0)).toBe(10_000)
  })
  it("mọi chỗ dùng chung `chenhThuan` — không còn 'bán − trả'", () => {
    const lib = doc("src/lib/analytics/hang-ban-nhan-vien.ts")
    expect(lib).toContain("r.diffNet = chenhThuan(r.diff, r.diffReturn)")
    expect(lib).toContain("p.diffNet = chenhThuan(p.diff, p.diffReturn)")
    expect(lib).toContain("diffNet: chenhThuan(d.diff, d.diffReturn),")
    expect(lib).not.toMatch(/diff - \w*\.?diffReturn/)
    const bc = doc("src/components/bao-cao/man-ban-hang.tsx")
    expect(bc).toContain('{ k: "diffNet", label: "Chênh lệch thuần", f: "money", v: (x) => chenhThuan((x.revTT || 0) - (x.listed || 0), (x.retTT || 0) - (x.rlisted || 0)) },')
    expect(doc("CLAUDE.md")).toContain("**Chênh thuần = chênh bán + chênh trả**")
  })
})

describe("màn hình: cột Tổng chênh lệch", () => {
  it("Hàng bán theo nhân viên: cột sau Chênh lệch thuần, dòng tổng, tệp Excel", () => {
    const s = doc("src/app/(dashboard)/reports/employees/page.tsx")
    expect(s).toMatch(/key: "diffNet",[\s\S]*?key: "tongChenh",\s+label: "Tổng chênh lệch",\s+align: "right",\s+render: \(r\) => <span className="font-semibold">\{hienChenh\(r\.tongChenh\)\}<\/span>,/)
    expect(s).toContain("{ content: hienChenh(employeeSummaryRows.reduce((s, r) => s + r.tongChenh, 0)), align: \"right\" },")
    expect(s).toMatch(/"Chênh lệch thuần",\s+"Tổng chênh lệch",\s+\],/)
    expect(s).toMatch(/Math\.round\(r\.diffNet\),\s+Math\.round\(r\.tongChenh\),\s+\]\)/)
  })

  it("Báo cáo tổng hợp › Theo nhân viên: cùng luật tongChenhLech, trừ giảm giá đơn", () => {
    const s = doc("src/components/bao-cao/man-ban-hang.tsx")
    expect(s).toContain('{ k: "tongChenh", label: "Tổng chênh lệch", f: "money", v: (x) => tongChenhLech(chenhThuan((x.revTT || 0) - (x.listed || 0), (x.retTT || 0) - (x.rlisted || 0)), x.giamDon) },')
    expect(s.indexOf('k: "diffNet"')).toBeLessThan(s.indexOf('k: "tongChenh"'))
  })
})
