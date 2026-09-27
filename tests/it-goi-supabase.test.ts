/** Chủ nhà 27/09/2026: log Supabase vượt gói — bớt lượt gọi trùng. */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { nhoNen, xoaNhoNen, coLoi, NHO_NEN_MS } from "@/lib/cache/nho-nen"

describe("nhoNen: nhớ danh mục nền trong phiên", () => {
  it("hai màn hỏi cùng lúc / trong 5 phút → một lượt đọc", async () => {
    xoaNhoNen()
    const doc = vi.fn(async () => ({ data: [1], error: null }))
    await Promise.all([nhoNen("nen:a", doc, coLoi, 1000), nhoNen("nen:a", doc, coLoi, 1000)])
    await nhoNen("nen:a", doc, coLoi, 1000 + NHO_NEN_MS - 1)
    expect(doc).toHaveBeenCalledTimes(1)
    await nhoNen("nen:a", doc, coLoi, 1000 + NHO_NEN_MS)
    expect(doc).toHaveBeenCalledTimes(2)
  })
  it("đọc hỏng thì không nhớ; xoá theo tiền tố", async () => {
    xoaNhoNen()
    const hong = vi.fn(async () => ({ data: null, error: { message: "x" } }))
    await nhoNen("nen:b", hong, coLoi, 1)
    await nhoNen("nen:b", hong, coLoi, 2)
    expect(hong).toHaveBeenCalledTimes(2)
    const ok = vi.fn(async () => ({ data: [], error: null }))
    await nhoNen("nen:khach-nhe", ok, coLoi, 1)
    xoaNhoNen("nen:khach")
    await nhoNen("nen:khach-nhe", ok, coLoi, 2)
    expect(ok).toHaveBeenCalledTimes(2)
  })
})

describe("các chỗ đọc trùng đã gộp", () => {
  const src = (p: string) => readFileSync(p, "utf8")
  it("hồ sơ: một lần cho mỗi người trong phiên (trừ USER_UPDATED)", () => {
    expect(src("src/hooks/use-auth.tsx")).toMatch(/if \(hoSoCua === au\.id && event !== "USER_UPDATED"\)/)
  })
  it("chuông thông báo: một kho chung, một kênh realtime", () => {
    const s = src("src/components/layout/notification-bell.tsx")
    expect(s).toMatch(/function docTB\(uid: string, epMoi = false\)/)
    expect(s).toMatch(/function moKenhTB\(uid: string\)/)
    expect(s).toMatch(/if \(next\) fetchNotifications\(true\)/)
  })
  it("quyền: nhớ 5 phút theo phiên, xoá khi lưu phân quyền", () => {
    expect(src("src/components/permissions-loader.tsx")).toMatch(/sessionStorage\.getItem\(khoa\)/)
    expect(src("src/app/(dashboard)/settings/permissions/page.tsx")).toContain("xoaNhoQuyen()")
    expect(src("src/components/settings/permission-matrix.tsx")).toContain("xoaNhoQuyen()")
  })
  it("trang chủ NVBH nhớ 2 phút; danh sách đơn / hoá đơn nhớ danh mục nền", () => {
    expect(src("src/components/home/sales-home.tsx")).toMatch(/boNhoTrangChu\.set\(khoaNho/)
    for (const f of ["orders", "sales-invoices"]) {
      const s = src(`src/app/(dashboard)/${f}/page.tsx`)
      for (const k of ["nen:khach-nhe", "nen:nhan-vien-ban", "nen:tuyen"]) expect(s, `${f} ${k}`).toContain(`nhoNen("${k}"`)
    }
  })
})
