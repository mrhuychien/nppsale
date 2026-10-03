/** Chủ nhà 03/10/2026: "nhân viên 60 khách mà có 3 khách hiện" — lọc NV trên máy chủ. Bấm thật: e2e/khach-loc-nhan-vien.spec.ts. */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { CHUA_PHAN_CONG, chonNv } from "@/lib/customers/loc-nhan-vien"

describe("lọc khách theo nhân viên", () => {
  it("có NV → nhúng !inner; Chưa phân công → !left (phép loại); không lọc → không nhúng", () => {
    expect(chonNv("u1")).toBe(", nv_chinh:customer_assignments!inner(user_id)")
    expect(chonNv(CHUA_PHAN_CONG)).toBe(", nv_chinh:customer_assignments!left(user_id)")
    expect(chonNv(null)).toBe("")
  })
  it("màn khách lọc trên truy vấn máy chủ (NV chính, đang hoạt động), không lọc lại trong trang đã tải", () => {
    const s = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8")
    expect(s).toContain('.select(select + chonNv(nvLoc)')
    expect(s).toContain('q.eq("nv_chinh.role", "primary").eq("nv_chinh.status", "active")')
    expect(s).toContain('q.is("nv_chinh", null) : q.eq("nv_chinh.user_id", nvLoc)')
    expect(s).not.toMatch(/primaryRepMap\[c\.id\]/)
  })
})
