import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { congSL, gopSL, hienSLTheoDonVi, tongSLTheoDonVi, type SLTheoDonVi } from "../src/lib/analytics/sl-theo-don-vi"
import { congHangBanNhanVien, type SanPhamHangBan } from "../src/lib/analytics/hang-ban-nhan-vien"

/**
 * ⚠ CHỦ NHÀ 24/09/2026 (Báo cáo > Nhân viên, dòng tổng "SL người bán: 7 | 8.224"):
 *   SL từng dòng đã quy về đơn vị cơ sở, nhưng dòng tổng vẫn cộng hộp + chai +
 *   gói thành một số. SL gộp nhiều mặt hàng phải hiện theo từng đơn vị cơ sở.
 */

const read = (p: string) => readFileSync(p, "utf8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const D = "src/app/(dashboard)/reports"

describe("hienSLTheoDonVi", () => {
  it("một đơn vị → '640 hộp'", () => {
    expect(hienSLTheoDonVi({ hộp: 640 })).toBe("640 hộp")
  })
  it("nhiều đơn vị: SL giảm dần, định dạng vi-VN", () => {
    expect(hienSLTheoDonVi({ gói: 55, hộp: 1640, chai: 120 })).toBe("1.640 hộp · 120 chai · 55 gói")
  })
  it("rỗng / toàn 0 → '0'", () => {
    expect(hienSLTheoDonVi({})).toBe("0")
    expect(hienSLTheoDonVi(null)).toBe("0")
    expect(hienSLTheoDonVi({ hộp: 0 })).toBe("0")
  })
  it("đơn vị rỗng → chỉ số; fmt tuỳ chọn", () => {
    expect(hienSLTheoDonVi({ "": 5 })).toBe("5")
    expect(hienSLTheoDonVi({ hộp: 2.5 }, (n) => n.toFixed(1))).toBe("2.5 hộp")
  })
})

describe("congSL / gopSL / tongSLTheoDonVi", () => {
  it("congSL cộng theo khoá, bỏ số 0", () => {
    const m: SLTheoDonVi = {}
    congSL(m, "hộp", 10)
    congSL(m, "hộp", 5)
    congSL(m, "chai", 0)
    congSL(m, "chai", 3)
    expect(m).toEqual({ hộp: 15, chai: 3 })
  })
  it("gopSL gộp, không sửa đầu vào", () => {
    const a = { hộp: 10 }
    const b = { hộp: 2, chai: 4 }
    expect(gopSL(a, b)).toEqual({ hộp: 12, chai: 4 })
    expect(a).toEqual({ hộp: 10 })
  })
  it("tongSLTheoDonVi gộp map các dòng (mặc định qtyTheoDv)", () => {
    const rows = [{ qtyTheoDv: { hộp: 640 }, r: { chai: 1 } }, { qtyTheoDv: { chai: 12 }, r: { chai: 2 } }]
    expect(tongSLTheoDonVi(rows)).toEqual({ hộp: 640, chai: 12 })
    expect(tongSLTheoDonVi(rows, (x) => x.r)).toEqual({ chai: 3 })
  })
})

describe("congHangBanNhanVien — SL nhân viên theo từng đơn vị cơ sở", () => {
  const BANH: SanPhamHangBan = {
    id: "banh", sku: "SP001945", name: "Bánh lễ", base_unit: "hộp", sell_price: 13200,
    units: [{ unit_name: "khay", conversion: 10 }], price_lists: [],
  }
  const NUOC: SanPhamHangBan = {
    id: "nuoc", sku: "SP002", name: "Nước", base_unit: "chai", sell_price: 10000,
    units: [{ unit_name: "lốc", conversion: 6 }], price_lists: [],
  }
  const sanPham = new Map([[BANH.id, BANH], [NUOC.id, NUOC]])

  it("640 hộp + 12 chai → '640 hộp · 12 chai', không bao giờ '652'", () => {
    const [nv] = congHangBanNhanVien({
      ban: [
        { uid: "nv1", line: { product_id: "banh", unit_name: "khay", conversion_factor: 10, quantity: 64, line_total: 8640000 } },
        { uid: "nv1", line: { product_id: "nuoc", unit_name: "lốc", conversion_factor: 6, quantity: 2, line_total: 120000 } },
      ],
      tra: [{ uid: "nv1", line: { product_id: "nuoc", unit_name: "lốc", quantity: 1, line_total: 60000 } }],
      sanPham,
    })
    expect(nv.qtyTheoDv).toEqual({ hộp: 640, chai: 12 })
    expect(hienSLTheoDonVi(nv.qtyTheoDv)).toBe("640 hộp · 12 chai")
    expect(hienSLTheoDonVi(nv.qtyTheoDv)).not.toContain("652")
    expect(nv.returnQtyTheoDv).toEqual({ chai: 6 })
    const banh = nv.products.find((p) => p.productId === "banh")!
    expect(banh.qtyTheoDv).toEqual({ hộp: 640 })
    expect(hienSLTheoDonVi(banh.qtyTheoDv)).toBe("640 hộp")
  })
})

describe("các trang báo cáo hiện SL gộp qua hienSLTheoDonVi", () => {
  const E = code(read(`${D}/employees/page.tsx`))
  it("Nhân viên: dòng NV, dòng khách, dòng tổng, SL trả, Excel", () => {
    expect(E).toContain("hienSLTheoDonVi(r.qtyTheoDv)")
    expect(E).toContain("hienSLTheoDonVi(r.returnQtyTheoDv)")
    expect(E).toContain("hienSLTheoDonVi(c.qtyTheoDv)")
    expect(E).toContain("hienSLTheoDonVi(totalsSummaryQty)")
    expect(E).toContain("hienSLTheoDonVi(totalsSummaryReturnQty)")
    expect(E).toContain("hienSLTheoDonVi(totalsProducts.qtyTheoDv)")
    expect(E).toContain("hienSLTheoDonVi(totalsByCustomer.qtyTheoDv)")
    // Không còn in số lẫn đơn vị của dòng tổng / dòng NV / dòng khách.
    expect(E).not.toMatch(/\br\.qty\.toLocaleString/)
    expect(E).not.toMatch(/\br\.returnQty\.toLocaleString/)
    expect(E).not.toMatch(/totals\w*\.qty\.toLocaleString/)
    expect(E).not.toMatch(/reduce\(\(s, r\) => s \+ r\.(qty|returnQty)/)
    // Excel dòng "(Tổng hợp)" xuất chuỗi theo đơn vị.
    expect(E).toMatch(/"\(Tổng hợp\)",\s*"",\s*hienSLTheoDonVi\(r\.qtyTheoDv\)/)
  })

  it("Khách hàng: Tổng SL theo khách + dòng tổng", () => {
    const S = code(read(`${D}/customers/page.tsx`))
    expect(S).toContain("hienSLTheoDonVi(r.qtyTheoDv)")
    expect(S).toContain("hienSLTheoDonVi(totals.qtyTheoDv)")
    expect(S).not.toMatch(/\br\.qty\.toLocaleString/)
    expect(S).not.toMatch(/totals\.qty\.toLocaleString/)
  })

  it("Hàng hóa (gộp theo nhóm + dòng tổng): mọi view", () => {
    for (const f of ["sales-by-product", "profit-by-product", "stock-value", "stock-movement"]) {
      const S = code(read(`${D}/products/_views/${f}.tsx`))
      expect(S, f).toContain("hienSLTheoDonVi(")
      expect(S, f).toContain("tongSLTheoDonVi(")
      expect(S, f).not.toMatch(/\b(r|totals)\.(qty|returnQty|beginQty|importQty|exportQty|endQty)\.toLocaleString/)
    }
    const P = code(read(`${D}/products/page.tsx`))
    expect(P).toContain("groupSameType ? hienSLTheoDonVi(theoDv) : qty")
  })

  it("Đặt hàng: theo mặt hàng (gộp cùng loại), theo đơn, dòng tổng", () => {
    const S = code(read(`${D}/orders/page.tsx`))
    expect(S).toContain("hienSLTheoDonVi(r.qtyTheoDv)")
    expect(S).toContain("hienSLTheoDonVi(totalsByProduct.qtyTheoDv)")
    expect(S).toContain("hienSLTheoDonVi(totalsTx.qtyTheoDv)")
    expect(S).not.toMatch(/\br\.qty\.toLocaleString/)
    expect(S).not.toMatch(/totals\w*\.qty\.toLocaleString/)
  })
})
