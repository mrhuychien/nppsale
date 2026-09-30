import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  chiaKenh,
  congNgay,
  dauKy,
  demViecCanXuLy,
  nhanCapNhat,
  tienRutGon,
  trungBinhDon,
} from "@/lib/dashboard/tong-quan"

/* Chủ nhà 30/09/2026: làm lại màn Tổng quan điện thoại theo thiết kế "tongquan". */

describe("dauKy — mốc đầu kỳ theo ngày giờ VN", () => {
  // 30/09/2026 21:19 giờ VN = 14:19 UTC.
  const toi = new Date("2026-09-30T14:19:00Z")
  it("bốn kỳ", () => {
    expect(dauKy("today", toi)).toBe("2026-09-30")
    expect(dauKy("week", toi)).toBe("2026-09-28") // thứ Hai
    expect(dauKy("month", toi)).toBe("2026-09-01")
    expect(dauKy("quarter", toi)).toBe("2026-07-01")
  })
  it("01/10 lúc 6h sáng VN (còn 30/09 theo UTC) đã là ngày/tháng/quý mới", () => {
    const sang = new Date("2026-09-30T23:00:00Z")
    expect(dauKy("today", sang)).toBe("2026-10-01")
    expect(dauKy("month", sang)).toBe("2026-10-01")
    expect(dauKy("quarter", sang)).toBe("2026-10-01")
  })
  it("chủ nhật thuộc tuần bắt đầu thứ Hai trước đó", () => {
    expect(dauKy("week", new Date("2026-10-04T05:00:00Z"))).toBe("2026-09-28")
  })
  it("congNgay qua tháng", () => {
    expect(congNgay("2026-09-30", 30)).toBe("2026-10-30")
    expect(congNgay("2026-12-15", 30)).toBe("2027-01-14")
  })
})

describe("tienRutGon", () => {
  it("như thiết kế", () => {
    expect(tienRutGon(964_775_500)).toBe("964,78 tr")
    expect(tienRutGon(15_330_000)).toBe("15,33 tr")
    expect(tienRutGon(1_780_000)).toBe("1,78 tr")
    expect(tienRutGon(2_000_000)).toBe("2 tr")
    expect(tienRutGon(1_250_000_000)).toBe("1,25 tỷ")
    expect(tienRutGon(450_000)).toBe("450.000đ")
    expect(tienRutGon(-3_500_000)).toBe("-3,5 tr")
  })
})

it("trungBinhDon: không đơn → 0", () => {
  expect(trungBinhDon(964_775_500, 542)).toBeCloseTo(1_780_028.6, 0)
  expect(trungBinhDon(100, 0)).toBe(0)
})

it("nhanCapNhat theo giờ VN", () => {
  expect(nhanCapNhat(new Date("2026-09-30T14:19:00Z"))).toBe("30/09 · Cập nhật 21:19")
})

describe("chiaKenh", () => {
  it("5 kênh đầu + ô gộp, phần trăm trên tổng", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ channel: `K${i}`, revenue: 100 - i * 10 }))
    const { items, soKenh } = chiaKenh(rows)
    expect(soKenh).toBe(8)
    expect(items).toHaveLength(6)
    expect(items[0].channel).toBe("K0")
    expect(items[5]).toMatchObject({ channel: "3 kênh khác", revenue: 50 + 40 + 30, gop: true })
    const tong = items.reduce((s, k) => s + k.width, 0)
    expect(tong).toBeCloseTo(100, 6)
  })
  it("kênh âm (trả nhiều hơn đi) được 0%, không làm thanh vượt 100%", () => {
    const { items } = chiaKenh([
      { channel: "A", revenue: 300 },
      { channel: "B", revenue: 100 },
      { channel: "C", revenue: -50 },
    ])
    expect(items.map((k) => k.percent)).toEqual([75, 25, 0])
    expect(items[2].revenue).toBe(-50)
    expect(items.every((k) => k.width >= 0)).toBe(true)
  })
  it("không quá 5 kênh thì không có ô gộp", () => {
    expect(chiaKenh([{ channel: "A", revenue: 1 }]).items).toHaveLength(1)
  })
})

it("demViecCanXuLy đếm mục khác 0", () => {
  expect(demViecCanXuLy({ quaHan: 3, tonThap: 194, sapHetHan: 0 })).toBe(2)
  expect(demViecCanXuLy({ quaHan: 0, tonThap: 0, sapHetHan: 0 })).toBe(0)
})

describe("trang /dashboard", () => {
  const S = readFileSync("src/app/(dashboard)/dashboard/page.tsx", "utf8")
  it("điện thoại lg:hidden, máy tính hidden lg:block, cùng một lần nạp", () => {
    expect(S).toContain("<TongQuanMobile")
    expect(S).toMatch(/className="lg:hidden">\s*<TongQuanMobile/)
    expect(S).toContain('className="hidden lg:block space-y-card-gap"')
  })
  it("mốc kỳ theo giờ VN, không toISOString", () => {
    expect(S).toContain("dauKy(period, now)")
    expect(S).not.toMatch(/toISOString\(\)\s*\.slice\(0, 10\)/)
  })
})
