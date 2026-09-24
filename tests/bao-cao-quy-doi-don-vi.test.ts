import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { giaNiemYetDonVi, heSoQuyDoi, soLuongCoSo, type SanPhamQuyDoi } from "../src/lib/analytics/units"
import { congHangBanNhanVien, giaTriNiemYetDong, type SanPhamHangBan } from "../src/lib/analytics/hang-ban-nhan-vien"
import {
  giaTriDongKho,
  giaVonBinhQuanCoSo,
  soLuongCoSoDongHd,
  soLuongCoSoDongKho,
  soLuongCoSoDongTra,
} from "../src/lib/analytics/sales"

/**
 * ⚠ CHỦ NHÀ 24/09/2026 (Báo cáo > Nhân viên > Hàng bán theo nhân viên):
 *   SP001945 "Bánh lễ đậu xanh 100g (10h/khay x 6 khay/th)" hiện SL 64 "hộp",
 *   niêm yết 844.800đ, doanh thu 8.640.000đ, chênh 7.795.200đ. 64 là KHAY;
 *   13.200đ là giá một HỘP. Niêm yết đúng = 64 × 132.000 = 8.448.000, SL = 640 hộp.
 */

const BANH: SanPhamHangBan = {
  id: "sp1945",
  sku: "SP001945",
  name: "Bánh lễ đậu xanh 100g (10h/khay x 6 khay/th)",
  base_unit: "hộp",
  sell_price: 13200,
  units: [
    { unit_name: "khay", conversion: 10 },
    { unit_name: "thùng", conversion: 60 },
  ],
  price_lists: [],
}

describe("heSoQuyDoi", () => {
  it("ưu tiên hệ số chụp trên dòng hơn danh mục", () => {
    expect(heSoQuyDoi(BANH, "khay", 12)).toBe(12)
    expect(heSoQuyDoi(BANH, "khay", "10")).toBe(10)
  })
  it("không có số chụp (hoặc 0 / rỗng) → tra danh mục", () => {
    expect(heSoQuyDoi(BANH, "thùng")).toBe(60)
    expect(heSoQuyDoi(BANH, "khay", 0)).toBe(10)
    expect(heSoQuyDoi(BANH, "khay", null)).toBe(10)
  })
  it("đơn vị cơ sở, đơn vị lạ, không có mặt hàng → 1", () => {
    expect(heSoQuyDoi(BANH, "hộp")).toBe(1)
    expect(heSoQuyDoi(BANH, "bao")).toBe(1)
    expect(heSoQuyDoi(null, "khay")).toBe(1)
  })
  it("soLuongCoSo", () => {
    expect(soLuongCoSo(64, 10)).toBe(640)
    expect(soLuongCoSo(null, 10)).toBe(0)
  })
})

describe("giaNiemYetDonVi", () => {
  const sp: SanPhamQuyDoi = {
    base_unit: "hộp",
    sell_price: 13200,
    units: [{ unit_name: "khay", conversion: 10 }],
    price_lists: [
      { unit_name: "khay", price: 125000, group_id: null },
      { unit_name: "khay", price: 100000, group_id: "nhom-si" },
    ],
  }
  it("bảng giá chung của đúng đơn vị (bỏ giá theo nhóm)", () => {
    expect(giaNiemYetDonVi(sp, "khay", 10)).toBe(125000)
  })
  it("không có bảng giá đơn vị → giá cơ sở × hệ số", () => {
    expect(giaNiemYetDonVi(BANH, "khay", 10)).toBe(132000)
    expect(giaNiemYetDonVi(BANH, "hộp", 1)).toBe(13200)
  })
  it("bảng giá của đơn vị cơ sở thắng `sell_price`", () => {
    const x: SanPhamQuyDoi = { ...BANH, price_lists: [{ unit_name: "hộp", price: 14000, group_id: null }] }
    expect(giaNiemYetDonVi(x, "khay", 10)).toBe(140000)
    expect(giaNiemYetDonVi(x, "hộp", 1)).toBe(14000)
  })
  it("không có mặt hàng → 0", () => {
    expect(giaNiemYetDonVi(null, "khay", 10)).toBe(0)
  })
})

describe("SP001945 — Hàng bán theo nhân viên", () => {
  const line = {
    product_id: "sp1945",
    unit_name: "khay",
    conversion_factor: 10,
    quantity: 64,
    unit_price: 135000,
    line_total: 8640000,
  }
  const sanPham = new Map([[BANH.id, BANH]])

  it("niêm yết theo giá khay, SL quy về hộp", () => {
    const [nv] = congHangBanNhanVien({ ban: [{ uid: "nv1", line }], tra: [], sanPham })
    expect(nv.qty).toBe(640)
    expect(nv.listed).toBe(8448000)
    expect(nv.revenue).toBe(8640000)
    expect(nv.diff).toBe(192000)
    const p = nv.products[0]
    expect(p.unit).toBe("hộp")
    expect(p.qty).toBe(640)
    expect(p.listed).toBe(64 * 132000)
  })

  it("không còn con số cũ 844.800 / chênh 7.795.200", () => {
    const [nv] = congHangBanNhanVien({ ban: [{ uid: "nv1", line }], tra: [], sanPham })
    expect(nv.listed).not.toBe(844800)
    expect(nv.diff).not.toBe(7795200)
  })

  it("bảng giá khay có sẵn thì dùng đúng giá đó", () => {
    const sp = { ...BANH, price_lists: [{ unit_name: "khay", price: 130000, group_id: null }] }
    expect(giaTriNiemYetDong(line, sp)).toBe(64 * 130000)
  })

  it("chưa có giá niêm yết nào → lấy đơn giá trên dòng (chênh 0)", () => {
    const sp = { ...BANH, sell_price: 0 }
    expect(giaTriNiemYetDong(line, sp)).toBe(64 * 135000)
  })

  it("dòng trả (không có hệ số chụp) quy về hộp qua danh mục; thùng + hộp cộng đúng", () => {
    const [nv] = congHangBanNhanVien({
      ban: [
        { uid: "nv1", line },
        { uid: "nv1", line: { ...line, unit_name: "hộp", conversion_factor: 1, quantity: 5, unit_price: 13500, line_total: 67500 } },
      ],
      tra: [{ uid: "nv1", line: { product_id: "sp1945", unit_name: "thùng", quantity: 1, line_total: 810000 } }],
      sanPham,
    })
    expect(nv.qty).toBe(645)
    expect(nv.listed).toBe(8448000 + 5 * 13200)
    expect(nv.returnQty).toBe(60)
    expect(nv.returnValue).toBe(810000)
    expect(nv.netRevenue).toBe(8640000 + 67500 - 810000)
  })
})

describe("giá vốn theo đơn vị cơ sở", () => {
  it("dòng kho: ưu tiên qty_in_base_uom, rồi quantity × hệ số chụp", () => {
    expect(soLuongCoSoDongKho({ quantity: 64, qty_in_base_uom: 640, conversion_factor_snapshot: 10 })).toBe(640)
    expect(soLuongCoSoDongKho({ quantity: -64, qty_in_base_uom: null, conversion_factor_snapshot: 10 })).toBe(640)
    expect(soLuongCoSoDongKho({ quantity: -2 })).toBe(2)
    expect(giaTriDongKho({ quantity: 64, qty_in_base_uom: 640, unit_cost: 11000 })).toBe(640 * 11000)
  })
  it("giá vốn bình quân là giá mỗi ĐƠN VỊ CƠ SỞ", () => {
    const avg = giaVonBinhQuanCoSo([
      { product_id: "p", quantity: 64, qty_in_base_uom: 640, unit_cost: 11000 },
      { product_id: "p", quantity: 5, qty_in_base_uom: 5, unit_cost: 11000 },
    ])
    expect(avg.get("p")).toBe(11000)
  })
  it("dòng hóa đơn / dòng trả quy về cơ sở", () => {
    expect(soLuongCoSoDongHd({ quantity: 64, unit_name: "khay", conversion_factor: 10 }, null)).toBe(640)
    expect(soLuongCoSoDongHd({ quantity: 64, unit_name: "khay", conversion_factor: 0 }, BANH)).toBe(640)
    expect(soLuongCoSoDongTra({ quantity: 2, unit_name: "thùng" }, BANH)).toBe(120)
  })
})

/* ---------- kiểm nguồn: các màn báo cáo không còn nhân / cộng SL thô ---------- */

const ROOT = resolve(__dirname, "..")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const R = "src/app/(dashboard)/reports"
const TEP = [
  `${R}/employees/page.tsx`,
  `${R}/sales/page.tsx`,
  `${R}/products/page.tsx`,
  `${R}/customers/page.tsx`,
  ...readdirSync(join(ROOT, R, "sales/_views")).map((f) => `${R}/sales/_views/${f}`),
  ...readdirSync(join(ROOT, R, "products/_views")).map((f) => `${R}/products/_views/${f}`),
]

describe("báo cáo không dùng SL thô", () => {
  for (const rel of TEP) {
    const s = code(readFileSync(join(ROOT, rel), "utf-8"))
    it(`${rel}: không nhân SL với sell_price`, () => {
      expect(s).not.toMatch(/\.sell_price\b/)
      expect(s).not.toMatch(/quantity[^;\n]*\*[^;\n]*sell_price/)
    })
    it(`${rel}: không cộng / nhân \`quantity\` thô`, () => {
      expect(s).not.toMatch(/Number\((l|rl)\.quantity/)
      expect(s).not.toMatch(/\+=\s*(l|rl)\.quantity/)
      expect(s).not.toMatch(/(l|rl)\.quantity\s*\*/)
    })
  }

  it("màn nhân viên dùng phần cộng dồn đã quy đổi", () => {
    const s = code(readFileSync(join(ROOT, R, "employees/page.tsx"), "utf-8"))
    expect(s).toContain("congHangBanNhanVien(")
    expect(s).toContain("giaVonBinhQuanCoSo(")
    expect(s).toContain("COT_SP_QUY_DOI")
  })

  it("lib/analytics/sales đọc cột quy đổi của dòng kho và dòng trả", () => {
    const s = code(readFileSync(join(ROOT, "src/lib/analytics/sales.ts"), "utf-8"))
    expect(s).toMatch(/COT_DONG_KHO =\s*"[^"]*qty_in_base_uom[^"]*conversion_factor_snapshot/)
    expect(s.match(/\.select\(COT_DONG_KHO/g)?.length).toBe(2)
    expect(s).toContain('"return_id, product_id, unit_name, quantity, line_total"')
    expect(s).not.toMatch(/Math\.abs\(Number\(l\.quantity\)\)/)
  })

  it("các màn này vẫn đọc doanh số từ hóa đơn đã ghi sổ", () => {
    for (const rel of TEP.slice(0, 4)) {
      const s = code(readFileSync(join(ROOT, rel), "utf-8"))
      expect(s, rel).toContain("fetchRevenueInvoicesDu(")
      expect(s, rel).toContain("fetchInvoiceLines(")
      expect(s, rel).not.toContain("fetchOrderLines(")
    }
  })
})
