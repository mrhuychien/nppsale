/**
 * Chủ nhà 30/09/2026 — báo cáo bán hàng theo nhân viên, phần chênh lệch: "Hàng trả về và Hàng đi:
 * Nhân viên sửa giá loại nào -> tính phần chênh số lượng X (giá sửa - giá gốc). Phần giảm giá cả
 * đơn tính riêng (tính theo đơn)" · giá gốc = giá của khách LÚC BÁN · "lúc đi đã ăn chênh, lúc về
 * phải trả chênh". Quét trước khi sửa: chênh lệch ăn cả VAT (bán đúng giá, VAT 10% → chênh +10%).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { chenhDongBan, chenhDongTra, giaNyCoSoLucBan, giaNyCoSoTrenHd, tiLeSauGiamHd, type DongDonGoc } from "@/lib/analytics/chenh-lech"
import { congHangBanNhanVien } from "@/lib/analytics/hang-ban-nhan-vien"
import { dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { gomBan, type DanhMucBC } from "@/lib/bao-cao/cong"

const SP = { base_unit: "lon", sell_price: 100, units: [{ unit_name: "thùng", conversion: 24 }], price_lists: [] }
// Đơn: 100 lon, giá khách 100, bán 90 → line_discount = 100 × 10 = 1.000 (của CẢ dòng đơn).
const DON: DongDonGoc = { id: "sol1", unit_name: "lon", conversion_factor: 1, quantity: 100, unit_price: 90, line_discount: 1000 }
const dongDon = new Map([[DON.id, DON]])
// Hoá đơn giao THIẾU 80 lon — post_invoice chép nguyên line_discount 1.000.
const HD80 = { product_id: "p", unit_name: "lon", conversion_factor: 1, quantity: 80, unit_price: 90, line_total: 7200, line_discount: 1000, order_line_id: "sol1" }

describe("giá niêm yết lúc bán", () => {
  it("tính từ DÒNG ĐƠN, không lấy chiết khấu nguyên dòng chép sang hoá đơn", () => {
    expect(giaNyCoSoLucBan(HD80, SP, dongDon)).toBe(100)
    const c = chenhDongBan(HD80, SP, 1, dongDon)
    expect(c).toEqual({ tien: 7200, niemYet: 8000, chenh: -800 }) // không phải −1.000
  })
  it("hoá đơn khác đơn vị với đơn: quy về đơn vị cơ sở", () => {
    const donThung: DongDonGoc = { id: "t", unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 2160, line_discount: 480 }
    const hdLon = { ...HD80, quantity: 24, unit_price: 90, line_total: 2160, order_line_id: "t" }
    // giá khách 1 thùng = 2160 + 240 = 2400 → 100 / lon
    expect(chenhDongBan(hdLon, SP, 1, new Map([["t", donThung]]))).toEqual({ tien: 2160, niemYet: 2400, chenh: -240 })
  })
  it("tiLeSauGiamHd (giữ cho nơi khác dùng) — chênh lệch KHÔNG trộn giảm giá đơn", () => {
    expect(tiLeSauGiamHd(6480, [{ line_total: 7200 }])).toBeCloseTo(0.9)
    expect(tiLeSauGiamHd(0, [{ line_total: 7200 }]), "không có subtotal = không giảm").toBe(1)
  })
  it("không tra được giá lúc bán: lùi về giá đưa vào, rồi mới tới đơn giá (chênh 0)", () => {
    const le = { ...HD80, order_line_id: "khong-co", line_discount: null }
    expect(chenhDongBan(le, SP, 1, dongDon, 95).niemYet).toBe(80 * 95)
    expect(chenhDongBan(le, SP, 1, dongDon).chenh).toBe(0)
  })
})

describe("chênh trả — lúc đi ăn chênh, lúc về trả chênh", () => {
  it("giá niêm yết lấy từ đúng mặt hàng trên hoá đơn gốc; tiền trả trước thuế", () => {
    const gia = giaNyCoSoTrenHd("p", [HD80], SP, dongDon)
    expect(gia).toBe(100)
    // Trả 5 lon ở giá 90 — line_total đã gồm VAT 8% (486) nhưng chênh tính trên 5 × 90.
    expect(chenhDongTra({ product_id: "p", unit_name: "lon", quantity: 5, unit_price: 90, line_total: 486 }, SP, gia)).toEqual({ tien: 450, niemYet: 500, chenh: -50 })
  })
  it("congHangBanNhanVien: chênh thuần = chênh bán − chênh trả", () => {
    const [r] = congHangBanNhanVien({
      ban: [{ uid: "nv", line: HD80 }],
      tra: [{ uid: "nv", line: { product_id: "p", unit_name: "lon", quantity: 5, unit_price: 90, line_total: 486 }, invoiceId: "hd1" }],
      sanPham: new Map([["p", { ...SP, id: "p", sku: "P", name: "Bia" }]]),
      dongDon,
      dongHdGoc: new Map([["hd1", [HD80]]]),
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
  const dm = { sp: new Map([["p", { id: "p", sku: "P", ten: "Bia", donViCoSo: "lon", quyDoi: SP }]]) } as unknown as DanhMucBC
  const hoaDon = [{ id: "hd1", invoice_code: "HD1", invoice_date: "2026-09-30", status: "posted", total: 7128, subtotal: 6480, vat: 648, customer_id: "k", sales_user_id: "nv", order_id: "o" }]
  it("chênh = SL × (giá sửa − giá gốc): VAT không lọt; giảm giá đơn cột riêng; chênh trả", () => {
    const { dong } = dungDongBan({
      hoaDon: hoaDon as never,
      dongHd: [{ id: "l1", invoice_id: "hd1", ...HD80 }] as never,
      tra: [{ id: "r1", status: "completed", customer_id: "k", credit_note_amount: 486, created_at: "2026-09-30", sales_user_id: "nv", invoice_id: "hd1" }] as never,
      dongTra: [{ return_id: "r1", product_id: "p", unit_name: "lon", quantity: 5, unit_price: 90, line_total: 486 }],
      giaVonCoSo: new Map(),
      giaVonTra: new Map(),
      nvTra: new Map([["r1", "nv"]]),
      dm,
      dongDon,
      dongHdGoc: new Map([["hd1", [{ id: "l1", invoice_id: "hd1", ...HD80 }]]]) as never,
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
  it("mig 218 trả dữ liệu giá lúc bán", () => {
    const m = readFileSync("supabase/migrations/218_chenh_lech_gia_luc_ban.sql", "utf8")
    for (const k of ["'line_discount', l.line_discount", "'order_line_id', l.order_line_id", "'dong_hd_goc'", "'dong_don'", "'unit_price', l.unit_price"]) expect(m).toContain(k)
    expect(readFileSync("scripts/sql/kham-so-that.sql", "utf8")).toContain("Mig 218")
  })
})
