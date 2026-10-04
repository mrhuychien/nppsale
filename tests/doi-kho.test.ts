/**
 * ĐỘI TEST "KHO & MUA HÀNG" — phần TypeScript thuần (phép kiểm đang XANH).
 *   npx vitest run tests/doi-kho.test.ts
 * Phần máy chủ (RPC + trigger): scripts/sql/doi-test/kho.sql. Lỗi đã xác minh: tests/doi-kho-loi.test.ts,
 * scripts/sql/doi-test/kho-loi.sql, e2e/doi-kho-loi.spec.ts.
 *
 * Luật (CLAUDE.md): số lượng cộng qua nhiều dòng quy về ĐƠN VỊ CƠ SỞ; `unit_cost` là giá mỗi đơn vị cơ sở;
 * ngày so theo giờ VN, không theo mốc UTC.
 */
import { describe, it, expect, vi } from "vitest"
import { dauNgayVn, cuoiNgayVn, dieuKienDenNgay, tonSauTheoKho, type DongBienDong } from "@/lib/inventory/lich-su-ton"
import {
  dungDongNhat, chiaVaoRo, tongKet, thieuTheoHd, chuaNhatKeTiep, chuaChiaKeTiep, docTienDo, khuKe, nhomDong,
  loiLuotSoan, duocSoanHang, hienSoLuong, khoaChia, TOI_DA_RO, type HdSoan, type DongHdSoan,
} from "@/lib/orders/luot-soan"
import {
  apLocSoan, soLocDangBat, cotHoaDonSoan, khoaCuaTuyen, thieuCotSoan, nhanDaSoan, duocDanhDauSoan, LOC_SOAN_MAC_DINH,
  type TruyVanLoc,
} from "@/lib/orders/soan-hang-loc"
import { soCuaO, moneyDisplay, tomTatThanhDay, lyDoKhoaNut, tomTatLo, buocSoLuong, locSoLuong, CHUA_CO_HANG, SL_PHAI_DUONG } from "@/lib/inventory/stock-in-mobile"
import { chenhCuaDong, tomTatKiemKe, nutGuiKiemKe, tomTatPhieuDieuChinh, coThuaChuaGiaVon, soCoDau } from "@/lib/inventory/kiem-ke-mobile"
import { explainAdjustmentError, describeAdjustment, productsMissingBatch, postStockAdjustment } from "@/lib/inventory/post-adjustment"
import { baseQtyOf, validIssueLines, overIssueProducts, destZonesFor, friendlyIssueError, issueReasonLabel, isTransfer, type IssueLine } from "@/lib/inventory/stock-issue"
import { vnToday, postedAtFor, seedUnitCost, resolveUnitCost, linesMissingCost } from "@/lib/inventory/opening-stock"
import { slCoSoDong, soLuongPhieu, nhanSoLuong, nhanNgayPhieu } from "@/lib/inventory/phieu-kho-mobile"
import { lineFromProduct, unitPatch, lineDiscountAmountOf, lineNetOf, receiptTotals, unitCostOf, validReceiptLines, friendlyReceiptError, type ReceiptLine } from "@/lib/purchasing/receipt-form"
import { remainingOf, buildReorder } from "@/lib/purchasing/reorder"
import { duocGhiMuaHang } from "@/lib/purchasing/roles"

// ---------------------------------------------------------------------------------------------------------------
// Thẻ kho — tồn chạy theo kho + tồn đầu kỳ (lich-su-ton.ts)
// ---------------------------------------------------------------------------------------------------------------
const mv = (id: string, zone: "sale" | "date", posted: string | null, qty: number, created = "2026-01-01T00:00:00Z"): DongBienDong => ({
  id, warehouse_zone: zone, posted_at: posted, created_at: created, signed_qty_in_base_uom: qty,
})

describe("thẻ kho: mốc ngày giờ VN", () => {
  it("đầu / cuối ngày theo +07:00", () => {
    expect(dauNgayVn("2026-10-02")).toBe("2026-10-02T00:00:00+07:00")
    expect(cuoiNgayVn("2026-10-02")).toBe("2026-10-02T23:59:59.999+07:00")
    expect(new Date(dauNgayVn("2026-10-02")).toISOString()).toBe("2026-10-01T17:00:00.000Z")
  })
  it('"Đến ngày": phiếu có posted_at so posted_at, phiếu cũ so created_at', () => {
    expect(dieuKienDenNgay("2026-10-02")).toBe(
      'posted_at.lte."2026-10-02T23:59:59.999+07:00",and(posted_at.is.null,created_at.lte."2026-10-02T23:59:59.999+07:00")'
    )
  })
})

describe("thẻ kho: tồn sau theo từng kho, tồn đầu kỳ", () => {
  const rows = [
    mv("a", "sale", "2026-09-28T03:00:00Z", 100),
    mv("b", "date", "2026-09-29T03:00:00Z", 20),
    mv("c", "sale", "2026-10-01T16:59:59Z", -30), // 23:59:59 01/10 giờ VN → TRƯỚC kỳ 02/10
    mv("d", "sale", "2026-10-01T17:00:00Z", -5), // 00:00 02/10 giờ VN → TRONG kỳ
    mv("e", "date", null, -4, "2026-10-03T02:00:00Z"), // phiếu cũ không posted_at → lấy created_at
    mv("f", "sale", "2026-10-03T01:00:00Z", 12.5),
  ]
  it("không lọc từ ngày: mọi dòng, mới nhất trước, tồn sau cộng riêng từng kho", () => {
    const { dong, dauKy } = tonSauTheoKho(rows, "")
    expect(dong.map((r) => r.id)).toEqual(["e", "f", "d", "c", "b", "a"])
    expect(dong.map((r) => r.tonSau)).toEqual([16, 77.5, 65, 70, 20, 100])
    expect(dauKy).toEqual({ sale: 0, date: 0 })
  })
  it("lọc từ 02/10 (giờ VN): dòng 23:59:59 ngày 01 vào đầu kỳ, dòng 00:00 ngày 02 vào kỳ", () => {
    const { dong, dauKy } = tonSauTheoKho(rows, "2026-10-02")
    expect(dong.map((r) => r.id)).toEqual(["e", "f", "d"])
    expect(dauKy).toEqual({ sale: 70, date: 20 })
    // Tồn sau KHÔNG bắt đầu lại từ 0 khi lọc kỳ.
    expect(dong.find((r) => r.id === "d")!.tonSau).toBe(65)
    expect(dong.find((r) => r.id === "e")!.tonSau).toBe(16)
  })
  it("đầu vào xáo trộn → cùng kết quả; hai dòng cùng mốc xếp theo id", () => {
    const tron = [rows[3], rows[0], rows[5], rows[1], rows[4], rows[2]]
    expect(tonSauTheoKho(tron, "").dong.map((r) => r.tonSau)).toEqual([16, 77.5, 65, 70, 20, 100])
    const cung = [mv("z", "sale", "2026-10-01T00:00:00Z", -1), mv("y", "sale", "2026-10-01T00:00:00Z", 10)]
    expect(tonSauTheoKho(cung, "").dong.map((r) => `${r.id}:${r.tonSau}`)).toEqual(["z:9", "y:10"])
  })
  it("số lượng không phải số → 0 (không làm hỏng cả cột NaN); tồn có thể âm", () => {
    const x = tonSauTheoKho([mv("a", "sale", "2026-10-01T00:00:00Z", Number("abc")), mv("b", "sale", "2026-10-02T00:00:00Z", -3)], "")
    expect(x.dong.map((r) => r.tonSau)).toEqual([-3, 0])
  })
  it("kho lạ / rỗng tính vào kho bán", () => {
    const x = tonSauTheoKho([{ ...mv("a", "sale", "2026-10-01T00:00:00Z", 5), warehouse_zone: "" as "sale" }], "")
    expect(x.dong[0].tonSau).toBe(5)
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Lượt soạn hàng (luot-soan.ts)
// ---------------------------------------------------------------------------------------------------------------
const HD: HdSoan[] = [
  { id: "i1", ma: "HD1", khach: "Cô Ba" },
  { id: "i2", ma: "HD2", khach: "Anh Tư" },
  { id: "i3", ma: "HD3", khach: "Chị Năm" },
]
const dong = (inv: string, pid: string, sl: number, heSo = 1, extra: Partial<DongHdSoan> = {}): DongHdSoan => ({
  invoiceId: inv, productId: pid, ten: `SP ${pid}`, sku: pid.toUpperCase(), viTri: null, ncc: null,
  donVi: heSo === 1 ? "hộp" : "thùng", heSo, sl, ...extra,
})
const SP = { p1: { base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] } }

describe("lượt soạn: gộp dòng nhặt theo đơn vị cơ sở", () => {
  it("2 thùng (×24) + 5 hộp + 3 hộp ở 3 HĐ → tổng 56 hộp, chia rổ A 48+5=53, C 3", () => {
    const rows = dungDongNhat(HD, [dong("i1", "p1", 2, 24), dong("i1", "p1", 5), dong("i3", "p1", 3)], SP)
    expect(rows).toHaveLength(1)
    expect(rows[0].tong).toBe(56)
    expect(rows[0].donViCoSo).toBe("hộp")
    expect(rows[0].phan.map((p) => `${p.ro}:${p.sl}`)).toEqual(["A:53", "C:3"])
    expect(hienSoLuong(56, rows[0])).toEqual({ chinh: "2 thùng + 8 hộp", phu: "= 56 hộp" })
  })
  it("bỏ dòng SL 0 / âm / HĐ ngoài lượt; hệ số 0 coi là 1; hàng đổi đánh dấu", () => {
    const rows = dungDongNhat(HD, [
      dong("i1", "p2", 0), dong("i1", "p2", -3), dong("iX", "p2", 9), dong("i2", "p2", 4, 0), dong("i3", "p2", 1, 1, { doi: true }),
    ])
    expect(rows[0].tong).toBe(5)
    expect(rows[0].coDoi).toBe(true)
    expect(rows[0].phan.map((p) => p.ro)).toEqual(["B", "C"])
  })
  it("quá 26 hoá đơn: chỉ 26 rổ A–Z được chia", () => {
    const nhieu = Array.from({ length: 28 }, (_, i) => ({ id: `h${i}`, ma: `HD${i}`, khach: "K" }))
    const rows = dungDongNhat(nhieu, nhieu.map((h) => dong(h.id, "p", 1)))
    expect(TOI_DA_RO).toBe(26)
    expect(rows[0].tong).toBe(26)
    expect(rows[0].phan.at(-1)!.ro).toBe("Z")
  })
  it("số lẻ cộng không trôi dấu phẩy động (0,1 + 0,2 = 0,3)", () => {
    const rows = dungDongNhat(HD, [dong("i1", "p", 0.1), dong("i2", "p", 0.2)])
    expect(rows[0].tong).toBe(0.3)
  })
  it("xếp theo vị trí kệ (số tự nhiên), chưa có vị trí xuống cuối", () => {
    const rows = dungDongNhat(HD, [
      dong("i1", "x", 1, 1, { viTri: "A10" }), dong("i1", "y", 1, 1, { viTri: "A2" }), dong("i1", "z", 1, 1, { viTri: "  " }),
    ])
    expect(rows.map((r) => r.productId)).toEqual(["y", "x", "z"])
    expect(khuKe("A1-03")).toBe("Kệ A")
    expect(khuKe("tđ-01")).toBe("Kệ TĐ")
    expect(khuKe("")).toBe("Chưa có vị trí kệ")
  })
  it("nhóm theo NCC: A→Z, thiếu NCC có nhóm riêng", () => {
    const rows = dungDongNhat(HD, [dong("i1", "a", 1, 1, { ncc: "Vinamilk" }), dong("i1", "b", 1, 1, { ncc: "Acecook" }), dong("i1", "c", 1)])
    expect(nhomDong(rows, "ncc").map((g) => g.ten)).toEqual(["Acecook", "Chưa có nhà cung cấp", "Vinamilk"])
  })
})

describe("lượt soạn: thiếu hàng chia theo thứ tự rổ, tổng kết tiến độ", () => {
  const rows = dungDongNhat(HD, [dong("i1", "p", 5), dong("i2", "p", 4), dong("i3", "p", 3), dong("i2", "q", 2)])
  const p = rows.find((r) => r.productId === "p")!
  it("nhặt 7/12 → A đủ 5, B được 2 (thiếu 2), C 0", () => {
    expect(chiaVaoRo(p, 7).map((x) => x.duoc)).toEqual([5, 2, 0])
    expect(chiaVaoRo(p).map((x) => x.duoc)).toEqual([5, 4, 3]) // chưa nhặt = chia đủ
    expect(chiaVaoRo(p, -1).map((x) => x.duoc)).toEqual([0, 0, 0])
  })
  it("thiếu theo HĐ: B thiếu 2, C thiếu 3", () => {
    const t = thieuTheoHd(rows, { nhat: { p: 7 }, chia: {} })
    expect(t.get("i2")).toEqual(["Thiếu 2 hộp · SP p"])
    expect(t.get("i3")).toEqual(["Thiếu 3 hộp · SP p"])
    expect(t.has("i1")).toBe(false)
  })
  it("tổng kết: ô cần chia bỏ ô 0, rổ đủ, xong nhặt / xong chia", () => {
    const t1 = tongKet(rows, { nhat: { p: 7 }, chia: {} })
    expect(t1).toMatchObject({ soMat: 2, daNhat: 1, soO: 3, daChia: 0, xongNhat: false, xongChia: false, matThieu: 1 })
    const chia = { [khoaChia("p", "i1")]: true, [khoaChia("p", "i2")]: true, [khoaChia("q", "i2")]: true } as Record<string, boolean>
    const t2 = tongKet(rows, { nhat: { p: 7, q: 2 }, chia })
    expect(t2.soO).toBe(3)
    expect(t2.daChia).toBe(3)
    expect(t2.xongChia).toBe(true)
    expect(Array.from(t2.roDu).sort()).toEqual(["i1", "i2"])
  })
  it("đi tới mặt hàng chưa nhặt / chưa chia kế tiếp (vòng lại đầu)", () => {
    expect(chuaNhatKeTiep(rows, { nhat: { [rows[0].productId]: 1 }, chia: {} }, 0)).toBe(1)
    expect(chuaNhatKeTiep(rows, { nhat: { p: 1, q: 1 }, chia: {} }, 0)).toBe(-1)
    expect(chuaChiaKeTiep(rows, { nhat: {}, chia: {} }, rows.length - 1)).toBe(0)
  })
  it("đọc tiến độ jsonb sai dạng không vỡ màn", () => {
    expect(docTienDo(null)).toEqual({ nhat: {}, chia: {} })
    expect(docTienDo({ nhat: { a: "3", b: null, c: "x" }, chia: { k: true, j: "true" } })).toEqual({ nhat: { a: 3 }, chia: { k: true } })
  })
  it("vai + câu lỗi", () => {
    expect(["owner", "manager", "warehouse", "accountant", "sales", null].map(duocSoanHang)).toEqual([true, true, true, true, false, false])
    expect(loiLuotSoan("KHONG_DU_QUYEN: x")).toMatch(/Chỉ chủ NPP/)
    expect(loiLuotSoan("QUA_NHIEU_RO")).toBe("Một lượt soạn tối đa 26 hoá đơn (rổ A–Z).")
    expect(loiLuotSoan("HOA_DON_KHONG_HOP_LE")).toMatch(/chưa ghi sổ/)
    expect(loiLuotSoan("function public.tao_luot_soan does not exist")).toMatch(/migration 225/)
    expect(loiLuotSoan("")).toBe("Lỗi không xác định")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Bộ lọc soạn hàng (soan-hang-loc.ts)
// ---------------------------------------------------------------------------------------------------------------
class Q implements TruyVanLoc<Q> {
  goi: string[] = []
  gte(c: string, v: string) { this.goi.push(`gte ${c} ${v}`); return this }
  lte(c: string, v: string) { this.goi.push(`lte ${c} ${v}`); return this }
  eq(c: string, v: string) { this.goi.push(`eq ${c} ${v}`); return this }
  in(c: string, v: string[]) { this.goi.push(`in ${c} ${v.join("|")}`); return this }
  is(c: string, v: null) { this.goi.push(`is ${c} ${v}`); return this }
  not(c: string, op: string, v: null) { this.goi.push(`not ${c} ${op} ${v}`); return this }
}
describe("bộ lọc soạn hàng", () => {
  it("mặc định chỉ lọc HĐ chưa soạn", () => {
    expect(apLocSoan(new Q(), LOC_SOAN_MAC_DINH, true).goi).toEqual(["is soan_luc null"])
    expect(soLocDangBat(LOC_SOAN_MAC_DINH)).toBe(0)
  })
  it("đủ bộ lọc + tuyến khớp id/mã/tên", () => {
    const l = { tu: "2026-10-01", den: "2026-10-03", nv: "u4", tuyen: "t1", soan: "da" as const }
    expect(apLocSoan(new Q(), l, true, khoaCuaTuyen({ id: "t1", code: "T01", name: "Tuyến 1" })).goi).toEqual([
      "gte invoice_date 2026-10-01", "lte invoice_date 2026-10-03", "eq sales_user_id u4", "in customer.channel t1|T01|Tuyến 1", "not soan_luc is null",
    ])
    expect(soLocDangBat(l)).toBe(5)
    expect(cotHoaDonSoan(l, true)).toContain("customer:customers!inner(")
    expect(cotHoaDonSoan({ ...l, tuyen: "" }, false)).not.toContain("soan_luc")
  })
  it("sổ chưa chạy mig 224 → bỏ lọc soạn; nhận dạng lỗi thiếu cột", () => {
    expect(apLocSoan(new Q(), LOC_SOAN_MAC_DINH, false).goi).toEqual([])
    expect(thieuCotSoan('column sales_invoices.soan_luc does not exist')).toBe(true)
    expect(thieuCotSoan(null)).toBe(false)
  })
  it('nhãn "Đã soạn" theo giờ VN (18:15Z ngày 01 = 01:15 ngày 02/10)', () => {
    expect(nhanDaSoan("2026-10-01T18:15:00Z", "Hoàng Văn Em")).toBe("Đã soạn 01:15 02/10 · Hoàng Văn Em")
    expect(nhanDaSoan(null)).toBe("")
    expect(["owner", "manager", "warehouse", "accountant", "sales"].map(duocDanhDauSoan)).toEqual([true, true, true, true, false])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Nhập kho (stock-in-mobile.ts, opening-stock.ts)
// ---------------------------------------------------------------------------------------------------------------
describe("nhập kho: ô số, thanh đáy, khoá nút", () => {
  it("ô số: dấu phẩy thập phân, rỗng / sai → 0", () => {
    expect(soCuaO("2,5")).toBe(2.5)
    expect(soCuaO("")).toBe(0)
    expect(soCuaO("abc")).toBe(0)
    expect(soCuaO(null)).toBe(0)
  })
  it("giá vốn lẻ hiện làm tròn tới đồng (không thành gấp mười)", () => {
    expect(moneyDisplay("29629.6")).toBe(29630)
    expect(moneyDisplay("")).toBe("")
    expect(moneyDisplay("x")).toBe("")
  })
  it("thanh đáy: 2 thùng × 24 + 3 hộp = 51 đơn vị cơ sở; dòng chưa chọn hàng không đếm; SL âm không trừ", () => {
    const lines = [
      { product_id: "a", quantity: "2", batch_code: "", expires_at: "", k: 24 },
      { product_id: "b", quantity: "3", batch_code: "", expires_at: "", k: 1 },
      { product_id: "", quantity: "9", batch_code: "", expires_at: "", k: 1 },
      { product_id: "c", quantity: "-4", batch_code: "", expires_at: "", k: 1 },
    ]
    expect(tomTatThanhDay(lines, (l) => l.k)).toEqual({ matHang: 3, donViCoSo: 51 })
    expect(tomTatThanhDay([{ product_id: "a", quantity: "1,5", batch_code: "", expires_at: "" }], () => 0)).toEqual({ matHang: 1, donViCoSo: 1.5 })
  })
  it("khoá nút: chưa có hàng / có dòng SL 0", () => {
    expect(lyDoKhoaNut([])).toBe(CHUA_CO_HANG)
    expect(lyDoKhoaNut([{ product_id: "a", quantity: "0", batch_code: "", expires_at: "" }])).toBe(SL_PHAI_DUONG)
    expect(lyDoKhoaNut([{ product_id: "a", quantity: "1", batch_code: "", expires_at: "" }])).toBe("")
  })
  it("lô / HSD / nút ±, ô SL gõ tay", () => {
    expect(tomTatLo({ batch_code: " ", expires_at: "" })).toBe("Lô tự sinh · chưa có HSD")
    expect(tomTatLo({ batch_code: "L01", expires_at: "2027-12-31" })).toBe("L01 · HSD 31/12/2027")
    expect(buocSoLuong("0.5", -1)).toBe("0")
    expect(buocSoLuong("1.25", 1)).toBe("2.25")
    expect(locSoLuong("1,2.3a")).toBe("1.23")
  })
  it("ngày nhập lùi → 12:00 giờ VN (không trượt ngày); hôm nay theo lịch VN dùng giờ thật", () => {
    const now = new Date("2026-10-01T18:30:00Z") // 01:30 ngày 02/10 giờ VN
    expect(vnToday(now)).toBe("2026-10-02")
    expect(postedAtFor("2025-12-31", now)).toBe("2025-12-31T05:00:00.000Z")
    expect(postedAtFor("2026-10-02", now)).toBe(now.toISOString())
    expect(postedAtFor("31/12/2025", now)).toBe(now.toISOString())
  })
  it("giá vốn mồi theo đơn vị dòng = giá cơ sở × hệ số; giá 0 / trống là CHƯA BIẾT", () => {
    expect(seedUnitCost(5000, 24)).toBe("120000")
    expect(seedUnitCost(0.1, 3)).toBe("0.3")
    expect(seedUnitCost(0, 24)).toBe("")
    expect(resolveUnitCost("0")).toEqual({ cost: 0, known: false })
    expect(resolveUnitCost(" 12.5 ")).toEqual({ cost: 12.5, known: true })
    expect(linesMissingCost([
      { product_id: "a", quantity: "1", unit_cost: "" }, { product_id: "b", quantity: "0", unit_cost: "" }, { product_id: "c", quantity: "2", unit_cost: "9" },
    ])).toEqual([1])
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Kiểm kê + duyệt điều chỉnh
// ---------------------------------------------------------------------------------------------------------------
describe("kiểm kê: chênh lệch, giá trị, nút gửi", () => {
  it("chênh = thực tế − hệ thống; chưa đếm / gõ sai → null", () => {
    expect(chenhCuaDong({ systemQty: 10, actualQty: "7" })).toBe(-3)
    expect(chenhCuaDong({ systemQty: 2.5, actualQty: "2" })).toBe(-0.5)
    expect(chenhCuaDong({ systemQty: 10, actualQty: " " })).toBeNull()
    expect(chenhCuaDong({ systemQty: 10, actualQty: "x" })).toBeNull()
  })
  it("tóm tắt: hao hụt 3 × 1.000, thừa 4 × 2.000, chênh ròng 5.000", () => {
    const t = tomTatKiemKe([
      { systemQty: 10, actualQty: "7", batchCost: 1000 },
      { systemQty: 10, actualQty: "14", batchCost: 2000 },
      { systemQty: 5, actualQty: "5", batchCost: 9999 },
      { systemQty: 5, actualQty: "", batchCost: 1 },
    ])
    expect(t).toEqual({ shrinkageQty: 3, shrinkageValue: 3000, surplusQty: 4, surplusValue: 8000, totalDiffValue: 5000, rowsWithDiff: 2, daDem: 3, tongDong: 4 })
  })
  it("nút gửi", () => {
    expect(nutGuiKiemKe({ daDem: 0, rowsWithDiff: 0, tongDong: 0 }, false)).toEqual({ nhan: "Thêm sản phẩm để kiểm", khoa: true })
    expect(nutGuiKiemKe({ daDem: 0, rowsWithDiff: 0, tongDong: 3 }, false).khoa).toBe(true)
    expect(nutGuiKiemKe({ daDem: 2, rowsWithDiff: 0, tongDong: 3 }, false)).toEqual({ nhan: "Không có chênh lệch", khoa: true })
    expect(nutGuiKiemKe({ daDem: 2, rowsWithDiff: 2, tongDong: 3 }, false)).toEqual({ nhan: "Gửi duyệt (2 chênh lệch)", khoa: false })
    expect(nutGuiKiemKe({ daDem: 2, rowsWithDiff: 2, tongDong: 3 }, true)).toEqual({ nhan: "Đang gửi…", khoa: true })
  })
  it("phiếu điều chỉnh đã lưu: |SL| × giá vốn dòng; thừa chưa giá vốn → cảnh báo", () => {
    expect(tomTatPhieuDieuChinh([{ quantity: -3, unit_cost: 1000 }, { quantity: "4", unit_cost: "2000" }, { quantity: 2, unit_cost: null }]))
      .toEqual({ shrinkQty: 3, shrinkValue: 3000, surplusQty: 6, surplusValue: 8000, netValue: 5000 })
    expect(coThuaChuaGiaVon([{ quantity: 2, unit_cost: null }])).toBe(true)
    expect(coThuaChuaGiaVon([{ quantity: -2, unit_cost: 0 }])).toBe(false)
    expect([soCoDau(12), soCoDau(-3), soCoDau(0)]).toEqual(["+12", "-3", "0"])
  })
  it("lỗi duyệt dịch sang tiếng Việt, lỗi lạ giữ nguyên", () => {
    expect(explainAdjustmentError("ALREADY_POSTED: phiếu KK1 đã được duyệt lúc 10:00")).toBe("Phiếu KK1 đã được duyệt lúc 10:00")
    expect(explainAdjustmentError("ENTRY_NOT_FOUND")).toBe("Không tìm thấy phiếu kiểm kê.")
    expect(explainAdjustmentError("FORBIDDEN: bạn không có quyền duyệt điều chỉnh kho")).toBe("bạn không có quyền duyệt điều chỉnh kho")
    expect(explainAdjustmentError("lỗi lạ")).toBe("lỗi lạ")
  })
  it("mô tả kết quả dựng từ số máy chủ trả", () => {
    expect(describeAdjustment({ batchesTouched: 2, shrinkQty: 3, shrinkValue: 3000, surplusQty: 4, surplusValue: 8000, expenseId: "x" }, (n) => `${n}đ`))
      .toBe("2 lô đã cập nhật • hao hụt 3 đơn vị (3000đ) • thừa 4 đơn vị (8000đ).")
  })
  it("soi trước NO_BATCH: chỉ dòng thừa không lô, mặt hàng chưa có lô, không trùng", () => {
    const out = productsMissingBatch([
      { product_id: "a", batch_id: null, quantity: 5, product: { name: "A" } },
      { product_id: "a", batch_id: null, quantity: 2 },
      { product_id: "b", batch_id: null, quantity: -5 },
      { product_id: "c", batch_id: "lo", quantity: 5 },
      { product_id: "d", batch_id: null, quantity: 0 },
      { product_id: "e", batch_id: null, quantity: 1 },
    ], new Set(["e"]))
    expect(out).toEqual([{ productId: "a", name: "A" }])
  })
  it("postStockAdjustment đọc RETURNS TABLE dạng mảng (không NaN)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ batches_touched: 2, shrink_qty: "3", shrink_value: 3000, surplus_qty: null, surplus_value: 0, expense_id: "e1" }], error: null })
    const r = await postStockAdjustment({ rpc } as never, "x1")
    expect(rpc).toHaveBeenCalledWith("post_stock_adjustment", { p_entry_id: "x1" })
    expect(r).toEqual({ batchesTouched: 2, shrinkQty: 3, shrinkValue: 3000, surplusQty: 0, surplusValue: 0, expenseId: "e1" })
    const rpc2 = vi.fn().mockResolvedValue({ data: null, error: { message: "STOCK_MOVED: tồn đã đổi" } })
    await expect(postStockAdjustment({ rpc: rpc2 } as never, "x")).rejects.toThrow("tồn đã đổi")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Xuất kho lẻ / chuyển kho (stock-issue.ts) + danh sách phiếu kho mobile
// ---------------------------------------------------------------------------------------------------------------
const il = (pid: string, q: string, k: string, on: number | null): IssueLine => ({
  id: `${pid}-${q}`, product_id: pid, product_name: `SP ${pid}`, sku: pid, note: "", unit_name: "x", quantity: q,
  conversion_factor: k, available_units: [], base_unit: "hộp", on_hand: on,
})
describe("xuất kho lẻ", () => {
  it("SL cơ sở = SL × hệ số, âm → 0, hệ số rỗng → 1", () => {
    expect(baseQtyOf(il("a", "2", "24", 0))).toBe(48)
    expect(baseQtyOf(il("a", "-5", "1", 0))).toBe(0)
    expect(baseQtyOf(il("a", "3", "", 0))).toBe(3)
  })
  it("chỉ dòng có hàng và SL > 0 được ghi", () => {
    expect(validIssueLines([il("a", "1", "1", 1), il("", "1", "1", 1), il("b", "0", "1", 1)]).map((l) => l.product_id)).toEqual(["a"])
  })
  it("vượt tồn GOM THEO MẶT HÀNG (6 + 8 > 10); chưa tra tồn thì không kết luận", () => {
    const out = overIssueProducts([il("a", "6", "1", 10), il("a", "8", "1", 10), il("b", "1", "24", 30), il("c", "99", "1", null)])
    expect(out).toEqual([{ product_id: "a", name: "SP a", need: 14, onHand: 10 }])
    expect(overIssueProducts([il("b", "2", "24", 30)])).toEqual([{ product_id: "b", name: "SP b", need: 48, onHand: 30 }])
  })
  it("chuyển kho là loại phiếu riêng; kho đích bỏ chính kho nguồn", () => {
    expect(isTransfer("transfer")).toBe(true)
    expect(destZonesFor("sale").map((z) => z.value)).toEqual(["date"])
    expect(issueReasonLabel("gift")).toBe("Hàng biếu / khuyến mãi")
    expect(issueReasonLabel("la")).toBe("la")
    expect(friendlyIssueError("KHONG_DU_TON: Sữa — cần 7 hop")).toBe("Sữa — cần 7 hop")
  })
  it("danh sách phiếu kho: SL theo đơn vị cơ sở, có dấu theo chiều", () => {
    expect(slCoSoDong({ quantity: 2, conversion_factor_snapshot: 24 })).toBe(48)
    expect(slCoSoDong({ quantity: 2, qty_in_base_uom: "-2.5" })).toBe(2.5)
    expect(soLuongPhieu("export", [{ quantity: 1, conversion_factor_snapshot: 24 }, { qty_in_base_uom: 3 }])).toBe(-27)
    expect(soLuongPhieu("stocktake", [{ quantity: -3 }, { quantity: 4 }])).toBe(1)
    expect(soLuongPhieu("import", [])).toBeNull()
    expect([nhanSoLuong("export", -27), nhanSoLuong("import", 1234.5), nhanSoLuong("transfer", 10), nhanSoLuong("x", null)]).toEqual(["−27", "+1.234,5", "10", "—"])
  })
  it("nhóm ngày phiếu theo giờ VN (17:30Z = 00:30 hôm sau)", () => {
    const now = new Date("2026-10-02T03:00:00Z")
    expect(nhanNgayPhieu("2026-10-01T17:30:00Z", now)).toBe("Hôm nay")
    expect(nhanNgayPhieu("2026-10-01T16:30:00Z", now)).toBe("Hôm qua")
    expect(nhanNgayPhieu("2026-09-28T03:00:00Z", now)).toBe("Thứ Hai, 28/09/2026")
  })
})

// ---------------------------------------------------------------------------------------------------------------
// Mua hàng (receipt-form.ts, reorder.ts, roles.ts)
// ---------------------------------------------------------------------------------------------------------------
const rl = (o: Partial<ReceiptLine>): ReceiptLine => ({
  id: "l", product_id: "p", product_name: "P", sku: "P", note: "", unit_name: "thùng", quantity: "3", unit_price: "240000",
  line_discount: "24000", discount_mode: "amount", vat_percent: "10", conversion_factor: "24", available_units: [], base_unit: "hộp", ...o,
})
describe("phiếu nhập NCC — cùng phép tính với complete_purchase_invoice", () => {
  it("giá vốn mỗi hộp = (3×240.000 − 24.000)/72 = 9.666,67 — khớp kho.sql G1", () => {
    expect(unitCostOf(rl({}))).toBeCloseTo(9666.6667, 3)
    expect(unitCostOf(rl({ quantity: "0" }))).toBe(0)
  })
  it("tổng phiếu: 796.000 + VAT 69.600 − CK 6.000 = 859.600; VAT gõ tay thắng; âm kẹp 0", () => {
    const lines = [rl({}), rl({ unit_name: "hộp", quantity: "10", unit_price: "10000", line_discount: "", vat_percent: "0", conversion_factor: "1" })]
    expect(receiptTotals(lines, "6000")).toMatchObject({ subtotal: 796000, vat: 69600, total: 859600, vatOverridden: false })
    expect(receiptTotals(lines, 6000, "50000")).toMatchObject({ vat: 50000, total: 840000, vatOverridden: true, vatComputed: 69600 })
    expect(receiptTotals(lines, 6000, "-5")).toMatchObject({ vat: 0, total: 790000 })
    expect(receiptTotals(lines, 6000, "0")).toMatchObject({ vat: 0, vatOverridden: true })
    expect(receiptTotals(lines, 9e9).total).toBe(0)
  })
  it("giảm giá dòng theo %: kẹp 100%; âm → 0; dòng không âm", () => {
    expect(lineDiscountAmountOf(rl({ discount_mode: "percent", line_discount: "10" }))).toBe(72000)
    expect(lineDiscountAmountOf(rl({ discount_mode: "percent", line_discount: "500" }))).toBe(720000)
    expect(lineDiscountAmountOf(rl({ line_discount: "-10" }))).toBe(0)
    expect(lineNetOf(rl({ line_discount: "9999999" }))).toBe(0)
  })
  it("dòng mới: SL trống, đơn vị cơ sở hệ số 1, VAT tỉ lệ → phần trăm", () => {
    const l = lineFromProduct({ id: "p", name: "P", sku: "P", base_unit: "hộp", cost_price: 5000, vat_rate: 0.1, units: [{ unit_name: "thùng", conversion: 24 }] } as never, 1)
    expect(l).toMatchObject({ quantity: "", unit_name: "hộp", conversion_factor: "1", unit_price: "5000", vat_percent: "10" })
    expect(unitPatch(l, "thùng")).toEqual({ unit_name: "thùng", conversion_factor: "24" })
    expect(unitPatch(l, "hộp")).toEqual({ unit_name: "hộp", conversion_factor: "1" })
    expect(unitPatch(l, "kiện lạ")).toEqual({ unit_name: "kiện lạ", conversion_factor: "1" })
    expect(validReceiptLines([rl({ quantity: "0" }), rl({ product_id: "" }), rl({})])).toHaveLength(1)
    expect(friendlyReceiptError("HANG_DA_XUAT: Không huỷ được\nvì đã xuất")).toBe("Không huỷ được\nvì đã xuất")
  })
  it("đề xuất đặt hàng: phần còn giao × hệ số − tồn, không âm", () => {
    expect(remainingOf({ product_id: "a", quantity: 5, invoiced_qty: 2, conversion_factor: 24 } as never)).toBe(72)
    expect(remainingOf({ product_id: "a", quantity: 1, invoiced_qty: 3, conversion_factor: 24 } as never)).toBe(0)
    const rows = buildReorder(
      [{ product_id: "a", quantity: 5, invoiced_qty: 2, conversion_factor: 24 }, { product_id: "a", quantity: 10, invoiced_qty: 0, conversion_factor: 1 }, { product_id: "b", quantity: 3, invoiced_qty: 0, conversion_factor: 1 }] as never,
      { a: 50, b: 10 }, [{ id: "a", name: "A", base_unit: "hộp", primary_supplier_id: "s1" }], { s1: "Vinamilk" }
    )
    expect(rows).toEqual([expect.objectContaining({ product_id: "a", demand: 82, onHand: 50, need: 32, supplier_name: "Vinamilk" })])
  })
  it("vai ghi mua hàng = RLS purchase_invoices", () => {
    expect(["owner", "manager", "accountant", "warehouse", "sales", null].map((r) => duocGhiMuaHang(r as never))).toEqual([true, true, true, true, false, false])
  })
})
