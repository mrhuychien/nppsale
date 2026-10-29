/**
 * CỘT "THUẾ + LÀM TRÒN" Ở DÒNG NHÂN VIÊN — chủ nhà 29/10/2026 (Phạm Thị Vĩnh 09/2026: Theo bảng giá 269.397.000, Doanh thu
 * 273.607.400, Chênh lệch bán 4.172.000 → 273.607.400 − 269.397.000 = 4.210.400 ≠ 4.172.000): "tại sao lấy doanh thu thực tế
 * trừ đi bảng giá lại không ra số ở cột chênh lệch bán". Doanh thu dòng nhân viên là tiền hoá đơn (gồm VAT, sau giảm giá
 * đơn, làm tròn — khớp công nợ, 26/09/2026), chênh tính trước thuế theo dòng; cộng 187 dòng mặt hàng ra 273.569.000 =
 * 269.397.000 + 4.172.000, dư 38.400 là thuế + làm tròn. Chốt cách 1: giữ Doanh thu, thêm cột cho đủ vế:
 *     Doanh thu − Theo bảng giá = Chênh lệch bán − Giảm giá đơn + Thuế + làm tròn.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { thueLamTronNv } from "@/lib/analytics/chenh-lech"
import { chotTienChungTu, congHangBanNhanVien } from "@/lib/analytics/hang-ban-nhan-vien"

const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

// Bảng giá: lon 100; thùng (24 lon) giá riêng 2.300.
const SP = {
  id: "p", sku: "P", name: "Bia", base_unit: "lon", sell_price: 100, units: [{ unit_name: "thùng", conversion: 24 }],
  price_lists: [{ unit_name: "lon", price: 100, group_id: null }, { unit_name: "thùng", price: 2300, group_id: null }],
}

describe("thueLamTronNv = tiền chứng từ − Σ dòng + giảm giá đơn", () => {
  it("VAT 10% không giảm giá: 1.210 − 1.100 + 0 = 110; VAT 8%: 226.800 − 210.000 = 16.800", () => {
    expect(thueLamTronNv(1_210, 1_100, 0)).toBe(110)
    expect(thueLamTronNv(226_800, 210_000, null)).toBe(16_800)
    expect(thueLamTronNv(226_800, 210_000, undefined)).toBe(16_800)
  })
  it("giảm giá đơn không phải thuế: HĐ 1.360.000 (tiền hàng 1.380.000, giảm 20.000, VAT 0) → 0", () => {
    expect(thueLamTronNv(1_360_000, 1_380_000, 20_000)).toBe(0)
  })
  it("vừa giảm giá vừa VAT: 1.190 = 1.100 − 20 + 110 → 110; làm tròn âm vẫn ra số âm", () => {
    expect(thueLamTronNv(1_190, 1_100, 20)).toBe(110)
    expect(thueLamTronNv(999, 1_000, 0)).toBe(-1)
  })
  it("Vĩnh 09/2026: 273.607.400 − 273.569.000 + 0 = 38.400 — đúng phần dư chủ nhà thấy", () => {
    expect(thueLamTronNv(273_607_400, 273_569_000, 0)).toBe(38_400)
    expect(269_397_000 + 4_172_000).toBe(273_569_000)
  })
})

describe("chotTienChungTu gắn thuế + làm tròn cho dòng nhân viên; vế đẳng thức khép kín", () => {
  const ban = (uid: string) => [
    { uid, line: { product_id: "p", unit_name: "lon", conversion_factor: 1, quantity: 10, unit_price: 110, line_total: 1100 } },
    { uid, line: { product_id: "p", unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 2250, line_total: 4500 } },
  ]
  it("không giảm giá: HĐ 6.160 (5.600 + VAT 560) → thuế 560; Doanh thu − Theo bảng giá = chênh + thuế", () => {
    const rows = congHangBanNhanVien({ ban: ban("a"), tra: [], sanPham: new Map([["p", SP]]), giamDon: [] })
    expect([rows[0].listed, rows[0].revenue, rows[0].diff, rows[0].thueLamTron]).toEqual([5_600, 5_600, 0, 0])
    const [r] = chotTienChungTu(rows, new Map([["a", 6_160]]), new Map())
    expect(r.thueLamTron).toBe(560)
    expect(r.revenue - r.listed).toBe(r.diff - r.docDiscount + r.thueLamTron)
  })
  it("có giảm giá đơn 100: HĐ 6.050 (5.600 − 100 + VAT 550) → thuế 550, không lẫn giảm giá", () => {
    const rows = congHangBanNhanVien({ ban: ban("a"), tra: [], sanPham: new Map([["p", SP]]), giamDon: [{ uid: "a", tien: 100 }] })
    const [r] = chotTienChungTu(rows, new Map([["a", 6_050]]), new Map())
    expect(r.docDiscount).toBe(100)
    expect(r.thueLamTron).toBe(550)
    expect(r.revenue - r.listed).toBe(r.diff - r.docDiscount + r.thueLamTron)
  })
  it("chênh lệch bán có số: 10 lon × 120 (bảng 100) = +200; HĐ 1.320 = 1.200 + VAT 120 → thuế 120", () => {
    const rows = congHangBanNhanVien({
      ban: [{ uid: "b", line: { product_id: "p", unit_name: "lon", conversion_factor: 1, quantity: 10, unit_price: 120, line_total: 1200 } }],
      tra: [], sanPham: new Map([["p", SP]]), giamDon: [],
    })
    const [r] = chotTienChungTu(rows, new Map([["b", 1_320]]), new Map())
    expect([r.listed, r.revenue, r.diff, r.thueLamTron]).toEqual([1_000, 1_320, 200, 120])
    expect(r.revenue - r.listed).toBe(320)
    expect(r.diff - r.docDiscount + r.thueLamTron).toBe(320)
  })
  it("nhân viên chỉ có hàng trả / chưa chốt: thuế 0; hàng trả không đụng cột này", () => {
    const rows = congHangBanNhanVien({
      ban: [], tra: [{ uid: "c", line: { product_id: "p", unit_name: "lon", quantity: 1, unit_price: 100, line_total: 100 } }],
      sanPham: new Map([["p", SP]]), giamDon: [],
    })
    expect(rows[0].thueLamTron).toBe(0)
    const [r] = chotTienChungTu(rows, new Map(), new Map([["c", 110]]))
    expect(r.thueLamTron).toBe(0)
    expect(r.returnValue).toBe(110)
  })
})

describe("màn hình: cột Thuế + làm tròn ngay sau Chênh lệch bán, trước Giảm giá đơn", () => {
  it("Báo cáo › Nhân viên (Hàng bán theo nhân viên): bảng, dòng tổng, tệp Excel (dòng mặt hàng để trống)", () => {
    const s = doc("src/app/(dashboard)/reports/employees/page.tsx")
    expect(s).toMatch(/key: "diff",\s+label: "Chênh lệch bán",[\s\S]*?key: "thueLamTron",\s+label: "Thuế \+ làm tròn",\s+align: "right",\s+render: \(r\) => hienChenh\(r\.thueLamTron\),\s+\},\s+\{\s+key: "docDiscount",/)
    expect(s).toMatch(/s \+ r\.diff, 0\)\), align: "right" \},\s+\{ content: hienChenh\(employeeSummaryRows\.reduce\(\(s, r\) => s \+ r\.thueLamTron, 0\)\), align: "right" \},/)
    expect(s).toMatch(/"Chênh lệch bán",\s+"Thuế \+ làm tròn",\s+"Giảm giá đơn",/)
    expect(s).toMatch(/Math\.round\(r\.diff\),\s+Math\.round\(r\.thueLamTron\),\s+-r\.docDiscount,/)
    expect(s).toMatch(/Math\.round\(d\.diff\),\s+"",\s+"",\s+d\.returnQty,/)
  })
  it("Báo cáo tổng hợp › Theo nhân viên: cùng luật thueLamTronNv trên tiền chứng từ − tiền theo giá HĐ + giảm giá đơn", () => {
    const s = doc("src/components/bao-cao/man-ban-hang.tsx")
    expect(s).toContain('{ k: "thueLamTron", label: "Thuế + làm tròn", f: "money", v: (x) => thueLamTronNv(x.rev || 0, x.revTT || 0, x.giamDon) },')
    expect(s.indexOf('k: "diff"')).toBeLessThan(s.indexOf('k: "thueLamTron"'))
    expect(s.indexOf('k: "thueLamTron"')).toBeLessThan(s.indexOf('k: "giamDon"'))
  })
  it("một hàm cho hai báo cáo; chotTienChungTu dùng Σ dòng trước khi thay bằng tiền chứng từ", () => {
    const lib = doc("src/lib/analytics/hang-ban-nhan-vien.ts")
    expect(lib).toContain("thueLamTron: thueLamTronNv(revenue, r.revenue, r.docDiscount)")
    expect(doc("CLAUDE.md")).toMatch(/Doanh thu − Theo bảng giá = Chênh lệch bán − Giảm giá đơn \+ Thuế \+ làm tròn/)
  })
})
