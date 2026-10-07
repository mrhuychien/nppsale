/**
 * Chủ nhà 07/10/2026: "Phiếu trả hàng NCC cả ở pos và mobile chưa chọn được đơn vị tính". Bấm thật:
 * e2e/tra-ncc-chon-dvt.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { doiDonViDongTraNcc, supplierReturnMax } from "@/lib/pos/purchase"
import { hidesMobileAppBar, showsBottomNav } from "@/lib/nav/mobile-chrome"

const UNITS = [{ unit_name: "hộp", conversion: 1 }, { unit_name: "thùng", conversion: 24 }]
const dong = (o: Partial<{ unit: string; price: number; qty: number; ordered: number | null }> = {}) => ({
  unit: "thùng", price: 360000, qty: 2, ordered: 2, units: UNITS, ...o,
})

describe("doiDonViDongTraNcc — đổi ĐVT dòng trả NCC", () => {
  it("giá đã gõ → quy theo hệ số; trần 'đã nhập' quy theo (2 thùng = 48 hộp)", () => {
    expect(doiDonViDongTraNcc(dong(), "hộp")).toEqual({ unit: "hộp", price: 15000, qty: 2, ordered: 48 })
  })
  it("đổi sang đơn vị lớn: trần quy về (48 hộp = 2 thùng), SL vượt trần mới thì kẹp lại", () => {
    const kq = doiDonViDongTraNcc(dong({ unit: "hộp", price: 15000, qty: 30, ordered: 48 }), "thùng")
    expect(kq).toEqual({ unit: "thùng", price: 360000, qty: 2, ordered: 2 })
    expect(supplierReturnMax(kq.ordered)).toBe(2)
  })
  it("giá đang là giá gợi ý (bảng giá nhập) → lấy giá gợi ý của đơn vị mới (thùng có giá riêng)", () => {
    const goiY = (u: string) => (u === "thùng" ? 350000 : 15000)
    expect(doiDonViDongTraNcc(dong({ unit: "hộp", price: 15000, qty: 1, ordered: null }), "thùng", goiY).price).toBe(350000)
  })
  it("chưa biết số đã nhập → không có trần", () => {
    expect(doiDonViDongTraNcc(dong({ ordered: null }), "hộp").ordered).toBeNull()
  })
  it("thiếu hệ số → giữ giá, không đoán", () => {
    const l = { unit: "lốc", price: 1000, qty: 1, ordered: null, units: [{ unit_name: "hộp", conversion: 1 }] }
    expect(doiDonViDongTraNcc(l, "hộp").price).toBe(1000)
  })
})

describe("nối dây", () => {
  it("POS trả NCC có ô ĐVT đi qua doiDonViDongTraNcc", () => {
    expect(readFileSync("src/components/pos/supplier-return-screen.tsx", "utf8")).toMatch(
      /aria-label=\{`Đơn vị tính dòng \$\{i \+ 1\}`\}[\s\S]{0,120}doiDonViDongTraNcc\(l, e\.target\.value/
    )
  })
  it("điện thoại: nút ĐVT ngay trên dòng phiếu NCC", () => {
    expect(readFileSync("src/components/purchasing/phieu-ncc-mobile.tsx", "utf8")).toMatch(/data-testid="dvt-dong-ncc"/)
  })
  it("lập phiếu trả khách trên điện thoại có đầu màn + thanh đáy riêng (kiểu /sell)", () => {
    expect(hidesMobileAppBar("/returns/new")).toBe(true)
    expect(showsBottomNav("/returns/new")).toBe(false)
  })
})
