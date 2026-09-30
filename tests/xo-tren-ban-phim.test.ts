/**
 * Chủ nhà 30/09/2026: "Màn nhập hàng NCC trên điện thoại: khi tìm ncc phần danh sách tìm tụt xuống dưới
 * bàn phím". Bấm thật (giả bàn phím bằng visualViewport): e2e/tim-ncc-ban-phim.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { chieuCaoXo } from "@/hooks/use-viewport-insets"

describe("danh sách xổ không chui xuống dưới bàn phím", () => {
  it("cao vừa phần màn còn thấy dưới ô nhập", () => {
    // Khung nhìn còn 400px (bàn phím chiếm phần dưới), ô nhập đáy ở 200 → còn 188px.
    expect(chieuCaoXo(200, { height: 400, offsetTop: 0 })).toEqual({ maxHeight: 188, canCuon: false })
    // Không bàn phím: tối đa 288.
    expect(chieuCaoXo(200, { height: 844, offsetTop: 0 }).maxHeight).toBe(288)
  })
  it("còn ít chỗ thì báo cuộn ô lên; không bao giờ âm", () => {
    const r = chieuCaoXo(380, { height: 400, offsetTop: 0 })
    expect(r.canCuon).toBe(true)
    expect(r.maxHeight).toBe(96)
    // Khung nhìn đã cuộn xuống 300px → phần thấy kéo dài tới 700.
    expect(chieuCaoXo(380, { height: 400, offsetTop: 300 })).toEqual({ maxHeight: 288, canCuon: false })
  })
  it("ô tìm chung + ngăn NCC + ngăn sửa dòng đều đo khung nhìn", () => {
    const ss = readFileSync("src/components/ui/search-select.tsx", "utf8")
    expect(ss).toContain("style={xoMax ? { maxHeight: xoMax } : undefined}")
    const ncc = readFileSync("src/components/purchasing/phieu-ncc-mobile.tsx", "utf8")
    expect(ncc.match(/style=\{box \? \{ maxHeight: box\.height, bottom: box\.bottom \} : undefined\}/g)?.length).toBe(2)
  })
})
