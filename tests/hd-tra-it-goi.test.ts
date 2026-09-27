/**
 * Chủ nhà 27/09/2026: "Phần chức năng của nhân viên bán hàng thêm phần Hoá đơn bán. Viết lại giao
 * diện danh sách hoá đơn bán trên mobile theo mẫu danh sách Đơn hàng … Check lại phần giao diện mới
 * Trả hàng và Hoá đơn bán xem có API nhiều ko và tối ưu" + "org làm gì đâu vì chỉ có 1 nhà phân
 * phối dùng thôi".
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { baoQuyenDaNap, layQuyenDaNap, ngheQuyenDaNap } from "@/lib/permissions"
import { huyHieuHoaDon } from "@/lib/orders/status-tone"
import { hidesMobileAppBar } from "@/lib/nav/mobile-chrome"

const src = (p: string) => readFileSync(p, "utf8")

describe("cờ bảng quyền đã nạp", () => {
  it("báo đổi đúng một lần mỗi lần đổi; gỡ nghe thì thôi báo", () => {
    const f = vi.fn()
    const go = ngheQuyenDaNap(f)
    baoQuyenDaNap(false)
    baoQuyenDaNap(true)
    baoQuyenDaNap(true)
    expect(layQuyenDaNap()).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
    go()
    baoQuyenDaNap(false)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it("chốt cửa vào chờ bảng quyền trước khi đá về /home; loader báo cả khi đọc hỏng", () => {
    const g = src("src/hooks/use-role-guard.ts")
    expect(g).toMatch(/!hasAccess && quyenChac\)/)
    expect(g).toMatch(/loading: loading \|\| \(!hasAccess && !quyenChac\)/)
    const l = src("src/components/permissions-loader.tsx")
    expect(l.match(/baoQuyenDaNap\(true\)/g)?.length).toBeGreaterThanOrEqual(3)
  })
})

describe("bớt lượt gọi", () => {
  it("useOrg: bọc Promise.resolve (builder Supabase chạy lại mỗi lần .then) + nhớ trong máy 12 giờ", () => {
    const s = src("src/hooks/use-org.ts")
    expect(s).toMatch(/p = Promise\.resolve\(createClient\(\)\.from\("organizations"\)/)
    expect(s).toMatch(/localStorage\.setItem\(khoaNho/)
    expect(s).toMatch(/cache\.get\(orgId\) \?\? docNho\(orgId\)/)
  })
  it("useFieldSearch: kết quả y hệt thì giữ nguyên đối tượng (không đọc lại cả danh sách)", () => {
    expect(src("src/hooks/use-field-search.ts")).toMatch(/setKq\(\(cu\) => \(cu\.key === key && JSON\.stringify/)
  })
  it("hoá đơn bán: bỏ đọc dòng hàng; danh mục lọc chỉ khi cần; tải thêm chỉ phần mới; hàng trả không đọc lại", () => {
    const s = src("src/app/(dashboard)/sales-invoices/page.tsx")
    expect(s).not.toContain("sales_invoice_lines")
    expect(s).toMatch(/const canDanhMuc = laMay === true \|\| filterSheet \|\| !!drawerId/)
    expect(s).toMatch(/taoQ\(false\)\.range\(truoc\.to \+ 1, pg\.to\)/)
    expect(s).toMatch(/filter\(\(id\) => !daDoc\.has\(id\)\)/)
  })
  it("đơn hàng: danh mục lọc khi cần; công nợ / hoá đơn MISA / dòng hàng / dòng hôm nay chỉ máy tính", () => {
    const s = src("src/app/(dashboard)/orders/page.tsx")
    expect(s).toMatch(/const canDanhMuc = laMay === true \|\| filterSheet/)
    expect(s).toMatch(/if \(!canDanhMuc\) return/)
    expect(s).toMatch(/if \(laMay === true\) void loadTodaySummary\(\)/)
    expect(s).toMatch(/if \(laMay !== true\) return\s+let cancelled = false\s+;\(async \(\) => \{\s+const ids = orders/)
    expect(s).toMatch(/if \(laMay !== true \|\| orders\.length === 0\) return/)
  })
  it("trả hàng: ngăn dùng dòng đã tải; tải thêm chỉ phần mới; tab điện thoại tính ngay (không đọc hai lần)", () => {
    const s = src("src/app/(dashboard)/returns/page.tsx")
    expect(s).toMatch(/row=\{nganMo \? \(filtered\.find/)
    expect(s).toMatch(/taoQ\(truoc\.to \+ 1, pg\.to, false\)/)
    expect(s).toMatch(/const ttHieuLuc = laDienThoai &&/)
    expect(src("src/components/returns/mobile-return-sheet.tsx")).toMatch(/if \(row && row\.id === returnId\)/)
  })
})

describe("hoá đơn bán trên điện thoại theo mẫu Đơn hàng", () => {
  it("huy hiệu: đã xuất thường thì không đeo; huỷ / lập lại / đã bị thay thì đeo", () => {
    expect(huyHieuHoaDon({ status: "posted" })).toBeNull()
    expect(huyHieuHoaDon({ status: "cancelled" })?.label).toBeTruthy()
    expect(huyHieuHoaDon({ status: "posted", replaced_from: "x" })?.label).toBe("Lập lại")
    expect(huyHieuHoaDon({ status: "posted", replaced_by: "y" })?.label).toBe("Đã bị thay")
  })
  it("dùng chung MobileOrdersScreen; ẩn app bar chuẩn; ô Hoá đơn bán trong lưới NVBH", () => {
    expect(src("src/app/(dashboard)/sales-invoices/page.tsx")).toContain("<MobileOrdersScreen")
    expect(hidesMobileAppBar("/sales-invoices")).toBe(true)
    const h = src("src/app/(dashboard)/home/page.tsx")
    expect(h).toMatch(/\{ label: "Hoá đơn bán", href: "\/sales-invoices"/)
  })
})
