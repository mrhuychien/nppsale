/**
 * Chủ nhà 03/10/2026 (Update 3.10 mục 2): "gộp Nhóm hàng vào NCC" → "Bỏ luôn trường nhóm hàng".
 * Cột `products.category` VẪN Ở DB (dữ liệu cũ không mất, không migration) nhưng không màn nào còn hiện /
 * lọc / gom theo nó — hàng được gom theo Nhà cung cấp (NCC chính của mặt hàng).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { LOC_SAN_PHAM } from "@/lib/search/list-filter-fields"
import { PRODUCT_COLUMNS, PRODUCT_FILTERS, DEFAULT_PRODUCT_COLUMNS } from "@/app/(dashboard)/products/list-config"
import { parseProductSheet, TEMPLATE_HEADERS } from "@/lib/products/import-parse"
import { LOAI_LOC } from "@/lib/bao-cao/cong"

const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
/** Bỏ chú thích — chú thích được phép nhắc tên trường cũ để giải thích vì sao bỏ. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("danh sách sản phẩm: không còn cột / ô lọc Danh mục (= nhóm hàng)", () => {
  it("cột + bộ lọc chọn được không có category", () => {
    expect(PRODUCT_COLUMNS.map((c) => c.key)).not.toContain("category")
    expect(DEFAULT_PRODUCT_COLUMNS).not.toContain("category")
    expect(PRODUCT_FILTERS.map((f) => f.key)).not.toContain("category")
  })
  it("lọc nâng cao không còn trường Nhóm hàng", () => {
    expect(LOC_SAN_PHAM.map((t) => t.cot)).not.toContain("category")
    expect(LOC_SAN_PHAM.map((t) => t.nhan)).not.toContain("Nhóm hàng")
  })
  it("trang danh sách không đọc / lọc / hiện category", () => {
    const s = code("src/app/(dashboard)/products/page.tsx")
    expect(s).not.toContain("categoryFilter")
    expect(s).not.toMatch(/\.eq\("category"/)
    expect(s).not.toContain("xem.category")
    const t = code("src/components/products/product-table.tsx")
    expect(t).not.toContain("p.category")
  })
})

describe("nhập Excel sản phẩm: bỏ qua cột Danh mục", () => {
  it("file mẫu không còn cột Danh mục", () => {
    expect(TEMPLATE_HEADERS as readonly string[]).not.toContain("Danh mục")
  })
  it("file cũ có cột Danh mục vẫn nhập được, cột ấy bị bỏ qua", () => {
    const r = parseProductSheet([
      ["Tên sản phẩm", "Đơn vị tính", "Nhà cung cấp", "Danh mục"],
      ["Sữa hộp", "hộp", "Vinamilk", "Sữa"],
    ])
    expect(r.headerError).toBeNull()
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].supplier_name).toBe("Vinamilk")
    expect("category" in r.rows[0]).toBe(false)
  })
  it("cột 'Nhóm hàng' của KiotViet vẫn là nguồn NCC", () => {
    const r = parseProductSheet([
      ["Tên hàng", "ĐVT", "Nhóm hàng"],
      ["Mì gói", "gói", "Cty Tân Việt"],
    ])
    expect(r.rows[0].supplier_name).toBe("Cty Tân Việt")
  })
  it("hộp thoại nhập không ghi category", () => {
    expect(code("src/components/products/product-import-dialog.tsx")).not.toMatch(/\bcategory\b/)
  })
})

describe("báo cáo tổng hợp: Nhóm hàng → Nhà cung cấp", () => {
  it("không còn loại lọc pgroup", () => {
    expect("pgroup" in LOAI_LOC).toBe(false)
  })
  it("Bán hàng: 'Xem theo' có Nhà cung cấp, không có Nhóm hàng", () => {
    const s = code("src/components/bao-cao/man-ban-hang.tsx")
    expect(s).not.toContain("pgroup")
    expect(s).toContain('ncc: { label: "Nhà cung cấp", loc: "ncc", tiep: "prod" }')
    expect(s).toContain('case "ncc": return dm.sp.get(l.sp)?.ncc || CHUA_CO')
  })
  it("Kho: không còn chế độ Nhóm hàng; gom theo NCC", () => {
    const s = code("src/components/bao-cao/man-kho.tsx")
    expect(s).not.toContain("pgroup")
    expect(s).not.toContain("Nhóm hàng")
    expect(s).toContain('const loai: LoaiLoc[] = ["prod", "ncc"]')
  })
  it("danh mục báo cáo không đọc category", () => {
    expect(code("src/lib/bao-cao/nap-danh-muc.ts")).not.toMatch(/\bcategory\b/)
  })
})

describe("báo cáo cũ / phân tích: không còn Nhóm hàng / Loại hàng / Ngành hàng", () => {
  const MAN = [
    "src/app/(dashboard)/reports/products/page.tsx",
    "src/app/(dashboard)/reports/products/_views/stock-value.tsx",
    "src/app/(dashboard)/reports/inventory/page.tsx",
    "src/app/(dashboard)/reports/employees/page.tsx",
    "src/app/(dashboard)/reports/orders/page.tsx",
    "src/app/(dashboard)/analytics/products/overview/page.tsx",
    "src/app/(dashboard)/analytics/products/stock/page.tsx",
    "src/app/(dashboard)/analytics/products/categories/page.tsx",
    "src/app/(dashboard)/analytics/business/overview/page.tsx",
    "src/lib/analytics/filter-catalogs.ts",
  ]
  it.each(MAN)("%s", (f) => {
    const s = code(f)
    expect(s).not.toMatch(/"Nhóm hàng|Nhóm hàng"|"Loại hàng|"Ngành hàng|Phân bổ theo danh mục/)
    expect(s).not.toMatch(/\bcategory\b|categoryFilter|catalogs\.categories/)
  })
  it("báo cáo Hàng hóa gộp theo NCC chính", () => {
    const s = code("src/app/(dashboard)/reports/products/page.tsx")
    expect(s).toContain("if (groupSameType) return p.primary_supplier_id || CHUA_GAN_NCC")
    expect(s).toContain('label="Gộp theo nhà cung cấp"')
  })
  it("'Phân loại hàng hóa' không còn trên menu Phân tích", () => {
    expect(code("src/components/analytics/analytics-sidebar.tsx")).not.toContain("/analytics/products/categories")
    expect(code("src/app/(dashboard)/analytics/products/layout.tsx")).not.toContain("/analytics/products/categories")
  })
})
