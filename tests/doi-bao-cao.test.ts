/**
 * ĐỘI TEST "BÁO CÁO" — phần TÍNH thuần TypeScript (không mạng).
 *
 * Luật (CLAUDE.md §1):
 *  - Chênh lệch giá NV = SL × (đơn giá trên HĐ − giá bảng của ĐÚNG đơn vị dòng), TRƯỚC thuế; hàng trả cùng
 *    luật; giảm giá cả đơn là cột riêng (`chenhDong`, src/lib/analytics/chenh-lech.ts).
 *  - Quy đổi đơn vị: cộng SL qua nhiều dòng → đơn vị cơ sở (`soLuongCoSo`, `heSoQuyDoi` ưu tiên hệ số chụp);
 *    tiền = SL × giá của đúng đơn vị (`giaNiemYetDonVi`).
 *  - Doanh số thuần = đi − trả; lãi gộp = thuần − (giá vốn − giá vốn hàng trả đã nhập kho).
 *  - invoice_date là DATE: so ngày theo giờ VN; công nợ không kẹp 0.
 */
import { describe, it, expect } from "vitest"
import { chenhDong, giaBangCuaDong } from "../src/lib/analytics/chenh-lech"
import { heSoQuyDoi, soLuongCoSo, giaNiemYetDonVi, type SanPhamQuyDoi } from "../src/lib/analytics/units"
import { dungDongBan, tuMotLuot } from "../src/lib/bao-cao/nap-ban-hang"
import { congBan, gomBan, danhMucRong, type DanhMucBC } from "../src/lib/bao-cao/cong"
import { chiTietBan } from "../src/lib/bao-cao/xuat-chi-tiet"
import { quyDoiTuDanhMuc } from "../src/lib/bao-cao/nap-danh-muc"
import { giamGiaHoaDon, soLuongCoSoDongHd, soLuongCoSoDongTra, giaVonBinhQuanCoSo, summariseSales } from "../src/lib/analytics/sales"
import { nhanVienPhieuTra } from "../src/lib/analytics/hang-ban-nhan-vien"
import { tinhTongQuan, cuaSoKy, mocDoc, gopCongNo, hoaDonCanTraNv, momPct, type DuLieuTongQuan } from "../src/app/(dashboard)/reports/_lib/tong-quan"
import { vnDateKey } from "../src/lib/orders/status-tone"

/** SNP-001 của dữ liệu mẫu: lon 10.000, Thung 24 có giá RIÊNG 228.000 (≠ 24 × 10.000), giá nhóm khách bị bỏ. */
const P1: SanPhamQuyDoi = {
  base_unit: "lon",
  sell_price: 0,
  units: [{ unit_name: "Loc 6", conversion: 6 }, { unit_name: "Thung 24", conversion: 24 }],
  price_lists: [
    { unit_name: "lon", price: 10000, group_id: null },
    { unit_name: "lon", price: 9500, group_id: "nhom-vip" },
    { unit_name: "Thung 24", price: 228000, group_id: null },
    { unit_name: "Thung 24", price: 216000, group_id: "nhom-vip" },
  ],
}

// ───────────────────────────── quy đổi đơn vị ─────────────────────────────
describe("units — heSoQuyDoi / soLuongCoSo / giaNiemYetDonVi", () => {
  it("ưu tiên hệ số CHỤP trên dòng, kể cả khi danh mục đã đổi", () => {
    expect(heSoQuyDoi(P1, "Thung 24", 20)).toBe(20)
    expect(heSoQuyDoi(P1, "Thung 24", "24")).toBe(24)
  })
  it("hệ số chụp 0 / âm / rỗng / chữ → tra danh mục", () => {
    for (const x of [0, -24, null, undefined, "abc", ""]) expect(heSoQuyDoi(P1, "Thung 24", x as never)).toBe(24)
  })
  it("đơn vị cơ sở, đơn vị lạ, không có SP → hệ số 1", () => {
    expect(heSoQuyDoi(P1, "lon")).toBe(1)
    expect(heSoQuyDoi(P1, "Bao 50")).toBe(1)
    expect(heSoQuyDoi(null, "Thung 24")).toBe(1)
    expect(heSoQuyDoi(P1, "")).toBe(1)
  })
  it("3 thùng + 5 lon = 77 lon (không phải 8)", () => {
    const tong = soLuongCoSo(3, heSoQuyDoi(P1, "Thung 24")) + soLuongCoSo(5, heSoQuyDoi(P1, "lon"))
    expect(tong).toBe(77)
  })
  it("SL chuỗi / rỗng / số lẻ", () => {
    expect(soLuongCoSo("2.5", 24)).toBe(60)
    expect(soLuongCoSo(null, 24)).toBe(0)
    expect(soLuongCoSo("x", 24)).toBe(0)
    expect(soLuongCoSo(-2, 24)).toBe(-48)
  })
  it("giá niêm yết của ĐÚNG đơn vị: thùng có giá riêng 228.000 (không phải 24 × 10.000)", () => {
    expect(giaNiemYetDonVi(P1, "Thung 24", 24)).toBe(228000)
    expect(giaNiemYetDonVi(P1, "lon", 1)).toBe(10000)
  })
  it("đơn vị không có giá riêng → giá cơ sở (bảng chung) × hệ số; bỏ giá nhóm khách", () => {
    expect(giaNiemYetDonVi(P1, "Loc 6", 6)).toBe(60000)
  })
  it("bảng giá thùng = 0 → lùi về giá cơ sở × hệ số", () => {
    const sp = { ...P1, price_lists: [{ unit_name: "lon", price: 10000, group_id: null }, { unit_name: "Thung 24", price: 0, group_id: null }] }
    expect(giaNiemYetDonVi(sp, "Thung 24", 24)).toBe(240000)
  })
  it("không có bảng giá chung → sell_price × hệ số; không có gì → 0", () => {
    expect(giaNiemYetDonVi({ base_unit: "goi", sell_price: "4500", price_lists: [] }, "Thung 30", 30)).toBe(135000)
    expect(giaNiemYetDonVi({ base_unit: "goi", sell_price: null }, "goi", 1)).toBe(0)
    expect(giaNiemYetDonVi(null, "goi", 1)).toBe(0)
  })
  it("chỉ có giá NHÓM KHÁCH (không có giá chung) → không lấy làm niêm yết", () => {
    const sp = { base_unit: "lon", sell_price: 0, price_lists: [{ unit_name: "lon", price: 9000, group_id: "g" }] }
    expect(giaNiemYetDonVi(sp, "lon", 1)).toBe(0)
  })
})

// ───────────────────────────── chênh lệch giá ─────────────────────────────
describe("chenhDong — SL × (đơn giá chứng từ − giá bảng cùng đơn vị), trước thuế", () => {
  it("bán 2 thùng × 240.000 so với giá THÙNG 228.000 → chênh 24.000 (không phải 0 nếu lấy 24 × giá lon)", () => {
    const c = chenhDong({ unit_name: "Thung 24", conversion_factor: 24, quantity: 2, unit_price: 240000, line_total: 480000 }, P1)
    expect(c).toEqual({ tien: 480000, niemYet: 456000, chenh: 24000 })
  })
  it("bán lon 10 × 10.500 → chênh 5.000", () => {
    expect(chenhDong({ unit_name: "lon", quantity: 10, unit_price: 10500, line_total: 105000 }, P1).chenh).toBe(5000)
  })
  it("bán dưới giá bảng → chênh ÂM", () => {
    expect(chenhDong({ unit_name: "Thung 24", conversion_factor: 24, quantity: 5, unit_price: 220000, line_total: 1100000 }, P1).chenh).toBe(-40000)
  })
  it("hàng TRẢ có VAT: dùng unit_price (trước thuế), không dùng line_total (gồm VAT)", () => {
    // 1 thùng × 240.000, VAT 10% → line_total 264.000
    const c = chenhDong({ unit_name: "Thung 24", quantity: 1, unit_price: 240000, line_total: 264000 }, P1)
    expect(c.chenh).toBe(12000)
    expect(c.tien).toBe(240000)
  })
  it("thiếu unit_price → suy từ line_total / SL", () => {
    expect(chenhDong({ unit_name: "lon", quantity: 4, unit_price: null, line_total: 44000 }, P1).chenh).toBe(4000)
  })
  it("SL 0 / thiếu unit_price + SL 0 → 0, không chia 0", () => {
    const c = chenhDong({ unit_name: "lon", quantity: 0, unit_price: null, line_total: 0 }, P1)
    expect(c).toEqual({ tien: 0, niemYet: 0, chenh: 0 })
  })
  it("mặt hàng chưa có giá bảng → chênh 0 (không 'chênh' cả doanh thu)", () => {
    const c = chenhDong({ unit_name: "chai", quantity: 3, unit_price: 7000, line_total: 21000 }, { base_unit: "chai", sell_price: 0 })
    expect(c).toEqual({ tien: 21000, niemYet: 21000, chenh: 0 })
    expect(chenhDong({ unit_name: "chai", quantity: 3, unit_price: 7000, line_total: 21000 }, null).chenh).toBe(0)
  })
  it("dòng không có đơn vị → coi là đơn vị cơ sở", () => {
    expect(giaBangCuaDong({ unit_name: null, quantity: 1, line_total: 0 }, P1)).toBe(10000)
  })
  it("đơn vị Loc 6 không có giá riêng: so với 6 × 10.000", () => {
    expect(chenhDong({ unit_name: "Loc 6", conversion_factor: 6, quantity: 2, unit_price: 55000, line_total: 110000 }, P1).chenh).toBe(-10000)
  })
  it("chênh thuần = chênh bán − chênh trả (cùng luật)", () => {
    const ban = chenhDong({ unit_name: "Thung 24", conversion_factor: 24, quantity: 2, unit_price: 240000, line_total: 480000 }, P1).chenh
    const tra = chenhDong({ unit_name: "Thung 24", quantity: 1, unit_price: 240000, line_total: 264000 }, P1).chenh
    expect(ban - tra).toBe(12000)
  })
})

// ───────────────────────────── sales.ts helpers ─────────────────────────────
describe("sales.ts — giảm giá HĐ, SL cơ sở, giá vốn bình quân, tổng hợp", () => {
  it("giảm giá cả đơn = Σ line_total − subtotal (không âm khi làm tròn)", () => {
    expect(giamGiaHoaDon({ subtotal: 400000 }, [{ line_total: 450000 }])).toBe(50000)
    expect(giamGiaHoaDon({ subtotal: 580000 }, [{ line_total: 480000 }, { line_total: 100000 }])).toBe(0)
  })
  it("SL cơ sở dòng HĐ ưu tiên hệ số chụp; dòng trả tra danh mục", () => {
    expect(soLuongCoSoDongHd({ quantity: 2, unit_name: "Thung 24", conversion_factor: 20 }, P1)).toBe(40)
    expect(soLuongCoSoDongTra({ quantity: 2, unit_name: "Thung 24" }, P1)).toBe(48)
  })
  it("giá vốn bình quân MỖI ĐƠN VỊ CƠ SỞ: qty_in_base_uom ưu tiên, thiếu thì quantity × hệ số chụp", () => {
    const m = giaVonBinhQuanCoSo([
      { product_id: "p", quantity: 2, qty_in_base_uom: 48, conversion_factor_snapshot: 24, unit_cost: 7000 },
      { product_id: "p", quantity: 1, qty_in_base_uom: null, conversion_factor_snapshot: 24, unit_cost: 8000 },
      { product_id: "q", quantity: -5, qty_in_base_uom: -5, conversion_factor_snapshot: 1, unit_cost: 0 },
    ])
    expect(m.get("p")).toBeCloseTo((48 * 7000 + 24 * 8000) / 72, 6)
    expect(m.get("q")).toBe(0)
  })
  it("summariseSales: thuần = đi − trả; lãi gộp = thuần − giá vốn", () => {
    expect(summariseSales([{ total: 1039000 }], 434000, 468000)).toMatchObject({ revenue: 1039000, netRevenue: 605000, grossProfit: 137000, invoiceCount: 1 })
  })
})

// ───────────────────────────── dựng dòng bán (dungDongBan) ─────────────────────────────
function dmMau(): DanhMucBC {
  const dm = danhMucRong()
  dm.sp.set("P1", { ten: "P1", sku: "SNP-001", thuongHieu: "", ncc: "", donViCoSo: "lon", donViLon: { ten: "Thung 24", heSo: 24 }, donVi: [{ ten: "Thung 24", heSo: 24 }], giaBan: 0, bangGia: [{ ten: "lon", gia: 10000 }, { ten: "Thung 24", gia: 228000 }] })
  dm.sp.set("P5", { ten: "P5", sku: "SNP-005", thuongHieu: "", ncc: "", donViCoSo: "lon", donViLon: null, donVi: [], giaBan: 0, bangGia: [{ ten: "lon", gia: 14000 }] })
  dm.khach.set("KH1", { ten: "KH1", nhom: "", kenh: "Tạp hoá", tinh: "", nv: "", hanMuc: 0, hanNo: 0 })
  dm.nv.set("A", "NV A")
  return dm
}
const hd = (id: string, total: number, subtotal: number, extra: Partial<Record<string, unknown>> = {}) => ({
  id, invoice_code: "HD-" + id, invoice_date: "2026-10-01", order_id: "O" + id, status: "posted", total, subtotal, vat: total - subtotal,
  customer_id: "KH1", sales_user_id: "A", posted_by: "U1", ...extra,
})
const dhd = (id: string, inv: string, sp: string, unit: string, cf: number, q: number, price: number, extra: Record<string, unknown> = {}) => ({
  id, invoice_id: inv, product_id: sp, unit_name: unit, conversion_factor: cf, quantity: q, unit_price: price, line_total: q * price, ...extra,
})

describe("dungDongBan — phân bổ tiền HĐ / phiếu trả, giá vốn, chênh", () => {
  const base = { giaVonCoSo: new Map([["P1", 7000], ["P5", 9000]]), giaVonTra: new Map(), nvTra: new Map<string, string>(), dm: dmMau(), tra: [], dongTra: [] }

  it("Σ tiền dòng của HĐ = total (gồm VAT, sau giảm cả đơn); giảm đơn chỉ ở dòng đầu", () => {
    const { dong } = dungDongBan({
      ...base,
      hoaDon: [hd("H2", 445000, 400000)],
      dongHd: [dhd("l1", "H2", "P5", "lon", 1, 20, 15000), dhd("l2", "H2", "P5", "lon", 1, 10, 15000)],
    })
    expect(dong.reduce((s, l) => s + l.tien, 0)).toBe(445000)
    expect(dong[0].giamDon).toBe(50000)
    expect(dong[1].giamDon).toBeUndefined()
    // chênh trước thuế, không trộn giảm giá đơn: 30 × (15.000 − 14.000)
    expect(dong.reduce((s, l) => s + (l.tienTT! - l.niemYet!), 0)).toBe(30000)
    // giá vốn = SL cơ sở × bình quân
    expect(dong.reduce((s, l) => s + l.giaVon, 0)).toBe(270000)
  })

  it("làm tròn phân bổ 3 dòng bằng nhau: Σ vẫn đúng tổng HĐ (dòng cuối nhận phần dư)", () => {
    const { dong } = dungDongBan({
      ...base,
      hoaDon: [hd("H", 100000, 100000)],
      dongHd: [dhd("a", "H", "P5", "lon", 1, 1, 1), dhd("b", "H", "P5", "lon", 1, 1, 1), dhd("c", "H", "P5", "lon", 1, 1, 1)],
    })
    expect(dong.map((l) => l.tien)).toEqual([33333, 33333, 33334])
  })

  it("dòng HÀNG ĐỔI trên HĐ không phải hàng bán: không vào SL, Σ tiền vẫn = total", () => {
    const { dong } = dungDongBan({
      ...base,
      hoaDon: [hd("H", 100000, 100000)],
      dongHd: [dhd("a", "H", "P5", "lon", 1, 10, 10000), dhd("x", "H", "P5", "lon", 1, 3, 10000, { is_exchange: true })],
    })
    expect(dong).toHaveLength(1)
    expect(dong[0].sl).toBe(10)
    expect(dong[0].tien).toBe(100000)
  })

  it("thùng: SL cơ sở = SL × hệ số chụp; mặt hàng không có giá vốn kỳ → cờ thieuGV", () => {
    const { dong } = dungDongBan({
      ...base,
      giaVonCoSo: new Map(),
      hoaDon: [hd("H1", 480000, 480000)],
      dongHd: [dhd("a", "H1", "P1", "Thung 24", 24, 2, 240000)],
    })
    expect(dong[0].sl).toBe(48)
    expect(dong[0].thieuGV).toBe(true)
    expect(dong[0].niemYet).toBe(456000)
  })

  it("HĐ không có dòng: một dòng mang cả total, SL 0", () => {
    const { dong } = dungDongBan({ ...base, hoaDon: [hd("H0", 50000, 50000)], dongHd: [] })
    expect(dong).toEqual([expect.objectContaining({ tien: 50000, sl: 0, loai: 1 })])
  })

  it("phiếu trả: Σ tiền dòng = credit_note_amount; giá vốn trả chia theo SL cơ sở; chênh trả trước thuế", () => {
    const { dong, phieuTra } = dungDongBan({
      ...base,
      hoaDon: [],
      dongHd: [],
      tra: [{ id: "R1", status: "completed", customer_id: "KH1", credit_note_amount: 264000, created_at: "2026-10-04", sales_user_id: "A", invoice_id: "H1", ma: "TH-1", lyDo: "damaged", tuSinh: false }],
      dongTra: [{ return_id: "R1", product_id: "P1", unit_name: "Thung 24", quantity: 1, unit_price: 240000, line_total: 264000 }],
      giaVonTra: new Map([["R1", { total: 168000, byProduct: new Map([["P1", 168000]]) }]]),
      nvTra: new Map([["R1", "A"]]),
    })
    expect(dong).toHaveLength(1)
    expect(dong[0]).toMatchObject({ loai: -1, tien: 264000, giaVon: 168000, sl: 24, nv: "A", ngay: "2026-10-04" })
    expect(dong[0].tienTT! - dong[0].niemYet!).toBe(12000)
    expect(phieuTra[0]).toMatchObject({ ma: "TH-1", loai: "Tự lập", hd: "H1", tien: 264000 })
  })

  it("phiếu trả không dòng (chỉ có hàng đổi): một dòng mang credit, giá vốn trả tổng", () => {
    const { dong } = dungDongBan({
      ...base, hoaDon: [], dongHd: [],
      tra: [{ id: "R9", status: "completed", customer_id: "KH1", credit_note_amount: 0, created_at: "2026-10-04", sales_user_id: null }],
      dongTra: [],
      giaVonTra: new Map([["R9", { total: 14000, byProduct: new Map([["P1", 14000]]) }]]),
    })
    expect(dong).toEqual([expect.objectContaining({ loai: -1, tien: 0, giaVon: 14000 })])
  })

  it("congBan: thuần = đi − trả; lãi gộp = thuần − (giá vốn − giá vốn hàng trả)", () => {
    const { dong } = dungDongBan({
      ...base,
      hoaDon: [hd("H2", 445000, 400000)],
      dongHd: [dhd("l1", "H2", "P5", "lon", 1, 30, 15000)],
      tra: [{ id: "R4", status: "completed", customer_id: "KH1", credit_note_amount: 70000, created_at: "2026-10-04", sales_user_id: "A" }],
      dongTra: [{ return_id: "R4", product_id: "P5", unit_name: "lon", quantity: 5, unit_price: 14000, line_total: 70000 }],
      giaVonTra: new Map([["R4", { total: 45000, byProduct: new Map([["P5", 45000]]) }]]),
      nvTra: new Map([["R4", "A"]]),
    })
    const t = congBan(dong)
    expect(t).toMatchObject({ rev: 445000, ret: 70000, net: 375000, cost: 270000 - 45000, gp: 375000 - 225000, nInv: 1, nCust: 1 })
    const g = gomBan(dong, (l) => l.nv, base.dm).get("A")!
    expect(g.qty).toBe(30)
    expect(g.rqty).toBe(5)
    expect(g.revTT - g.listed - (g.retTT - g.rlisted)).toBe(30000)
  })
})

describe("tuMotLuot — hàm máy chủ → dòng thô", () => {
  it("ngày phiếu trả = revenue_date; giá vốn bình quân = tiền / SL; giá vốn trả cộng theo phiếu + mặt hàng", () => {
    const x = tuMotLuot({
      hd: [{ ...hd("H", 1, 1), sales_user_id: null }],
      dong_hd: [],
      tra: [{ id: "R", status: "submitted", customer_id: "K", invoice_id: "H", credit_note_amount: "100000" as never, created_at: "2026-10-04T03:00:00Z", revenue_date: "2026-10-02", sales_user_id: null, reason: "damaged", credit_with_invoice: true, ma: "TH-9" }],
      dong_tra: [],
      gv: [{ product_id: "P1", sl: 58, tien: 406000 }, { product_id: "P0", sl: 0, tien: 0 }],
      gv_tra: [{ return_id: "R", product_id: "P1", tien: 100 }, { return_id: "R", product_id: "P1", tien: 50 }, { return_id: "R", product_id: "P5", tien: 7 }],
    })
    expect(x.hd[0].sales_user_id).toBe("")
    expect(x.tra[0]).toMatchObject({ created_at: "2026-10-02", credit_note_amount: 100000 })
    expect(x.traThem.get("R")).toEqual({ ma: "TH-9", lyDo: "damaged", tuSinh: true })
    expect(x.giaVonCoSo.get("P1")).toBe(7000)
    expect(x.giaVonCoSo.get("P0")).toBe(0)
    expect(x.giaVonTra.get("R")!.total).toBe(157)
    expect(x.giaVonTra.get("R")!.byProduct.get("P1")).toBe(150)
  })
})

describe("nhanVienPhieuTra — NV của phiếu trả", () => {
  it("NV phiếu → NV HĐ gắn phiếu → NV HĐ gần nhất của khách", () => {
    const hoaDon = [
      { id: "H1", customer_id: "K", sales_user_id: "B", invoice_date: "2026-09-01" },
      { id: "H2", customer_id: "K", sales_user_id: "C", invoice_date: "2026-09-20" },
    ]
    const m = nhanVienPhieuTra([
      { id: "r1", customer_id: "K", sales_user_id: "A", invoice_id: "H1" },
      { id: "r2", customer_id: "K", sales_user_id: null, invoice_id: "H1" },
      { id: "r3", customer_id: "K", sales_user_id: null, invoice_id: null },
      { id: "r4", customer_id: "Z", sales_user_id: null, invoice_id: null },
    ] as never, hoaDon as never)
    expect(m.get("r1")).toBe("A")
    expect(m.get("r2")).toBe("B")
    expect(m.get("r3")).toBe("C")
    expect(m.has("r4")).toBe(false)
  })
})

// ───────────────────────────── Excel chi tiết ─────────────────────────────
describe("chiTietBan — sheet Chi tiết dòng", () => {
  const dm = dmMau()
  const { dong, hoaDon, phieuTra } = dungDongBan({
    giaVonCoSo: new Map([["P1", 7000]]),
    giaVonTra: new Map([["R1", { total: 168000, byProduct: new Map([["P1", 168000]]) }]]),
    nvTra: new Map([["R1", "A"]]),
    dm,
    hoaDon: [hd("H1", 585000, 585000)],
    dongHd: [dhd("a", "H1", "P1", "Thung 24", 24, 2, 240000), dhd("b", "H1", "P1", "lon", 1, 10, 10500)],
    tra: [{ id: "R1", status: "completed", customer_id: "KH1", credit_note_amount: 264000, created_at: "2026-10-04", sales_user_id: "A", invoice_id: "H1", ma: "TH-1", lyDo: "damaged", tuSinh: false }],
    dongTra: [{ return_id: "R1", product_id: "P1", unit_name: "Thung 24", quantity: 1, unit_price: 240000, line_total: 264000 }],
  })
  const rows = chiTietBan({ dong, dm, hoaDon, phieuTra, giaVon: true })
  const dau = rows[0] as string[]
  const cot = (t: string) => dau.indexOf(t)

  it("Σ cột 'DT thuần (phân bổ)' = doanh thu thuần 585.000 − 264.000 = 321.000", () => {
    expect(rows.slice(1).reduce((s, r) => s + Number(r[cot("DT thuần (phân bổ)")]), 0)).toBe(321000)
  })
  it("dòng trả mang dấu ÂM ở SL, thành tiền, SL quy đổi, chênh; ghi HĐ gốc", () => {
    const r = rows.find((x) => x[cot("Loại")] === "Trả")!
    expect(r[cot("SL")]).toBe(-1)
    expect(r[cot("SL quy đổi")]).toBe(-24)
    expect(r[cot("Thành tiền dòng")]).toBe(-264000)
    expect(r[cot("Đơn giá")]).toBe(240000)
    expect(r[cot("Giá bảng")]).toBe(228000)
    expect(r[cot("Chênh lệch giá")]).toBe(-12000)
    expect(r[cot("Hoá đơn gốc")]).toBe("HD-H1")
    expect(r[cot("Giá vốn")]).toBe(-168000)
  })
  it("dòng bán thùng: Giá bảng = giá THÙNG 228.000, chênh +24.000, SL quy đổi 48", () => {
    const r = rows.find((x) => x[cot("Loại")] === "Bán" && x[cot("ĐVT")] === "Thung 24")!
    expect(r[cot("Giá bảng")]).toBe(228000)
    expect(r[cot("Chênh lệch giá")]).toBe(24000)
    expect(r[cot("SL quy đổi")]).toBe(48)
    expect(r[cot("ĐV cơ sở")]).toBe("lon")
  })
  it("NVBH không xem giá vốn → không có cột Giá vốn / Lãi gộp", () => {
    const r2 = chiTietBan({ dong, dm, hoaDon, phieuTra, giaVon: false })
    expect(r2[0]).not.toContain("Giá vốn")
    expect(r2[0]).not.toContain("Lãi gộp")
    expect(r2[1].length).toBe((r2[0] as string[]).length)
  })
  it("sắp theo ngày tăng dần (bán 01/10 trước trả 04/10)", () => {
    expect(rows.slice(1).map((r) => r[0])).toEqual(["2026-10-01", "2026-10-01", "2026-10-04"])
  })
})

describe("quyDoiTuDanhMuc — dựng SanPhamQuyDoi từ danh mục", () => {
  it("chênh qua danh mục khớp chênh qua sản phẩm gốc", () => {
    const qd = quyDoiTuDanhMuc(dmMau(), "P1")!
    expect(giaNiemYetDonVi(qd, "Thung 24", heSoQuyDoi(qd, "Thung 24"))).toBe(228000)
    expect(quyDoiTuDanhMuc(dmMau(), "khong-co")).toBeNull()
  })
})

// ───────────────────────────── /reports tổng quan ─────────────────────────────
describe("tinhTongQuan — /reports theo kỳ", () => {
  // now = 2026-10-04 10:00 giờ VN (03:00 UTC). Kỳ "week": start = 2026-09-27 03:00 UTC.
  const now = new Date("2026-10-04T03:00:00Z")
  const w = cuaSoKy("week", now)
  const data = (): DuLieuTongQuan => ({
    orders: [
      { id: "o1", order_date: "2026-10-01", status: "completed" },
      { id: "o2", order_date: "2026-09-22", status: "completed" },
    ],
    invoices: [
      { id: "i1", order_id: "o1", invoice_date: "2026-10-01", total: 445000, sales_user_id: "A" },
      { id: "i2", order_id: "o1x", invoice_date: "2026-09-27", total: 14000, sales_user_id: "A" }, // đúng ngày VN đầu kỳ
      { id: "i3", order_id: "o3", invoice_date: "2026-09-26", total: 14000, sales_user_id: "A" }, // ngoài kỳ → kỳ trước
      { id: "i4", order_id: "o4", invoice_date: "2026-10-02", total: 500000, sales_user_id: "B" },
    ],
    returns: [
      { id: "r1", status: "completed", customer_id: "K1", credit_note_amount: 264000, created_at: "2026-10-04", sales_user_id: null, invoice_id: "h-cu" },
      { id: "r2", status: "submitted", customer_id: "K3", credit_note_amount: 100000, created_at: "2026-10-02", sales_user_id: "B", invoice_id: "i4" },
      { id: "r3", status: "completed", customer_id: "K2", credit_note_amount: 70000, created_at: "2026-09-25", sales_user_id: "A" },
    ],
    receivables: [
      { id: "c1", status: "open", amount: 445000, paid: 0, created_at: "2026-10-01T05:00:00Z" },
      { id: "c2", status: "partial", amount: 400000, paid: 100000, created_at: "2026-10-02T05:00:00Z" },
      { id: "c3", status: "open", amount: -70000, paid: 0, created_at: "2026-09-25T05:00:00Z" },
      { id: "c4", status: "paid", amount: 14000, paid: 14000, created_at: "2026-09-28T05:00:00Z" },
      { id: "c5", status: "overdue", amount: 80000, paid: 0, created_at: "2026-08-01T05:00:00Z" },
    ],
    receivableCount: 5,
    nvCuaHoaDon: new Map([["h-cu", "A"]]),
  })

  it("kỳ tuần: doanh thu thuần = (445.000 + 14.000 + 500.000) − (264.000 + 100.000) = 595.000", () => {
    const k = tinhTongQuan(data(), w)
    expect(k.totalRevenue).toBe(595000)
    expect(k.completedOrders).toBe(3)
    expect(k.aov).toBeCloseTo(595000 / 3, 6)
  })
  it("kỳ trước: 14.000 − 70.000 = −56.000 → MoM tính trên số thuần", () => {
    const k = tinhTongQuan(data(), w)
    expect(k.momRevenue).toBeCloseTo(((595000 + 56000) / -56000) * 100, 6)
  })
  it("công nợ mở KHÔNG kẹp 0: 445.000 + 300.000 − 70.000 + 80.000 = 755.000; 1 quá hạn", () => {
    const k = tinhTongQuan(data(), w)
    expect(k.openReceivables).toBe(755000)
    expect(k.overdueCount).toBe(1)
    expect(k.receivableCount).toBe(5)
  })
  it("doanh số NV thuần; phiếu chưa gán NV lùi về NV của HĐ gắn phiếu (kể cả HĐ ngoài kỳ)", () => {
    const k = tinhTongQuan(data(), w)
    expect(k.salesByUser.get("A")).toBe(445000 + 14000 - 264000)
    expect(k.salesByUser.get("B")).toBe(500000 - 100000)
    expect(Array.from(k.salesByUser.values()).reduce((s, x) => s + x, 0)).toBe(k.totalRevenue)
  })
  it("đã thu trong kỳ theo created_at của phiếu nợ", () => {
    expect(tinhTongQuan(data(), w).paidInPeriod).toBe(100000 + 14000)
  })
  it("HĐ 01:00 sáng giờ VN (18:00 UTC hôm trước) — kỳ 'hôm nay' theo ngày VN", () => {
    // 00:30 giờ VN ngày 04/10 = 17:30 UTC ngày 03/10
    const dem = new Date("2026-10-03T17:30:00Z")
    expect(vnDateKey(dem)).toBe("2026-10-04")
    const d = data()
    d.invoices.push({ id: "i9", order_id: "o9", invoice_date: "2026-10-04", total: 9000, sales_user_id: "A" })
    const k = tinhTongQuan(d, { start: new Date("2026-10-03T17:00:00Z"), end: dem, prevStart: new Date("2026-10-02T17:00:00Z"), prevEnd: new Date("2026-10-03T17:00:00Z") })
    expect(k.totalRevenue).toBe(9000 - 264000)
  })
  it("mocDoc: ngày đọc HĐ theo giờ VN của prevStart; đơn theo ngày UTC", () => {
    const m = mocDoc({ start: new Date("2026-10-03T17:00:00Z"), end: now, prevStart: new Date("2026-10-02T17:30:00Z"), prevEnd: new Date("2026-10-03T17:00:00Z") })
    expect(m.ngayTu).toBe("2026-10-03")
    expect(m.donTu).toBe("2026-10-02")
  })
  it("gopCongNo không nhân đôi phiếu có ở cả hai lượt đọc; hoaDonCanTraNv chỉ HĐ thiếu", () => {
    expect(gopCongNo([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]).map((x) => x.id)).toEqual(["a", "b", "c"])
    const r = data().returns
    expect(hoaDonCanTraNv(r, new Map())).toEqual(["h-cu"])
    expect(hoaDonCanTraNv(r, new Map([["h-cu", "A"]]))).toEqual([])
  })
  it("momPct: kỳ trước 0 → null (không chia 0)", () => {
    expect(momPct(100, 0)).toBeNull()
    expect(momPct(150, 100)).toBe(50)
  })
})
