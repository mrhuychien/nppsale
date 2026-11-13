import { describe, it, expect, afterEach } from "vitest"
import { chiDoanhSoTong, docTrangThai, ghiTrangThai, hieuLuc, MAC_DINH_MAN, TRANG_THAI_GOC, type TrangThaiBC } from "@/lib/bao-cao/trang-thai"
import { DS_DO_HAT } from "@/lib/bao-cao/ky"
import { canEnterHref, canSeeHref, duocVaoTrang, filterByPermission, trangThayChoVai } from "@/lib/nav/nav-permission"
import { setPermissionsCache, setUserOverrides } from "@/lib/permissions"

/**
 * ⚠ CHỦ NHÀ 13/11/2026: "Sửa Nvbh chỉ được xem doanh số tổng bán (ngày,tuần,tháng)" — chốt "Chỉ sửa màn Báo cáo" (trang chủ
 *   giữ nguyên). Báo cáo tổng hợp › Bán hàng của NVBH chỉ còn doanh số theo Ngày / Tuần / Tháng (`chiDoanhSoTong`); báo cáo
 *   cũ /reports/sales (hoá đơn từng ngày kèm khách, Giảm giá HĐ, Trả hàng, Nhân viên) chặn theo vai → đưa sang Bán hàng.
 */
afterEach(() => {
  setPermissionsCache(null)
  setUserOverrides(null)
})

const MD = MAC_DINH_MAN["/bao-cao/ban-hang"]
const NVBH = "00000000-0000-4000-8000-0000000000b9"

describe("chiDoanhSoTong — trạng thái Bán hàng của NVBH", () => {
  const day: TrangThaiBC = {
    ...TRANG_THAI_GOC,
    ky: "quarter",
    soSanh: false,
    xem: "prod",
    nguon: "ord",
    loc: { cust: ["c1"], prod: ["sp1"], ncc: ["n1"], channel: ["Tuyến 1"] },
    dao: [{ l: "Tạp hoá Cô Ba", v: "docs", f: { cust: "c1" } }],
    hat: "week",
  }

  it("ép về Thời gian · Hoá đơn · không lọc · không đào sâu; giữ kỳ, so với kỳ trước, Ngày / Tuần / Tháng", () => {
    const st = chiDoanhSoTong(day)
    expect(st).toMatchObject({ xem: "time", nguon: "inv", loc: {}, dao: [] })
    expect(st).toMatchObject({ ky: "quarter", soSanh: false, hat: "week" })
  })

  it("đường dẫn gõ tay (xem=prod, nguon=ord, l_cust, dao) cũng chỉ ra doanh số của chính mình theo thời gian", () => {
    const sp = new URLSearchParams(ghiTrangThai(day, MD))
    expect(sp.get("xem")).toBe("prod")
    const st = chiDoanhSoTong(docTrangThai(sp, MD))
    const E = hieuLuc(st, st.xem, NVBH)
    // Lọc hiệu lực chỉ còn khoá nhân viên — lọc khách / hàng / NCC / kênh của đường dẫn không còn tác dụng.
    expect(E).toEqual({ loc: { staff: [NVBH] }, khoang: null, co: {}, xem: "time" })
  })

  it("không đổi chỗ khác: chủ NPP vẫn giữ nguyên trạng thái", () => {
    expect(chiDoanhSoTong(day)).not.toBe(day)
    expect(day.xem).toBe("prod")
    expect(day.loc.cust).toEqual(["c1"])
  })
})

describe("Ngày / Tuần / Tháng (`hat`) nằm trên đường dẫn", () => {
  it("đọc / ghi đúng ba giá trị; giá trị lạ bỏ qua; không chọn thì không ghi", () => {
    for (const [h] of DS_DO_HAT) {
      const q = ghiTrangThai({ ...TRANG_THAI_GOC, ...MD, hat: h }, MD)
      expect(q).toContain(`hat=${h}`)
      expect(docTrangThai(new URLSearchParams(q), MD).hat).toBe(h)
    }
    expect(docTrangThai(new URLSearchParams("hat=year"), MD).hat).toBeNull()
    expect(docTrangThai(new URLSearchParams(""), MD).hat).toBeNull()
    expect(ghiTrangThai({ ...TRANG_THAI_GOC, ...MD }, MD)).not.toContain("hat")
  })
  it("nhãn nút đúng lời chủ nhà", () => {
    expect(DS_DO_HAT.map(([, l]) => l)).toEqual(["Ngày", "Tuần", "Tháng"])
  })
})

describe("báo cáo bán hàng cũ /reports/sales — chặn theo vai NVBH, đưa sang Bán hàng", () => {
  it("NVBH không vào / không thấy trong menu; Báo cáo tổng hợp › Bán hàng vẫn vào", () => {
    expect(canEnterHref("sales", "/reports/sales")).toBe(false)
    expect(canSeeHref("sales", "/reports/sales")).toBe(false)
    expect(duocVaoTrang("sales", "/reports/sales", "reports")).toBe(false)
    expect(duocVaoTrang("sales", "/bao-cao/ban-hang", "reports")).toBe(true)
    expect(filterByPermission("sales", [{ href: "/reports/sales" }, { href: "/bao-cao/ban-hang" }]).map((x) => x.href)).toEqual(["/bao-cao/ban-hang"])
  })
  it("cửa vào đưa NVBH sang /bao-cao/ban-hang (không về Trang chủ); vai / trang khác không có chỗ thay", () => {
    expect(trangThayChoVai("sales", "/reports/sales")).toBe("/bao-cao/ban-hang")
    expect(trangThayChoVai("owner", "/reports/sales")).toBeNull()
    expect(trangThayChoVai("sales", "/reports/finance")).toBeNull()
    expect(trangThayChoVai(null, "/reports/sales")).toBeNull()
  })
  it("quyền riêng từng người không mở lại được (luật theo vai)", () => {
    setUserOverrides({ "reports.sales.read": true, "reports.read": true })
    expect(duocVaoTrang("sales", "/reports/sales", "reports")).toBe(false)
  })
  it("các vai khác vẫn vào như cũ", () => {
    for (const r of ["owner", "manager", "accountant", "warehouse"] as const) {
      expect(duocVaoTrang(r, "/reports/sales", "reports"), r).toBe(true)
      expect(canSeeHref(r, "/reports/sales"), r).toBe(true)
    }
  })
})
