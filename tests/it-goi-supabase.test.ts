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

import { docDemNhom, tongDem } from "@/lib/list/dem-nhom"

describe("đếm chip trạng thái một lượt (mig 206)", () => {
  it("đọc kết quả gom nhóm; tổng = cộng mọi trạng thái", () => {
    const d = docDemNhom({ data: [{ status: "draft", count: 3 }, { status: "completed", count: 5 }], error: null })
    expect(d).toEqual({ draft: 3, completed: 5 })
    expect(tongDem(d!)).toBe(8)
    expect(docDemNhom({ data: [], error: null })).toEqual({})
  })
  it("chưa bật gom nhóm (lỗi, hay trả dòng không có count) → null để đếm kiểu cũ", () => {
    expect(docDemNhom({ data: null, error: { code: "PGRST123", message: "Use of aggregate functions is not allowed" } })).toBeNull()
    expect(docDemNhom({ data: [{ status: "draft" }], error: null })).toBeNull()
  })
  it("danh sách đơn / hoá đơn thử gom nhóm trước, lùi về đếm từng trạng thái", () => {
    for (const [f, bang] of [["orders", "sales_orders"], ["sales-invoices", "sales_invoices"]]) {
      const s = readFileSync(`src/app/(dashboard)/${f}/page.tsx`, "utf8")
      expect(s).toContain(`supabase.from("${bang}").select(routeFilter !== "all" ? "status, count(), customer:customers!inner()" : "status, count()")`)
      expect(s).toMatch(/if \(nhom\) \{/)
    }
  })
  it("mig 206 bật aggregates của PostgREST, có đường tắt lại", () => {
    const sql = readFileSync("supabase/migrations/206_dem_theo_nhom.sql", "utf8")
    expect(sql).toContain("ALTER ROLE authenticator SET pgrst.db_aggregates_enabled = 'true';")
    expect(sql).toContain("NOTIFY pgrst, 'reload config';")
  })
})
