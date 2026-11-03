import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { HREF_HANG_BAN_NV, laManHangBanNv } from "@/lib/nav/bao-cao-tong-hop"

/**
 * ⚠ CHỦ NHÀ 03/11/2026: "Lôi cho tao riêng báo cáo này ra ngoài menu BÁO CÁO TỔNG HỢP > Nhân viên (Lưu ý khi bấm vào từng
 *   nhân viên xem được chi tiết như bên báo cáo)" · "các cột doanh thu thuần, chênh lệch thuần -> đổi tên thành doanh thu
 *   net, chênh lệch net". Màn riêng là CHÍNH trang Báo cáo › Nhân viên chạy ở đường dẫn khác — một mã, một luật số.
 *   Hành vi: e2e/bao-cao-nv-tong-chenh.spec.ts.
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const NV = doc("src/app/(dashboard)/reports/employees/page.tsx")

describe("đường dẫn → vai màn riêng", () => {
  it("chỉ đúng /bao-cao/nhan-vien là màn riêng Hàng bán theo nhân viên", () => {
    expect(HREF_HANG_BAN_NV).toBe("/bao-cao/nhan-vien")
    expect(laManHangBanNv("/bao-cao/nhan-vien")).toBe(true)
    for (const p of ["/reports/employees", "/bao-cao", "/bao-cao/nhan-vien/x", "/bao-cao/ban-hang", "", null, undefined]) {
      expect(laManHangBanNv(p), String(p)).toBe(false)
    }
  })
})

describe("trang /bao-cao/nhan-vien dựng CHÍNH báo cáo Nhân viên", () => {
  const trang = doc("src/app/(dashboard)/bao-cao/nhan-vien/page.tsx")
  it("nhập trang báo cáo Nhân viên, không chép bảng / phép tính sang", () => {
    expect(trang).toContain('import BaoCaoNhanVien from "../../reports/employees/page"')
    expect(trang).toContain("<BaoCaoNhanVien />")
    for (const x of ["congHangBanNhanVien", "chenhDong", "ReportTable", "supabase"]) expect(trang, x).not.toContain(x)
  })
  it("báo cáo Nhân viên đọc vai theo đường dẫn: chỉ Hàng bán theo nhân viên, ẩn ô Mối quan tâm, tiêu đề riêng", () => {
    expect(NV).toContain("const chiHangBan = laManHangBanNv(usePathname())")
    expect(NV).toContain('useState<Variant>(chiHangBan ? "summary" : "sales")')
    expect(NV).toContain('const VARIANTS_HANG_BAN = VARIANTS.filter((v) => v.key === "summary")')
    expect(NV).toContain("variants={chiHangBan ? VARIANTS_HANG_BAN : VARIANTS}")
    expect(NV).toContain("anMoiQuanTam={chiHangBan}")
    expect(NV).toContain('title={chiHangBan ? "Hàng bán theo nhân viên" : "Báo cáo nhân viên"}')
  })
  it("màn riêng không đọc giá vốn (phiếu xuất, dòng kho, giá vốn hàng trả) — bảng không có cột giá vốn", () => {
    expect(NV).toContain('chiHangBan ? Promise.resolve(KHONG_PHIEU_KHO) : fetchPostedStockEntries(supabase, orgId, range, "export")')
    expect(NV).toMatch(/chiHangBan \? Promise\.resolve\(new Map\(\)[^)]*\) : fetchReturnCosts\(supabase, returnIds\)/)
    // Đọc lại khi đổi vai (khoá của `load`).
    expect(NV).toContain("}, [user?.org_id, range, supabase, batLuot, chiHangBan])")
    // Phép "Hàng bán theo nhân viên" không dùng giá vốn — bỏ đọc là an toàn.
    const i = NV.indexOf("const employeeSummaryRows: SummaryRow[] = useMemo(")
    const than = NV.slice(i, NV.indexOf("const handleExport", i))
    for (const x of ["avgCostMap", "returnCosts", "stockLines"]) expect(than, x).not.toContain(x)
  })
  it("ReportShell ẩn ô Mối quan tâm chỉ khi được bảo (`anMoiQuanTam`) — báo cáo khác không đổi", () => {
    const s = doc("src/components/analytics/report-shell.tsx")
    expect(s).toContain("anMoiQuanTam?: boolean")
    expect(s.indexOf("{!anMoiQuanTam && (")).toBeGreaterThan(-1)
    expect(s.indexOf("{!anMoiQuanTam && (")).toBeLessThan(s.indexOf('ariaLabel="Mối quan tâm"'))
  })
})

describe("điện thoại: màn riêng giữ app bar chuẩn (☰) — nó không có đầu trang xanh riêng như các màn Báo cáo tổng hợp khác", () => {
  it("/bao-cao/nhan-vien KHÔNG ẩn app bar; các màn /bao-cao/* khác vẫn ẩn; ô trái là ☰ (trang gốc)", async () => {
    const { hidesMobileAppBar, laTrangDanhSach } = await import("@/lib/nav/mobile-chrome")
    expect(hidesMobileAppBar("/bao-cao/nhan-vien")).toBe(false)
    for (const p of ["/bao-cao", "/bao-cao/ban-hang", "/bao-cao/cong-no", "/bao-cao/tai-chinh"]) expect(hidesMobileAppBar(p), p).toBe(true)
    expect(laTrangDanhSach("/bao-cao/nhan-vien")).toBe(true)
  })
})

describe("đổi tên cột: Doanh thu net / Chênh lệch net — chỉ ở Hàng bán theo nhân viên", () => {
  const i = NV.indexOf('variant === "summary" ? (')
  const bang = NV.slice(i, NV.indexOf(") : (", NV.indexOf('data-testid="nv-hang-ban-chi-tiet"', i)))
  it("bảng chính + chi tiết từng nhân viên không còn 'thuần'", () => {
    expect(bang).toContain('label: "Doanh thu net"')
    expect(bang).toContain('label: "Chênh lệch net"')
    expect(bang).toContain(">Doanh thu net</th>")
    expect(bang).toContain(">Chênh lệch net</th>")
    // Nhãn cột / tiêu đề cột (chú thích trích lời chủ nhà còn chữ "thuần" là đúng).
    expect(bang).not.toMatch(/label: "[^"]*thuần/)
    expect(bang).not.toMatch(/>[^<>{}]*thuần[^<>{}]*<\/th>/)
  })
  it("Excel Hàng bán theo nhân viên đổi theo", () => {
    const j = NV.indexOf('} else if (variant === "summary") {')
    const xuat = NV.slice(j, NV.indexOf("downloadXlsx(`bao-cao-nv-hangban-summary", j))
    expect(xuat).toMatch(/"Doanh thu net",\s+"Chênh lệch net",\s+"Tổng chênh lệch",/)
    expect(xuat).not.toContain('"Doanh thu thuần"')
    expect(xuat).not.toContain('"Chênh lệch thuần"')
  })
  it("các mối quan tâm khác giữ tên cũ (chủ nhà chỉ đổi ở Hàng bán theo nhân viên)", () => {
    expect(NV).toContain('{ key: "net", label: "Doanh thu thuần", align: "right", render: (r) => <span className="font-semibold text-primary">{formatCurrency(r.netRevenue)}</span> },')
    expect(NV).toContain('["Người bán", "Vai trò", "Doanh thu", "Giá trị trả", "Doanh thu thuần"],')
  })
})
