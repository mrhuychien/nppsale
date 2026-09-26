import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { laLoiTaiMa, duocTuTaiLai, goiBaoLoi, CACH_TAI_LAI_MS } from "../src/lib/client-error"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: /dashboard điện thoại trắng "Application error: a client-side exception
 *   has occurred". Màn lỗi phải nói câu lỗi, tự tải lại khi là lỗi tải mã, và báo về máy chủ.
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")

describe("nhận diện lỗi tải mã", () => {
  it.each([
    [{ name: "ChunkLoadError", message: "x" }, true],
    [new Error("Loading chunk 4521 failed."), true],
    [new Error("Loading CSS chunk app-layout failed"), true],
    [new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"), true],
    [new TypeError("Importing a module script failed."), true],
    [new TypeError("cannot add `postgres_changes` callbacks after `subscribe()`."), false],
    [new TypeError("x.split is not a function"), false],
    [null, false],
  ])("%o → %s", (e, kq) => expect(laLoiTaiMa(e)).toBe(kq))
})

describe("tự tải lại không lặp", () => {
  it("chỉ một lần mỗi 30 giây", () => {
    expect(duocTuTaiLai(1_000_000, null)).toBe(true)
    expect(duocTuTaiLai(1_000_000, 1_000_000 - 5_000)).toBe(false)
    expect(duocTuTaiLai(1_000_000, 1_000_000 - CACH_TAI_LAI_MS - 1)).toBe(true)
    expect(duocTuTaiLai(1_000_000, Number.NaN)).toBe(true)
  })
})

describe("gói báo lỗi", () => {
  it("cắt ngắn, giữ digest và đường dẫn", () => {
    const e = Object.assign(new Error("a".repeat(5000)), { digest: "abc" })
    const g = goiBaoLoi(e, "app/error", "/dashboard?x=1")
    expect(g.thongBao.length).toBe(1000)
    expect(g.stack.length).toBeLessThanOrEqual(3000)
    expect(g).toMatchObject({ noi: "app/error", duongDan: "/dashboard?x=1", ten: "Error", digest: "abc" })
    expect(goiBaoLoi("chuỗi", "x", "/").thongBao).toBe("chuỗi")
  })
})

describe("các vùng bắt lỗi", () => {
  it("app/error (khung app) và global-error (layout gốc) dùng màn lỗi chung", () => {
    expect(doc("src/app/error.tsx")).toContain('<ErrorScreen error={error} reset={reset} noi="app/error" />')
    const g = doc("src/app/global-error.tsx")
    expect(g).toContain("<html")
    expect(g).toContain("<body>")
    const s = doc("src/components/error-screen.tsx")
    expect(s).toMatch(/if \(taiLaiNeuLoiTaiMa\(error\)\) return\s+baoLoiVeMayChu\(error, noi\)/)
    expect(doc("src/app/(dashboard)/error.tsx")).toContain('baoLoiVeMayChu(error, "dashboard/error")')
  })
  it("chuông nằm trong vùng bắt lỗi riêng; kênh realtime mỗi lần gắn một tên", () => {
    const b = doc("src/components/layout/notification-bell.tsx")
    expect(b).toMatch(/<KhungAnToan noi="notification-bell">\s*<ChuongThongBao \/>/)
    expect(b).toContain("Math.random().toString(36)")
  })
  it("/api/client-error chỉ nhận người đã đăng nhập, cắt thân tin", () => {
    const r = doc("src/app/api/client-error/route.ts")
    expect(r).toContain("if (!data.user) return new NextResponse(null, { status: 401 })")
    expect(r).toContain(".slice(0, 8000)")
  })
})
