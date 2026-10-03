/**
 * TẠO NHANH Ở /sell (chủ nhà 03/10/2026, Update 3.10 mục 4–5): "Đang làm đơn -> thêm khách hàng -> thêm xong quay
 * về phần đơn đang làm, add luôn khách vừa thêm vào khách. Tương tự sản phẩm cũng vậy" / "Update ngược cơ chế
 * tương tự cho sell bán hàng trên mobile".
 */
import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { khachBanTuMoiTao, sanPhamBanTuMoiTao, docLaiKhongNem } from "@/lib/sell/tao-nhanh"
import { addSellProduct, addSellCustomer, loadSellRefDataShared, peekSellRefData, resetSellRefData } from "@/lib/sell/ref-store"
import { sellableUnits, unitPriceFor } from "@/lib/sell/pricing"
import type { SellProduct, SellRefData } from "@/lib/sell/ref-data"
import type { Customer, Product } from "@/types"

const saved = { id: "sp-moi", sku: "SPX", name: "Kẹo Mới Z", base_unit: "gói", sell_price: 5000, vat_rate: 8 } as unknown as Product

describe("sản phẩm vừa tạo → dạng danh mục bán", () => {
  it("đọc lại hỏng: bảng giá / đơn vị RỖNG, giá cơ sở rơi về sell_price", () => {
    const p = sanPhamBanTuMoiTao(saved, null)
    expect(p.price_lists).toEqual([])
    expect(p.units).toEqual([])
    expect(unitPriceFor(p, "gói", "nhom-1")).toBe(5000)
    expect(sellableUnits(p)).toEqual(["gói"])
  })
  it("có bản đọc lại thì lấy bản đó — đủ đơn vị phụ và giá thùng riêng", () => {
    const docLai = {
      ...saved,
      units: [{ id: "u1", product_id: "sp-moi", unit_name: "thùng", conversion: 20 }],
      price_lists: [{ id: "pl1", product_id: "sp-moi", unit_name: "thùng", price: 95000, group_id: null }],
    } as unknown as SellProduct
    const p = sanPhamBanTuMoiTao(saved, docLai)
    expect(sellableUnits(p)).toEqual(["gói", "thùng"])
    expect(unitPriceFor(p, "thùng", null)).toBe(95000)
  })
  it("bản đọc lại của mã KHÁC thì không lấy", () => {
    const p = sanPhamBanTuMoiTao(saved, { ...saved, id: "khac", units: [{ unit_name: "thùng", conversion: 2 }] } as unknown as SellProduct)
    expect(p.id).toBe("sp-moi")
    expect(p.units).toEqual([])
  })
})

describe("khách vừa tạo → dạng danh mục bán", () => {
  const k = { id: "kh-moi", store_name: "Cô Tám Mới", owner_name: null, phone: null, address: "1 Lê Lợi", channel: "T2" }
  it("đọc lại hỏng: ghép từ biểu mẫu, chưa có nhóm (bảng giá chung), đang hoạt động", () => {
    const c = khachBanTuMoiTao(k, null)
    expect(c).toMatchObject({ id: "kh-moi", store_name: "Cô Tám Mới", group_id: null, status: "active", address: "1 Lê Lợi" })
  })
  it("có bản đọc lại thì lấy (nhóm + điều khoản thật)", () => {
    const doc = { id: "kh-moi", store_name: "Cô Tám Mới", group_id: "g1", payment_terms: "NET7" } as unknown as Customer
    expect(khachBanTuMoiTao(k, doc)).toBe(doc)
  })
  it("đọc lại ném lỗi → null, không ném tiếp", async () => {
    await expect(docLaiKhongNem(() => Promise.reject(new Error("mạng")))).resolves.toBeNull()
  })
})

describe("bản danh mục trong RAM nhận hàng / khách vừa tạo", () => {
  beforeEach(() => resetSellRefData())
  const goc = { source: "server", products: [], customers: [], stockByProduct: {}, warnings: [] } as unknown as SellRefData
  it("thêm một lần, bấm hai lần không nhân đôi", async () => {
    await loadSellRefDataShared(async () => goc)
    const p = sanPhamBanTuMoiTao(saved, null)
    addSellProduct(p)
    addSellProduct(p)
    addSellCustomer({ id: "kh" } as Customer)
    expect(peekSellRefData()?.products.map((x) => x.id)).toEqual(["sp-moi"])
    expect(peekSellRefData()?.customers.map((x) => x.id)).toEqual(["kh"])
  })
  it("chưa có bản trong RAM thì thôi (không dựng bản nửa vời)", () => {
    addSellProduct(sanPhamBanTuMoiTao(saved, null))
    expect(peekSellRefData()).toBeNull()
  })
})

describe("nối dây ở màn", () => {
  const HOOK = readFileSync("src/hooks/use-sell-data.tsx", "utf8")
  const SP = readFileSync("src/app/(dashboard)/sell/page.tsx", "utf8")
  const KH = readFileSync("src/app/(dashboard)/sell/customer/page.tsx", "utf8")
  it("provider: themVaoDanhMucBan ghi RAM + state, đánh dấu danh mục cũ", () => {
    const f = HOOK.slice(HOOK.indexOf("const themVaoDanhMucBan = useCallback"), HOOK.indexOf("const productIndex"))
    expect(f).toContain("addSellProduct(p)")
    expect(f).toContain("lamCuDanhMucBan()")
    expect(f).toContain("setProducts((ds) => gopVuaTao(ds, [p]))")
  })
  it("sản phẩm: chỉ khi có quyền tạo sản phẩm VÀ không ở bước chọn hàng trả", () => {
    expect(SP).toContain('const duocTaoSp = !returning && duocTaoNhanh(user?.role, "san-pham")')
    expect(SP).toContain("{duocTaoSp && (\n            <button")
  })
  it("sản phẩm: lưu xong đọc lại, đưa vào danh mục, thêm 1 như chạm thẻ (step)", () => {
    const f = SP.slice(SP.indexOf("const daTaoSp = async"), SP.indexOf("const cartCount"))
    expect(f).toContain("loadOneSellProduct(createClient(), saved.id)")
    expect(f.indexOf("themVaoDanhMucBan(p)")).toBeGreaterThan(-1)
    expect(f.indexOf("themVaoDanhMucBan(p)")).toBeLessThan(f.indexOf("stepRef.current(p, selectedUnitOf({}, p), 1)"))
  })
  it("khách: tạo tại chỗ, đọc lại, thêm vào danh mục rồi chọn như chạm khách có sẵn", () => {
    expect(KH).toContain('const duocTaoKhach = duocTaoNhanh(user?.role, "khach")')
    const f = KH.slice(KH.indexOf("const daTaoKhach = async"), KH.indexOf("// Chữ gõ vào ô là việc khẩn"))
    expect(f).toContain("loadOneSellCustomer(createClient(), k.id)")
    expect(f.indexOf("addCustomer(c)")).toBeGreaterThan(-1)
    expect(f.indexOf("addCustomer(c)")).toBeLessThan(f.indexOf("chonKhach(c)"))
    expect(KH).toContain("onClick={() => chonKhach(c)}")
    // Luồng ?picked= cũ vẫn chạy cho các lối vào khác.
    expect(KH).toContain("cart.setCustomerId(picked)")
  })
  it("dòng tạo mới cuối danh sách khi có chữ tìm (không chỉ khi tìm SĐT)", () => {
    expect(KH).toContain("duocTaoKhach && !pickWait && !loading && list.length > 0 && q.trim()")
    expect(SP).toContain("duocTaoSp && !loading && list.length > 0 && q.trim()")
  })
})
