import { describe, it, expect, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { duocVaoTrang, mucChaCua, CUA_VAO, NAV_PERMISSION } from "@/lib/nav/nav-permission"
import {
  xemDuocGiaVon, locBienThe, duocXuatFile, setPermissionsCache, rowsToCache, setUserOverrides, ACTIONS,
  type Action, type Module,
} from "@/lib/permissions"
import { FEATURES } from "@/lib/permissions-features"
import { MAU_QUYEN_NVBH, oTheoMauNvbh } from "@/lib/permission-templates"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Rà soát lại bảng phân quyền, bổ sung các phần thiếu, bỏ các phần
 *   thừa. Xây dựng cho tao phân quyền mẫu cho nhân viên bán hàng: Đủ để nhân viên bán hàng;
 *   Không xem được các thông tin quan trọng của nhà phân phối".
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
afterEach(() => { setPermissionsCache(null); setUserOverrides(null) })

const CAM_NVBH: Array<[string, Module]> = [
  ["/reports/finance/pnl", "reports"],
  ["/reports/finance/balance-sheet", "reports"],
  ["/analytics/business/cost-profit", "reports"],
  ["/analytics/products/stock", "reports"],
  ["/analytics", "reports"],
  ["/reports/inventory", "reports"],
  ["/dashboard", "reports"],
  ["/reports/end-of-day", "reports"],
  ["/inventory/batches", "inventory"],
  ["/inventory/batches/lo-1", "inventory"],
  ["/inventory/stock-card/sp-1", "inventory"],
  ["/inventory/audit", "inventory"],
  ["/suppliers/ncc-1", "inventory"],
  ["/purchase-returns/tr-1", "inventory"],
  ["/payables/by-supplier", "receivables"],
  ["/hr/payroll", "settings"],
  ["/hr/payroll/abc", "settings"],
  /* Chủ nhà 26/09/2026: NVBH chỉ còn module bán hàng + công nợ / báo cáo bán hàng / phiếu lương. */
  ["/inventory", "inventory"],
  ["/products", "products"],
  ["/returns", "returns"],
  ["/returns/new", "returns"],
  ["/finance/cash-receipts", "receivables"],
  ["/finance/cash-receipts/new", "receivables"],
  ["/receivables/collect", "receivables"],
  ["/reports/orders", "reports"],
  ["/reports/products", "reports"],
  ["/reports/customers", "reports"],
]
const DUOC_NVBH: Array<[string, Module]> = [
  ["/sell", "orders"], ["/sell/cart", "orders"], ["/sell/drafts", "orders"], ["/orders/abc", "orders"],
  ["/customers/new", "customers"], ["/reports/sales", "reports"], ["/receivables", "receivables"],
  ["/receivables/by-customer", "receivables"], ["/luong-cua-toi", "orders"], ["/notifications", "orders"],
  ["/promotions", "promotions"], ["/sales/visits", "customers"], ["/commissions", "commissions"],
]

describe("NVBH — cổng vào trang (mặc định)", () => {
  it("không vào được các màn có số liệu quan trọng của NPP (kể cả màn con động)", () => {
    for (const [p, m] of CAM_NVBH) expect(duocVaoTrang("sales", p, m), p).toBe(false)
  })
  it("vẫn đủ để bán hàng", () => {
    for (const [p, m] of DUOC_NVBH) expect(duocVaoTrang("sales", p, m), p).toBe(true)
  })
  it("thủ kho vẫn xem lô / thẻ kho / báo cáo tồn; kế toán vẫn xem lãi lỗ", () => {
    expect(duocVaoTrang("warehouse", "/inventory/batches/lo-1", "inventory")).toBe(true)
    expect(duocVaoTrang("warehouse", "/inventory/stock-card/sp-1", "inventory")).toBe(true)
    expect(duocVaoTrang("warehouse", "/reports/inventory", "reports")).toBe(true)
    expect(duocVaoTrang("accountant", "/reports/finance/pnl", "reports")).toBe(true)
    expect(duocVaoTrang("owner", "/suppliers/ncc-1", "inventory")).toBe(true)
  })
  it("màn con lấy tiền tố dài nhất; bảng cửa vào không trùng bảng menu", () => {
    expect(mucChaCua("/analytics/products/x")).toBe("/analytics/products/overview")
    expect(mucChaCua("/hr/payroll/abc")).toBe("/hr")
    expect(mucChaCua("/orders/abc")).toBeNull()
    for (const k of Object.keys(CUA_VAO)) expect(NAV_PERMISSION[k], k).toBeUndefined()
  })
})

describe("NVBH — giá vốn, xuất file", () => {
  it("giá vốn / giá trị tồn / lãi: chủ, quản lý, kế toán, thủ kho — không NVBH", () => {
    expect(xemDuocGiaVon("sales")).toBe(false)
    for (const r of ["owner", "manager", "accountant", "warehouse"] as const) expect(xemDuocGiaVon(r), r).toBe(true)
    setUserOverrides({ "inventory.cost.read": true })
    expect(xemDuocGiaVon("sales"), "quyền riêng từng người đè lên vai").toBe(true)
  })
  it("báo cáo bỏ màn Lợi nhuận / Giá trị kho / Xuất nhập tồn / Nhân viên với NVBH", () => {
    const V = [{ key: "sales" }, { key: "profit" }, { key: "stock_value" }, { key: "movement" }, { key: "employee" }]
    expect(locBienThe("sales", V).map((v) => v.key)).toEqual(["sales"])
    expect(locBienThe("manager", V)).toHaveLength(5)
    for (const f of ["sales", "products", "customers"]) {
      const s = doc(`src/app/(dashboard)/reports/${f}/page.tsx`)
      expect(s, f).toContain("locBienThe(nguoiXem?.role, VARIANTS)")
      expect(s, f).toContain("variants={bienThe}")
    }
  })
  it("form sản phẩm và trang kho ẩn giá vốn / giá trị tồn theo xemDuocGiaVon", () => {
    expect(doc("src/components/products/product-form.tsx")).toContain("{xemDuocGiaVon(user?.role) && (")
    expect(doc("src/app/(dashboard)/inventory/page.tsx")).toContain("{xemDuocGiaVon(user?.role) && (")
  })
  it("ô Xuất file của ma trận nay có tác dụng", () => {
    expect(duocXuatFile("sales", "reports")).toBe(false)
    expect(duocXuatFile("sales", "orders")).toBe(false)
    expect(duocXuatFile("manager", "reports")).toBe(true)
    expect(duocXuatFile("owner", "orders")).toBe(true)
    expect(doc("src/components/analytics/report-frame.tsx")).toContain("{onExportCsv && xuat ? (")
    expect(doc("src/app/(dashboard)/orders/page.tsx")).toContain('duocXuatFile(authUser?.role, "orders")')
  })
})

describe("mẫu phân quyền NVBH", () => {
  const cacheTheoMau = () => {
    const rows: Array<{ role: "sales"; module: string; action: Action; allowed: boolean }> = []
    for (const f of FEATURES) {
      const o = oTheoMauNvbh(f.key, ACTIONS)
      for (const a of ACTIONS) rows.push({ role: "sales", module: f.key, action: a, allowed: o[a] })
    }
    return rowsToCache(rows)
  }
  it("mọi khoá trong mẫu là tính năng thật; không có khoá nhạy cảm", () => {
    const keys = new Set(FEATURES.map((f) => f.key))
    for (const k of Object.keys(MAU_QUYEN_NVBH)) expect(keys.has(k), k).toBe(true)
    for (const k of ["inventory.cost", "reports.finance", "reports.dashboard", "reports.end_of_day", "analytics.business",
      "suppliers", "payables", "purchasing.invoices", "receivables.by_rep", "finance.expenses", "hr", "settings", "invoices"]) {
      expect(MAU_QUYEN_NVBH[k], k).toBeUndefined()
    }
    for (const acts of Object.values(MAU_QUYEN_NVBH)) expect(acts).not.toContain("export")
  })
  it("áp mẫu: đủ để bán, không vào màn nhạy cảm", () => {
    setPermissionsCache(cacheTheoMau())
    for (const [p, m] of DUOC_NVBH) expect(duocVaoTrang("sales", p, m), p).toBe(true)
    for (const [p, m] of CAM_NVBH) expect(duocVaoTrang("sales", p, m), p).toBe(false)
    expect(duocVaoTrang("sales", "/receivables/by-rep", "receivables")).toBe(false)
    expect(duocVaoTrang("sales", "/suppliers", "inventory")).toBe(false)
    expect(xemDuocGiaVon("sales")).toBe(false)
  })
  it("màn Phân quyền có nút Áp mẫu NVBH; nhóm Pack3 chỉ còn khoá có tác dụng", () => {
    const s = doc("src/app/(dashboard)/settings/permissions/page.tsx")
    expect(s).toContain("Áp mẫu NVBH")
    expect(s).toContain("oTheoMauNvbh(f.key, ACTIONS)")
    const m = doc("src/components/settings/permission-matrix.tsx")
    expect(m).toContain('"customer.view_all"')
    for (const k of ["warehouse.view_cost", "finance.collect", "hr.run_payroll", "admin.users"]) expect(m, k).not.toContain(`"${k}"`)
    expect(FEATURES.some((f) => f.key === "deliveries"), "Giao hàng bỏ khỏi ma trận").toBe(false)
  })
})

describe("mig 197 — bảng nhân sự khoá với NVBH", () => {
  const m = doc("supabase/migrations/197_khoa_nhan_su_voi_nvbh.sql")
  it("lương / thưởng chỉ chủ, quản lý, kế toán; chấm công thêm của chính mình", () => {
    expect(m).toMatch(/"View salary config"[\s\S]*?user_role\(\) IN \('owner', 'manager', 'accountant'\)/)
    expect(m).toMatch(/"View monthly bonus"[\s\S]*?user_role\(\) IN \('owner', 'manager', 'accountant'\)/)
    expect(m).toMatch(/"View attendance"[\s\S]*?user_id = \(SELECT auth\.uid\(\)\)/)
    expect(m).toContain("NOTIFY pgrst, 'reload schema';")
  })
})

describe("mig 198 — NVBH đọc phiếu trả thuộc về mình", () => {
  /* Chủ nhà 26/09/2026: "doanh thu của nhân viên chưa trừ hàng trả lại" — NVBH chỉ đọc được
     phiếu mình tự lập, phiếu tự sinh lúc xuất HĐ (kho / kế toán bấm) không thấy nên không trừ.
     Kịch bản chạy thật trên Postgres: NVBH thấy phiếu tự sinh của HĐ mình; chính sách cũ thấy 0. */
  const m = doc("supabase/migrations/198_nvbh_doc_phieu_tra_cua_minh.sql")
  it("mình lập, đứng tên mình, hoặc gắn HĐ / đơn của mình", () => {
    expect(m).toContain("requested_by = (SELECT auth.uid())")
    expect(m).toContain("OR sales_user_id = (SELECT auth.uid())")
    expect(m).toMatch(/sales_invoices si\s+WHERE si\.id = returns\.invoice_id AND si\.sales_user_id = \(SELECT auth\.uid\(\)\)/)
    expect(m).toMatch(/sales_orders so\s+WHERE so\.id = returns\.order_id AND so\.sales_user_id = \(SELECT auth\.uid\(\)\)/)
    expect(doc("scripts/sql/kham-so-that.sql")).toContain("Mig 198")
  })
})

describe("mig 199 — công nợ theo khách khớp công nợ theo nhân viên", () => {
  /* Chủ nhà 26/09/2026: "đặc biệt công nợ theo khách hàng và công nợ theo nhân viên không khớp
     nhau?" — theo KH 650.123.000đ, theo NV 643.795.000đ. Kịch bản Postgres: nợ 100.000 + dư
     có −30.000 → theo KH = theo NV = tổng = 70.000; bản 121 (kẹp 0) ra 100.000. */
  const m = doc("supabase/migrations/199_cong_no_theo_khach_bo_kep_0.sql")
  const than = m.slice(m.indexOf("CREATE FUNCTION public.receivables_by_customer()"), m.indexOf("$$;", m.indexOf("CREATE FUNCTION public.receivables_by_customer()")))
  it("không kẹp từng dòng về 0, không SECURITY DEFINER", () => {
    expect(than).toContain("COALESCE(rc.amount, 0) - COALESCE(rc.paid, 0) AS remaining,")
    expect(than).not.toContain("GREATEST(0, COALESCE(rc.amount")
    expect(m.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")).not.toMatch(/SECURITY\s+DEFINER/)
    expect(doc("scripts/sql/kham-so-that.sql")).toContain("Mig 199")
  })
  it("màn Công nợ theo KH: khách dư có không đếm là đang nợ", () => {
    expect(doc("src/app/(dashboard)/receivables/by-customer/page.tsx")).toContain("rows.filter((r) => r.remaining > 0).length")
  })
})

