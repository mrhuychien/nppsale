import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const PAGE = code(readFileSync("src/app/(dashboard)/reports/products/page.tsx", "utf8"))
const BAN = code(readFileSync("src/app/(dashboard)/reports/products/_views/sales-by-product.tsx", "utf8"))
const KHO = code(readFileSync("src/app/(dashboard)/reports/products/_views/stock-value.tsx", "utf8"))

/** ⚠ CHỦ NHÀ 24/09/2026: "sửa luôn 2 lỗi thấy thêm" (Báo cáo > Hàng hóa, gộp theo nhóm). */
describe("Hàng hóa > Bán hàng: mở dòng nhóm có chi tiết", () => {
  /** Gộp theo nhóm thì `id` là TÊN NHÓM — lọc chi tiết theo `id` là luôn trống. */
  it("chi tiết lọc theo các mặt hàng của dòng, không theo id dòng", () => {
    expect(BAN).toContain("const trong = new Set(r.productIds)")
    expect(BAN).toContain("orderLines.filter((l) => trong.has(l.product_id))")
    expect(BAN).not.toContain("l.product_id === r.id")
  })
  it("dòng ghi đủ mặt hàng từ cả dòng bán lẫn dòng trả", () => {
    const i = PAGE.indexOf("const salesRows: SalesByProductRow[] = useMemo(")
    const body = PAGE.slice(i, PAGE.indexOf("// -------------------- Lợi nhuận", i))
    expect(body.match(/ghiMatHang\(e, p\.id\)/g)?.length).toBe(2)
  })
  it("SL từng hóa đơn trong chi tiết giữ theo đơn vị (nhóm nhiều mặt hàng)", () => {
    expect(BAN).toContain("congSL(e.qtyTheoDv, sp?.base_unit || \"\", soLuongCoSoDongHd(l, sp))")
    expect(BAN).toContain("hienSLTheoDonVi(d.qtyTheoDv)")
  })
})

describe("Hàng hóa > Giá trị kho: Giá vốn TB chỉ khi một đơn vị cơ sở", () => {
  it("dòng lẫn đơn vị → không tính giá vốn TB", () => {
    expect(PAGE).toContain("unit_cost: Object.keys(rest.qtyTheoDv).length === 1 && _qtyAccum > 0 ? _valAccum / _qtyAccum : null")
    expect(KHO).toContain('r.unit_cost === null ? "—" : formatCurrency(r.unit_cost)')
    expect(PAGE).toContain('r.unit_cost ?? "—"')
  })
})
