/**
 * QUÉT MÃ VẠCH Ở FORM SẢN PHẨM — chủ nhà 24/10/2026: "phần thêm sản phẩm đoạn mã vạch thêm cho tao phần quét mã vạch nhé".
 *
 * Ô Mã vạch của ProductForm (máy tính, điện thoại, khung tạo nhanh) có nút quét → dùng lại `BarcodeScanner` của nhập kho /
 * xuất kho / POS (camera + nhập tay); mã đọc được điền vào ô. Enter của máy quét USB trong ô KHÔNG gửi form. Mã đã gắn cho
 * sản phẩm khác → cảnh báo, vẫn cho lưu. Luật mã: src/lib/products/ma-vach.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cauTrungMaVach, chuanMaVach, sanPhamTrungMaVach } from "@/lib/products/ma-vach"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const FORM = read("src/components/products/product-form.tsx")
const SCANNER = read("src/components/ui/barcode-scanner.tsx")

describe("chuanMaVach — mã từ máy quét / camera về dạng lưu", () => {
  it("bỏ CR / LF / tab máy quét gửi kèm, cắt khoảng trắng hai đầu", () => {
    expect(chuanMaVach("8930000000011\r\n")).toBe("8930000000011")
    expect(chuanMaVach("\t 8930000000011 \n")).toBe("8930000000011")
    expect(chuanMaVach("893\r\n0000000011")).toBe("8930000000011")
  })
  it("giữ hoa thường và khoảng trắng ở giữa (Code128 có thể có); rỗng / null → chuỗi rỗng", () => {
    expect(chuanMaVach("ABC 123")).toBe("ABC 123")
    expect(chuanMaVach("")).toBe("")
    expect(chuanMaVach("   ")).toBe("")
    expect(chuanMaVach(null)).toBe("")
    expect(chuanMaVach(undefined)).toBe("")
  })
})

describe("sanPhamTrungMaVach — sản phẩm KHÁC đang mang mã", () => {
  const sua = { id: "sp-sua", name: "Sữa hộp", sku: "SUA1" }
  const mi = { id: "sp-mi", name: "Mì tôm", sku: null }
  it("tạo mới: dòng đầu là trùng; không có dòng → null", () => {
    expect(sanPhamTrungMaVach([sua, mi])).toEqual(sua)
    expect(sanPhamTrungMaVach([])).toBeNull()
    expect(sanPhamTrungMaVach(null)).toBeNull()
    expect(sanPhamTrungMaVach(undefined)).toBeNull()
  })
  it("sửa hàng: chính nó mang mã thì không trùng; hàng khác thì trùng", () => {
    expect(sanPhamTrungMaVach([sua], "sp-sua")).toBeNull()
    expect(sanPhamTrungMaVach([sua, mi], "sp-sua")).toEqual(mi)
    expect(sanPhamTrungMaVach([sua], "sp-khac")).toEqual(sua)
  })
})

describe("cauTrungMaVach — lời cảnh báo", () => {
  it("nêu mã, tên và mã hàng của sản phẩm đang giữ mã; cảnh báo chứ không cấm", () => {
    const c = cauTrungMaVach("8930000000011", { id: "x", name: "Sữa hộp", sku: "SUA1" })
    expect(c.title).toBe("Mã vạch đã gắn cho sản phẩm khác")
    expect(c.description).toContain("8930000000011")
    expect(c.description).toContain("“Sữa hộp” (SUA1)")
    expect(c.description).toContain("Kiểm tra lại trước khi lưu")
  })
  it("không có mã hàng thì không mở ngoặc rỗng", () => {
    expect(cauTrungMaVach("1", { id: "x", name: "Mì tôm", sku: null }).description).toContain("“Mì tôm”.")
  })
})

describe("form sản phẩm nối với bộ quét dùng chung", () => {
  it("nút quét ở ô Mã vạch mở BarcodeScanner; mã quét điền vào ô qua nhanMaQuet; nhãn nhập tay là “Dùng mã này”", () => {
    expect(FORM).toContain('data-testid="quet-ma-vach"')
    expect(FORM).toContain('aria-label="Quét mã vạch"')
    expect(FORM).toContain('import { BarcodeScanner } from "@/components/ui/barcode-scanner"')
    expect(FORM).toMatch(/<BarcodeScanner\s+open=\{quetMo\}\s+onClose=\{\(\) => setQuetMo\(false\)\}\s+onScan=\{nhanMaQuet\}\s+title="Quét mã vạch sản phẩm"\s+manualLabel="Dùng mã này"/)
    expect(FORM).toContain("setForm((f) => ({ ...f, barcode: ma }))")
  })
  it("camera bắn 10 lần/giây — mỗi lần mở chỉ nhận MỘT mã (daNhanRef), mở lại thì nhận lại", () => {
    expect(FORM).toContain("if (!ma || daNhanRef.current) return")
    expect(FORM).toContain("daNhanRef.current = true")
    expect(FORM).toMatch(/onClick=\{\(\) => \{\s*daNhanRef\.current = false\s*setQuetMo\(true\)/)
  })
  it("Enter trong ô Mã vạch (máy quét USB) không gửi form — chặn mặc định, sang ô Tên hàng", () => {
    const o = FORM.slice(FORM.indexOf('id="barcode"'), FORM.indexOf('data-testid="quet-ma-vach"'))
    expect(o).toContain('if (e.key !== "Enter") return')
    expect(o).toContain("e.preventDefault()")
    expect(o).toContain("tenRef.current?.focus()")
    expect(FORM).toMatch(/id="name"\s+ref=\{tenRef\}/)
  })
  it("kiểm trùng lúc quét và lúc rời ô: hỏi sổ theo org + barcode, loại chính sản phẩm đang sửa, cảnh báo bằng toast", () => {
    expect(FORM).toContain('.from("products").select("id, name, sku").eq("org_id", orgId).eq("barcode", ma)')
    expect(FORM).toContain('(productId ? cau.neq("id", productId) : cau).limit(2)')
    expect(FORM).toContain("sanPhamTrungMaVach((data ?? []) as SanPhamTrungMa[], productId)")
    expect(FORM).toContain('toast({ ...cauTrungMaVach(ma, trung), variant: "destructive" })')
    expect(FORM).toContain("onBlur={(e) => void kiemTrungMaVach(chuanMaVach(e.target.value))}")
    expect(FORM).toContain("void kiemTrungMaVach(ma)")
    // Cùng một mã không hỏi sổ hai lần; quét mã mới thì hỏi lại.
    expect(FORM).toContain("if (!ma || !orgId || daKiemRef.current === ma) return")
    expect(FORM).toContain('daKiemRef.current = ""')
  })
  it("InfoTab nhận productId từ ProductForm (sửa hàng: chính nó mang mã không phải trùng)", () => {
    expect(FORM).toContain("productId={product?.id}")
  })
})

describe("BarcodeScanner: nhãn nút nhập tay theo nơi gọi; hộp có vai dialog để tìm được", () => {
  it("mặc định “Thêm sản phẩm” (nhập kho / xuất kho / POS không đổi); form sản phẩm truyền nhãn riêng", () => {
    expect(SCANNER).toContain('manualLabel = "Thêm sản phẩm"')
    expect(SCANNER).toContain("{manualLabel}")
    expect(SCANNER).not.toMatch(/>\s*Thêm sản phẩm\s*</)
    for (const t of ["src/app/(dashboard)/sell/scan/page.tsx", "src/app/(dashboard)/inventory/stock-in/page.tsx", "src/app/(dashboard)/inventory/stock-out/page.tsx"]) {
      expect(read(t)).not.toContain("manualLabel")
    }
  })
  it("tấm quét là role=dialog mang tiêu đề", () => {
    expect(SCANNER).toMatch(/role="dialog"\s+aria-label=\{title\}/)
  })
  it("CLAUDE.md ghi luật", () => {
    expect(read("CLAUDE.md")).toMatch(/### Quét mã vạch ở form sản phẩm/)
    expect(read("CLAUDE.md")).toMatch(/Enter trong ô Mã vạch không gửi form/)
  })
})
