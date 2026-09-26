import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { chotTienChungTu, type HangBanNhanVien } from "@/lib/analytics/hang-ban-nhan-vien"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "sao doanh thu thuần trong báo cáo bán hàng vẫn lệch so với công nợ"
 *   (Báo cáo nhân viên 643.594.600đ ≠ công nợ 643.795.000đ). Tab "Hàng bán theo nhân viên"
 *   cộng DÒNG; công nợ là tiền CHỨNG TỪ (HĐ.total − phiếu trả.credit_note_amount).
 */
const dong = (id: string, over: Partial<HangBanNhanVien> = {}): HangBanNhanVien => ({
  id, qty: 0, qtyTheoDv: {}, listed: 100_000, revenue: 95_000, diff: -5_000,
  returnQty: 0, returnQtyTheoDv: {}, returnValue: 9_600, netRevenue: 85_400, products: [], ...over,
})

describe("báo cáo nhân viên khớp công nợ", () => {
  it("cấp nhân viên dùng tiền hóa đơn và tiền phiếu trả", () => {
    const [r] = chotTienChungTu([dong("nv")], new Map([["nv", 97_000]]), new Map([["nv", 10_000]]))
    expect(r.revenue).toBe(97_000) // có giảm giá đơn / VAT của HĐ
    expect(r.returnValue).toBe(10_000) // credit_note_amount, không phải Σ dòng trả
    expect(r.netRevenue).toBe(87_000) // = công nợ phát sinh của nhân viên
    expect(r.diff).toBe(-3_000)
  })
  it("nhân viên chỉ có hàng trả vẫn ra số âm đúng", () => {
    const [r] = chotTienChungTu([dong("nv2")], new Map(), new Map([["nv2", 5_000]]))
    expect(r.netRevenue).toBe(-5_000)
  })
  it("màn chỉ chốt khi KHÔNG lọc hàng hóa", () => {
    const s = readFileSync(resolve(__dirname, "../src/app/(dashboard)/reports/employees/page.tsx"), "utf-8")
    expect(s).toContain("const coLocHang = productFilter.length > 0 || categoryFilter.length > 0 || brandFilter.length > 0")
    expect(s).toContain("rows = chotTienChungTu(rows, tienHd, tienTra)")
    expect(s).toContain("Number(o.total || 0)")
    expect(s).toContain("Number(r.credit_note_amount || 0)")
  })
})
