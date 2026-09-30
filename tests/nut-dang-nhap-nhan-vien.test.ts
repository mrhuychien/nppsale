/**
 * Chủ nhà 30/09/2026: "thêm nút đăng nhập chức năng tương tự mở tab trên safari cạnh tên nhân viên
 * trong Danh sách nhân viên". Bấm thật trên iPhone: e2e/qr-mo-tab-moi.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const NUT = readFileSync("src/components/users/nut-dang-nhap-nhan-vien.tsx", "utf8")
const TRANG = readFileSync("src/app/(dashboard)/settings/users/page.tsx", "utf8")
const API = readFileSync("src/app/api/admin/users/qr-links/route.ts", "utf8")
const THE = readFileSync("src/components/ui/doc-card-list.tsx", "utf8")

describe("nút Đăng nhập cạnh tên nhân viên", () => {
  it("có link sẵn thì là thẻ <a> Safari thật, bấm không mở ngăn xem nhanh", () => {
    const i = NUT.indexOf("href={safari}")
    expect(i).toBeGreaterThan(0)
    const the = NUT.slice(NUT.lastIndexOf("<a", i), NUT.indexOf("</a>", i))
    expect(the).toContain("e.stopPropagation()")
    expect(the).not.toContain("target=")
    expect(NUT).toContain("linkTrinhDuyetRieng(loginUrl)?.safari")
  })
  it("chưa có mã: tạo mã rồi mở Safari", () => {
    expect(NUT).toContain('fetch(`/api/admin/users/${userId}/qr`, { method: "POST" })')
    expect(NUT).toContain("window.location.href = moi.safari")
  })
  it("chỉ Chủ NPP trên iPhone / iPad; không cho chính mình và người đang khoá", () => {
    expect(TRANG).toContain("const coNutDangNhap = isOwner && apple")
    expect(TRANG).toContain("coNutDangNhap && u.is_active && u.id !== currentUser?.id ?")
    expect(TRANG).toContain("aside={(u) => nutDangNhap(u, true)}")
    expect(TRANG).toMatch(/font-bold">\{u\.full_name\}<\/span>\s*\{nutDangNhap\(u\)\}/)
  })
  it("API link hàng loạt: chỉ Chủ sở hữu, chỉ nhân viên cùng tổ chức", () => {
    expect(API).toContain('caller.role !== "owner"')
    expect(API).toContain('.eq("org_id", caller.org_id)')
    expect(API).toContain('.in("user_id", ids)')
  })
  it("thẻ điện thoại: nút bên nằm NGOÀI vùng chạm của thẻ", () => {
    const nut = THE.indexOf("const nut = (")
    const hetNut = THE.indexOf("</button>", nut)
    expect(THE.indexOf("{ben &&")).toBeGreaterThan(hetNut)
  })
})
