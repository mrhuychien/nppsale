import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { laNhanVien, trangGoc, trangSauDangNhap } from "../src/lib/nav/trang-dau"

/** ⚠ Chủ nhà 26/09/2026: nhân viên đăng nhập / gõ địa chỉ gốc → Trang chủ, không vào Tổng quan. */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("trang đầu theo vai", () => {
  it.each([
    ["owner", "/dashboard", "/orders"], ["manager", "/dashboard", "/orders"], ["accountant", "/dashboard", "/orders"],
    ["sales", "/home", "/home"], ["warehouse", "/home", "/home"], ["driver", "/home", "/home"], [null, "/home", "/home"],
  ] as const)("%s → gốc %s, đăng nhập %s", (vai, goc, dn) => {
    expect(trangGoc(vai)).toBe(goc)
    expect(trangSauDangNhap(vai)).toBe(dn)
    expect(laNhanVien(vai)).toBe(goc === "/home")
  })
  it("trang gốc, đăng nhập và middleware dùng luật này — không còn đẩy thẳng /dashboard", () => {
    expect(doc("src/app/page.tsx")).toContain("redirect(trangGoc(me?.role))")
    expect(doc("src/app/login/page.tsx")).toContain("router.push(trangSauDangNhap(vaiTro))")
    expect(doc("src/lib/supabase/middleware.ts")).not.toContain('url.pathname = "/dashboard"')
  })
})

describe("cổng vào trang không quay vòng", () => {
  it("không vào được thì về /home (luôn vào được), không về \"/\"", async () => {
    const { duocVaoTrang } = await import("../src/lib/nav/nav-permission")
    const g = doc("src/hooks/use-role-guard.ts")
    /* Trang chặn riêng một vai và chỉ chỗ thay (`truVai`, chủ nhà 13/11/2026) thì sang chỗ ấy; còn lại về /home. */
    expect(g).toContain('router.replace(trangThayChoVai(user.role, pathname) ?? "/home")')
    expect(g).not.toContain('router.replace("/")')
    for (const r of ["owner", "manager", "accountant", "sales", "warehouse"] as const) {
      expect(duocVaoTrang(r, "/home", "orders"), r).toBe(true)
    }
    // Chỗ thay phải vào được — không thì đá qua lại giữa hai trang chặn.
    const { NAV_PERMISSION, canEnterHref } = await import("../src/lib/nav/nav-permission")
    for (const [href, p] of Object.entries(NAV_PERMISSION)) {
      for (const [vai, ve] of Object.entries(p.truVai ?? {})) {
        expect(canEnterHref(vai as "sales", ve!), `${href} → ${vai} → ${ve}`).toBe(true)
      }
    }
  })
})

describe("kênh realtime không dùng lại tên cũ", () => {
  it("khoá sửa (entity lock) mỗi lần gắn một tên kênh riêng", () => {
    expect(doc("src/hooks/use-entity-lock.ts")).toMatch(/entity_locks:\$\{opts\.entityType\}:\$\{opts\.entityId\}:\$\{Math\.random\(\)/)
  })
})
