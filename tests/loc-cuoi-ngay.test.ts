import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { quaLocCuoiNgay } from "../src/lib/analytics/loc-cuoi-ngay"

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const read = (p: string) => code(readFileSync(p, "utf8"))
const KHONG = { khach: [], nhanVien: [], nguoiTao: "", hinhThuc: "" }

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "sửa 2 lỗi biết chưa sửa". Bộ lọc báo cáo lọc theo cột
 *   không đọc về / không có trong sổ — chọn gì cũng ra rỗng.
 */
describe("báo cáo cuối ngày: bộ lọc chạy thật", () => {
  it("Người tạo: đơn theo created_by, hóa đơn theo posted_by", () => {
    const loc = { ...KHONG, nguoiTao: "u1" }
    expect(quaLocCuoiNgay({ customer_id: "c", created_by: "u1" }, loc)).toBe(true)
    expect(quaLocCuoiNgay({ customer_id: "c", posted_by: "u1" }, loc)).toBe(true)
    expect(quaLocCuoiNgay({ customer_id: "c", posted_by: "u2" }, loc)).toBe(false)
  })

  it("Hình thức thanh toán so đúng mã payment_terms (COD / NET…)", () => {
    const loc = { ...KHONG, hinhThuc: "NET7" }
    expect(quaLocCuoiNgay({ customer_id: "c", payment_terms: "NET7" }, loc)).toBe(true)
    expect(quaLocCuoiNgay({ customer_id: "c", payment_terms: "net7" }, loc)).toBe(true)
    expect(quaLocCuoiNgay({ customer_id: "c", payment_terms: "COD" }, loc)).toBe(false)
  })

  it("khách / nhân viên như cũ; không lọc gì thì qua hết", () => {
    expect(quaLocCuoiNgay({ customer_id: "c" }, KHONG)).toBe(true)
    expect(quaLocCuoiNgay({ customer_id: "c", sales_user_id: "s" }, { ...KHONG, khach: ["x"] })).toBe(false)
    expect(quaLocCuoiNgay({ customer_id: "c", sales_user_id: "s" }, { ...KHONG, nhanVien: ["s"] })).toBe(true)
  })

  it("đọc về đúng các cột bộ lọc cần", () => {
    const S = read("src/lib/analytics/sales.ts")
    expect(S).toMatch(/COT_DON =\s*"[^"]*created_by, payment_terms"/)
    expect(S).toMatch(/COT_HOA_DON =\s*"[^"]*posted_by, payment_terms"/)
  })

  it("màn dùng luật chung, danh sách hình thức là PAYMENT_TERMS", () => {
    const S = read("src/app/(dashboard)/reports/end-of-day/page.tsx")
    expect(S).toContain("quaLocCuoiNgay(o, {")
    expect(S).toContain("PAYMENT_TERMS.map((t) => ({ key: t.value, label: t.label }))")
    expect(S).not.toContain("PAYMENT_METHOD_OPTIONS")
  })
})

describe("bỏ ô 'Phương thức bán hàng' — sổ không ghi thông tin này", () => {
  it.each(["src/app/(dashboard)/reports/sales/page.tsx", "src/app/(dashboard)/reports/end-of-day/page.tsx"])(
    "%s", (f) => {
      const S = read(f)
      expect(S).not.toContain("sales_method")
      expect(S).not.toContain("SALES_METHOD_OPTIONS")
      expect(S).not.toContain("Phương thức bán hàng")
    }
  )
})
