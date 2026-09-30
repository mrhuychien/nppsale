/**
 * Chủ nhà 30/09/2026: "Làm lại các màn … Danh sách sản phẩm" (thiết kế "ds-san-pham") — chip NCC chính
 * có số, "N đang bán", dòng phụ thẻ, "Xem thêm · đang hiện 20/N". Bấm thật: e2e/ds-san-pham-mobile-thiet-ke.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  chipNcc,
  demNccTuDong,
  docDemNcc,
  dongPhuSanPham,
  nhanSoSanPham,
  nhanXemThem,
  sapXepTiepTheo,
  soDangBan,
  NCC_CHUA_GAN,
} from "@/lib/products/mobile-list"

const NCC = [
  { id: "a", name: "Cty Á Châu" },
  { id: "p", name: "Cty Phương Hiển" },
  { id: "b", name: "Cty An Phát" },
]

describe("chip NCC của danh sách sản phẩm (điện thoại)", () => {
  const dem = demNccTuDong([
    { primary_supplier_id: "p", status: "active" },
    { primary_supplier_id: "a", status: "active" },
    { primary_supplier_id: "a", status: "active" },
    { primary_supplier_id: "a", status: "inactive" },
    { primary_supplier_id: "p", status: "active" },
    { primary_supplier_id: "b", status: "active" },
    { primary_supplier_id: null, status: "active" },
  ])

  it("Tất cả đầu tiên, NCC nhiều hàng trước, bằng nhau theo tên, chưa gán cuối", () => {
    expect(chipNcc(dem, NCC, "all")).toEqual([
      { key: "all", label: "Tất cả", count: 7 },
      { key: "a", label: "Cty Á Châu", count: 3 },
      { key: "p", label: "Cty Phương Hiển", count: 2 },
      { key: "b", label: "Cty An Phát", count: 1 },
      { key: NCC_CHUA_GAN, label: "Chưa gán NCC", count: 1 },
    ])
  })

  it("đếm theo trạng thái đang lọc — Á Châu còn 2 đang bán, bằng Phương Hiển thì xếp theo tên", () => {
    const c = chipNcc(dem, NCC, "active")
    expect(c[0]).toEqual({ key: "all", label: "Tất cả", count: 6 })
    expect(c.slice(1, 3).map((x) => x.key)).toEqual(["a", "p"])
    expect(chipNcc(dem, NCC, "inactive").map((x) => [x.key, x.count])).toEqual([["all", 1], ["a", 1]])
  })

  it("N đang bán = cộng nhóm active", () => {
    expect(soDangBan(dem)).toBe(6)
  })

  it("đọc kết quả gom nhóm của máy chủ; sai dạng thì trả null để đếm kiểu cũ", () => {
    expect(docDemNcc({ data: [{ primary_supplier_id: "a", status: "active", count: 3 }, { primary_supplier_id: null, status: "inactive", count: "2" }], error: null }))
      .toEqual([{ ncc: "a", status: "active", n: 3 }, { ncc: null, status: "inactive", n: 2 }])
    expect(docDemNcc({ data: null, error: { message: "aggregates disabled" } })).toBeNull()
    expect(docDemNcc({ data: [{ primary_supplier_id: "a", status: "active" }], error: null })).toBeNull()
  })

  it("NCC không có trong danh sách (RLS) vẫn có chip", () => {
    expect(chipNcc([{ ncc: "x", status: "active", n: 2 }], NCC, "all")[1]).toEqual({ key: "x", label: "NCC khác", count: 2 })
  })
})

describe("chữ trên màn", () => {
  it("dòng phụ SKU · đơn vị · NCC, bỏ phần trống", () => {
    expect(dongPhuSanPham({ sku: "SP000295", base_unit: "hộp", supplier: { name: "Cty Á Châu" } })).toBe("SP000295 · hộp · Cty Á Châu")
    expect(dongPhuSanPham({ sku: "SP1", base_unit: "gói", supplier: null })).toBe("SP1 · gói")
  })
  it("đếm + xem thêm", () => {
    expect(nhanSoSanPham(1751)).toBe("1.751 sản phẩm")
    expect(nhanXemThem(20, 1751)).toBe("Xem thêm · đang hiện 20/1.751")
    expect(nhanXemThem(1751, 1751)).toBeNull()
  })
  it("sắp xếp xoay vòng A–Z ↔ Z–A", () => {
    expect(sapXepTiepTheo("name_asc")).toBe("name_desc")
    expect(sapXepTiepTheo("name_desc")).toBe("name_asc")
  })
})

describe("trang /products dùng màn điện thoại riêng", () => {
  const src = readFileSync("src/app/(dashboard)/products/page.tsx", "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(l))
    .join("\n")
  it("DocListLayout cards={null}, không còn mobileHead", () => {
    expect(src).toContain("<MobileProductsScreen")
    expect(src).toContain("cards={null}")
    expect(src).not.toContain("mobileHead={")
  })
  it("chip chưa gán NCC lọc bằng IS NULL (cả danh sách lẫn số đếm)", () => {
    expect(src.match(/supplierFilter === NCC_CHUA_GAN\) q = q\.is\("primary_supplier_id", null\)/g)?.length).toBe(2)
  })
  it("giá trên thẻ cùng công thức giaMacDinh", () => {
    const man = readFileSync("src/components/products/mobile-products-screen.tsx", "utf8")
    expect(man).toContain("const gia = giaMacDinh(p)")
    expect(man).toContain('canCreate && (')
  })
})
