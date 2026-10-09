import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { congHangBanNhanVien, type SanPhamHangBan } from "@/lib/analytics/hang-ban-nhan-vien"
import { truSL } from "@/lib/analytics/sl-theo-don-vi"

/**
 * CHỦ NHÀ 09/10/2026: "sửa tiếp báo cáo /reports/employees — Mối quan tâm: Hàng bán theo nhân viên, Xem chi tiết từng
 * nhân viên: Thêm cột bảng giá (theo đơn vị), giá bán (theo đơn vị), SL thực bán (sl bán - sl trả)".
 *
 * Giá chỉ so được trên CÙNG đơn vị tính (luật chênh 01/10/2026: "Giá trên hóa đơn so với giá trên bảng giá (lưu ý phải
 * cùng đơn vị tính) x số lượng") → chi tiết tách mỗi mặt hàng theo ĐƠN VỊ của dòng: bán thùng thì bảng giá / giá bán là
 * của thùng, SL là số thùng.
 */
const SUA: SanPhamHangBan = {
  id: "sua",
  sku: "SUA",
  name: "Sữa hộp",
  base_unit: "hộp",
  sell_price: 20000,
  units: [{ unit_name: "thùng", conversion: 24 }],
  price_lists: [
    { unit_name: "thùng", price: 450000, group_id: null },
    { unit_name: "hộp", price: 20000, group_id: null },
  ],
}
const sanPham = new Map([[SUA.id, SUA]])
const ban = (unit: string, heSo: number, q: number, gia: number) => ({
  uid: "nv",
  line: { product_id: "sua", unit_name: unit, conversion_factor: heSo, quantity: q, unit_price: gia, line_total: q * gia },
})

describe("Hàng bán theo nhân viên — chi tiết theo đơn vị tính", () => {
  const [nv] = congHangBanNhanVien({
    ban: [ban("thùng", 24, 2, 470000), ban("thùng", 24, 1, 460000), ban("hộp", 1, 10, 21000)],
    // Trả 4 hộp, đơn giá 21.000 trước thuế, tiền dòng gồm VAT 10%.
    tra: [{ uid: "nv", line: { product_id: "sua", unit_name: "hộp", quantity: 4, unit_price: 21000, line_total: 92400 } }],
    sanPham,
  })
  const p = nv.products[0]
  const thung = p.donVi.find((d) => d.unit === "thùng")!
  const hop = p.donVi.find((d) => d.unit === "hộp")!

  it("mỗi đơn vị một dòng, đơn vị lớn trước; SL theo đúng đơn vị (không quy đổi)", () => {
    expect(p.donVi.map((d) => [d.unit, d.heSo])).toEqual([["thùng", 24], ["hộp", 1]])
    expect(thung.qty).toBe(3)
    expect(hop.qty).toBe(10)
  })

  it("bảng giá của ĐÚNG đơn vị; giá bán = bình quân đơn giá trên HĐ của đơn vị ấy (trước thuế)", () => {
    expect(thung.giaBang).toBe(450000) // giá thùng riêng, KHÔNG phải 24 × 20.000
    expect(thung.giaBan).toBeCloseTo((2 * 470000 + 460000) / 3, 6)
    expect(hop.giaBang).toBe(20000)
    expect(hop.giaBan).toBe(21000)
    // Chênh = SL × (giá bán − bảng giá) trên cùng đơn vị.
    expect(thung.diff).toBe(3 * thung.giaBan! - 3 * 450000)
    expect(hop.diff).toBe(10 * (21000 - 20000))
  })

  it("SL thực bán = SL bán − SL trả (cùng đơn vị); tiền thuần = doanh thu − giá trị trả", () => {
    expect(thung.netQty).toBe(3)
    expect(hop.returnQty).toBe(4)
    expect(hop.netQty).toBe(6)
    expect(hop.returnValue).toBe(92400)
    expect(hop.netRevenue).toBe(210000 - 92400)
    expect(hop.diffReturn).toBe(4 * (21000 - 20000))
    expect(hop.diffNet).toBe(10000 - 4000)
  })

  it("dòng Cộng của mặt hàng quy về đơn vị cơ sở: 3 thùng + 10 hộp = 82 hộp, trả 4 → thực bán 78", () => {
    expect(p.qty).toBe(82)
    expect(p.returnQty).toBe(4)
    expect(p.netQty).toBe(78)
    // Σ các dòng đơn vị = số của mặt hàng.
    expect(p.donVi.reduce((s, d) => s + d.revenue, 0)).toBe(p.revenue)
    expect(p.donVi.reduce((s, d) => s + d.listed, 0)).toBe(p.listed)
    expect(p.donVi.reduce((s, d) => s + d.returnValue, 0)).toBe(p.returnValue)
  })

  it("chỉ trả mà không bán ở đơn vị ấy: giá bán '—' (null), SL thực bán âm", () => {
    const [x] = congHangBanNhanVien({
      ban: [ban("thùng", 24, 1, 450000)],
      tra: [{ uid: "nv", line: { product_id: "sua", unit_name: "hộp", quantity: 2, unit_price: 20000, line_total: 44000 } }],
      sanPham,
    })
    const h = x.products[0].donVi.find((d) => d.unit === "hộp")!
    expect(h.giaBan).toBeNull()
    expect(h.netQty).toBe(-2)
  })

  it("mặt hàng chưa có giá bảng: bảng giá 0 (hiện '—'), chênh 0", () => {
    const tron: SanPhamHangBan = { ...SUA, id: "tron", sell_price: 0, price_lists: [] }
    const [x] = congHangBanNhanVien({
      ban: [{ uid: "nv", line: { product_id: "tron", unit_name: "hộp", conversion_factor: 1, quantity: 5, unit_price: 15000, line_total: 75000 } }],
      tra: [],
      sanPham: new Map([[tron.id, tron]]),
    })
    const d = x.products[0].donVi[0]
    expect(d.giaBang).toBe(0)
    expect(d.giaBan).toBe(15000)
    expect(d.diff).toBe(0)
  })

  it("truSL: SL thực bán theo từng đơn vị cơ sở (dòng tổng nhân viên)", () => {
    expect(truSL({ hộp: 82, chai: 5 }, { hộp: 4 })).toEqual({ hộp: 78, chai: 5 })
  })
})

describe("màn Báo cáo nhân viên — bảng chi tiết và file Excel có ba cột mới", () => {
  const s = readFileSync(resolve(__dirname, "..", "src/app/(dashboard)/reports/employees/page.tsx"), "utf8")
  it("bảng chi tiết: Bảng giá (theo ĐVT), Giá bán (theo ĐVT), SL thực bán — từ `p.donVi`", () => {
    for (const c of ["Bảng giá (theo ĐVT)", "Giá bán (theo ĐVT)", "SL thực bán"]) expect(s).toContain(`>${c}</th>`)
    expect(s).toContain("...p.donVi.map((d, i) => (")
    expect(s).toContain("{d.giaBang > 0 ? formatCurrency(d.giaBang) : \"—\"}")
    expect(s).toContain("{d.giaBan != null ? formatCurrency(d.giaBan) : \"—\"}")
    expect(s).toContain("{d.netQty.toLocaleString(\"vi-VN\")}")
  })
  it("Excel: mỗi mặt hàng × đơn vị một dòng, có ba cột mới", () => {
    for (const c of ['"Bảng giá (theo ĐVT)"', '"Giá bán (theo ĐVT)"', '"SL thực bán"']) expect(s).toContain(c)
    expect(s).toContain("for (const d of p.donVi) {")
    expect(s).toContain("hienSLTheoDonVi(truSL(r.qtyTheoDv, r.returnQtyTheoDv))")
  })
})
