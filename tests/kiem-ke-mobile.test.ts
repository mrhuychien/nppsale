import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"
import {
  chenhCuaDong,
  coThuaChuaGiaVon,
  nutGuiKiemKe,
  soCoDau,
  tomTatKiemKe,
  tomTatPhieuDieuChinh,
} from "../src/lib/inventory/kiem-ke-mobile"

/**
 * Hai màn Kiểm kê / Duyệt điều chỉnh trên điện thoại (thiết kế chủ nhà 30/09/2026). Số tiền tính y
 * như màn máy tính: chênh × giá vốn lô (giá mỗi đơn vị cơ sở).
 */
const dong = (systemQty: number, actualQty: string, batchCost = 1000) => ({ systemQty, actualQty, batchCost })

describe("chênh của một dòng", () => {
  it("chưa đếm / gõ sai → null", () => {
    expect(chenhCuaDong(dong(5, ""))).toBeNull()
    expect(chenhCuaDong(dong(5, "  "))).toBeNull()
    expect(chenhCuaDong(dong(5, "abc"))).toBeNull()
  })
  it("thực tế − hệ thống, kể cả khớp = 0", () => {
    expect(chenhCuaDong(dong(5, "3"))).toBe(-2)
    expect(chenhCuaDong(dong(5, "5"))).toBe(0)
    expect(chenhCuaDong(dong(0, "12"))).toBe(12)
  })
})

describe("tóm tắt phiếu đang đếm", () => {
  it("hao hụt / thừa / ròng theo giá vốn lô, đếm số dòng đã đếm", () => {
    const t = tomTatKiemKe([dong(10, "7", 2000), dong(4, "6", 500), dong(3, "3"), dong(8, "")])
    expect(t).toEqual({
      shrinkageQty: 3,
      shrinkageValue: 6000,
      surplusQty: 2,
      surplusValue: 1000,
      totalDiffValue: -5000,
      rowsWithDiff: 2,
      daDem: 3,
      tongDong: 4,
    })
  })
  it("thừa mà lô chưa có giá vốn → 0đ, vẫn đếm SL", () => {
    const t = tomTatKiemKe([dong(0, "12", 0)])
    expect(t.surplusQty).toBe(12)
    expect(t.surplusValue).toBe(0)
  })
})

describe("nút gửi ở thanh đáy", () => {
  const t = (daDem: number, rowsWithDiff: number, tongDong = 1) => ({ daDem, rowsWithDiff, tongDong })
  it("chưa đếm thì khoá, nói phải nhập tồn", () => {
    expect(nutGuiKiemKe(t(0, 0), false)).toEqual({ nhan: "Nhập tồn thực tế để gửi", khoa: true })
  })
  it("đếm hết mà khớp cả → khoá (luồng cũ không lưu phiếu không chênh)", () => {
    expect(nutGuiKiemKe(t(1, 0), false)).toEqual({ nhan: "Không có chênh lệch", khoa: true })
  })
  it("có chênh → mở, nêu số dòng", () => {
    expect(nutGuiKiemKe(t(2, 1, 2), false)).toEqual({ nhan: "Gửi duyệt (1 chênh lệch)", khoa: false })
  })
  it("đang gửi / chưa có dòng → khoá", () => {
    expect(nutGuiKiemKe(t(2, 1, 2), true).khoa).toBe(true)
    expect(nutGuiKiemKe(t(0, 0, 0), false).khoa).toBe(true)
  })
})

describe("tóm tắt phiếu chờ duyệt", () => {
  it("|SL| × giá vốn dòng; ròng = thừa − hao hụt", () => {
    const s = tomTatPhieuDieuChinh([
      { quantity: -4, unit_cost: 1500 },
      { quantity: "3", unit_cost: "1000" },
      { quantity: 0, unit_cost: 9999 },
    ])
    expect(s).toEqual({ shrinkQty: 4, shrinkValue: 6000, surplusQty: 3, surplusValue: 3000, netValue: -3000 })
  })
  it("cảnh báo khi có dòng thừa chưa có giá vốn, không cảnh báo dòng hao hụt", () => {
    expect(coThuaChuaGiaVon([{ quantity: 12, unit_cost: 0 }])).toBe(true)
    expect(coThuaChuaGiaVon([{ quantity: 12, unit_cost: null }])).toBe(true)
    expect(coThuaChuaGiaVon([{ quantity: 12, unit_cost: 100 }])).toBe(false)
    expect(coThuaChuaGiaVon([{ quantity: -3, unit_cost: 0 }])).toBe(false)
  })
  it("số có dấu", () => {
    expect([soCoDau(12), soCoDau(-3), soCoDau(0)]).toEqual(["+12", "-3", "0"])
  })
})

describe("hai trang dùng chung một phép tính với màn điện thoại", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
  it("Kiểm kê: máy tính và điện thoại cùng `tomTatKiemKe`, điện thoại bọc lg:hidden", () => {
    const s = read("src/app/(dashboard)/inventory/stocktake-adjust/page.tsx")
    expect(s).toContain("const summary = useMemo(() => tomTatKiemKe(rows), [rows])")
    expect(s).toContain("tomTat={summary}")
    expect(s).toMatch(/<div className="lg:hidden">\s*<KiemKeMobile/)
    expect(s).toContain("onGui={handleSave}")
  })
  it("Duyệt điều chỉnh: nút điện thoại gọi đúng handleApprove / handleReject của trang", () => {
    const s = read("src/app/(dashboard)/inventory/adjustments/page.tsx")
    expect(s).toContain("const summarize = (a: Adjustment) => tomTatPhieuDieuChinh(a.lines || [])")
    expect(s).toContain("onApprove={(a) => handleApprove(a as Adjustment)}")
    expect(s).toContain("onReject={(a) => handleReject(a as Adjustment)}")
    expect(s).toContain("canApprove={!!canApprove}")
  })
  it("màn điện thoại khoá Duyệt khi còn sản phẩm thừa chưa có lô", () => {
    const s = read("src/components/inventory/duyet-dieu-chinh-mobile.tsx")
    expect(s).toContain("disabled={dangBan || thieuLo.length > 0}")
    expect(s).toContain("{canApprove && (")
  })
})
