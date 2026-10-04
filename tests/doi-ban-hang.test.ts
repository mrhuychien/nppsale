/**
 * ĐỘI TEST "BÁN HÀNG / ĐƠN HÀNG" — logic TS thuần (xanh).
 *
 * Kiểm CON SỐ: tổng tiền / VAT / làm tròn / giảm giá dòng + đơn, quyền giảm giá
 * (mig 185), hạn mức công nợ (nợ sẵn có + đơn này), tách "Khách cần trả" / "Ghi có"
 * (công nợ âm, mig 186), gộp công nợ theo HÓA ĐƠN của một đơn, quy đổi đơn vị,
 * sửa đơn khi đang soạn, tổng sau sửa tại chỗ.
 */
import { describe, it, expect } from "vitest"
import { discountAmount, lineGross, switchUnit } from "@/lib/pos/discount"
import { posTotals, tachPhaiTra, cashSuggestions, lineAmount } from "@/lib/pos/totals"
import { giamCuaChungTu, giamGiaDonConLai } from "@/lib/pos/invoice-discount"
import {
  cartTotals,
  netPriceOf,
  addLine,
  setLinesQty,
  setQty,
  baseQtyOf,
  priceViolation,
  ceilingFor,
  kiemQuyenGiamGia,
  type CartLine,
} from "@/lib/sell/cart"
import { unitPriceFor, conversionFor, stockInUnit, sellableUnits, type PricedProduct } from "@/lib/sell/pricing"
import { toOrderLine, lineTotalOf } from "@/lib/sell/create-order"
import { planOrderLines, isSellEditable, orderLinesToCart } from "@/lib/sell/order-edit"
import {
  userDiscountRulesFrom,
  userPriceRulesFrom,
  tranGiamGia,
  kepGiamGia,
  kiemGiamGia,
  nhanTranGiamGia,
} from "@/lib/pricing"
import { evaluateApproval, DEFAULT_APPROVAL_RULES } from "@/lib/approval"
import { decideStatus } from "@/lib/sell/submit"
import { DRAFT_APPROVAL_REASON } from "@/lib/orders/save-gate"
import { gopCongNoCuaDon, gopCongNoTheoDon } from "@/lib/orders/receivable-sum"
import { validateOrderEdit } from "@/lib/orders/edit-validator"
import { tongSauSuaTaiCho } from "@/lib/orders/inline-totals"
import { canEditOrder, whyCannotEdit } from "@/lib/orders/edit-permission"
import type { ApprovalRules } from "@/types"

const line = (o: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "lon",
  qty: 1,
  price: 10_000,
  listPrice: 10_000,
  note: "",
  conversion: 1,
  vatRate: 0,
  ...o,
})

const rules = (o: Partial<ApprovalRules> = {}): ApprovalRules =>
  ({ ...DEFAULT_APPROVAL_RULES, id: "r", org_id: "o", created_at: "", updated_at: "", updated_by: null, ...o }) as ApprovalRules

/* ------------------------------------------------------------------ */
describe("giảm giá ₫ / % (pos/discount)", () => {
  it("% làm tròn về đồng một lần: 5% của 134.500 = 6.725", () => {
    expect(discountAmount({ value: 5, unit: "pct" }, 134_500)).toBe(6_725)
  })
  it("kẹp [0, tiền hàng]: giảm vượt, giảm âm, 150%", () => {
    expect(discountAmount({ value: 999_999, unit: "vnd" }, 50_000)).toBe(50_000)
    expect(discountAmount({ value: -10, unit: "vnd" }, 50_000)).toBe(0)
    expect(discountAmount({ value: 150, unit: "pct" }, 50_000)).toBe(50_000)
    expect(discountAmount({ value: 10, unit: "pct" }, 0)).toBe(0)
  })
  it("đổi đơn vị giữ nguyên số tiền (33.500 / 670.000 = 5%)", () => {
    expect(switchUnit({ value: 5, unit: "pct" }, 670_000)).toEqual({ value: 33_500, unit: "vnd" })
    expect(switchUnit({ value: 33_501, unit: "vnd" }, 670_000)).toEqual({ value: 5.0001, unit: "pct" })
    expect(switchUnit({ value: 10_000, unit: "vnd" }, 0)).toEqual({ value: 0, unit: "pct" })
  })
  it("tiền hàng dòng không âm khi SL âm", () => {
    expect(lineGross(-3, 10_000)).toBe(0)
    expect(lineAmount({ qty: 3, price: 10_000, discount: { value: 10, unit: "pct" } })).toBe(27_000)
  })
})

/* ------------------------------------------------------------------ */
describe("tổng POS (spec 21/09 §6)", () => {
  // 7.928.000 gộp, giảm dòng 33.500 (5% trên dòng 670.000), giảm đơn 100.000, trừ trả 3.900
  const lines = [
    { qty: 1, price: 670_000, discount: { value: 5, unit: "pct" as const } },
    { qty: 1, price: 7_258_000, discount: { value: 0, unit: "vnd" as const } },
  ]
  it("7.928.000 − 33.500 − 100.000 − 3.900 = 7.790.600", () => {
    const t = posTotals({ lines, docDiscount: { value: 100_000, unit: "vnd" }, returnCredit: 3_900 })
    expect([t.gross, t.lineDiscount, t.docDiscount, t.returnCredit, t.due, t.credit]).toEqual([
      7_928_000, 33_500, 100_000, 3_900, 7_790_600, 0,
    ])
  })
  it("giảm đơn 5% tính trên TIỀN GỘP = 396.400", () => {
    expect(posTotals({ lines, docDiscount: { value: 5, unit: "pct" } }).docDiscount).toBe(396_400)
  })
  it("VAT theo dòng, nền sau giảm dòng, giảm đơn không hạ nền thuế", () => {
    const t = posTotals({
      lines: [{ qty: 2, price: 50_000, discount: { value: 10, unit: "pct" }, vatRate: 0.08 }],
      docDiscount: { value: 20_000, unit: "vnd" },
    })
    // 100.000 − 10.000 = 90.000 → thuế 7.200; khách trả 90.000 − 20.000 + 7.200
    expect(t.vat).toBe(7_200)
    expect(t.due).toBe(77_200)
  })
  it("hàng trả vượt tiền đơn → Khách cần trả 0, phần vượt là Ghi có (công nợ âm, mig 186)", () => {
    const t = posTotals({ lines: [{ qty: 1, price: 50_000, discount: { value: 0, unit: "vnd" } }], returnCredit: 80_000 })
    expect(t.due).toBe(0)
    expect(t.credit).toBe(30_000)
  })
  it("tachPhaiTra: dương / âm / 0 / rác / số lẻ", () => {
    expect(tachPhaiTra(5_000)).toEqual({ due: 5_000, credit: 0 })
    expect(tachPhaiTra(-3_000)).toEqual({ due: 0, credit: 3_000 })
    expect(tachPhaiTra(0)).toEqual({ due: 0, credit: 0 })
    expect(tachPhaiTra(Number.NaN)).toEqual({ due: 0, credit: 0 })
    expect(tachPhaiTra(1_234.5)).toEqual({ due: 1_235, credit: 0 })
    expect(tachPhaiTra(-1_234.4)).toEqual({ due: 0, credit: 1_234 })
  })
  it("chip mệnh giá: đúng số trước, không chip thấp hơn, 0 thì rỗng", () => {
    expect(cashSuggestions(7_790_600)).toEqual([7_790_600, 7_800_000, 8_000_000])
    expect(cashSuggestions(100_000)).toEqual([100_000, 500_000, 1_000_000])
    expect(cashSuggestions(0)).toEqual([])
    expect(cashSuggestions(-5)).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
describe("giỏ /sell — cartTotals, giảm giá dòng/đơn, quy đổi", () => {
  it("2 thùng × 240.000 (hệ số 24) + 5 lon × 10.000, VAT 8% dòng thùng", () => {
    const t = cartTotals([
      line({ unit: "Thung 24", qty: 2, price: 240_000, listPrice: 240_000, conversion: 24, vatRate: 0.08 }),
      line({ qty: 5 }),
    ])
    expect([t.gross, t.subtotal, t.vat, t.grandTotal, t.discount]).toEqual([530_000, 530_000, 38_400, 568_400, 0])
  })
  it("giảm dòng quy vào đơn giá, làm tròn ở ĐƠN GIÁ: 3 × 10.000 bớt 1.000 → 9.667/lon, 29.001", () => {
    const l = line({ qty: 3, discount: { value: 1_000, unit: "vnd" } })
    expect(netPriceOf(l)).toBe(9_667)
    expect(cartTotals([l]).subtotal).toBe(29_001)
  })
  it("giảm đơn kẹp tiền hàng; VAT tính trên giá dòng, trước giảm đơn", () => {
    const t = cartTotals([line({ qty: 10, vatRate: 0.1 })], 0, { value: 500_000, unit: "vnd" })
    expect([t.subtotal, t.docDiscount, t.vat, t.grandTotal]).toEqual([0, 100_000, 10_000, 10_000])
  })
  it("trừ hàng trả, tổng không âm", () => {
    const t = cartTotals([line({ qty: 2 })], 50_000)
    expect([t.returnCredit, t.grandTotal]).toEqual([50_000, 0])
    expect(cartTotals([line({ qty: 2 })], -9_000).returnCredit).toBe(0)
  })
  it("chiết khấu chỉ đếm phần GIẢM; nâng giá không thành chiết khấu âm", () => {
    expect(cartTotals([line({ qty: 2, price: 11_000 })]).discount).toBe(0)
    expect(cartTotals([line({ qty: 2, price: 9_000 })]).discount).toBe(2_000)
  })
  it("thêm trùng (sp + đơn vị) cộng dồn giữ vị trí; khác đơn vị thành dòng mới lên đầu", () => {
    let c = addLine([], line({ qty: 2 }))
    c = addLine(c, line({ productId: "p2" }))
    c = addLine(c, line({ qty: 3 }))
    expect(c.map((l) => `${l.productId}:${l.qty}`)).toEqual(["p2:1", "p1:5"])
    c = addLine(c, line({ unit: "Thung 24", conversion: 24 }))
    expect(c[0].unit).toBe("Thung 24")
    expect(baseQtyOf(c, "p1")).toBe(5 + 24)
  })
  it("chọn nhiều: số tuyệt đối, 0 là bỏ dòng, trùng thì lựa chọn sau thắng", () => {
    const c = setLinesQty([line({ qty: 2 }), line({ productId: "p2", qty: 4 })], [
      line({ qty: 7 }),
      line({ productId: "p2", qty: 0 }),
      line({ productId: "p3", qty: 1 }),
      line({ productId: "p3", qty: 6 }),
    ])
    expect(c.map((l) => `${l.productId}:${l.qty}`)).toEqual(["p3:6", "p1:7"])
    expect(setQty(c, 0, 0).length).toBe(1)
    expect(setQty(c, 9, 3)).toBe(c)
  })
  it("chốt giá: sàn = giá bảng, trần = giá bảng + %; không quyền sửa giá thì không chặn", () => {
    const o = { canEditPrice: true, maxIncreasePct: 10 }
    expect(priceViolation({ price: 9_999, listPrice: 10_000 }, o)).toBe("below_list")
    expect(priceViolation({ price: 11_000, listPrice: 10_000 }, o)).toBeNull()
    expect(priceViolation({ price: 11_001, listPrice: 10_000 }, o)).toBe("above_ceiling")
    expect(priceViolation({ price: 1, listPrice: 10_000 }, { canEditPrice: false, maxIncreasePct: 0 })).toBeNull()
    expect(ceilingFor(33_333, 5)).toBe(35_000)
  })
  it("dòng đơn gửi xuống: đơn giá sau giảm, line_discount so giá bảng, hệ số chốt", () => {
    const d = toOrderLine(line({ unit: "Thung 24", qty: 2, price: 240_000, listPrice: 250_000, conversion: 24, discount: { value: 10, unit: "pct" }, vatRate: 0.08 }))
    expect(d).toMatchObject({ unit_price: 216_000, line_discount: 68_000, line_total: 432_000, conversion_factor: 24, vat_rate: 0.08 })
    expect(lineTotalOf({ qty: 3, price: 333.4 })).toBe(1_000)
  })
  it("lưu rồi mở lại đơn (sửa đơn): tiền, hệ số, thuế dòng giữ nguyên", () => {
    const sp = { id: "p1", base_unit: "lon", sell_price: 10_000, vat_rate: 0, price_lists: [], units: [{ unit_name: "Thung 24", conversion: 24 }] } as never
    const luu = [
      toOrderLine(line({ qty: 10, discount: { value: 10, unit: "pct" } })),
      toOrderLine(line({ unit: "Thung 24", qty: 2, price: 240_000, listPrice: 240_000, conversion: 24, vatRate: 0.08 })),
    ]
    const mo = orderLinesToCart(luu.map((l) => ({ ...l, note: null })) as never, [sp], null)
    expect(cartTotals(mo).subtotal).toBe(90_000 + 480_000)
    expect(cartTotals(mo).vat).toBe(38_400)
    expect(mo.map((l) => l.conversion)).toEqual([1, 24])
  })
})

/* ------------------------------------------------------------------ */
describe("quyền giảm giá theo nhân viên (mig 185)", () => {
  it("chủ NPP / kế toán toàn quyền; quản lý & NVBH theo cờ", () => {
    expect(userDiscountRulesFrom({ role: "owner" })).toMatchObject({ allowed: true, free: true, maxValue: null })
    expect(userDiscountRulesFrom({ role: "accountant", allow_discount: false })).toMatchObject({ allowed: true, free: true })
    expect(userDiscountRulesFrom({ role: "manager" })).toMatchObject({ allowed: false, free: false })
    expect(userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_type: "vnd", discount_max_value: "50000" }))
      .toMatchObject({ allowed: true, maxType: "vnd", maxValue: 50_000 })
    expect(userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_value: "" }).maxValue).toBeNull()
    expect(userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_value: -1 }).maxValue).toBeNull()
    expect(userDiscountRulesFrom(null)).toMatchObject({ allowed: false, free: false })
  })
  it("trần: tắt = 0, rỗng = vô hạn, % làm tròn xuống, % > 100 kẹp 100", () => {
    const s = (v: number | null, t = "pct") => userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_type: t, discount_max_value: v })
    expect(tranGiamGia(userDiscountRulesFrom({ role: "sales" }), 1_000_000)).toBe(0)
    expect(tranGiamGia(s(null), 1_000_000)).toBe(Infinity)
    expect(tranGiamGia(s(7.5), 33_333)).toBe(2_499)
    expect(tranGiamGia(s(30_000, "vnd"), 10)).toBe(30_000)
    expect(nhanTranGiamGia(s(7.5))).toBe("Tối đa 7,5%")
  })
  it("kẹp ô giảm: ₫ về trần; % về trần làm tròn XUỐNG để không vượt 1 đồng", () => {
    const r = userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_type: "pct", discount_max_value: 10 })
    expect(kepGiamGia({ value: 50_000, unit: "vnd" }, 333_333, r)).toEqual({ value: 33_333, unit: "vnd" })
    const k = kepGiamGia({ value: 50, unit: "pct" }, 333_333, r)
    expect(k.unit).toBe("pct")
    expect(discountAmount(k, 333_333)).toBeLessThanOrEqual(33_333)
    expect(kepGiamGia({ value: 5, unit: "pct" }, 333_333, userDiscountRulesFrom({ role: "sales" }))).toEqual({ value: 0, unit: "pct" })
  })
  it("chốt lúc gửi: không quyền + giảm dòng → chặn; vượt trần → chặn; giảm đơn sẵn có của NPP giữ được", () => {
    const tat = userDiscountRulesFrom({ role: "sales" })
    const tran10 = userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_value: 10 })
    expect(kiemGiamGia([{ giam: 1, tienHang: 100 }], { giam: 0, tienHang: 100 }, tat)).toMatch(/không có quyền giảm giá dòng/)
    expect(kiemGiamGia([{ giam: 11, tienHang: 100 }], { giam: 0, tienHang: 100 }, tran10)).toMatch(/vượt mức/)
    expect(kiemGiamGia([{ giam: 10, tienHang: 100 }], { giam: 10, tienHang: 100 }, tran10)).toBeNull()
    expect(kiemGiamGia([], { giam: 50_000, tienHang: 1_000_000 }, tat, 50_000)).toBeNull()
    expect(kiemGiamGia([], { giam: 50_001, tienHang: 1_000_000 }, tat, 50_000)).toMatch(/không có quyền giảm giá đơn/)
    expect(kiemGiamGia([{ giam: 999, tienHang: 1 }], { giam: 999, tienHang: 1 }, userDiscountRulesFrom({ role: "owner" }))).toBeNull()
  })
  it("/sell: đổi SL sau khi kẹp làm khoản giảm ₫ vượt % trần → chặn lúc gửi", () => {
    const r = userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_value: 10 })
    // 10 lon × 10.000, giảm 10.000đ (đúng 10%) → hợp lệ; hạ còn 5 lon → 10.000 / 50.000 = 20%
    const c = [line({ qty: 10, discount: { value: 10_000, unit: "vnd" } })]
    expect(kiemQuyenGiamGia(c, cartTotals(c), r)).toBeNull()
    const c2 = [line({ qty: 5, discount: { value: 10_000, unit: "vnd" } })]
    expect(kiemQuyenGiamGia(c2, cartTotals(c2), r)).toMatch(/vượt mức/)
  })
  it("quyền sửa giá: chủ NPP / kế toán 'free'; NVBH theo cờ, % trần không âm", () => {
    expect(userPriceRulesFrom({ role: "owner" })).toMatchObject({ free: true, allow_price_edit: true })
    expect(userPriceRulesFrom({ role: "sales", allow_price_edit: false, price_edit_max_increase_pct: -5 }))
      .toMatchObject({ free: false, allow_price_edit: false, price_edit_max_increase_pct: 0 })
  })
})

/* ------------------------------------------------------------------ */
describe("hạn mức công nợ = nợ sẵn có + đơn này (CLAUDE.md)", () => {
  const ctx = (o: object) => ({ orderTotal: 300_000, customer: { id: "k", credit_limit: 1_000_000 }, customerDebt: 0, customerOverdue: 0, repPortfolioDebt: 0, role: "sales" as const, ...o })
  it("800.000 + 300.000 > 1.000.000 → cảnh báo, nói đúng số 1.100.000", () => {
    const d = evaluateApproval(rules(), ctx({ customerDebt: 800_000 }))
    expect(d.autoApprove).toBe(false)
    expect(d.reason).toMatch(/1\.100\.000/)
  })
  it("đúng bằng hạn mức → không cảnh báo", () => {
    expect(evaluateApproval(rules(), ctx({ customerDebt: 700_000 })).autoApprove).toBe(true)
  })
  it("dư có (nợ âm −200.000) được trừ: −200.000 + 1.100.000 = 900.000 ≤ 1.000.000", () => {
    expect(evaluateApproval(rules(), ctx({ customerDebt: -200_000, orderTotal: 1_100_000 })).autoApprove).toBe(true)
  })
  it("hạn mức 0 = không đặt; tắt enforce_credit_limit = bỏ qua", () => {
    expect(evaluateApproval(rules(), ctx({ customer: { id: "k", credit_limit: 0 }, customerDebt: 9e9 })).autoApprove).toBe(true)
    expect(evaluateApproval(rules({ enforce_credit_limit: false }), ctx({ customerDebt: 9e9 })).autoApprove).toBe(true)
  })
  it("chiết khấu sâu 30% / 50% canh trên giá trị trước chiết khấu", () => {
    expect(evaluateApproval(rules(), ctx({ grossBeforeDiscount: 1_000_000, discountAmount: 299_999 })).autoApprove).toBe(true)
    expect(evaluateApproval(rules(), ctx({ grossBeforeDiscount: 1_000_000, discountAmount: 300_000 })).expectedApprover).toBe("manager")
    expect(evaluateApproval(rules(), ctx({ orderTotal: 0, grossBeforeDiscount: 720_000, discountAmount: 720_000 })).expectedApprover).toBe("owner")
  })
  it("decideStatus: Lưu nháp → draft; đọc hỏng → submitted kèm câu kiểm tay; vượt hạn mức KHÔNG chặn gửi", () => {
    const base = { asDraft: false, orderTotal: 300_000, subtotal: 300_000, grossBeforeDiscount: 300_000, customer: { id: "k", credit_limit: 100_000 }, rules: rules(), customerDebt: 0, customerOverdue: 0, repPortfolioDebt: 0, role: "sales" as const }
    expect(decideStatus({ ...base, asDraft: true })).toEqual({ status: "draft", reason: DRAFT_APPROVAL_REASON })
    expect(decideStatus({ ...base, contextFailed: true }).reason).toMatch(/kiểm tay/)
    const v = decideStatus(base)
    expect(v.status).toBe("submitted")
    expect(v.reason).toMatch(/vượt hạn mức/)
  })
})

/* ------------------------------------------------------------------ */
describe("công nợ của một đơn = gộp các phiếu theo HÓA ĐƠN", () => {
  it("rỗng → null; gộp tiền; trạng thái theo chỗ xấu nhất; hạn sớm nhất", () => {
    expect(gopCongNoCuaDon([])).toBeNull()
    const g = gopCongNoCuaDon([
      { amount: "300000", paid: "300000", status: "paid", due_date: "2026-10-20" },
      { amount: 200_000, paid: 50_000, status: "open", due_date: "2026-10-10" },
    ])
    expect(g).toEqual({ amount: 500_000, paid: 350_000, status: "partial", due_date: "2026-10-10" })
    expect(gopCongNoCuaDon([{ amount: 1, paid: 1, status: "paid", due_date: null }])?.status).toBe("paid")
    expect(gopCongNoCuaDon([{ amount: 100, paid: 0, status: "open", due_date: null }])?.status).toBe("open")
  })
  it("công nợ âm cộng vào, không kẹp 0", () => {
    expect(gopCongNoCuaDon([
      { amount: 100_000, paid: 0, status: "open", due_date: null },
      { amount: -150_000, paid: 0, status: "open", due_date: null },
    ])?.amount).toBe(-50_000)
  })
  it("gom theo order_id, bỏ phiếu không đơn (nợ đầu kỳ)", () => {
    const m = gopCongNoTheoDon([
      { order_id: "d1", amount: 10, paid: 0, status: "open", due_date: null },
      { order_id: "d1", amount: 5, paid: 5, status: "paid", due_date: null },
      { order_id: null, amount: 999, paid: 0, status: "open", due_date: null },
    ])
    expect(Object.keys(m)).toEqual(["d1"])
    expect(m.d1.amount).toBe(15)
  })
})

/* ------------------------------------------------------------------ */
describe("sửa đơn: ma trận khi đang soạn, quyền sửa, tổng sau sửa", () => {
  const ex = (picked: number) => ({ id: "l1", product_id: "p", unit_name: "Thung 24", quantity: 2, conversion_factor: 24, picked_qty_in_base_uom: picked })
  it("đã soạn 24 lon: giữ 1 thùng được, 23 lon / đổi đơn vị / xoá dòng bị chặn", () => {
    const v = (proposed: { product_id: string; unit_name: string; quantity: number; conversion_factor?: number } | null) =>
      validateOrderEdit({ stage: "picking", changes: [{ existing: ex(24), proposed }] }).ok
    expect(v({ product_id: "p", unit_name: "Thung 24", quantity: 1, conversion_factor: 24 })).toBe(true)
    expect(v({ product_id: "p", unit_name: "Thung 24", quantity: 0.5, conversion_factor: 24 })).toBe(false)
    expect(v({ product_id: "p", unit_name: "lon", quantity: 23 })).toBe(false)
    expect(v({ product_id: "q", unit_name: "Thung 24", quantity: 9, conversion_factor: 24 })).toBe(false)
    expect(v(null)).toBe(false)
    expect(validateOrderEdit({ stage: "picking", changes: [{ existing: ex(0), proposed: null }] }).ok).toBe(true)
    expect(validateOrderEdit({ stage: "delivering", changes: [] }).ok).toBe(false)
    expect(validateOrderEdit({ stage: "draft", changes: [{ existing: ex(99), proposed: null }] }).ok).toBe(true)
  })
  it("quyền sửa: NVBH chỉ đơn mình ở nháp / phiếu tạm; đã xuất / đã huỷ khoá", () => {
    const c = (o: object) => ({ role: "sales" as const, userId: "u", status: "submitted" as const, salesUserId: "u", hasUpdatePermission: true, ...o })
    expect(canEditOrder(c({}))).toBe(true)
    expect(canEditOrder(c({ salesUserId: "khac" }))).toBe(false)
    expect(whyCannotEdit(c({ salesUserId: "khac" }))).toMatch(/nhân viên khác/)
    expect(canEditOrder(c({ status: "completed" }))).toBe(false)
    expect(whyCannotEdit(c({ status: "cancelled" }))).toMatch(/đã huỷ/)
    expect(canEditOrder(c({ role: "manager", salesUserId: "khac" }))).toBe(true)
    expect(canEditOrder(c({ hasUpdatePermission: false }))).toBe(false)
    expect(isSellEditable("submitted") && isSellEditable("draft") && !isSellEditable("completed")).toBe(true)
  })
  it("tổng sau sửa tại chỗ: VAT tính lại theo dòng, trừ hàng trả, không âm", () => {
    expect(tongSauSuaTaiCho([{ line_total: 100_000, vat_rate: 0.1 }, { line_total: 33_333, vat_rate: 0.08 }], 20_000))
      .toEqual({ subtotal: 133_333, vat: 12_667, total: 126_000 })
    expect(tongSauSuaTaiCho([{ line_total: 10_000, vat_rate: 0 }], 50_000).total).toBe(0)
  })
  it("so khớp dòng khi lưu bản sửa: dòng cũ trùng khoá chỉ giữ một, thừa thì xoá", () => {
    const row = (p: string, u: string) => ({ product_id: p, unit_name: u, quantity: 1, unit_price: 1, line_discount: 0, line_total: 1, conversion_factor: 1 })
    const plan = planOrderLines(
      [{ id: "a", product_id: "p", unit_name: "lon" }, { id: "b", product_id: "p", unit_name: "lon" }, { id: "c", product_id: "q", unit_name: "lon" }] as never,
      [row("p", "lon"), row("r", "lon")]
    )
    expect(plan.update.map((x) => x.id)).toEqual(["a"])
    expect(plan.insert.map((x) => x.product_id)).toEqual(["r"])
    expect(plan.remove.map((x) => x.id).sort()).toEqual(["b", "c"])
  })
})

/* ------------------------------------------------------------------ */
describe("giá & quy đổi đơn vị", () => {
  const sp: PricedProduct = {
    id: "p", base_unit: "lon", sell_price: 10_000,
    price_lists: [
      { unit_name: "Thung 24", group_id: null, price: 228_000 },
      { unit_name: "lon", group_id: "g1", price: 9_500 },
    ],
    units: [{ unit_name: "lon", conversion: 1 }, { unit_name: "Loc 6", conversion: 6 }, { unit_name: "Thung 24", conversion: 24 }],
  } as unknown as PricedProduct
  it("bốn bậc giá: nhóm → chung → sell_price → cơ sở × hệ số", () => {
    expect(unitPriceFor(sp, "lon", "g1")).toBe(9_500)
    expect(unitPriceFor(sp, "lon", null)).toBe(10_000)
    expect(unitPriceFor(sp, "Thung 24", "g1")).toBe(228_000)
    expect(unitPriceFor(sp, "Loc 6", "g1")).toBe(57_000)
    expect(unitPriceFor(sp, "Hop la", null)).toBe(0)
  })
  it("hệ số: không tra ra thì 1; tồn theo đơn vị làm tròn xuống; đơn vị cơ sở đứng đầu, không trùng", () => {
    expect(conversionFor(sp, "Thung 24")).toBe(24)
    expect(conversionFor(sp, "Hop la")).toBe(1)
    expect(stockInUnit(sp, "Thung 24", 71)).toBe(2)
    expect(stockInUnit(sp, "Thung 24", -5)).toBe(-1)
    expect(sellableUnits(sp)).toEqual(["lon", "Loc 6", "Thung 24"])
  })
  it("giảm cả đơn suy từ Σ(SL × giá) − subtotal; sai số làm tròn ≤ số dòng là 0", () => {
    expect(giamCuaChungTu([{ quantity: 3, unitPrice: 9_667 }], 29_000)).toBe(0)
    expect(giamCuaChungTu([{ quantity: 10, unitPrice: 10_000 }], 95_000)).toBe(5_000)
    expect(giamCuaChungTu([{ quantity: 0, unitPrice: 10_000 }], 0)).toBe(0)
    expect(giamGiaDonConLai({ dongDon: [{ quantity: 10, unitPrice: 10_000 }], subtotalDon: 90_000, hoaDonKhac: [{ dong: [{ quantity: 5, unitPrice: 10_000 }], subtotal: 46_000 }] })).toBe(6_000)
  })
})
