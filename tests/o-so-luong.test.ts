import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { docSoLuongGo } from "@/lib/ui/so-luong-go"

/**
 * Chủ nhà 09/11/2026 (phiếu trả hàng trên điện thoại): "khi chọn khách trong danh sách hiển thị thêm thông tin địa chỉ, phần
 * số lượng dùng bàn phím numpad và gõ được, ngoài việc +/-".
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("docSoLuongGo — chữ đang gõ ≠ số đã chốt", () => {
  it("xoá trắng / gõ 0 / chỉ dấu chấm: giữ chữ trên ô, CHƯA đẩy số (rời ô thì về số cũ)", () => {
    expect(docSoLuongGo("")).toEqual({ chu: "", so: null })
    expect(docSoLuongGo("0")).toEqual({ chu: "0", so: null })
    expect(docSoLuongGo(".")).toEqual({ chu: ".", so: null })
  })
  it("gõ số: đẩy lên ngay; dấu phẩy là dấu thập phân; '1.' giữ để gõ tiếp '1.5'", () => {
    expect(docSoLuongGo("12")).toEqual({ chu: "12", so: 12 })
    expect(docSoLuongGo("1,5")).toEqual({ chu: "1.5", so: 1.5 })
    expect(docSoLuongGo("1.")).toEqual({ chu: "1.", so: 1 })
  })
  it("bỏ chữ lạ, chỉ một dấu thập phân; ô số nguyên bỏ cả dấu chấm", () => {
    expect(docSoLuongGo("a3b")).toEqual({ chu: "3", so: 3 })
    expect(docSoLuongGo("1.2.3")).toEqual({ chu: "1.23", so: 1.23 })
    expect(docSoLuongGo("1.5", false)).toEqual({ chu: "15", so: 15 })
  })
})

describe("ô số lượng gõ được — phiếu trả hàng + phiếu nhập NCC trên điện thoại", () => {
  it("OSoLuong: bàn phím số, giữ chữ đang gõ, rời ô thì về số đã chốt, chạm vào là chọn cả số (sau một nhịp — iOS)", () => {
    const s = doc("src/components/ui/o-so-luong.tsx")
    expect(s).toContain('inputMode={thapPhan ? "decimal" : "numeric"}')
    expect(s).toContain("value={nhap ?? String(value)}")
    expect(s).toContain("onBlur={() => setNhap(null)}")
    expect(s).toContain("if (g.so !== null) onChange(g.so)")
    expect(s).toMatch(/setTimeout\(\(\) => \{\s*try \{\s*o\.setSelectionRange\(0, o\.value\.length\)/)
  })
  it("hai màn dùng OSoLuong, không còn ô buộc value={String(qty)} (không xoá trắng được)", () => {
    for (const p of ["src/components/returns/phieu-tra-khach-mobile.tsx", "src/components/purchasing/phieu-ncc-mobile.tsx"]) {
      const s = doc(p)
      expect(s, p).toContain("<OSoLuong")
      expect(s, p).not.toMatch(/value=\{String\((line\.)?qty\)\}/)
    }
  })
  it("danh sách chọn khách: hiện địa chỉ (một luật ghép fullCustomerAddress), tìm được theo địa chỉ; trang đọc cột địa chỉ", () => {
    const s = doc("src/components/returns/phieu-tra-khach-mobile.tsx")
    expect(s).toContain("export interface KhachTra extends CustomerAddressParts")
    expect(s).toContain("customers.map((c) => ({ c, diaChi: fullCustomerAddress(c) }))")
    expect(s).toContain("viMatchAllWords(q, c.store_name, c.owner_name, c.phone, diaChi)")
    expect(s).toContain('data-testid="dia-chi-khach"')
    const trang = doc("src/app/(dashboard)/returns/new/page.tsx")
    expect(trang).toContain('.select("id, store_name, owner_name, phone, group_id, address, ward, district, province", { count: "exact" })')
  })
})
