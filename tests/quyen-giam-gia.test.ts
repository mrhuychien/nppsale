import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { kepGiamGia, kiemGiamGia, nhanTranGiamGia, tranGiamGia, userDiscountRulesFrom } from "../src/lib/pricing"
import { kiemQuyenGiamGia, type CartLine } from "../src/lib/sell/cart"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Cho phép giảm giá, set tối đa theo % hoặc giá trị (nếu để
 *   trống, ko giới hạn) … bật/tắt cho từng nhân viên bán hàng … Mặc định là tắt,
 *   khi tắt, phần giảm giá ở từng dòng và cả đơn ẩn đi với nhân viên bán hàng.
 *   Nhà phân phối thì toàn quyền giảm giá dòng và giảm giá đơn." (mig 185)
 */
const nv = (p: Record<string, unknown> = {}) => userDiscountRulesFrom({ role: "sales", ...p })

describe("luật quyền giảm giá", () => {
  it("mặc định TẮT với NVBH; chủ NPP / kế toán toàn quyền, không trần", () => {
    expect(nv().allowed).toBe(false)
    expect(userDiscountRulesFrom({ role: "owner" })).toMatchObject({ allowed: true, maxValue: null, free: true })
    expect(userDiscountRulesFrom({ role: "accountant", allow_discount: false, discount_max_value: 1 })).toMatchObject({ allowed: true, maxValue: null })
  })
  it("trống = không giới hạn; % và đồng", () => {
    expect(tranGiamGia(nv({ allow_discount: true }), 1_000_000)).toBe(Infinity)
    expect(tranGiamGia(nv({ allow_discount: true, discount_max_type: "pct", discount_max_value: 5 }), 1_000_000)).toBe(50_000)
    expect(tranGiamGia(nv({ allow_discount: true, discount_max_type: "vnd", discount_max_value: "20000" }), 1_000_000)).toBe(20_000)
    expect(tranGiamGia(nv(), 1_000_000)).toBe(0)
    expect(nhanTranGiamGia(nv({ allow_discount: true, discount_max_type: "pct", discount_max_value: 2.5 }))).toBe("Tối đa 2,5%")
    expect(nhanTranGiamGia(nv({ allow_discount: true }))).toBe("")
  })
  it("kẹp ô nhập về trần, giữ cách nhập đang chọn", () => {
    const r = nv({ allow_discount: true, discount_max_type: "pct", discount_max_value: 5 })
    expect(kepGiamGia({ value: 10, unit: "pct" }, 200_000, r)).toEqual({ value: 5, unit: "pct" })
    expect(kepGiamGia({ value: 30_000, unit: "vnd" }, 200_000, r)).toEqual({ value: 10_000, unit: "vnd" })
    expect(kepGiamGia({ value: 3, unit: "pct" }, 200_000, r)).toEqual({ value: 3, unit: "pct" })
    const d = nv({ allow_discount: true, discount_max_type: "vnd", discount_max_value: 15_000 })
    expect(kepGiamGia({ value: 10, unit: "pct" }, 200_000, d)).toEqual({ value: 7.5, unit: "pct" })
    expect(kepGiamGia({ value: 9, unit: "vnd" }, 200_000, nv())).toEqual({ value: 0, unit: "vnd" })
    /* Quy ra % phải làm tròn XUỐNG — lên một chút là vượt trần một đồng. */
    const k = kepGiamGia({ value: 50, unit: "pct" }, 30_000, nv({ allow_discount: true, discount_max_type: "vnd", discount_max_value: 10_000 }))
    expect(k).toEqual({ value: 33.3333, unit: "pct" })
  })
  it("chốt lúc gửi: không quyền, vượt trần dòng, vượt trần đơn; giữ nguyên giảm đơn có sẵn thì qua", () => {
    const r = nv({ allow_discount: true, discount_max_type: "pct", discount_max_value: 5 })
    expect(kiemGiamGia([{ giam: 5_000, tienHang: 100_000 }], { giam: 0, tienHang: 100_000 }, r)).toBeNull()
    expect(kiemGiamGia([{ giam: 6_000, tienHang: 100_000 }], { giam: 0, tienHang: 100_000 }, r)).toMatch(/vượt mức/)
    expect(kiemGiamGia([], { giam: 6_000, tienHang: 100_000 }, r)).toMatch(/Giảm giá đơn vượt/)
    expect(kiemGiamGia([{ giam: 1, tienHang: 100_000 }], { giam: 0, tienHang: 1 }, nv())).toMatch(/không có quyền giảm giá dòng/)
    expect(kiemGiamGia([], { giam: 30_000, tienHang: 100_000 }, nv(), 30_000), "NPP đặt sẵn, NV giữ nguyên").toBeNull()
    expect(kiemGiamGia([], { giam: 31_000, tienHang: 100_000 }, nv(), 30_000)).toMatch(/không có quyền giảm giá đơn/)
    expect(kiemGiamGia([{ giam: 99_999, tienHang: 100_000 }], { giam: 99_999, tienHang: 1 }, userDiscountRulesFrom({ role: "owner" }))).toBeNull()
  })
  it("giỏ /sell đi qua cùng chốt", () => {
    const l: CartLine = { productId: "p", unit: "hộp", qty: 2, price: 100_000, listPrice: 100_000, note: "", conversion: 1, vatRate: 0, discount: { value: 10, unit: "pct" } }
    const r = nv({ allow_discount: true, discount_max_type: "pct", discount_max_value: 5 })
    expect(kiemQuyenGiamGia([l], { subtotal: 180_000, docDiscount: 0 }, r)).toMatch(/vượt mức/)
    expect(kiemQuyenGiamGia([{ ...l, discount: { value: 5, unit: "pct" } }], { subtotal: 190_000, docDiscount: 0 }, r)).toBeNull()
  })
})

describe("gắn vào màn", () => {
  const POS_DON = readFileSync("src/components/pos/order-screen.tsx", "utf8")
  const POS_HD = readFileSync("src/components/pos/invoice-screen.tsx", "utf8")
  const CAI_DAT = readFileSync("src/app/(dashboard)/settings/users/[id]/page.tsx", "utf8")
  const AUTH = readFileSync("src/hooks/use-auth.tsx", "utf8")
  it.each([["màn đơn", POS_DON], ["màn hóa đơn", POS_HD]])("POS %s: tắt quyền thì ẩn chi tiết dòng và ô giảm đơn, lưu thì chốt", (_t, S) => {
    expect(S).toMatch(/quyenGiam\.allowed \? \(\s*<LineDetailToggle/)
    expect(S).toMatch(/moCT && quyenGiam\.allowed && \(/)
    expect(S).toMatch(/quyenGiam\.allowed \? \(\s*<DocDiscountRow/)
    expect(S).toMatch(/const loi = kiemGiamGia\(/)
  })
  it("POS mở đơn cũ nạp lại giảm giá đơn (trước đây về 0, lưu lại là mất)", () => {
    expect(POS_DON).toMatch(/sales_user_id, subtotal, customer:customers/)
    expect(POS_DON).toMatch(/setDocDiscount\(\{ value: g, unit: "vnd" \}\)\s*setGiamDonGoc\(g\)/)
  })
  it("cài đặt nhân viên có khối quyền giảm giá dưới quyền sửa giá, lưu riêng", () => {
    const i = CAI_DAT.indexOf("Quyền sửa giá khi tạo / sửa đơn")
    const j = CAI_DAT.indexOf("Quyền giảm giá dòng / giảm giá đơn")
    expect(i).toBeGreaterThan(-1)
    expect(j, "khối giảm giá phải ngay dưới khối sửa giá").toBeGreaterThan(i)
    expect(CAI_DAT).toMatch(/allow_discount: giamGia\.bat,\s*discount_max_type: giamGia\.kieu,\s*discount_max_value: maxSo === null \? null/)
  })
  it("đăng nhập đọc cột mig 185 RIÊNG — thiếu cột không chặn đăng nhập", () => {
    const dau = AUTH.match(/"id, org_id, full_name, role[^"]*"/)![0]
    expect(dau).not.toContain("allow_discount")
    expect(AUTH).toContain('.select("allow_discount, discount_max_type, discount_max_value")')
  })
})
