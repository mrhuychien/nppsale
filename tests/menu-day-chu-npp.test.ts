/**
 * Chủ nhà 30/09/2026: menu đáy điện thoại của NPP — "thay Tổng quan = Trang chủ. Thay Kho bằng Nhập
 * hàng (phiếu nhập hàng), Thay nhân sự bằng Nhân viên (danh sách nhân viên)". Bấm thật:
 * e2e/menu-day-chu-npp.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { canSeeHref } from "@/lib/nav/nav-permission"

const NAV = readFileSync("src/components/layout/mobile-nav.tsx", "utf8")
const owner = NAV.slice(NAV.indexOf("  owner: ["), NAV.indexOf("  ],", NAV.indexOf("  owner: [")))
const muc = Array.from(owner.matchAll(/label: "([^"]+)", href: "([^"]+)"/g), (m) => [m[1], m[2]])

describe("menu đáy của Chủ NPP", () => {
  it("Trang chủ · Đơn hàng · [Bán hàng] · Nhập hàng · Nhân viên", () => {
    expect(muc).toEqual([
      ["Trang chủ", "/home"],
      ["Đơn hàng", "/orders"],
      ["Nhập hàng", "/purchasing/receipts"],
      ["Nhân viên", "/settings/users"],
    ])
  })
  it("chủ NPP thấy đủ bốn mục (không bị lọc quyền rơi mất)", () => {
    for (const [, href] of muc) expect(canSeeHref("owner", href), href).toBe(true)
  })
})

import { laTrangDanhSach } from "@/lib/nav/mobile-chrome"

describe("trang danh sách có ☰ (chủ nhà 30/09/2026)", () => {
  it("danh sách / trang gốc mục: có; chi tiết / form: không", () => {
    for (const p of ["/orders", "/settings/users", "/purchase-returns", "/inventory/stock-out", "/receivables/by-rep"]) {
      expect(laTrangDanhSach(p), p).toBe(true)
    }
    for (const p of ["/", "/orders/3f1a2b3c-1111-4222-8333-444455556666", "/purchasing/receipts/new", "/customers/3f1a2b3c-1111-4222-8333-444455556666/edit", "/orders/3f1a2b3c-1111-4222-8333-444455556666/print"]) {
      expect(laTrangDanhSach(p), p).toBe(false)
    }
  })
  it("app bar: khối văn phòng ở trang danh sách thì ☰ thắng ←", () => {
    const H = readFileSync("src/components/layout/header.tsx", "utf8")
    expect(H).toContain("const showBack = backHref !== undefined && !(user && !laNhanVien(user.role) && laTrangDanhSach(pathname))")
  })
  it("bốn màn đầu trang xanh có ☰", () => {
    for (const f of ["src/components/orders/mobile-orders-screen.tsx", "src/components/customers/mobile-customers-screen.tsx", "src/components/returns/mobile-returns-screen.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("<NutMenuDauTrang />")
    }
  })
})
