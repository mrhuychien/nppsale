import { describe, it, expect } from "vitest"
import { dungDongBan } from "@/lib/bao-cao/nap-ban-hang"
import { dungDongDat } from "@/lib/bao-cao/nap-don-dat"
import { noTaiNgay, nhomTuoi } from "@/lib/bao-cao/nap-cong-no"
import { tinhXnt, tinhTon, type BienDong } from "@/lib/bao-cao/nap-kho"
import { congBan, gomBan, danhMucRong } from "@/lib/bao-cao/cong"

const dm = danhMucRong()
dm.sp.set("sua", { ten: "Sữa", sku: "S", nhom: "Sữa", thuongHieu: "", ncc: "", donViCoSo: "hộp", donViLon: { ten: "thùng", heSo: 24 }, donVi: [{ ten: "thùng", heSo: 24 }] })
dm.sp.set("mi", { ten: "Mì", sku: "M", nhom: "Mì", thuongHieu: "", ncc: "", donViCoSo: "gói", donViLon: null, donVi: [] })
dm.khach.set("k1", { ten: "Cô Ba", nhom: "", kenh: "A", tinh: "", nv: "n1", hanMuc: 1000, hanNo: 7 })

const hd = (o: Record<string, unknown>) => ({ id: "h1", invoice_code: "HD1", invoice_date: "2026-09-10", order_id: "o1", status: "posted", total: 1100, subtotal: 1000, vat: 100, customer_id: "k1", sales_user_id: "n1", ...o })

describe("dòng bán: tiền dòng phân bổ để khớp tổng hoá đơn (doanh thu theo HOÁ ĐƠN)", () => {
  const out = dungDongBan({
    hoaDon: [hd({})],
    dongHd: [
      { id: "l1", invoice_id: "h1", product_id: "sua", unit_name: "thùng", conversion_factor: 24, quantity: 1, unit_price: 800, line_total: 800 },
      { id: "l2", invoice_id: "h1", product_id: "mi", unit_name: "gói", conversion_factor: 1, quantity: 10, unit_price: 40, line_total: 400 },
      { id: "l3", invoice_id: "h1", product_id: "mi", unit_name: "gói", conversion_factor: 1, quantity: 5, unit_price: 0, line_total: 0, is_exchange: true },
    ],
    tra: [{ id: "r1", status: "completed", customer_id: "k1", credit_note_amount: -300, created_at: "2026-09-12", sales_user_id: null, invoice_id: "h1", ma: "TH1", lyDo: "Hỏng" }],
    dongTra: [{ return_id: "r1", product_id: "sua", unit_name: "hộp", quantity: 2, line_total: 100 }],
    giaVonCoSo: new Map([["sua", 20], ["mi", 30]]),
    giaVonTra: new Map([["r1", { total: 40, byProduct: new Map([["sua", 40]]) }]]),
    nvTra: new Map([["r1", "n1"]]),
    dm,
  })
  it("Σ tiền dòng bán = total hoá đơn (giảm giá + VAT được phân bổ)", () => {
    const t = congBan(out.dong)
    expect(t.rev).toBe(1100)
    expect(t.ret).toBe(300)
    expect(t.net).toBe(800)
    const m = gomBan(out.dong, (l) => l.sp)
    expect(m.get("sua")!.rev + m.get("mi")!.rev).toBe(1100)
  })
  it("hàng đổi trên hoá đơn không phải hàng bán; SL quy về đơn vị cơ sở", () => {
    const m = gomBan(out.dong, (l) => l.sp)
    expect(m.get("mi")!.qty).toBe(10)
    expect(m.get("sua")!.qty).toBe(24)
    expect(m.get("sua")!.rqty).toBe(2)
  })
  it("giá vốn: bán = SL cơ sở × giá vốn cơ sở; trả = giá vốn đã nhập lại kho", () => {
    const t = congBan(out.dong)
    expect(t.cost).toBe(24 * 20 + 10 * 30 - 40)
    expect(out.phieuTra[0]).toMatchObject({ ma: "TH1", tien: 300, nv: "n1", loai: "Tự lập" })
  })
  it("hoá đơn không có dòng vẫn vào doanh thu (một dòng không rõ mặt hàng)", () => {
    const x = dungDongBan({ hoaDon: [hd({ id: "h9" })], dongHd: [], tra: [], dongTra: [], giaVonCoSo: new Map(), giaVonTra: new Map(), nvTra: new Map(), dm })
    expect(congBan(x.dong).rev).toBe(1100)
    expect(x.dong[0].sp).toBe("")
  })
})

describe("đơn đặt: bỏ đơn huỷ, đã xuất theo SL đã xuất", () => {
  it("đã xuất = tiền dòng × invoiced/quantity", () => {
    const o = (id: string, status: string, total: number) => ({ id, order_code: id, order_date: "2026-09-10", status, total, subtotal: total, discount: 0, vat: 0, customer_id: "k1", sales_user_id: "n1", created_by: "u", payment_terms: "COD" })
    const r = dungDongDat(
      [o("d1", "partially_invoiced", 1000), o("d2", "cancelled", 999)],
      [
        { order_id: "d1", product_id: "sua", quantity: 10, invoiced_qty: 5, line_total: 600 },
        { order_id: "d1", product_id: "mi", quantity: 4, invoiced_qty: 0, line_total: 400 },
        { order_id: "d2", product_id: "mi", quantity: 1, invoiced_qty: 0, line_total: 999 },
      ]
    )
    expect(r.dong.reduce((s, l) => s + l.tien, 0)).toBe(1000)
    expect(r.dong.reduce((s, l) => s + l.daXuat, 0)).toBe(300)
    expect(r.don.get("d1")?.trangThai).toBe("Hoàn thành")
    expect(r.don.has("d2")).toBe(false)
  })
})

describe("công nợ tính đến ngày (không kẹp dòng âm)", () => {
  const phieu = [
    { id: "p1", customer_id: "k1", sales_user_id: "n1", invoice_id: "h1", amount: 1000, paid: 200, due_date: "2026-09-05", status: "partial", created_at: "2026-08-29T03:00:00Z", invoice: { invoice_code: "HD1", invoice_date: "2026-08-29" } },
    { id: "p2", customer_id: "k1", sales_user_id: "n1", invoice_id: null, return_id: "r1", amount: -300, paid: 0, due_date: null, status: "open", created_at: "2026-09-01T03:00:00Z", invoice: null },
    { id: "p3", customer_id: "k1", sales_user_id: "n1", invoice_id: "h3", amount: 500, paid: 0, due_date: null, status: "open", created_at: "2026-09-20T03:00:00Z", invoice: { invoice_code: "HD3", invoice_date: "2026-09-20" } },
  ]
  it("hôm nay: nợ = Σ(amount − paid), dòng âm trừ vào tổng", () => {
    const r = noTaiNgay({ X: "2026-09-26", phieu, thuSau: [], thuTruoc: [], dm })
    const k = r.khach[0]
    expect(k.no).toBe(800 + -300 + 500)
    // HD1 hạn 05/09 → quá; HD3 không có hạn → 20/09 + 7 ngày (NET7) = 27/09 → chưa quá.
    expect(k.qua).toBe(800)
    expect(k.tinhTrang).toContain("Quá hạn")
    expect(k.tuoi[nhomTuoi(21)]).toBe(800)
  })
  it("lùi về ngày cũ: cộng lại khoản thu sau ngày đó, bỏ phiếu phát sinh sau", () => {
    const tt = { id: "t1", amount: 200, method: "cash", collected_at: "2026-09-10T03:00:00Z", receivable_id: "p1" }
    const r = noTaiNgay({ X: "2026-09-02", phieu, thuSau: [tt], thuTruoc: [], dm })
    expect(r.khach[0].no).toBe(1000 - 300)
    expect(r.phieu.map((x) => x.id).sort()).toEqual(["p1", "p2"])
  })
  it("phiếu đã tất toán nhưng còn thu sau ngày chọn thì vẫn là nợ ở ngày đó", () => {
    const daTra = { ...phieu[0], id: "p9", paid: 1000, status: "paid" }
    const r = noTaiNgay({ X: "2026-09-02", phieu: [], thuSau: [{ id: "t2", amount: 1000, method: "cash", collected_at: "2026-09-15T03:00:00Z", receivable_id: "p9", receivable: daTra }], thuTruoc: [], dm })
    expect(r.khach[0].no).toBe(1000)
  })
  it("dư có khi tổng âm; vượt hạn mức", () => {
    const r = noTaiNgay({ X: "2026-09-02", phieu: [phieu[1]], thuSau: [], thuTruoc: [], dm })
    expect(r.khach[0].tinhTrang).toEqual(["Dư có"])
    const r2 = noTaiNgay({ X: "2026-09-26", phieu: [phieu[0], phieu[2]], thuSau: [], thuTruoc: [], dm })
    expect(r2.khach[0].tinhTrang).toContain("Vượt hạn mức")
  })
})

describe("kho: xuất – nhập – tồn tính lùi từ tồn hiện tại", () => {
  const bd = (ngay: string, sl: number, loai: BienDong["loai"]): BienDong => ({ ngay, sp: "sua", sl, loai, ma: "", phieu: "", gia: 0 })
  it("tồn cuối = hiện tại − biến động sau kỳ; tồn đầu khép sổ", () => {
    const m = tinhXnt(new Map([["sua", 100]]), [bd("2026-09-02", 50, "nhap"), bd("2026-09-03", -20, "ban"), bd("2026-09-04", 5, "tra"), bd("2026-09-05", -3, "khac"), bd("2026-09-20", -10, "ban")], "2026-09-01", "2026-09-10")
    const x = m.get("sua")!
    expect(x).toMatchObject({ cuoi: 110, nhap: 50, ban: 20, tra: 5, khac: 3 })
    expect(x.dau).toBe(110 - 50 - 5 + 20 + 3)
  })
  it("tồn thấp / chậm bán theo ngưỡng", () => {
    const lo = [{ id: "b1", sp: "sua", ma: "L1", sl: 10, gia: 5, hsd: "2026-10-01", nhap: "" }, { id: "b2", sp: "mi", ma: "L2", sl: 100, gia: 1, hsd: null, nhap: "" }]
    const t = tinhTon(lo, new Map([["sua", { sl30: 60, cuoi: "2026-09-25" }]]), "2026-09-26")
    const sua = t.find((x) => x.sp === "sua")!
    const mi = t.find((x) => x.sp === "mi")!
    expect(sua).toMatchObject({ giaTri: 50, tonThap: true, chamBan: false })
    expect(sua.duBan).toBe(5)
    expect(mi).toMatchObject({ tonThap: false, chamBan: true, banCuoi: "" })
  })
})
