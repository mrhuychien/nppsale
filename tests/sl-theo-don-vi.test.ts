import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  congSL, gopSL, hienSLTheoDonVi, hienTongSL, tongSLTheoDonVi, tongSoSL, truSL, DON_VI_TONG, type SLTheoDonVi,
} from "../src/lib/analytics/sl-theo-don-vi"
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

/**
 * ⚠ CHỦ NHÀ 03/11/2026 (Báo cáo Nhân viên › Hàng bán theo nhân viên): "cột số lượng bán tổng hợp số lượng và ghi 'đơn vị'
 *   ko cần diễn giải chi tiết ở phần tổng hợp" — phần tổng hợp là MỘT số (Σ quy về đơn vị cơ sở) + chữ "đơn vị".
 */
describe("tongSoSL / hienTongSL — phần tổng hợp Hàng bán theo nhân viên", () => {
  it("640 hộp + 12 chai → 652 (một số), hiện '652'; chữ đơn vị là 'đơn vị'", () => {
    expect(tongSoSL({ hộp: 640, chai: 12 })).toBe(652)
    expect(hienTongSL({ hộp: 640, chai: 12 })).toBe("652")
    expect(hienTongSL({ gói: 55, hộp: 1640, chai: 120 })).toBe("1.815")
    expect(DON_VI_TONG).toBe("đơn vị")
  })
  it("rỗng / null → 0; SL thực bán âm vẫn cộng đúng dấu", () => {
    expect(tongSoSL({})).toBe(0)
    expect(tongSoSL(null)).toBe(0)
    expect(hienTongSL(undefined)).toBe("0")
    expect(tongSoSL(truSL({ hộp: 2 }, { hộp: 5, chai: 1 }))).toBe(-4)
  })
  it("bỏ sai số cộng số thực (Excel không hiện 0,30000000000000004); bỏ giá trị không hữu hạn", () => {
    expect(tongSoSL({ hộp: 0.1, chai: 0.2 })).toBe(0.3)
    expect(tongSoSL({ hộp: 3, chai: Number.NaN })).toBe(3)
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
    // Phần tổng hợp (chủ nhà 03/11/2026): một số = Σ quy về đơn vị cơ sở, đúng bằng `qty` dùng để sắp xếp.
    expect(tongSoSL(nv.qtyTheoDv)).toBe(652)
    expect(tongSoSL(nv.qtyTheoDv)).toBe(nv.qty)
    expect(tongSoSL(nv.returnQtyTheoDv)).toBe(nv.returnQty)
    const banh = nv.products.find((p) => p.productId === "banh")!
    expect(banh.qtyTheoDv).toEqual({ hộp: 640 })
    expect(hienSLTheoDonVi(banh.qtyTheoDv)).toBe("640 hộp")
  })
})

describe("các trang báo cáo hiện SL gộp qua hienSLTheoDonVi", () => {
  const E = code(read(`${D}/employees/page.tsx`))
  /** Bảng chính của "Hàng bán theo nhân viên": cột + dòng tổng (trước phần chi tiết mở ra). */
  const dauTongHop = E.indexOf('variant === "summary" ? (')
  const TONG_HOP = E.slice(dauTongHop, E.indexOf("expandable={(r) => (", dauTongHop))
  const CON_LAI = E.slice(0, dauTongHop) + E.slice(dauTongHop + TONG_HOP.length)
  it("Nhân viên › Theo mặt hàng / Theo khách: dòng NV, dòng khách, dòng tổng theo từng đơn vị", () => {
    expect(CON_LAI).toContain("hienSLTheoDonVi(r.qtyTheoDv)")
    expect(CON_LAI).toContain("hienSLTheoDonVi(c.qtyTheoDv)")
    expect(CON_LAI).toContain("hienSLTheoDonVi(totalsProducts.qtyTheoDv)")
    expect(CON_LAI).toContain("hienSLTheoDonVi(totalsByCustomer.qtyTheoDv)")
    // Không in số lẫn đơn vị của dòng tổng / dòng NV / dòng khách.
    expect(E).not.toMatch(/\br\.qty\.toLocaleString/)
    expect(E).not.toMatch(/\br\.returnQty\.toLocaleString/)
    expect(E).not.toMatch(/totals\w*\.qty\.toLocaleString/)
    expect(E).not.toMatch(/reduce\(\(s, r\) => s \+ r\.(qty|returnQty)/)
  })
  it("Nhân viên › Hàng bán theo nhân viên: phần tổng hợp MỘT số + 'đơn vị' (chủ nhà 03/11/2026)", () => {
    expect(dauTongHop).toBeGreaterThan(0)
    expect(TONG_HOP).toContain("render: (r) => hienTongSL(r.qtyTheoDv)")
    expect(TONG_HOP).toContain("render: () => DON_VI_TONG")
    expect(TONG_HOP).toContain("render: (r) => hienTongSL(r.returnQtyTheoDv)")
    expect(TONG_HOP).toMatch(/\{ content: hienTongSL\(totalsSummaryQty\), align: "right" \},\s*\{ content: DON_VI_TONG \},/)
    expect(TONG_HOP).toContain("{ content: hienTongSL(totalsSummaryReturnQty), align: \"right\" }")
    // Không còn diễn giải "640 hộp · 12 chai" ở phần tổng hợp.
    expect(TONG_HOP).not.toContain("hienSLTheoDonVi(")
    // Excel dòng "(Tổng hợp)": cột Đơn vị "đơn vị", SL bán / SL trả / SL thực bán là SỐ.
    expect(E).toMatch(/"\(Tổng hợp\)",\s*DON_VI_TONG,\s*tongSoSL\(r\.qtyTheoDv\),/)
    expect(E).toMatch(/tongSoSL\(r\.returnQtyTheoDv\),\s*-r\.returnValue,/)
    expect(E).toContain("tongSoSL(truSL(r.qtyTheoDv, r.returnQtyTheoDv)),")
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
