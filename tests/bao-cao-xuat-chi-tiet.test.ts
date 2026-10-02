/**
 * Chủ nhà 02/10/2026: "phần báo cáo xuất excel cần xuất chi tiết các dòng hơn để xử lý thông tin. VD báo cáo
 * bán hàng theo nhân viên -> chi tiết dòng hàng, bán cho ai, giá bao nhiêu...". Bấm thật: e2e/bao-cao-xuat-chi-tiet.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { dungDongDat } from "@/lib/bao-cao/nap-don-dat"
import { danhMucRong } from "@/lib/bao-cao/cong"
import { chiTietBan, chiTietDat, chiTietNo, chiTietThu, chiTietTonLo, chiTietBienDong } from "@/lib/bao-cao/xuat-chi-tiet"

const dm = danhMucRong()
dm.nv.set("nv1", "Đồng Thị Hiền")
dm.khach.set("k1", { ten: "Tạp hoá Cô Ba", sdt: "0911111111", diaChi: "1 Lê Lợi", nhom: "", kenh: "T2", tinh: "", nv: "nv1", hanMuc: 0, hanNo: 0 })
dm.sp.set("sua", {
  ten: "Sữa hộp", sku: "SUA1", nhom: "Sữa", thuongHieu: "", ncc: "", donViCoSo: "hộp",
  donViLon: { ten: "thùng", heSo: 24 }, donVi: [{ ten: "thùng", heSo: 24 }], giaBan: 10000,
  bangGia: [{ ten: "hộp", gia: 10000 }, { ten: "thùng", gia: 230000 }],
})

/** HĐ 1: 2 thùng × 235.000 (giá bảng thùng 230.000) + 5 hộp × 10.000, giảm cả đơn 20.000 → total 500.000. Trả 1 thùng. */
const ban = dungDongBan({
  hoaDon: [{ id: "h1", invoice_code: "HD-1", invoice_date: "2026-10-01", order_id: "o1", status: "posted", total: 500000, subtotal: 500000, vat: 0, customer_id: "k1", sales_user_id: "nv1", posted_by: "nv1" }],
  dongHd: [
    { id: "l1", invoice_id: "h1", product_id: "sua", unit_name: "thùng", conversion_factor: 24, quantity: 2, unit_price: 235000, line_total: 470000, line_discount: 0 },
    { id: "l2", invoice_id: "h1", product_id: "sua", unit_name: "hộp", conversion_factor: 1, quantity: 5, unit_price: 10000, line_total: 50000, line_discount: 0 },
  ],
  tra: [{ id: "r1", status: "completed", customer_id: "k1", credit_note_amount: -230000, created_at: "2026-10-02", sales_user_id: "nv1", invoice_id: "h1", ma: "TH-1", lyDo: "damaged", tuSinh: false }],
  dongTra: [{ return_id: "r1", product_id: "sua", unit_name: "thùng", quantity: 1, unit_price: 230000, line_total: 230000 }],
  giaVonCoSo: new Map([["sua", 8000]]),
  giaVonTra: new Map([["r1", { total: 192000, byProduct: new Map([["sua", 192000]]) }]]),
  nvTra: new Map([["r1", "nv1"]]),
  dm,
})

describe("Excel Bán hàng — sheet Chi tiết dòng", () => {
  const rows = chiTietBan({ ...ban, dm, giaVon: true })
  const dau = rows[0] as string[]
  const c = (r: (string | number)[], ten: string) => r[dau.indexOf(ten)]

  it("mỗi dòng hàng một dòng: bán cho ai, NV, mặt hàng, ĐVT, SL, đơn giá", () => {
    expect(rows).toHaveLength(4)
    const thung = rows[1]
    expect(c(thung, "Loại")).toBe("Bán")
    expect(c(thung, "Số chứng từ")).toBe("HD-1")
    expect(c(thung, "Nhân viên")).toBe("Đồng Thị Hiền")
    expect(c(thung, "Khách hàng")).toBe("Tạp hoá Cô Ba")
    expect(c(thung, "SĐT")).toBe("0911111111")
    expect(c(thung, "Tên hàng")).toBe("Sữa hộp")
    expect(c(thung, "ĐVT")).toBe("thùng")
    expect(c(thung, "SL")).toBe(2)
    expect(c(thung, "Đơn giá")).toBe(235000)
    expect(c(thung, "SL quy đổi")).toBe(48)
  })
  it("giá bảng + chênh theo ĐÚNG đơn vị dòng (thùng so giá thùng)", () => {
    expect(c(rows[1], "Giá bảng")).toBe(230000)
    expect(c(rows[1], "Chênh lệch giá")).toBe(10000)
    expect(c(rows[2], "Giá bảng")).toBe(10000)
    expect(c(rows[2], "Chênh lệch giá")).toBe(0)
  })
  it("dòng trả mang dấu âm, có HĐ gốc + lý do; Σ DT phân bổ = doanh thu thuần", () => {
    const tra = rows[3]
    expect(c(tra, "Loại")).toBe("Trả")
    expect(c(tra, "Số chứng từ")).toBe("TH-1")
    expect(c(tra, "Hoá đơn gốc")).toBe("HD-1")
    expect(c(tra, "Lý do trả")).toBe("Hàng hư hỏng")
    expect(c(tra, "SL")).toBe(-1)
    expect(c(tra, "DT thuần (phân bổ)")).toBe(-230000)
    const tong = rows.slice(1).reduce((s, r) => s + Number(c(r, "DT thuần (phân bổ)")), 0)
    expect(tong).toBe(500000 - 230000)
  })
  it("không xem giá vốn thì không có cột giá vốn / lãi gộp", () => {
    const an = chiTietBan({ ...ban, dm, giaVon: false })[0]
    expect(an).not.toContain("Giá vốn")
    expect(an).not.toContain("Lãi gộp")
    expect(dau).toContain("Lãi gộp")
  })
})

describe("Excel các báo cáo khác — sheet chi tiết", () => {
  it("Đơn đặt: dòng hàng có ĐVT, SL, đơn giá, đã xuất / chưa xuất", () => {
    const d = dungDongDat(
      [{ id: "o1", order_code: "DH-1", order_date: "2026-10-01", status: "submitted", total: 100000, subtotal: 100000, discount: 0, vat: 0, customer_id: "k1", sales_user_id: "nv1", created_by: "nv1", payment_terms: null } as never],
      [{ order_id: "o1", product_id: "sua", quantity: 10, invoiced_qty: 0, line_total: 100000, unit_name: "hộp", unit_price: 10000, line_discount: 0 }]
    )
    const r = chiTietDat({ dong: d.dong, dm, don: d.don })
    expect(r[1]).toEqual(expect.arrayContaining(["DH-1", "Tạp hoá Cô Ba", "Sữa hộp", "hộp", 10, 10000, 100000]))
    expect(r[1][r[0].indexOf("Chưa xuất")]).toBe(100000)
  })
  it("Công nợ: từng phiếu nợ, dư có ghi rõ", () => {
    const r = chiTietNo([{ kh: "k1", nv: "nv1", no: 0, qua: 0, lauNhat: 0, hanMuc: 0, thuCuoi: "", tuoi: [], tinhTrang: [], phieu: [
      { id: "p1", kh: "k1", nv: "nv1", hd: "h1", ma: "HD-1", ngay: "2026-09-01", han: "2026-09-15", con: 270000, qua: 17 },
      { id: "p2", kh: "k1", nv: "nv1", hd: null, ma: "Phiếu trả", ngay: "2026-09-20", han: "2026-09-20", con: -5000, qua: 0 },
    ] }], dm)
    expect(r).toHaveLength(3)
    expect(r[1]).toEqual(expect.arrayContaining(["Tạp hoá Cô Ba", "HD-1", 270000, 17, "Quá hạn"]))
    expect(r[2][r[0].indexOf("Tình trạng")]).toBe("Dư có")
  })
  it("Thu tiền, tồn theo lô, biến động kho", () => {
    expect(chiTietThu([{ id: "t1", ngay: "2026-10-01", tien: 100000, hinhThuc: "Tiền mặt", kh: "k1", nv: "nv1", nguoiThu: "nv1", hd: "h1", maHd: "HD-1" }], dm)[1])
      .toEqual(["2026-10-01", "Tiền mặt", 100000, "Tạp hoá Cô Ba", "0911111111", "HD-1", "Đồng Thị Hiền", "Đồng Thị Hiền"])
    const lo = chiTietTonLo([{ sp: "sua", sl: 30, giaTri: 0, hsd: null, tb30: 0, duBan: 0, banCuoi: "", tonThap: false, chamBan: false, lo: [{ id: "b1", sp: "sua", ma: "L1", sl: 30, gia: 8000, hsd: "2027-01-01", nhap: "2026-09-01" }] }], dm, false)
    expect(lo[1]).toEqual(["SUA1", "Sữa hộp", "Sữa", "hộp", "L1", "2027-01-01", "2026-09-01", 30])
    const bd = chiTietBienDong([
      { ngay: "2026-09-30", sp: "sua", sl: 5, loai: "nhap", ma: "NK-0", phieu: "e0", gia: 8000 },
      { ngay: "2026-10-01", sp: "sua", sl: -24, loai: "ban", ma: "XK-1", phieu: "e1", gia: 8000 },
    ], dm, "2026-10-01", "2026-10-31", true)
    expect(bd).toHaveLength(2)
    expect(bd[1]).toEqual(["2026-10-01", "Xuất bán", "XK-1", "SUA1", "Sữa hộp", "Sữa", "hộp", -24, 8000, -192000])
  })
  it("cả 5 màn báo cáo xuất kèm sheet chi tiết", () => {
    for (const f of ["man-ban-hang", "man-cuoi-ngay", "man-cong-no", "man-kho", "man-tai-chinh"]) {
      expect(readFileSync(`src/components/bao-cao/${f}.tsx`, "utf8"), f).toMatch(/xuatExcel\([^)]*\)[^\n]*\[|chiTietThu\(/)
    }
  })
})
