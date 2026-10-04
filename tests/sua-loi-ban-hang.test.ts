/**
 * HỒI QUY CHO CÁC LỖI BÁN HÀNG / ĐƠN HÀNG ĐÃ SỬA (đội test 04/10/2026, mig 226).
 * Ca gốc nằm ở tests/doi-ban-hang-loi.test.ts (L-TS1..3) — tệp này giữ các ca biên.
 *
 *   1. Mở lại đơn có giảm giá dòng (/sell và POS): dựng lại (giá trước giảm + khoản giảm),
 *      lưu lại ra ĐÚNG đơn giá + line_discount cũ, không bị coi là "Giá ngoài hạn mức".
 *   2. Nhân viên không có quyền giảm vẫn lưu được đơn NPP đã giảm (không tăng khoản ấy).
 *   3. Giảm giá ĐƠN theo % cùng luật ở POS và /sell (tiền gộp, kẹp tiền hàng).
 *   4. Nợ quá hạn theo NGÀY VN (không mốc 07:00 UTC).
 *   5. Câu lỗi máy chủ DISCOUNT_* đọc được.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  cartTotals, giaTruocGiamTuSo, kiemQuyenGiamGia, netPriceOf, priceViolation, tienGopOf, type CartLine,
} from "@/lib/sell/cart"
import { toOrderLine } from "@/lib/sell/create-order"
import { orderLinesToCart } from "@/lib/sell/order-edit"
import { posTotals } from "@/lib/pos/totals"
import { loadApprovalContext } from "@/lib/sell/approval-context"
import { userDiscountRulesFrom } from "@/lib/pricing"
import { errorMessage } from "@/lib/errors"
import type { SellProduct } from "@/lib/sell/ref-data"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const sp = {
  id: "p1", name: "Coca", sku: "SNP-001", base_unit: "lon", sell_price: 10_000, vat_rate: 0,
  price_lists: [], units: [{ unit_name: "Thung 24", conversion: 24 }],
} as unknown as SellProduct

const line = (o: Partial<CartLine> = {}): CartLine => ({
  productId: "p1", unit: "lon", qty: 10, price: 10_000, listPrice: 10_000, note: "", conversion: 1, vatRate: 0, ...o,
})

/** Lưu dòng giỏ → đọc lại từ sổ như /sell/edit nạp. */
function luuRoiMoLai(l: CartLine): CartLine {
  const daLuu = toOrderLine(l)
  return orderLinesToCart(
    [{ product_id: daLuu.product_id, unit_name: daLuu.unit_name, quantity: daLuu.quantity, unit_price: daLuu.unit_price,
       line_discount: daLuu.line_discount, conversion_factor: daLuu.conversion_factor, note: null, vat_rate: 0 }],
    [sp],
    null
  )[0]
}

describe("1. mở lại đơn có giảm giá dòng", () => {
  const ca: Array<[string, Partial<CartLine>]> = [
    ["giảm 10%", { discount: { value: 10, unit: "pct" } }],
    ["giảm 7.000đ trên 3 lon", { qty: 3, discount: { value: 7_000, unit: "vnd" } }],
    ["SL lẻ 1,5 giảm 5%", { qty: 1.5, discount: { value: 5, unit: "pct" } }],
    ["giảm 33,33% (đơn giá sau giảm làm tròn)", { qty: 7, discount: { value: 33.33, unit: "pct" } }],
  ]
  for (const [ten, o] of ca) {
    it(`${ten}: lưu lại ra đúng đơn giá + line_discount, không giá xấu`, () => {
      const goc = toOrderLine(line(o))
      const moLai = luuRoiMoLai(line(o))
      expect(priceViolation(moLai, { canEditPrice: true, maxIncreasePct: 0 })).toBeNull()
      expect(netPriceOf(moLai)).toBe(goc.unit_price)
      const lai = toOrderLine(moLai)
      expect({ unit_price: lai.unit_price, line_discount: lai.line_discount, line_total: lai.line_total })
        .toEqual({ unit_price: goc.unit_price, line_discount: goc.line_discount, line_total: goc.line_total })
    })
  }
  it("dòng không giảm: nạp như cũ (không có discount, không giamGoc)", () => {
    const moLai = luuRoiMoLai(line())
    expect(moLai.discount).toBeUndefined()
    expect(moLai.giamGoc).toBeUndefined()
    expect(moLai.price).toBe(10_000)
  })
  it("dòng nâng giá trong hạn mức (không giảm): giữ giá đã nâng", () => {
    const moLai = luuRoiMoLai(line({ price: 10_500 }))
    expect(moLai.price).toBe(10_500)
    expect(moLai.discount).toBeUndefined()
  })
  it("giaTruocGiamTuSo: lệch < 1đ so với giá bảng thì lấy đúng giá bảng", () => {
    expect(giaTruocGiamTuSo({ unitPrice: 9_333, lineDiscount: 1_001, qty: 1.5, listPrice: 10_000 }).price).toBe(10_000)
    expect(giaTruocGiamTuSo({ unitPrice: 9_000, lineDiscount: 0, qty: 2, listPrice: 10_000 })).toEqual({ price: 9_000 })
  })
  it("/sell/edit đọc line_discount; POS dựng lại bằng cùng hàm", () => {
    expect(read("src/app/(dashboard)/sell/edit/[id]/page.tsx")).toMatch(/"product_id, unit_name, quantity, unit_price, line_discount,/)
    const pos = read("src/components/pos/order-screen.tsx")
    expect(pos).toContain("giaTruocGiamTuSo({ unitPrice: r.unitPrice, lineDiscount: r.lineDiscount, qty: r.orderedQty, listPrice })")
    expect(pos).toContain("price: g.price,")
    expect(pos).toContain("giamGoc: g.giamGoc,")
  })
})

describe("2. nhân viên không quyền giảm sửa đơn NPP đã giảm", () => {
  const nvbh = userDiscountRulesFrom({ role: "sales", allow_discount: false })
  const tran10 = userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_type: "pct", discount_max_value: 10 })
  const moLai = luuRoiMoLai(line({ discount: { value: 30, unit: "pct" } }))
  const totals = (c: CartLine[]) => cartTotals(c)
  it("không đổi gì → lưu được", () => {
    expect(kiemQuyenGiamGia([moLai], totals([moLai]), nvbh)).toBeNull()
    expect(kiemQuyenGiamGia([moLai], totals([moLai]), tran10)).toBeNull()
  })
  it("đổi SL, giảm theo đồng giữ nguyên → lưu được", () => {
    const c = [{ ...moLai, qty: 20 }]
    expect(kiemQuyenGiamGia(c, totals(c), nvbh)).toBeNull()
  })
  it("tăng khoản giảm → bị chặn", () => {
    const c = [{ ...moLai, discount: { value: 40_000, unit: "vnd" as const } }]
    expect(kiemQuyenGiamGia(c, totals(c), nvbh)).toMatch(/không có quyền giảm giá dòng/)
  })
  it("dòng mới (không giamGoc) có giảm → vẫn bị chặn như trước", () => {
    const c = [line({ discount: { value: 5, unit: "pct" } })]
    expect(kiemQuyenGiamGia(c, totals(c), nvbh)).toMatch(/không có quyền/)
  })
})

describe("3. giảm giá đơn % — POS và /sell cùng một số", () => {
  const gio = [
    { qty: 7, price: 13_500, giam: { value: 5, unit: "pct" as const }, vat: 0.08 },
    { qty: 3, price: 20_000, giam: { value: 4_000, unit: "vnd" as const }, vat: 0 },
    { qty: 12, price: 9_000, giam: undefined, vat: 0.1 },
  ]
  for (const doc of [{ value: 10, unit: "pct" as const }, { value: 2.5, unit: "pct" as const }, { value: 50_000, unit: "vnd" as const }]) {
    it(`giảm đơn ${doc.value}${doc.unit === "pct" ? "%" : "đ"}, có VAT và hàng trả`, () => {
      const pos = posTotals({
        lines: gio.map((l) => ({ qty: l.qty, price: l.price, discount: l.giam ?? { value: 0, unit: "vnd" }, vatRate: l.vat })),
        docDiscount: doc,
        returnCredit: 30_000,
      })
      const sell = cartTotals(
        gio.map((l) => line({ qty: l.qty, price: l.price, listPrice: l.price, vatRate: l.vat, ...(l.giam ? { discount: l.giam } : {}) })),
        30_000,
        doc
      )
      expect(sell.docDiscount).toBe(pos.docDiscount)
      // /sell quy giảm dòng về đơn giá làm tròn (đúng thứ đi xuống sổ) — lệch tối đa vài đồng.
      expect(Math.abs(sell.grandTotal - pos.due)).toBeLessThanOrEqual(gio.length)
    })
  }
  it("nền % là tiền gộp theo GIÁ DÒNG (đã sửa tay), không theo giá bảng", () => {
    const c = [line({ qty: 10, price: 11_000, listPrice: 10_000 })]
    expect(tienGopOf(c)).toBe(110_000)
    expect(cartTotals(c, 0, { value: 10, unit: "pct" }).docDiscount).toBe(11_000)
  })
  it("giảm dòng + giảm đơn vượt tiền hàng: kẹp ở cả hai màn, không sinh 'ghi có' cho khách", () => {
    const pos = posTotals({ lines: [{ qty: 2, price: 100_000, discount: { value: 50, unit: "pct" } }], docDiscount: { value: 80, unit: "pct" } })
    const sell = cartTotals([line({ qty: 2, price: 100_000, listPrice: 100_000, discount: { value: 50, unit: "pct" } })], 0, { value: 80, unit: "pct" })
    expect(pos).toMatchObject({ docDiscount: 100_000, due: 0, credit: 0 })
    expect(sell).toMatchObject({ docDiscount: 100_000, subtotal: 0, grandTotal: 0 })
  })
  it("trần quyền giảm đơn so trên tiền gộp ở /sell (cùng nền POS)", () => {
    const tran10 = userDiscountRulesFrom({ role: "sales", allow_discount: true, discount_max_type: "pct", discount_max_value: 10 })
    const c = [line({ qty: 100, discount: { value: 10, unit: "pct" } })] // gộp 1.000.000, sau giảm dòng 900.000
    const t = cartTotals(c, 0, { value: 100_000, unit: "vnd" }) // đúng 10% tiền gộp
    expect(kiemQuyenGiamGia(c, t, tran10)).toBeNull()
    const t2 = cartTotals(c, 0, { value: 100_001, unit: "vnd" })
    expect(kiemQuyenGiamGia(c, t2, tran10)).toMatch(/Giảm giá đơn vượt mức/)
  })
})

describe("4. nợ quá hạn theo ngày VN", () => {
  function sb(receivables: Array<{ amount: number; paid: number; due_date: string | null }>) {
    const q = (rows: unknown[]) => {
      const b: Record<string, unknown> = {}
      for (const m of ["select", "eq", "neq", "order"]) b[m] = () => b
      b.range = async () => ({ data: rows, error: null, count: rows.length })
      b.maybeSingle = async () => ({ data: null, error: null })
      return b
    }
    return { from: (t: string) => q(t === "receivables" ? receivables : []) }
  }
  const quaHan = async (due: string, luc: string) =>
    (await loadApprovalContext(sb([{ amount: 500_000, paid: 0, due_date: due }]), {
      orgId: "o", customerId: "k", salesUserId: "u", now: Date.parse(luc),
    })).customerOverdue
  it("đến hạn hôm nay: 06:59 và 07:01 giờ VN đều CHƯA quá hạn", async () => {
    expect(await quaHan("2026-10-04", "2026-10-04T06:59:00+07:00")).toBe(0)
    expect(await quaHan("2026-10-04", "2026-10-04T07:01:00+07:00")).toBe(0)
    expect(await quaHan("2026-10-04", "2026-10-04T23:59:00+07:00")).toBe(0)
  })
  it("đến hạn hôm qua: quá hạn ngay từ 00:00 giờ VN (17:00 UTC hôm trước)", async () => {
    expect(await quaHan("2026-10-03", "2026-10-04T00:01:00+07:00")).toBe(500_000)
  })
  it("cột due_date dạng timestamp vẫn so theo ngày", async () => {
    expect(await quaHan("2026-10-04T00:00:00+00:00", "2026-10-04T10:00:00+07:00")).toBe(0)
  })
})

describe("5. câu lỗi máy chủ quyền giảm giá", () => {
  it("DISCOUNT_NOT_ALLOWED / DISCOUNT_OVER_LIMIT có câu tiếng Việt, giữ nguyên văn", () => {
    const a = errorMessage({ code: "P0001", message: "DISCOUNT_NOT_ALLOWED: Bạn không có quyền giảm giá dòng" })
    expect(a).toMatch(/^Máy chủ từ chối: bạn chưa được bật quyền giảm giá/)
    expect(a).toContain("DISCOUNT_NOT_ALLOWED")
    expect(errorMessage({ code: "P0001", message: "DISCOUNT_OVER_LIMIT: Giảm giá dòng vượt mức cho phép (tối đa 10%)." }))
      .toMatch(/^Máy chủ từ chối: khoản giảm giá vượt mức/)
  })
})

describe("6. giá trần chốt ở máy chủ (mig 229, chủ nhà 04/10/2026)", () => {
  it("PRICE_OVER_CEILING có câu tiếng Việt, giữ nguyên văn máy chủ", () => {
    const a = errorMessage({ code: "P0001", message: "PRICE_OVER_CEILING: Đơn giá 11.400 vượt mức tối đa 10.450 (giá bảng 9.500, được nâng 10%)." })
    expect(a).toMatch(/^Máy chủ từ chối: đơn giá vượt mức được nâng/)
    expect(a).toContain("10.450")
  })
  it("migration 229 kiểm giá TRƯỚC giảm dòng, NVBH không quyền sửa giá thì % = 0", () => {
    const sql = readFileSync(resolve(__dirname, "../supabase/migrations/229_chan_gia_tran_may_chu.sql"), "utf-8")
    expect(sql).toMatch(/v_truoc := NEW\.unit_price \+ COALESCE\(NEW\.line_discount, 0\) \/ NEW\.quantity/)
    expect(sql).toMatch(/WHEN u\.allow_price_edit OR u\.role <> 'sales'/)
    expect(sql).toMatch(/RAISE EXCEPTION 'PRICE_OVER_CEILING/)
  })
})

describe("7. giá trần phiếu trả chốt ở máy chủ (mig 230)", () => {
  it("RETURN_PRICE_OVER_CEILING ra câu của phiếu trả, không lẫn câu giá bán", () => {
    const a = errorMessage({ code: "P0001", message: "RETURN_PRICE_OVER_CEILING: Giá trả 24.000 vượt mức tối đa 19.000 (giá tham chiếu 19.000, được nâng 0%)." })
    expect(a).toMatch(/^Máy chủ từ chối: giá trả cao hơn mức cho phép/)
    expect(a).toContain("19.000")
  })
  it("migration 230: trigger trên return_lines, bỏ qua hàng đổi, tham chiếu giá đã bán trên HĐ", () => {
    const sql = readFileSync(resolve(__dirname, "../supabase/migrations/230_chan_gia_tran_phieu_tra.sql"), "utf-8")
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON public\.return_lines/)
    expect(sql).toMatch(/IF COALESCE\(NEW\.is_exchange, false\) OR v_uid IS NULL THEN RETURN NEW/)
    expect(sql).toMatch(/FROM sales_invoice_lines l/)
  })
})
