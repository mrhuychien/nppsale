/**
 * Báo cáo bán hàng theo nhân viên, phần chênh lệch. Chủ nhà 01/10/2026 (chốt lại luật): "hiện tại chỉ có
 * 1 giá bán ra. Cách tính chênh lệch: Hàng đi: lấy số liệu trên hóa đơn. Giá trên hóa đơn so với giá trên
 * bảng giá (lưu ý phải cùng đơn vị tính) x số lượng". Hàng trả cùng luật; giảm giá cả đơn cột riêng.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { chenhDong, giaBangCuaDong } from "@/lib/analytics/chenh-lech"
import { congHangBanNhanVien } from "@/lib/analytics/hang-ban-nhan-vien"
import { dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { gomBan, type DanhMucBC } from "@/lib/bao-cao/cong"

// Bảng giá: lon 100; thùng (24 lon) có giá RIÊNG 2.300 — không phải 24 × 100.
const SP = {
  base_unit: "lon", sell_price: 100, units: [{ unit_name: "thùng", conversion: 24 }],
  price_lists: [{ unit_name: "lon", price: 100, group_id: null }, { unit_name: "thùng", price: 2300, group_id: null }],
}
// Dòng HĐ 80 lon giá 90 — kèm chiết khấu / dòng đơn cũ: KHÔNG còn ảnh hưởng (luật giá lúc bán đã bỏ).
const HD80 = { product_id: "p", unit_name: "lon", conversion_factor: 1, quantity: 80, unit_price: 90, line_total: 7200, line_discount: 1000, order_line_id: "sol1" }

describe("chênh = SL × (giá trên HĐ − giá bảng cùng đơn vị)", () => {
  it("bán dưới giá bảng: âm; chiết khấu / dòng đơn không còn tính", () => {
    expect(chenhDong(HD80, SP)).toEqual({ tien: 7200, niemYet: 8000, chenh: -800 })
  })
  it("so với giá của ĐÚNG đơn vị dòng: 2 thùng × (2.400 − 2.300), không phải × (2.400 − 24 × 100)", () => {
    const thung = { unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 2400, line_total: 4800 }
    expect(giaBangCuaDong(thung, SP)).toBe(2300)
    expect(chenhDong(thung, SP)).toEqual({ tien: 4800, niemYet: 4600, chenh: 200 })
  })
  it("đơn vị không có giá riêng: giá cơ sở × hệ số (như màn bán)", () => {
    const sp = { ...SP, price_lists: [{ unit_name: "lon", price: 100, group_id: null }] }
    expect(chenhDong({ unit_name: "thùng", conversion_factor: 24, quantity: 1, unit_price: 2300, line_total: 2300 }, sp).chenh).toBe(-100)
  })
  it("bán CAO hơn giá bảng: chênh dương", () => {
    expect(chenhDong({ unit_name: "lon", quantity: 10, unit_price: 110, line_total: 1100 }, SP).chenh).toBe(100)
  })
  it("mặt hàng chưa có giá bảng: chênh 0, không chênh cả doanh thu", () => {
    expect(chenhDong({ unit_name: "gói", quantity: 3, unit_price: 50, line_total: 150 }, { base_unit: "gói", sell_price: 0, price_lists: [] }).chenh).toBe(0)
  })
  it("hàng trả: tiền trước thuế (line_total có VAT không dùng)", () => {
    expect(chenhDong({ unit_name: "lon", quantity: 5, unit_price: 90, line_total: 486 }, SP)).toEqual({ tien: 450, niemYet: 500, chenh: -50 })
  })
  it("congHangBanNhanVien: chênh thuần = chênh bán − chênh trả; giảm giá đơn cột riêng", () => {
    const [r] = congHangBanNhanVien({
      ban: [{ uid: "nv", line: HD80 }],
      tra: [{ uid: "nv", line: { product_id: "p", unit_name: "lon", quantity: 5, unit_price: 90, line_total: 486 } }],
      sanPham: new Map([["p", { ...SP, id: "p", sku: "P", name: "Bia" }]]),
      giamDon: [{ uid: "nv", tien: 720 }],
    })
    expect(r.listed).toBe(8000)
    expect(r.diff).toBe(-800)
    expect(r.returnListed).toBe(500)
    expect(r.diffReturn).toBe(-50)
    expect(r.diffNet).toBe(-750)
    expect(r.docDiscount, "giảm giá đơn cột riêng").toBe(720)
  })
})

describe("Báo cáo tổng hợp › Theo nhân viên dùng cùng luật", () => {
  const dm = { sp: new Map([["p", { id: "p", sku: "P", ten: "Bia", donViCoSo: "lon", giaBan: 100, donVi: [{ ten: "thùng", heSo: 24 }], bangGia: [{ ten: "lon", gia: 100 }, { ten: "thùng", gia: 2300 }] }]]) } as unknown as DanhMucBC
  const hoaDon = [{ id: "hd1", invoice_code: "HD1", invoice_date: "2026-09-30", status: "posted", total: 7128, subtotal: 6480, vat: 648, customer_id: "k", sales_user_id: "nv", order_id: "o" }]
  it("chênh = SL × (giá HĐ − giá bảng): VAT không lọt; giảm giá đơn cột riêng; chênh trả", () => {
    const { dong } = dungDongBan({
      hoaDon: hoaDon as never,
      dongHd: [{ id: "l1", invoice_id: "hd1", ...HD80 }] as never,
      tra: [{ id: "r1", status: "completed", customer_id: "k", credit_note_amount: 486, created_at: "2026-09-30", sales_user_id: "nv", invoice_id: "hd1" }] as never,
      dongTra: [{ return_id: "r1", product_id: "p", unit_name: "lon", quantity: 5, unit_price: 90, line_total: 486 }],
      giaVonCoSo: new Map(),
      giaVonTra: new Map(),
      nvTra: new Map([["r1", "nv"]]),
      dm,
    })
    const g = gomBan(dong, (l) => l.nv, dm).get("nv")!
    expect(g.rev, "doanh thu vẫn là tiền HĐ").toBe(7128)
    expect(g.revTT).toBe(7200)
    expect(g.listed).toBe(8000)
    expect(g.revTT - g.listed, "chênh bán = 80 × (90 − 100)").toBe(-800)
    expect(g.giamDon, "giảm giá đơn = 7.200 − 6.480, tính riêng").toBe(720)
    expect(g.retTT - g.rlisted, "chênh trả = 5 × (90 − 100)").toBe(-50)
  })
  it("màn hiện đủ cột chênh bán / trả / thuần", () => {
    const s = readFileSync("src/components/bao-cao/man-ban-hang.tsx", "utf8")
    expect(s).toContain('label: "Chênh lệch bán", f: "money", v: (x) => (x.revTT || 0) - (x.listed || 0)')
    expect(s).toContain('label: "Chênh lệch trả", f: "money", v: (x) => (x.retTT || 0) - (x.rlisted || 0)')
    expect(s).toContain('label: "Chênh lệch thuần"')
    expect(s).toContain('label: "Giảm giá đơn"')
  })
  it("không còn đọc 'giá lúc bán' (dòng đơn / hoá đơn gốc) — chỉ bảng giá", () => {
    for (const f of ["src/lib/bao-cao/nap-ban-hang.ts", "src/lib/analytics/hang-ban-nhan-vien.ts", "src/app/(dashboard)/reports/employees/page.tsx"]) {
      const s = readFileSync(f, "utf8")
      expect(s, f).not.toMatch(/napGiaLucBan|dongDon|dongHdGoc|giaNyCoSo/)
    }
  })
})
