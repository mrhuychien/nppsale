/**
 * Chủ nhà 30/09/2026: "Mobile cho NPP: viết lại tất cả các trang danh sách chưa theo phong cách trang
 * Đơn hàng theo phong cách trang danh sách Đơn hàng" · "Các trang danh sách khi NPP truy cập mobile phải
 * có menu 3 gạch". Bấm thật: e2e/ds-mobile-dau-xanh.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { DOC_LIST_MOBILE_ROUTES, hidesMobileAppBar } from "@/lib/nav/mobile-chrome"
import { tachSoDem } from "@/components/ui/doc-list-mobile-head"

const GOC = "src/app/(dashboard)"
function trang(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) trang(p, out)
    else if (f === "page.tsx") out.push(p)
  }
  return out
}
const route = (p: string) => p.slice(GOC.length).replace(/\/page\.tsx$/, "") || "/"
const DS = trang(GOC).map((p) => ({ p, r: route(p), s: readFileSync(p, "utf8") }))

describe("danh sách trên điện thoại theo mẫu Đơn hàng", () => {
  it("mọi trang dùng khuôn DocListLayout có thẻ điện thoại đều có đầu trang xanh (trừ màn tự dựng riêng)", () => {
    const rieng = new Set(["/customers", "/products", "/inventory/entries", "/settings/users", "/suppliers"]) // màn tự dựng đầu xanh riêng
    const thieu = DS.filter((x) => x.s.includes("<DocListLayout") && !rieng.has(x.r) && !x.s.includes("mobileHead={")).map((x) => x.r)
    expect(thieu).toEqual([])
  })
  it("trang có đầu xanh ⇔ có tên trong DOC_LIST_MOBILE_ROUTES (không thì app bar chồng lên)", () => {
    const coDau = DS.filter((x) => x.s.includes("mobileHead={")).map((x) => x.r).sort()
    expect(coDau).toEqual([...DOC_LIST_MOBILE_ROUTES].sort())
    for (const r of DOC_LIST_MOBILE_ROUTES) expect(hidesMobileAppBar(r), r).toBe(true)
    expect(hidesMobileAppBar("/purchasing/receipts/abc"), "trang con vẫn có app bar").toBe(false)
  })
  it("không còn thanh tìm cũ trên điện thoại chồng với ô tìm của đầu xanh", () => {
    for (const x of DS.filter((d) => d.s.includes("mobileHead={"))) {
      expect(x.s, x.r).not.toContain("<MobileFilterBar")
    }
  })
  it("tách số đếm", () => {
    expect(tachSoDem("12 phiếu thu")).toEqual(["12", "phiếu thu"])
    expect(tachSoDem("1.234 hoá đơn")).toEqual(["1.234", "hoá đơn"])
  })
})
