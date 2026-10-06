import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * ⚠ CHỦ NHÀ 03/10/2026 (Update 3.10): "Phần nhập hàng trên di động — khi tìm kiếm hàng thêm nút thêm sản phẩm
 *   ở top, cạnh nút chọn nhiều sản phẩm. — Khi tìm kiếm ncc, thêm nút thêm NCC" · "Khi tạo xong sản phẩm hoặc
 *   NCC -> bấm xong thì quay về phần đang làm … add luôn".
 * Chốt bấm thật ở e2e/nhap-hang-mobile-tao-nhanh.spec.ts; ở đây giữ các mối nối dễ bị gỡ nhầm.
 */

/** Bỏ dòng chú thích theo từng dòng (không regex — xem SKILL "Testing UI by reading source"). */
function ma(rel: string): string {
  const out: string[] = []
  let trongKhoi = false
  for (const l of readFileSync(rel, "utf8").split("\n")) {
    const t = l.trim()
    if (trongKhoi) {
      if (t.includes("*/")) trongKhoi = false
      continue
    }
    if (t.startsWith("{/*") || t.startsWith("/*")) {
      if (!t.includes("*/")) trongKhoi = true
      continue
    }
    if (t.startsWith("*") || t.startsWith("//")) continue
    out.push(l)
  }
  return out.join("\n")
}
function cat(src: string, tu: string, den?: string): string {
  const i = src.indexOf(tu)
  expect(i, `không thấy mốc ${tu}`).toBeGreaterThan(0)
  const j = den ? src.indexOf(den, i + tu.length) : -1
  return src.slice(i, j > i ? j : undefined)
}

const PHIEU = ma("src/components/purchasing/phieu-ncc-mobile.tsx")
const NHAP_KHO = ma("src/components/inventory/stock-in-mobile.tsx")
const TRANG_NHAP_KHO = ma("src/app/(dashboard)/inventory/stock-in/page.tsx")

describe("phiếu nhập / trả NCC điện thoại — Thêm sản phẩm ở đầu màn", () => {
  const dau = cat(PHIEU, 'data-testid="buoc-them-hang"', "{nccButton}")

  it("nút nằm ở hàng đầu màn, ngay trước nút Chọn nhiều, gác theo quyền tạo sản phẩm", () => {
    expect(PHIEU).toContain('const duocTaoSp = duocTaoNhanh(user?.role, "san-pham")')
    const nut = cat(dau, "{duocTaoSp && (", 'data-testid="chon-nhieu"')
    expect(nut).toContain('data-testid="them-san-pham"')
    expect(nut).toContain("setTaoSp({ chu: q })")
  })

  it("ô trống (không khớp mã nào) cũng mời tạo, mang chữ đang tìm", () => {
    const trong = cat(PHIEU, 'data-testid="hang-trong"', "danhSach.map(")
    expect(trong).toContain("{duocTaoSp && (")
    expect(trong).toContain("setTaoSp({ chu: q })")
  })

  it("lưu xong: hàng vào danh mục của màn rồi thêm như chạm thẻ (giữ luật chọn từng mã / chọn nhiều)", () => {
    const daTao = cat(PHIEU, "const daTaoHang = async", "const hopLe")
    expect(daTao).toContain("docSanPhamVuaTao<ReceiptProduct>")
    expect(daTao).toContain("setHangMoi(")
    expect(daTao).toContain("cham(moi, moi.base_unit, false)")
    // Thẻ, tra mã và cảnh báo NCC khác đều đọc danh mục đã ghép hàng mới — không phải `products` của trang.
    expect(PHIEU).toContain("const dsHang = useMemo(() => ganGiaNhap(gopVuaTao(products, hangMoi), bangGiaNhap)")
    expect(PHIEU).toContain("new Map(dsHang.map(")
    expect(PHIEU).toContain("dsHang.filter((p) => inSupplierScope(")
    expect(PHIEU).toContain("linesOutOfSupplierScope(lines, dsHang")
  })

  it("NCC của phiếu điền sẵn cho hàng mới", () => {
    const khung = cat(PHIEU, "<TaoNhanhSanPham", "/>")
    expect(khung).toContain("nccBanDau={value.supplierId || undefined}")
    expect(khung).toContain("onDaTao={(sp) => void daTaoHang(sp)}")
    expect(ma("src/components/tao-nhanh/tao-nhanh-san-pham.tsx")).toContain("nccBanDau={nccBanDau}")
    expect(ma("src/components/products/product-form.tsx")).toContain(
      'primary_supplier_id: product?.primary_supplier_id || nccBanDau || ""'
    )
  })
})

describe("tấm chọn NCC — Thêm NCC", () => {
  const tam = cat(PHIEU, "function ChonNccSheet(", "function SuaDongSheet(")

  it("nút ở đầu tấm và dòng tạo mới ở cuối danh sách (cả khi không khớp), đều mang chữ đang tìm", () => {
    expect(tam).toContain('data-testid="them-ncc"')
    expect(tam).toContain('data-testid="tao-ncc-moi"')
    expect(tam.match(/onTaoMoi\(q\)/g)?.length).toBe(2)
    // Dòng tạo mới nằm NGOÀI nhánh "không tìm thấy" — có kết quả vẫn hiện ở cuối.
    const sauDs = cat(tam, "ds.map((s) =>")
    expect(sauDs).toContain('data-testid="tao-ncc-moi"')
  })

  it("gác theo quyền tạo NCC; đóng tấm chọn trước khi mở khung tạo; lưu xong chọn luôn NCC cho phiếu", () => {
    expect(PHIEU).toContain('const duocTaoNcc = duocTaoNhanh(user?.role, "ncc")')
    expect(PHIEU).toContain("onTaoMoi={duocTaoNcc ? (chu) => { setNccOpen(false); setTaoNcc({ chu }) } : undefined}")
    const khung = cat(PHIEU, "<TaoNhanhNcc", "/>")
    expect(khung).toContain("setNccMoi(")
    expect(khung).toContain("onChange({ supplierId: n.id })")
    // Tên NCC mới hiện được: tấm chọn và nút NCC đọc danh sách đã ghép.
    expect(PHIEU).toContain("suppliers={dsNcc}")
    expect(PHIEU).toContain("const supplier = dsNcc.find(")
  })
})

describe("nhập kho điện thoại — Thêm sản phẩm cạnh nút quét", () => {
  it("nút chỉ hiện khi trang truyền `onTaoSanPham` (trang gác theo quyền, điền sẵn chữ đang tìm)", () => {
    const o = cat(NHAP_KHO, 'aria-label="Quét mã"', "nk-m-trong")
    expect(o).toContain("{p.onTaoSanPham && (")
    expect(o).toContain('data-testid="nk-m-them-san-pham"')
    expect(TRANG_NHAP_KHO).toContain("onTaoSanPham={coQuyenTaoSp ? () => setTaoSp({ chu: productSearch }) : undefined}")
  })
})
