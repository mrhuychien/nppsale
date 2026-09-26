import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { canSeeHref, duocVaoTrang } from "@/lib/nav/nav-permission"
import { setPermissionsCache, setUserOverrides, ROLES } from "@/lib/permissions"
import { MAU_QUYEN_NVBH } from "@/lib/permission-templates"
import { khoanLuong, nhanThangLuong, doanhSoTinhLuong, type DongPhieuLuong } from "@/lib/hr/phieu-luong-cua-toi"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "NV bán hàng chỉ cần Module bán hàng và - Xem được công nợ của mình -
 *   Xem được báo cáo bán hàng của mình - Xem được phiếu lương của mình. Còn lại bỏ hết".
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
afterEach(() => { setPermissionsCache(null); setUserOverrides(null) })

describe("NVBH chỉ còn module bán hàng", () => {
  it("menu của NVBH: đúng bán hàng + công nợ + báo cáo bán hàng + phiếu lương", () => {
    for (const h of ["/sell", "/orders", "/customers", "/sales/visits", "/promotions", "/commissions",
      "/receivables", "/reports/sales", "/luong-cua-toi"]) expect(canSeeHref("sales", h), h).toBe(true)
    for (const h of ["/inventory", "/products", "/returns", "/finance/cash-receipts", "/receivables/collect",
      "/reports/orders", "/reports/products", "/reports/customers", "/invoices", "/hr", "/settings"]) {
      expect(canSeeHref("sales", h), h).toBe(false)
    }
  })
  it("các vai khác không mất gì", () => {
    expect(canSeeHref("warehouse", "/reports/products")).toBe(true)
    expect(canSeeHref("manager", "/reports/customers")).toBe(true)
    expect(canSeeHref("accountant", "/finance/cash-receipts")).toBe(true)
    expect(canSeeHref("accountant", "/receivables/collect")).toBe(true)
    expect(canSeeHref("warehouse", "/inventory")).toBe(true)
  })
  it("quyền riêng từng người vẫn cấp lại được", () => {
    setUserOverrides({ "products.read": true })
    expect(duocVaoTrang("sales", "/products", "products")).toBe(true)
  })
  it("mẫu NVBH đúng bộ được giữ", () => {
    expect(Object.keys(MAU_QUYEN_NVBH).sort()).toEqual([
      "commissions", "customers", "customers.visits", "orders", "promotions",
      "receivables", "receivables.by_customer", "reports.sales",
    ])
    expect(MAU_QUYEN_NVBH.receivables).toEqual(["read"])
  })
  it("Phiếu lương của tôi: mọi vai đều thấy, có ở ngăn kéo + trang chủ", () => {
    for (const r of ROLES) expect(canSeeHref(r, "/luong-cua-toi"), r).toBe(true)
    expect(doc("src/components/layout/sidebar.tsx")).toContain('href: "/luong-cua-toi"')
    expect(doc("src/app/(dashboard)/home/page.tsx")).toContain('href: "/luong-cua-toi"')
    expect(doc("src/app/(dashboard)/luong-cua-toi/page.tsx")).toContain('.rpc("my_payslips")')
  })
  it("trang chủ NVBH: không thấy kho thì không đọc / không hiện Tồn kho thấp", () => {
    const s = doc("src/components/home/sales-home.tsx")
    expect(s).toMatch(/if \(xemKho\) \{\s*const \[ton, prod, lo\]/)
    expect(s).toContain("xemKho && (dl.tonThap ?? 0) > 0")
    expect(doc("src/app/(dashboard)/home/page.tsx")).toContain('xemKho={canSeeHref(role, "/products")}')
  })
})

describe("mig 202 — tắt ô quyền cũ của NVBH trong sổ", () => {
  const m = doc("supabase/migrations/202_nvbh_chi_con_ban_hang.sql")
  it("tắt ô sales ngoài bộ giữ; NPP mới không gieo receivables.create cho sales", () => {
    expect(m).toMatch(/UPDATE role_permissions rp\s+SET allowed = false\s+WHERE rp\.role = 'sales'/)
    const gieo = m.slice(m.indexOf("_gieo_quyen_mac_dinh(p_org uuid)"), m.indexOf("$fn$;"))
    expect(gieo).not.toMatch(/'sales',\s*'receivables',\s*'create'/)
    expect(gieo).toMatch(/'accountant', 'receivables', 'create'/)
    expect(m).toContain("REVOKE EXECUTE ON FUNCTION public._gieo_quyen_mac_dinh(uuid) FROM PUBLIC, anon, authenticated;")
    expect(m).toContain("NOTIFY pgrst, 'reload schema';")
    expect(doc("scripts/sql/kham-so-that.sql")).toContain("Mig 202 (NVBH chỉ còn bán hàng)")
  })
})

describe("phiếu lương của tôi — các khoản", () => {
  const r: DongPhieuLuong = {
    payroll_run_id: "k1", month: "2026-09-01", locked_at: null,
    base_salary: 8000000, standard_workdays: 26, actual_workdays: 24, prorated_base: "7384615",
    allowances: 500000, kpi_bonus: 1200000, order_count_bonus: 0, activity_bonus: 0, overtime: 0,
    deductions: 100000, social_insurance: 840000, manual_adjustment: -50000, net_salary: 8094615,
    computed_breakdown: { revenue: 120000000 }, notes: null,
  }
  it("cộng các khoản ra đúng thực nhận (công thức trg_tinh_luong_thuc_nhan)", () => {
    const ds = khoanLuong(r)
    expect(ds.reduce((s, k) => s + k.amount, 0)).toBe(Number(r.net_salary))
    expect(ds.find((k) => k.label === "BHXH")?.amount).toBe(-840000)
    expect(ds.find((k) => k.label === "Khấu trừ")?.amount).toBe(-100000)
    expect(ds[0].label).toBe("Lương cơ bản (24/26 công)")
    expect(ds.some((k) => k.label === "Thưởng số đơn"), "khoản 0 bỏ đi").toBe(false)
  })
  it("nhãn tháng, doanh số tính lương", () => {
    expect(nhanThangLuong("2026-09-01")).toBe("Tháng 09/2026")
    expect(doanhSoTinhLuong(r)).toBe(120000000)
    expect(doanhSoTinhLuong({ ...r, computed_breakdown: null })).toBeNull()
  })
})

describe("trang gộp /reports — số toàn NPP", () => {
  it("NVBH không vào; trang chủ NVBH có ô Báo cáo → /reports/sales", () => {
    expect(duocVaoTrang("sales", "/reports", "reports")).toBe(false)
    for (const r of ["owner", "manager", "accountant", "warehouse"] as const) expect(duocVaoTrang(r, "/reports", "reports"), r).toBe(true)
    const h = doc("src/app/(dashboard)/home/page.tsx")
    expect(h).toMatch(/TILES_NVBH: Tile\[\] = \[\s*\{ label: "Báo cáo", href: "\/reports\/sales"/)
    expect(h).toContain("filterByPermission(role, TILES_NVBH)")
  })
})
