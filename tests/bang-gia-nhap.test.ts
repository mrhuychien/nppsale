/**
 * Chủ nhà 06/10/2026: "Làm thêm phần bảng giá nhập hàng -> lưu giá nhập load lại khi làm đơn, nếu giá có thay đổi thì
 * tự cập nhật thay đổi (vẫn được toàn quyền sửa giá trên đơn nhập)". Máy chủ: scripts/sql/thu-234-bang-gia-nhap.sql
 * (16/16). Bấm thật: e2e/bang-gia-nhap.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  dungBangGia, ganGiaNhap, giaNhapDonVi, khoaGia, laChuaCoBang, thayDoiGia, type DongGiaNhap,
} from "@/lib/purchasing/bang-gia-nhap"
import { buocSoLuong, doiDonViDong, giaGoiY } from "@/lib/purchasing/phieu-mobile"
import type { ReceiptProduct } from "@/lib/purchasing/receipt-form"

const SUA = { base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }, { unit_name: "lốc", conversion: 4 }], cost_price: 15000 }

describe("giaNhapDonVi — giá gợi ý khi lập phiếu", () => {
  it("có giá ĐÚNG đơn vị → giá đó (thùng có giá thùng riêng, không lấy giá hộp × 24)", () => {
    const p = { ...SUA, gia_nhap: [{ unit_name: "hộp", price: 16000 }, { unit_name: "thùng", price: 370000 }] }
    expect(giaNhapDonVi(p, "thùng")).toBe(370000)
    expect(giaNhapDonVi(p, "hộp")).toBe(16000)
  })
  it("chưa có giá đơn vị này → quy từ giá đơn vị cơ sở", () => {
    expect(giaNhapDonVi({ ...SUA, gia_nhap: [{ unit_name: "hộp", price: 16000 }] }, "lốc")).toBe(64000)
  })
  it("chỉ có giá đơn vị khác → quy về đơn vị cơ sở rồi nhân hệ số", () => {
    const p = { ...SUA, gia_nhap: [{ unit_name: "thùng", price: 400000 }] }
    expect(giaNhapDonVi(p, "hộp")).toBe(16667)
    expect(giaNhapDonVi(p, "lốc")).toBe(66667)
  })
  it("chưa có trong bảng → giá vốn mặc định × hệ số; không có gì → 0", () => {
    expect(giaNhapDonVi(SUA, "thùng")).toBe(360000)
    expect(giaNhapDonVi({ base_unit: "gói" }, "gói")).toBe(0)
  })
  it("giá 0 trong bảng không tính là có giá", () => {
    expect(giaNhapDonVi({ ...SUA, gia_nhap: [{ unit_name: "thùng", price: 0 }] }, "thùng")).toBe(360000)
  })
})

describe("phiếu nhập trên điện thoại dùng bảng giá nhập", () => {
  const p = { id: "sp", name: "Sữa", ...SUA, units: SUA.units as never, gia_nhap: [{ unit_name: "thùng", price: 400000 }] } as unknown as ReceiptProduct
  it("thêm 1 thùng → giá 400.000 từ bảng", () => {
    expect(giaGoiY(p, "thùng")).toBe(400000)
    expect(buocSoLuong([], p, "thùng", 1, 1)[0].unit_price).toBe("400000")
  })
  it("đổi đơn vị dòng còn giá gợi ý → giá gợi ý đơn vị mới; giá đã gõ theo HĐ NCC → giữ nguyên", () => {
    const l = buocSoLuong([], p, "thùng", 1, 1)
    expect(doiDonViDong(l, 0, p, "hộp")[0].unit_price).toBe("16667")
    const go = [{ ...l[0], unit_price: "390000" }]
    expect(doiDonViDong(go, 0, p, "hộp")[0].unit_price).toBe("390000")
  })
  it("ganGiaNhap gắn giá vào đúng mặt hàng, không đụng mặt hàng khác", () => {
    const ds = ganGiaNhap([{ id: "a" }, { id: "b" }], new Map([["a", [{ unit_name: "hộp", price: 1 }]]]))
    expect(ds[0].gia_nhap).toEqual([{ unit_name: "hộp", price: 1 }])
    expect(ds[1].gia_nhap).toBeUndefined()
  })
})

describe("màn Bảng giá nhập", () => {
  const dong: DongGiaNhap[] = [
    { product_id: "sp", unit_name: "thùng", price: 400000, effective_date: "2026-09-28", updated_at: null, source_invoice_id: "pi1", invoice: { receipt_code: "PN-1" } },
  ]
  const rows = dungBangGia(
    [{ id: "sp", name: "Sữa", sku: "SUA1", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }], primary_supplier_id: "n1" }],
    dong,
    new Map([["n1", "Vinamilk"]])
  )
  it("mỗi (mặt hàng, đơn vị) một dòng, đơn vị cơ sở trước", () => {
    expect(rows.map((r) => [r.donVi, r.gia, r.goiY, r.ncc])).toEqual([
      ["hộp", null, 16667, "Vinamilk"],
      ["thùng", 400000, 400000, "Vinamilk"],
    ])
    expect(rows[1].nguon).toEqual({ id: "pi1", ma: "PN-1" })
  })
  it("thayDoiGia: gõ giá mới → lưu; xoá trắng ô đang có giá → bỏ giá; gõ lại giá cũ / ô trống chưa có giá → không gửi", () => {
    const cu = new Map([[khoaGia("sp", "thùng"), 400000]])
    expect(thayDoiGia(new Map([[khoaGia("sp", "hộp"), "17000"]]), cu)).toEqual([{ product_id: "sp", unit_name: "hộp", price: 17000 }])
    expect(thayDoiGia(new Map([[khoaGia("sp", "thùng"), ""]]), cu)).toEqual([{ product_id: "sp", unit_name: "thùng", price: null }])
    expect(thayDoiGia(new Map([[khoaGia("sp", "thùng"), "400000"]]), cu)).toEqual([])
    expect(thayDoiGia(new Map([[khoaGia("sp", "hộp"), " "]]), cu)).toEqual([])
    expect(thayDoiGia(new Map([[khoaGia("sp", "hộp"), "-5"]]), cu)).toEqual([])
  })
  it("nhận ra sổ chưa chạy mig 234", () => {
    expect(laChuaCoBang('relation "public.purchase_price_lists" does not exist')).toBe(true)
    expect(laChuaCoBang("Could not find the table in the schema cache (PGRST205)")).toBe(true)
    expect(laChuaCoBang("JWT expired")).toBe(false)
  })
})

describe("nối dây", () => {
  const doc = (p: string) => readFileSync(p, "utf8")
  it("POS nhập hàng / trả NCC điền giá từ bảng giá nhập (không còn price: 0 cứng)", () => {
    const nhap = doc("src/components/pos/purchase-screen.tsx")
    expect(nhap).toMatch(/price: giaNhapGoiY\(p\.id, p\.base_unit, units, p\.base_unit\)/)
    expect(nhap).toMatch(/doiDonViDongPos\(l, e\.target\.value\)/)
    expect(doc("src/components/pos/supplier-return-screen.tsx")).toMatch(/price: giaNhapDonVi\(/)
  })
  it("màn điện thoại gắn bảng giá nhập vào danh mục", () => {
    expect(doc("src/components/purchasing/phieu-ncc-mobile.tsx")).toMatch(/ganGiaNhap\(gopVuaTao\(products, hangMoi\), bangGiaNhap\)/)
  })
  it("menu Mua hàng có Bảng giá nhập, có quyền theo mục mua hàng", () => {
    expect(doc("src/components/layout/sidebar.tsx")).toMatch(/href: "\/purchasing\/price-list"/)
    expect(doc("src/lib/nav/nav-permission.ts")).toMatch(/"\/purchasing\/price-list": \{ module: "inventory"/)
  })
  it("mig 234: trigger khi chuyển sang completed, không cho phiếu cũ đè giá mới, có dòng khám sổ", () => {
    const m = doc("supabase/migrations/234_bang_gia_nhap.sql")
    expect(m).toMatch(/AFTER INSERT OR UPDATE OF status ON purchase_invoices/)
    expect(m).toMatch(/WHERE g\.effective_date <= EXCLUDED\.effective_date/)
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\._ghi_gia_nhap_tu_phieu\(uuid\) FROM PUBLIC, anon, authenticated/)
    expect(doc("scripts/sql/kham-so-that.sql")).toMatch(/Mig 234/)
  })
})
