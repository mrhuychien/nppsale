import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { chuVietTat, MUC_MENU_NGUOI_DUNG } from "../src/components/layout/user-menu"
import { canSeeHref } from "../src/lib/nav/nav-permission"

/** ⚠ Chủ nhà 26/09/2026: "bấm vào icon và tên người dùng phải ra menu người dùng". */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("menu người dùng", () => {
  it("mọi chỗ hiện ảnh đại diện / tên dùng chung UserMenu", () => {
    for (const p of [
      "src/components/layout/header.tsx",
      "src/components/home/sales-home.tsx",
      "src/app/(dashboard)/home/page.tsx",
      "src/components/orders/mobile-orders-screen.tsx",
      "src/components/customers/mobile-customers-screen.tsx",
    ]) expect(doc(p), p).toContain("<UserMenu")
    // Trang chủ NVBH: cả ảnh đại diện lẫn tên nằm trong phần bấm được.
    const h = doc("src/components/home/sales-home.tsx")
    const a = h.indexOf("<UserMenu"), b = h.indexOf("</UserMenu>")
    expect(h.slice(a, b)).toContain("{viet}")
    expect(h.slice(a, b)).toContain("Chào {ten}")
  })
  it("mục theo quyền: NVBH có Phiếu lương, không Tổng quan / Cài đặt; chủ NPP có đủ", () => {
    const cua = (r: "sales" | "owner") => MUC_MENU_NGUOI_DUNG.filter((m) => canSeeHref(r, m.href)).map((m) => m.href)
    expect(cua("sales")).toEqual(["/home", "/luong-cua-toi", "/help"])
    expect(cua("owner")).toEqual(["/home", "/luong-cua-toi", "/dashboard", "/settings", "/help"])
  })
  it("chữ viết tắt", () => {
    expect(chuVietTat("Nguyễn Thị Hiền")).toBe("NH")
    expect(chuVietTat("Chủ")).toBe("C")
    expect(chuVietTat(null)).toBe("U")
  })
})
