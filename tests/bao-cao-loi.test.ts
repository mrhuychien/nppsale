import { describe, it, expect } from "vitest"
import { kyTheoMa, chiaThoiGian, doHat, khoaThoiGian, congNgay, homNayVN, nhanKhoang } from "@/lib/bao-cao/ky"
import { soGon, soDu, soSanh, phanTram, boDau } from "@/lib/bao-cao/so"
import { congBan, gomBan, congDat, quaLoc, hienSoLuong, danhMucRong, type DongBan, type DongDat } from "@/lib/bao-cao/cong"
import { docTrangThai, ghiTrangThai, hieuLuc, TRANG_THAI_GOC } from "@/lib/bao-cao/trang-thai"

describe("kỳ báo cáo (spec 2.3)", () => {
  it("Tháng này = tháng lịch; so với cùng số ngày đầu tháng trước", () => {
    expect(kyTheoMa("month", "2026-09-26")).toEqual({ a: "2026-09-01", b: "2026-09-26", cmp: ["2026-08-01", "2026-08-26"] })
    // 31/03: tháng 2 chỉ có 28 ngày → so cả tháng 2
    expect(kyTheoMa("month", "2026-03-31").cmp).toEqual(["2026-02-01", "2026-02-28"])
  })
  it("Tuần này bắt đầu thứ Hai; Tuần trước đủ 7 ngày", () => {
    // 26/09/2026 là thứ Bảy
    expect(kyTheoMa("week", "2026-09-26")).toEqual({ a: "2026-09-21", b: "2026-09-26", cmp: ["2026-09-14", "2026-09-19"] })
    expect(kyTheoMa("lastweek", "2026-09-26")).toEqual({ a: "2026-09-14", b: "2026-09-20", cmp: ["2026-09-07", "2026-09-13"] })
  })
  it("Tháng trước, Quý này, Năm nay, Hôm qua, Tuỳ chỉnh", () => {
    expect(kyTheoMa("lastmonth", "2026-09-26")).toEqual({ a: "2026-08-01", b: "2026-08-31", cmp: ["2026-07-01", "2026-07-31"] })
    expect(kyTheoMa("quarter", "2026-09-26")).toEqual({ a: "2026-07-01", b: "2026-09-26", cmp: ["2026-04-01", "2026-06-27"] })
    expect(kyTheoMa("year", "2026-09-26")).toEqual({ a: "2026-01-01", b: "2026-09-26", cmp: null })
    expect(kyTheoMa("yesterday", "2026-09-01")).toEqual({ a: "2026-08-31", b: "2026-08-31", cmp: ["2026-08-30", "2026-08-30"] })
    expect(kyTheoMa("custom", "2026-09-26", "2026-09-10", "2026-09-01")).toEqual({ a: "2026-09-01", b: "2026-09-10", cmp: ["2026-08-22", "2026-08-31"] })
  })
  it("hôm nay theo giờ VN, không theo UTC", () => {
    // 20:00 UTC ngày 25 = 03:00 ngày 26 giờ VN
    expect(homNayVN(new Date("2026-09-25T20:00:00Z"))).toBe("2026-09-26")
  })
  it("độ hạt + cột thời gian phủ kín kỳ", () => {
    expect(doHat("2026-09-01", "2026-09-26")).toBe("day")
    expect(doHat("2026-07-01", "2026-09-26")).toBe("week")
    expect(doHat("2026-01-01", "2026-09-26")).toBe("month")
    expect(chiaThoiGian("2026-09-01", "2026-09-26", "day")).toHaveLength(26)
    const tuan = chiaThoiGian("2026-09-02", "2026-09-26", "week")
    expect(tuan[0]).toMatchObject({ k: "2026-08-31", r: ["2026-09-02", "2026-09-06"] })
    expect(tuan.at(-1)).toMatchObject({ r: ["2026-09-21", "2026-09-26"] })
    const thang = chiaThoiGian("2026-01-15", "2026-03-10", "month")
    expect(thang.map((t) => t.r)).toEqual([["2026-01-15", "2026-01-31"], ["2026-02-01", "2026-02-28"], ["2026-03-01", "2026-03-10"]])
    expect(khoaThoiGian("week", "2026-09-26")).toBe("2026-09-21")
    expect(congNgay("2026-12-31", 1)).toBe("2027-01-01")
    expect(nhanKhoang("2026-09-01", "2026-09-26")).toBe("01/09 – 26/09")
  })
})

describe("định dạng số", () => {
  it("rút gọn ở thẻ, đủ ở bảng", () => {
    expect(soGon(923_400_000)).toBe("923 tr")
    expect(soGon(1_234_000_000)).toBe("1,23 tỷ")
    expect(soGon(12_500_000)).toBe("12,5 tr")
    expect(soGon(-3_000_000)).toBe("-3 tr")
    expect(soGon(850_000)).toBe("850.000")
    expect(soDu(1234000)).toBe("1.234.000")
    expect(phanTram(0.125)).toBe("12,5%")
    expect(phanTram(1, 0)).toBe("100%")
    expect(phanTram(0, 0)).toBe("0%")
    expect(soGon(10_000_000)).toBe("10 tr")
  })
  it("so sánh: chiều tốt / xấu, tắt thì không có dòng", () => {
    expect(soSanh(112, 100, true)).toEqual({ t: "▲ 12% so với kỳ trước", tone: "tot" })
    expect(soSanh(112, 100, false)?.tone).toBe("xau")
    expect(soSanh(95, 100, true)).toEqual({ t: "▼ 5% so với kỳ trước", tone: "xau" })
    expect(soSanh(5, 0, true)?.t).toBe("mới so với kỳ trước")
    expect(soSanh(5, null, true)).toBeNull()
    expect(boDau("Tạp hoá Cô Ba Đức")).toBe("tap hoa co ba duc")
  })
})

const ban = (o: Partial<DongBan>): DongBan => ({ ngay: "2026-09-01", loai: 1, ct: "h1", hd: "h1", kh: "k1", nv: "n1", sp: "p1", tien: 0, giaVon: 0, sl: 0, ...o })

describe("cộng dồn dòng bán", () => {
  const ls = [
    ban({ tien: 600, giaVon: 400, sl: 6 }),
    ban({ sp: "p2", tien: 400, giaVon: 300, sl: 4 }),
    ban({ ct: "h2", hd: "h2", kh: "k2", tien: 1000, giaVon: 700, sl: 10, ngay: "2026-09-02" }),
    ban({ loai: -1, ct: "r1", hd: "", tien: 100, giaVon: 70, sl: 1, ngay: "2026-09-02" }),
  ]
  it("thuần = bán − trả; lãi gộp = thuần − (giá vốn − giá vốn hàng trả)", () => {
    const t = congBan(ls)
    expect(t).toMatchObject({ rev: 2000, ret: 100, net: 1900, cost: 1330, gp: 570, nInv: 2, nCust: 2 })
    expect(t.avg).toBe(950)
  })
  it("gom theo chiều: tổng các nhóm = tổng kỳ", () => {
    const m = gomBan(ls, (l) => l.sp)
    expect(Array.from(m.values()).reduce((s, g) => s + g.net, 0)).toBe(1900)
    expect(m.get("p1")).toMatchObject({ net: 1500, qty: 16, rqty: 1, nInv: 2, last: "2026-09-02" })
  })
  it("đơn đặt: đã xuất / chưa xuất / tỉ lệ", () => {
    const d: DongDat[] = [
      { ngay: "2026-09-01", don: "d1", kh: "k1", nv: "n1", sp: "p1", tien: 300, daXuat: 300, trangThai: "completed", nguoiTao: "u" },
      { ngay: "2026-09-01", don: "d1", kh: "k1", nv: "n1", sp: "p2", tien: 200, daXuat: 0, trangThai: "completed", nguoiTao: "u" },
      { ngay: "2026-09-02", don: "d2", kh: "k2", nv: "n1", sp: "p1", tien: 500, daXuat: 0, trangThai: "submitted", nguoiTao: "u" },
    ]
    expect(congDat(d)).toEqual({ n: 2, val: 1000, done: 300, not: 700, rate: 0.3 })
  })
  it("lọc theo chiều của khách / mặt hàng; loại không áp được thì bỏ qua", () => {
    const dm = danhMucRong()
    dm.khach.set("k1", { ten: "Cô Ba", nhom: "g1", kenh: "Tuyến A", tinh: "Hải Phòng", nv: "n1", hanMuc: 0, hanNo: 0 })
    dm.sp.set("p1", { ten: "Sữa", sku: "S", nhom: "Sữa", thuongHieu: "", ncc: "c1", donViCoSo: "hộp", donViLon: null })
    expect(quaLoc({ kh: "k1", sp: "p1" }, { channel: ["Tuyến A"], ncc: ["c1"] }, dm)).toBe(true)
    expect(quaLoc({ kh: "k1", sp: "p1" }, { province: ["Hà Nội"] }, dm)).toBe(false)
    expect(quaLoc({ kh: "k1" }, { ncc: ["c9"] }, dm)).toBe(true) // phiếu thu không có mặt hàng
    expect(quaLoc({ kh: "k1", sp: "p1" }, { brand: ["(Chưa có)"] }, dm)).toBe(true)
  })
  it("số lượng: đơn vị lớn + đơn vị cơ sở, không cộng lẫn", () => {
    const sp = { ten: "", sku: "", nhom: "", thuongHieu: "", ncc: "", donViCoSo: "hộp", donViLon: { ten: "thùng", heSo: 24 } }
    expect(hienSoLuong(sp, 99)).toEqual({ t: "4 thùng 3 hộp", sub: "99 hộp" })
    expect(hienSoLuong(sp, 96)).toEqual({ t: "4 thùng", sub: "96 hộp" })
    expect(hienSoLuong(sp, 5)).toEqual({ t: "5 hộp", sub: "" })
  })
})

describe("trạng thái trên đường dẫn", () => {
  it("ghi → đọc lại được y nguyên; chỉ ghi phần khác mặc định", () => {
    const st = { ...TRANG_THAI_GOC, ky: "custom" as const, ca: "2026-09-01", cb: "2026-09-10", soSanh: false, loc: { cust: ["a", "b"] }, xem: "cust", nguon: "ord" as const, dao: [{ l: "12/09", v: "cust", f: { range: ["2026-09-12", "2026-09-12"] as [string, string] } }] }
    const qs = ghiTrangThai(st, { xem: "time" })
    expect(docTrangThai(new URLSearchParams(qs), { xem: "time" })).toEqual(st)
    expect(ghiTrangThai({ ...TRANG_THAI_GOC, xem: "time" }, { xem: "time" })).toBe("")
  })
  it("đường dẫn hỏng không làm vỡ màn", () => {
    const st = docTrangThai(new URLSearchParams("ky=abc&dao=%7Bxx&ca=2026-99"))
    expect(st.ky).toBe("month")
    expect(st.dao).toEqual([])
    expect(st.ca).toBeNull()
  })
  it("đào sâu đè lọc thanh; NVBH bị khoá nhân viên", () => {
    const st = { ...TRANG_THAI_GOC, loc: { cust: ["a", "b"], staff: ["x"] }, dao: [{ l: "Cô Ba", v: "prod", f: { cust: "a", pending: true } }] }
    expect(hieuLuc(st, "cust", "me")).toEqual({ loc: { cust: ["a"], staff: ["me"] }, khoang: null, co: { pending: true }, xem: "prod" })
    expect(hieuLuc({ ...st, dao: [] }, "cust").xem).toBe("cust")
  })
})

describe("menu: chỉ một mục sáng", () => {
  it("mục khớp dài nhất thắng — Tổng quan không sáng khi đang ở Bán hàng", async () => {
    const { mucDangMo } = await import("@/lib/nav/muc-dang-mo")
    const ds = ["/bao-cao", "/bao-cao/ban-hang", "/bao-cao/kho"]
    expect(mucDangMo("/bao-cao/ban-hang", ds)).toBe("/bao-cao/ban-hang")
    expect(mucDangMo("/bao-cao", ds)).toBe("/bao-cao")
    expect(mucDangMo("/bao-cao-x", ds)).toBeNull()
  })
})

describe("điện thoại: màn báo cáo có đầu trang xanh riêng", () => {
  it("ẩn app bar chuẩn ở /bao-cao và các màn con, không ẩn ở màn khác", async () => {
    const { hidesMobileAppBar } = await import("@/lib/nav/mobile-chrome")
    expect(hidesMobileAppBar("/bao-cao")).toBe(true)
    expect(hidesMobileAppBar("/bao-cao/cong-no")).toBe(true)
    expect(hidesMobileAppBar("/reports")).toBe(false)
  })
})

describe("liên kết sang màn khác giữ kỳ + chế độ xem + bước đào sâu", () => {
  it("Tổng quan → Bán hàng theo khách, kỳ Tháng trước, đào sâu một khách", async () => {
    const { lienKetMan, docTrangThai, MAC_DINH_MAN } = await import("@/lib/bao-cao/trang-thai")
    const url = lienKetMan("/bao-cao/ban-hang", { ky: "lastmonth", xem: "cust", dao: [{ l: "Cô Ba", v: "prod", f: { cust: "k1" } }] })
    expect(url.startsWith("/bao-cao/ban-hang?")).toBe(true)
    const st = docTrangThai(new URLSearchParams(url.split("?")[1]), MAC_DINH_MAN["/bao-cao/ban-hang"])
    expect(st).toMatchObject({ ky: "lastmonth", xem: "cust", dao: [{ l: "Cô Ba", v: "prod", f: { cust: "k1" } }] })
    expect(lienKetMan("/bao-cao/ban-hang", { ky: "month", xem: "time" })).toBe("/bao-cao/ban-hang")
  })
})
