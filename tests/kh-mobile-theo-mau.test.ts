import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { noNgan, datGanNhat, diaChiNgan, BUOC_TAI_KHACH } from "../src/components/customers/mobile-customers-screen"
import { hidesMobileAppBar } from "../src/lib/nav/mobile-chrome"

/** ⚠ CHỦ NHÀ 26/09/2026: "Thiết kế lại màn Khách hàng trên mobile theo mẫu". */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const PAGE = doc("src/app/(dashboard)/customers/page.tsx")

const ngayTruoc = (n: number) => {
  const d = new Date(Date.now() - n * 86_400_000)
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
}

describe("thẻ khách theo mẫu", () => {
  it("nợ: rút gọn, dư có (công nợ âm), không nợ, chưa đọc được", () => {
    expect(noNgan(2_200_000)).toBe("Nợ 2,2 tr")
    expect(noNgan(-300_000)).toBe("Dư có 300k")
    expect(noNgan(0)).toBe("Không nợ")
    expect(noNgan(null)).toBe("—")
  })
  it("lần đặt gần nhất", () => {
    expect(datGanNhat(null)).toBe("Chưa đặt đơn")
    expect(datGanNhat(ngayTruoc(0))).toBe("Đặt hôm nay")
    expect(datGanNhat(ngayTruoc(1))).toBe("Đặt hôm qua")
    expect(datGanNhat(ngayTruoc(15))).toBe("Đặt 15 ngày trước")
  })
  it("địa chỉ gọn: bỏ trống, không lặp", () => {
    expect(diaChiNgan({ address: "Số 199 Hàng Kênh", ward: "Cát Dài", district: "Lê Chân" })).toBe("Số 199 Hàng Kênh, Cát Dài, Lê Chân")
    expect(diaChiNgan({ address: "12 Tô Hiệu, Lê Chân", ward: null, district: "Lê Chân" })).toBe("12 Tô Hiệu, Lê Chân")
    expect(diaChiNgan({})).toBe("")
  })
})

describe("màn /customers trên điện thoại", () => {
  it("tải 20 khách mỗi lần; máy tính giữ trang 50", () => {
    expect(BUOC_TAI_KHACH).toBe(20)
    expect(PAGE).toMatch(/matches \? 50 : BUOC_TAI_KHACH/)
  })
  it("Nợ nhiều nhất sắp trên TOÀN BỘ nợ đã đọc (lát mã), rồi xếp lại theo lát mã", () => {
    expect(PAGE).toContain("Object.keys(debts).filter((id) => debts[id] > 0).sort((a, b) => debts[b] - debts[a])")
    expect(PAGE).toContain('const noNhieuNhat = quick === "all" && sapXep === "debt" && !debouncedSearch && debts !== null')
    expect(PAGE).toContain("filtered.slice().sort((a, b) => (thu.get(a.id) ?? 0) - (thu.get(b.id) ?? 0))")
  })
  it("NVBH không thấy người phụ trách; quản lý vẫn thấy", () => {
    expect(PAGE).toContain("isSales ? null : managersSummary(managersMap[c.id] || [])")
  })
  it("đầu trang xanh riêng — không app bar chuẩn chồng lên", () => {
    expect(hidesMobileAppBar("/customers")).toBe(true)
    expect(hidesMobileAppBar("/customers/abc")).toBe(false)
  })
  it("màn điện thoại đặt cuối, sau bảng máy tính", () => {
    expect(PAGE.indexOf("<MobileCustomersScreen")).toBeGreaterThan(PAGE.indexOf("<CustomerTable"))
  })
})
