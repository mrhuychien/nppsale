/**
 * "TỔNG CHÊNH LỆCH" — chủ nhà 12/10/2026: "Thêm cột tổng chênh lệch = chênh lệch thuần - giảm giá đơn".
 * Một luật (`tongChenhLech`) cho Báo cáo › Nhân viên ("Hàng bán theo nhân viên") và Báo cáo tổng hợp › Theo nhân viên.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { chenhDong, chenhThuan, chenhTra, chenhTraDong, tongChenhLech } from "@/lib/analytics/chenh-lech"
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

  it("congHangBanNhanVien: bán 3 thùng × 2.400 (+300), khách trả 1 thùng ĐÚNG GIÁ 2.400 (−100, thu hồi), giảm giá đơn 120 → net +200, tổng +80", () => {
    /* Chủ nhà 03/11/2026: "phần chênh lệch trả tính sai: phải là giá trị âm". Bản 12/10/2026 thử bằng phiếu trả 2.200 (DƯỚI
       bảng giá) để ra −100 — trả đúng giá bán (trường hợp thật) thì ra +100 và chênh net đội lên 400. */
    const [r] = congHangBanNhanVien({
      ban: [{ uid: "nv", line: { product_id: "p", unit_name: "thùng", conversion_factor: 24, quantity: 3, unit_price: 2400, line_total: 7200 } }],
      tra: [{ uid: "nv", line: { product_id: "p", unit_name: "thùng", quantity: 1, unit_price: 2400, line_total: 2400 } }],
      sanPham: new Map([["p", SP]]),
      giamDon: [{ uid: "nv", tien: 120 }],
    })
    expect([r.diff, r.diffReturn, r.diffNet, r.docDiscount, r.tongChenh]).toEqual([300, -100, 200, 120, 80])
    // Cùng luật ở cấp mặt hàng / đơn vị tính; chênh net = chênh của SL thực bán: 2 × (2.400 − 2.300).
    expect([r.products[0].diffReturn, r.products[0].donVi[0].diffReturn]).toEqual([-100, -100])
    expect([r.products[0].diffNet, r.products[0].donVi[0].diffNet]).toEqual([200, 200])
    // Tiền / giá bảng của hàng trả vẫn là số dương (màn tự hiện dấu trừ).
    expect([r.returnValue, r.returnListed]).toEqual([2400, 2300])
  })

  it("bán DƯỚI bảng giá rồi khách trả cùng giá: chênh trả DƯƠNG (trả lại phần NV đã chịu), net = chênh của SL thực bán", () => {
    const [r] = congHangBanNhanVien({
      ban: [{ uid: "nv", line: { product_id: "p", unit_name: "thùng", conversion_factor: 24, quantity: 3, unit_price: 2200, line_total: 6600 } }],
      tra: [{ uid: "nv", line: { product_id: "p", unit_name: "thùng", quantity: 1, unit_price: 2200, line_total: 2200 } }],
      sanPham: new Map([["p", SP]]),
      giamDon: [],
    })
    expect([r.diff, r.diffReturn, r.diffNet]).toEqual([-300, 100, -200])
    expect(r.diffNet).toBe(2 * (2200 - 2300))
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
    expect(bc).toContain('{ k: "diffNet", label: "Chênh lệch thuần", f: "money", v: (x) => chenhThuan((x.revTT || 0) - (x.listed || 0), chenhTra(x.retTT || 0, x.rlisted || 0)) },')
    expect(doc("CLAUDE.md")).toContain("**Chênh thuần = chênh bán + chênh trả**")
  })
})

describe("chênh trả: hàng trả tính ÂM (chủ nhà 03/11/2026: 'phần chênh lệch trả tính sai: phải là giá trị âm')", () => {
  it("chenhTra = giá bảng hàng trả − tiền trả theo giá phiếu: trả đúng giá đã bán trên bảng giá → âm", () => {
    expect(chenhTra(2400, 2300)).toBe(-100)
    expect(chenhTra(2200, 2300)).toBe(100)
    // Bằng nhau ra 0 thật (không "-0" — formatCurrency(-0) hiện "-0").
    expect(Object.is(chenhTra(2300, 2300), 0)).toBe(true)
  })
  it("chenhTraDong = chenhDong của dòng với dấu ngược lại; tiền / giá bảng giữ dương", () => {
    const dong = { unit_name: "thùng", quantity: 2, unit_price: 2400, line_total: 5280 }
    const ban = chenhDong(dong, SP)
    expect(ban).toEqual({ tien: 4800, niemYet: 4600, chenh: 200 })
    expect(chenhTraDong(dong, SP)).toEqual({ tien: 4800, niemYet: 4600, chenh: -200 })
  })
  it("hai báo cáo cùng một luật: lib dùng chenhTraDong cho dòng trả, Báo cáo tổng hợp dùng chenhTra", () => {
    const lib = doc("src/lib/analytics/hang-ban-nhan-vien.ts")
    expect(lib).toContain("const c = chenhTraDong(line, sp)")
    const bc = doc("src/components/bao-cao/man-ban-hang.tsx")
    expect(bc).toContain('{ k: "diffTra", label: "Chênh lệch trả", f: "money", v: (x) => chenhTra(x.retTT || 0, x.rlisted || 0) },')
    expect(bc).not.toContain("(x.retTT || 0) - (x.rlisted || 0)")
  })
})

describe("màn hình: cột Tổng chênh lệch", () => {
  it("Hàng bán theo nhân viên: cột sau Chênh lệch net (chủ nhà 03/11/2026 đổi tên từ 'thuần'), dòng tổng, tệp Excel", () => {
    const s = doc("src/app/(dashboard)/reports/employees/page.tsx")
    expect(s).toMatch(/key: "diffNet",[\s\S]*?key: "tongChenh",\s+label: "Tổng chênh lệch",\s+align: "right",\s+render: \(r\) => <span className="font-semibold">\{hienChenh\(r\.tongChenh\)\}<\/span>,/)
    expect(s).toContain("{ content: hienChenh(employeeSummaryRows.reduce((s, r) => s + r.tongChenh, 0)), align: \"right\" },")
    expect(s).toMatch(/"Doanh thu net",\s+"Chênh lệch net",\s+"Tổng chênh lệch",\s+\],/)
    expect(s).toMatch(/Math\.round\(r\.diffNet\),\s+Math\.round\(r\.tongChenh\),\s+\]\)/)
  })

  it("Báo cáo tổng hợp › Theo nhân viên: cùng luật tongChenhLech, trừ giảm giá đơn", () => {
    const s = doc("src/components/bao-cao/man-ban-hang.tsx")
    expect(s).toContain('{ k: "tongChenh", label: "Tổng chênh lệch", f: "money", v: (x) => tongChenhLech(chenhThuan((x.revTT || 0) - (x.listed || 0), chenhTra(x.retTT || 0, x.rlisted || 0)), x.giamDon) },')
    expect(s.indexOf('k: "diffNet"')).toBeLessThan(s.indexOf('k: "tongChenh"'))
  })
})
