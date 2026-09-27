/**
 * Chủ nhà 27/09/2026 — Báo cáo tổng hợp:
 *  - Theo nhân viên: cột như báo cáo cũ "Hàng bán theo nhân viên" (SL bán, giá trị niêm yết, doanh
 *    thu, chênh lệch, SL trả, giá trị trả, DT thuần) + chỉ tiêu = mức doanh số chung A (cài đặt lương).
 *  - Lãi gộp chỉ ra các mã hàng chưa có giá vốn.
 *  - Bỏ Thương hiệu / Nhóm khách / Tỉnh; bảng chi tiết lên đầu, 20 dòng / trang, không cuộn trong bảng.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { gomBan, maChuaCoGiaVon, danhMucRong } from "@/lib/bao-cao/cong"
import { chiTieuKy } from "@/lib/bao-cao/ky"
import { SO_DONG_TRANG } from "@/components/bao-cao/bang"

const dm = danhMucRong()
dm.sp.set("sua", {
  ten: "Sữa", sku: "S01", nhom: "Sữa", thuongHieu: "", ncc: "", donViCoSo: "hộp",
  donViLon: { ten: "thùng", heSo: 24 }, donVi: [{ ten: "thùng", heSo: 24 }],
  giaBan: 10, bangGia: [{ ten: "thùng", gia: 200 }],
})
dm.sp.set("mi", { ten: "Mì", sku: "M01", nhom: "Mì", thuongHieu: "", ncc: "", donViCoSo: "gói", donViLon: null, donVi: [], giaBan: 5, bangGia: [] })
dm.sp.set("keo", { ten: "Kẹo", sku: "K01", nhom: "Kẹo", thuongHieu: "", ncc: "", donViCoSo: "gói", donViLon: null, donVi: [], giaBan: 3, bangGia: [] })

const hd = (o: Record<string, unknown>) => ({ id: "h1", invoice_code: "HD1", invoice_date: "2026-09-10", order_id: "o1", status: "posted", total: 400, subtotal: 400, vat: 0, customer_id: "k1", sales_user_id: "n1", ...o })

const out = dungDongBan({
  hoaDon: [hd({})],
  dongHd: [
    { id: "l1", invoice_id: "h1", product_id: "sua", unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 150, line_total: 300 },
    { id: "l2", invoice_id: "h1", product_id: "mi", unit_name: "gói", conversion_factor: 1, quantity: 10, unit_price: 6, line_total: 60 },
    { id: "l3", invoice_id: "h1", product_id: "keo", unit_name: "gói", conversion_factor: 1, quantity: 10, unit_price: 4, line_total: 40 },
  ],
  tra: [{ id: "r1", status: "completed", customer_id: "k1", credit_note_amount: -20, created_at: "2026-09-12", sales_user_id: null, invoice_id: "h1", ma: "TH1", lyDo: "" }],
  dongTra: [{ return_id: "r1", product_id: "mi", unit_name: "gói", quantity: 4, line_total: 20 }],
  // Kẹo không có phiếu xuất → chưa có giá vốn; Mì giá vốn 0 → cũng là chưa có.
  giaVonCoSo: new Map([["sua", 5], ["mi", 0]]),
  giaVonTra: new Map(),
  nvTra: new Map([["r1", "n1"]]),
  dm,
})

describe("chỉ tiêu kỳ từ mức doanh số chung A / tháng", () => {
  it("cả tháng = A, nửa tháng = A/2, hai tháng = 2A, chưa đặt = 0", () => {
    expect(chiTieuKy(30_000_000, "2026-09-01", "2026-09-30")).toBe(30_000_000)
    expect(chiTieuKy(30_000_000, "2026-09-01", "2026-09-15")).toBe(15_000_000)
    expect(chiTieuKy(31_000_000, "2026-09-01", "2026-10-31")).toBe(62_000_000)
    expect(chiTieuKy(0, "2026-09-01", "2026-09-30")).toBe(0)
    expect(chiTieuKy(1000, "2026-09-10", "2026-09-01")).toBe(0)
  })
})

describe("theo nhân viên: niêm yết theo đơn vị dòng, SL theo từng đơn vị cơ sở", () => {
  const nv = gomBan(out.dong, (l) => l.nv, dm).get("n1")!
  it("giá trị niêm yết = SL dòng × giá niêm yết CỦA ĐƠN VỊ DÒNG (bảng giá chung, rồi giá bán × hệ số)", () => {
    const sua = out.dong.find((l) => l.sp === "sua")!
    expect(sua.niemYet).toBe(2 * 200)
    expect(out.dong.find((l) => l.sp === "mi")!.niemYet).toBe(10 * 5)
    expect(nv.listed).toBe(400 + 50 + 30)
    expect(nv.rev - nv.listed).toBe(400 - 480)
  })
  it("SL bán / SL trả giữ theo đơn vị cơ sở, không cộng lẫn hộp với gói", () => {
    expect(nv.qtyDv).toEqual({ hộp: 48, gói: 20 })
    expect(nv.rqtyDv).toEqual({ gói: 4 })
    expect(nv.ret).toBe(20)
  })
})

describe("mã hàng chưa có giá vốn (lãi gộp)", () => {
  it("chỉ dòng bán, mã không có / bằng 0 giá vốn, xếp theo doanh thu", () => {
    const ds = maChuaCoGiaVon(out.dong, dm)
    expect(ds.map((x) => x.sku)).toEqual(["M01", "K01"])
    expect(ds[0]).toMatchObject({ ten: "Mì", sl: 10 })
    expect(out.dong.find((l) => l.sp === "sua")!.thieuGV).toBeUndefined()
  })
})

const src = (p: string) => readFileSync(p, "utf8")

describe("giao diện báo cáo (chủ nhà 27/09/2026)", () => {
  const banHang = src("src/components/bao-cao/man-ban-hang.tsx")
  it("theo nhân viên có đủ cột như báo cáo cũ + chỉ tiêu từ cài đặt lương", () => {
    for (const c of ['"SL bán"', '"Giá trị niêm yết"', '"Chênh lệch"', '"SL trả"', '"Giá trị trả"', '"Chỉ tiêu"', '"% đạt"']) expect(banHang).toContain(c)
    expect(banHang).toContain('rpc("my_sales_target")')
  })
  it("bỏ Thương hiệu / Nhóm khách / Tỉnh ở mọi màn", () => {
    for (const f of ["man-ban-hang", "man-kho", "man-cong-no", "man-cuoi-ngay", "man-tong-quan", "man-tai-chinh"]) {
      const s = src(`src/components/bao-cao/${f}.tsx`)
      expect(s).not.toMatch(/"brand"|"cgroup"|"province"|Thương hiệu"|"Tỉnh"|"Nhóm khách"/)
    }
  })
  it("bảng 20 dòng / trang, không có khung cuộn riêng", () => {
    expect(SO_DONG_TRANG).toBe(20)
    expect(src("src/components/bao-cao/bang.tsx")).not.toMatch(/max-h-\[\d+px\] overflow-auto border-t/)
  })
  it("bảng chi tiết đứng trước biểu đồ; đang đào sâu thì lên đầu", () => {
    for (const f of ["man-ban-hang", "man-kho", "man-cong-no"]) {
      const s = src(`src/components/bao-cao/${f}.tsx`)
      expect(s.indexOf("!dangDao && vm.bang") >= 0 || s.indexOf("!st.dao.length && vm.bang") >= 0).toBe(true)
      const iBang = Math.max(s.indexOf("!dangDao && vm.bang"), s.indexOf("!st.dao.length && vm.bang"))
      expect(iBang).toBeLessThan(s.lastIndexOf("{vm.bieuDo}"))
      expect(s).toMatch(/(dangDao|st\.dao\.length > 0) && [^\n]*vm\.bang/)
    }
  })
})
