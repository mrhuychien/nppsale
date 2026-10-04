/**
 * ĐỘI TEST HOÁ ĐƠN — logic TypeScript của xuất / sửa / huỷ hoá đơn và soạn hàng.
 *
 * Kỳ vọng theo CLAUDE.md §1: công nợ theo HĐ (gộp nhiều phiếu, không kẹp 0), một đơn một HĐ, huỷ HĐ = huỷ đơn,
 * Sửa HĐ giữ ngày + giảm giá khi không gửi khoá, công nợ âm, phiếu tự sinh trừ từ Chờ xử lý.
 * Con số tiền ở đây khớp với kịch bản SQL thật: scripts/sql/doi-test/hoa-don-xuat-sua-huy.sql (A7, A8, A10).
 */
import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  invoiceTotals, shortageOf, explainInvoiceError, invoiceWarnings, dongGuiLen, giamGiaDonPayload,
  postInvoice, reissueInvoice, cancelInvoice, baoDaHuyHoaDon, MO_TA_HUY_HOA_DON,
  type InvoiceDraftLine, type InvoiceableLine,
} from "@/lib/orders/post-invoice"
import {
  seedForNew, seedForReissue, toDraft, toDraftCoGiam, rowsOverOrdered, patchRowFromCart, rowToCartLine, withStock,
  type EditorRow,
} from "@/lib/orders/invoice-editor"
import { creditCounted, creditOnInvoice, netDueOnInvoice, showCreditOnPrint } from "@/lib/orders/invoice-credit"
import { gopCongNoCuaDon, gopCongNoTheoDon } from "@/lib/orders/receivable-sum"
import { duocDanhDauSoan } from "@/lib/orders/soan-hang-loc"
import { duocSoanHang, loiLuotSoan } from "@/lib/orders/luot-soan"
import type { SupabaseClient } from "@supabase/supabase-js"

const dong = (x: Partial<InvoiceDraftLine> = {}): InvoiceDraftLine => ({
  orderLineId: "sol1", productId: "p1", unitName: "lon", conversionFactor: 1, quantity: 1, unitPrice: 10000,
  lineDiscount: 0, vatRate: 0, isExchange: false, note: null, ...x,
})

const dongDon = (x: Partial<InvoiceableLine> = {}): InvoiceableLine => ({
  orderLineId: "sol1", returnLineId: null, productId: "p1", productName: "Coca", sku: "SNP-001", unitName: "lon",
  conversionFactor: 1, orderedQty: 100, invoicedQty: 0, remainingQty: 100, unitPrice: 10000, listPrice: 10000,
  lineDiscount: 0, vatRate: 0, availableBase: 1000, isExchange: false, note: null, ...x,
})

/** Supabase giả: ghi lại lời gọi RPC, trả `data` cho sẵn. */
function gia(data: unknown, error: { message: string } | null = null) {
  const goi: Array<{ fn: string; args: Record<string, unknown> }> = []
  const sb = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      goi.push({ fn, args })
      return { data, error }
    }),
  } as unknown as SupabaseClient
  return { sb, goi }
}

// ─────────────────────────────── invoiceTotals ───────────────────────────────
describe("invoiceTotals — phải ra đúng số post_invoice ghi", () => {
  it("giảm giá đơn 50.000 trên 30 × 10.000, thuế 10% trên giá dòng → 250.000 / 30.000 / 280.000 (khớp SQL A7)", () => {
    const t = invoiceTotals([dong({ quantity: 30, vatRate: 0.1 })], 50000)
    expect(t).toEqual({ subtotal: 250000, vat: 30000, total: 280000, goods: 300000, discount: 50000 })
  })
  it("giảm vượt tiền hàng bị kẹp về tiền hàng: total 0 (khớp SQL A8)", () => {
    const t = invoiceTotals([dong({ quantity: 10 })], 999999)
    expect(t.discount).toBe(100000)
    expect(t.total).toBe(0)
    expect(t.subtotal).toBe(0)
  })
  it("giảm âm / NaN → 0", () => {
    expect(invoiceTotals([dong({ quantity: 10 })], -5000).total).toBe(100000)
    expect(invoiceTotals([dong({ quantity: 10 })], Number.NaN).total).toBe(100000)
  })
  it("làm tròn ở TỔNG: 3 × 3.333,33 = 9.999,99 → 10.000 (khớp SQL A10)", () => {
    expect(invoiceTotals([dong({ quantity: 3, unitPrice: 3333.33 })]).total).toBe(10000)
  })
  it("total làm tròn (subtotal + vat) CHƯA làm tròn, không phải tổng hai số đã tròn", () => {
    const t = invoiceTotals([dong({ quantity: 1, unitPrice: 5, vatRate: 0.1 }), dong({ quantity: 1, unitPrice: 4, vatRate: 0.05 })])
    // sub 9, vat 0,5 + 0,2 = 0,7 → total round(9,7) = 10, vat round(0,7) = 1
    expect(t).toMatchObject({ subtotal: 9, vat: 1, total: 10 })
  })
  it("dòng SL 0 / âm không tính; nhiều dòng cộng đúng; số lẻ 1,5 × 55.000 = 82.500 (khớp SQL A6)", () => {
    const t = invoiceTotals([dong({ quantity: 0, unitPrice: 999 }), dong({ quantity: -2, unitPrice: 999 }),
      dong({ quantity: 1.5, unitPrice: 55000 }), dong({ quantity: 2, unitPrice: 240000 })])
    expect(t.total).toBe(82500 + 480000)
  })
  it("không dòng → 0", () => {
    expect(invoiceTotals([])).toEqual({ subtotal: 0, vat: 0, total: 0, goods: 0, discount: 0 })
  })
})

describe("shortageOf — quy về đơn vị cơ sở", () => {
  it("2 thùng (×24) khi tồn 48 lon → đủ; tồn 30 → thiếu 18 lon", () => {
    expect(shortageOf({ conversionFactor: 24, availableBase: 48 }, 2)).toBe(0)
    expect(shortageOf({ conversionFactor: 24, availableBase: 30 }, 2)).toBe(18)
  })
  it("hệ số 0 / rỗng coi như 1; tồn âm vẫn tính thiếu", () => {
    expect(shortageOf({ conversionFactor: 0, availableBase: 5 }, 7)).toBe(2)
    expect(shortageOf({ conversionFactor: 1, availableBase: -3 }, 2)).toBe(5)
  })
})

describe("explainInvoiceError — mã lỗi RPC sang câu tiếng Việt", () => {
  it.each([
    ["ORDER_NOT_INVOICEABLE: đơn DH-1 đang ở trạng thái completed, không xuất hàng được", /^Đơn không còn xuất hàng được/],
    ["NO_LINES: hóa đơn phải có ít nhất một dòng số lượng > 0", /^Chưa chọn dòng nào để xuất/],
    ["LOCKED_HAS_PAYMENT: hóa đơn đã có tiền thu, huỷ phiếu thu trước", /^hóa đơn đã có tiền thu/],
    ["LOCKED_RETURN_DONE: hóa đơn đã có phiếu trả hoàn thành", /^hóa đơn đã có phiếu trả hoàn thành/],
    ["LOCKED_EINVOICE: hóa đơn đã phát hành hóa đơn điện tử", /^hóa đơn đã phát hành/],
    ["REASON_REQUIRED: phải ghi lý do huỷ hóa đơn", /^phải ghi lý do/],
    ["INVOICE_NOT_POSTED: hóa đơn HD-0001 đang ở trạng thái cancelled", /^Hóa đơn không còn hiệu lực/],
    ["REISSUE_RETURN_STOCKED: phiếu trả TH-0001 đã nhập kho — chọn …", /^phiếu trả TH-0001 đã nhập kho/],
    ["FORBIDDEN: bạn không có quyền xuất hàng", /^bạn không có quyền xuất hàng$/],
    ["ORDER_CLOSE_REMOVED: không còn đóng đơn", /^Không còn đóng đơn — đơn xuất hóa đơn xong là Hoàn thành\.$/],
    ["ORG_MISMATCH", /^Đơn không thuộc đơn vị của bạn\.$/],
    ["INSUFFICIENT_STOCK: thiếu 10 đơn vị của \"Bia\" — ghi sổ phiếu xuất sẽ làm tồn kho âm", /^Không đủ tồn: thiếu 10 đơn vị/],
    ["function public.post_invoice(jsonb) does not exist", /^Chưa chạy migration/],
  ])("%s", (vao, ra) => {
    expect(explainInvoiceError(vao)).toMatch(ra)
  })
  it("lỗi lạ trả NGUYÊN VĂN, chuỗi rỗng → rỗng", () => {
    expect(explainInvoiceError("duplicate key value violates unique constraint \"uq_sales_invoices_mot_don_mot_hd\""))
      .toBe("duplicate key value violates unique constraint \"uq_sales_invoices_mot_don_mot_hd\"")
    expect(explainInvoiceError("")).toBe("")
  })
})

describe("invoiceWarnings", () => {
  const r = { invoiceId: "i", invoiceCode: "HD-1", entryId: "e", receivableId: "r", orderStatus: "completed" }
  it("không thiếu, không cận hạn → null", () => {
    expect(invoiceWarnings({ ...r, shortQty: 0, nearExpirySkipped: 0 })).toBeNull()
  })
  it("bán âm 10 đơn vị cơ sở → cảnh báo nói số + 'đơn vị cơ sở'", () => {
    expect(invoiceWarnings({ ...r, shortQty: 10, nearExpirySkipped: 0 })).toMatch(/Thiếu 10 đơn vị cơ sở/)
  })
  it("cả hai → nối hai câu", () => {
    const w = invoiceWarnings({ ...r, shortQty: 24, nearExpirySkipped: 2 })!
    expect(w).toMatch(/Thiếu 24/)
    expect(w).toMatch(/2 lượt lấy lô/)
  })
})

describe("tải trọng gửi RPC", () => {
  it("dongGuiLen bê đủ trường: dòng đơn, đơn vị, hệ số, thuế, hàng đổi, ghi chú", () => {
    expect(dongGuiLen(dong({ unitName: "Thung 24", conversionFactor: 24, quantity: 2, unitPrice: 240000, vatRate: 0.08, note: "x" })))
      .toEqual({ order_line_id: "sol1", product_id: "p1", unit_name: "Thung 24", conversion_factor: 24, quantity: 2,
        unit_price: 240000, line_discount: 0, vat_rate: 0.08, is_exchange: false, note: "x" })
  })
  it("giamGiaDonPayload: vắng → không gửi khoá (Sửa HĐ giữ giảm cũ); 0 → gửi 0; âm → 0; lẻ → làm tròn", () => {
    expect(giamGiaDonPayload(undefined)).toEqual({})
    expect(giamGiaDonPayload(0)).toEqual({ discount: 0 })
    expect(giamGiaDonPayload(-500)).toEqual({ discount: 0 })
    expect(giamGiaDonPayload(12345.6)).toEqual({ discount: 12346 })
  })
})

describe("postInvoice / reissueInvoice / cancelInvoice qua Supabase giả", () => {
  const hang = [{ invoice_id: "inv1", invoice_code: "HD-0007", entry_id: "e1", receivable_id: "r1", short_qty: "12", near_expiry_skipped: 1, order_status: "completed" }]

  it("lọc dòng SL 0 trước khi gửi; đọc mảng RETURNS TABLE; short_qty chuỗi → số", async () => {
    const { sb, goi } = gia(hang)
    const r = await postInvoice(sb, { orderId: "o1", invoiceDate: "2026-10-04", lines: [dong({ quantity: 0 }), dong({ quantity: 3 })] })
    expect(goi).toHaveLength(1)
    expect(goi[0].fn).toBe("post_invoice")
    const p = goi[0].args.p as Record<string, unknown>
    expect(p.order_id).toBe("o1")
    expect(p.invoice_date).toBe("2026-10-04")
    expect((p.lines as unknown[]).length).toBe(1)
    expect(p).not.toHaveProperty("discount")
    expect(p).not.toHaveProperty("return_adds")
    expect(r).toEqual({ invoiceId: "inv1", invoiceCode: "HD-0007", entryId: "e1", receivableId: "r1", shortQty: 12, nearExpirySkipped: 1, orderStatus: "completed" })
  })
  it("không dòng nào SL > 0 → báo ngay, KHÔNG gọi máy chủ (gửi hai lần cũng không lọt)", async () => {
    const { sb, goi } = gia(hang)
    await expect(postInvoice(sb, { orderId: "o1", lines: [dong({ quantity: 0 })] })).rejects.toThrow(/Chưa chọn dòng nào/)
    await expect(postInvoice(sb, { orderId: "o1", lines: [] })).rejects.toThrow(/Chưa chọn dòng nào/)
    expect(goi).toHaveLength(0)
  })
  it("lỗi RPC dịch sang tiếng Việt", async () => {
    const { sb } = gia(null, { message: "ORDER_NOT_INVOICEABLE: đơn DH-1 đang ở trạng thái completed, không xuất hàng được" })
    await expect(postInvoice(sb, { orderId: "o1", lines: [dong()] })).rejects.toThrow(/^Đơn không còn xuất hàng được/)
  })
  it("hàng trả thêm: KHÔNG gửi line_total (máy chủ tự tính tiền trừ nợ)", async () => {
    const { sb, goi } = gia(hang)
    await postInvoice(sb, { orderId: "o1", lines: [dong()], returnAdds: [{ productId: "p2", unitName: "lon", quantity: 3, unitPrice: 5000, vatRate: 0, isExchange: false }] })
    const adds = (goi[0].args.p as { return_adds: Array<Record<string, unknown>> }).return_adds
    expect(adds).toEqual([{ product_id: "p2", unit_name: "lon", quantity: 3, unit_price: 5000, vat_rate: 0, is_exchange: false }])
    expect(adds[0]).not.toHaveProperty("line_total")
  })
  it("Sửa HĐ: không gửi discount khi không biết (giữ giảm cũ), không gửi return_edits rỗng, gửi tra_da_nhap", async () => {
    const { sb, goi } = gia(hang)
    await reissueInvoice(sb, "inv0", { lines: [dong({ quantity: 2 })], returnEdits: [], traDaNhap: "lam_lai" })
    expect(goi[0].fn).toBe("reissue_invoice")
    expect(goi[0].args.p_invoice_id).toBe("inv0")
    const p = goi[0].args.p as Record<string, unknown>
    expect(p).not.toHaveProperty("discount")
    expect(p).not.toHaveProperty("return_edits")
    expect(p.tra_da_nhap).toBe("lam_lai")
    expect(p.invoice_date).toBeNull()
  })
  it("Sửa HĐ thành rỗng → chặn trước khi gọi, gợi ý huỷ HĐ", async () => {
    const { sb, goi } = gia(hang)
    await expect(reissueInvoice(sb, "inv0", { lines: [dong({ quantity: 0 })] })).rejects.toThrow(/muốn bỏ hết thì huỷ hóa đơn/)
    expect(goi).toHaveLength(0)
  })
  it("Huỷ HĐ: gửi lý do, đọc order_status; lời báo nói rõ đơn huỷ theo", async () => {
    const { sb, goi } = gia([{ import_entry_id: "nk1", order_status: "cancelled" }])
    const r = await cancelInvoice(sb, "inv1", "khách đổi ý")
    expect(goi[0]).toEqual({ fn: "cancel_invoice", args: { p_invoice_id: "inv1", p_reason: "khách đổi ý" } })
    expect(r).toEqual({ importEntryId: "nk1", orderStatus: "cancelled" })
    expect(baoDaHuyHoaDon("HD-0001", r.orderStatus)).toBe("Đã huỷ hóa đơn HD-0001 và đơn hàng của nó")
    expect(baoDaHuyHoaDon("HD-0001", "completed")).toBe("Đã huỷ hóa đơn HD-0001")
    expect(MO_TA_HUY_HOA_DON).toMatch(/Đơn hàng của hóa đơn và phiếu trả chưa nhập kho kèm theo cũng bị huỷ/)
  })
})

// ─────────────────────────────── invoice-editor ───────────────────────────────
describe("invoice-editor — màn soạn HĐ", () => {
  it("lập MỚI: mặc định xuất hết phần còn lại; dòng hàng đổi không phải 'thêm tay'", () => {
    const rows = seedForNew([dongDon({ remainingQty: 60, invoicedQty: 40 }), dongDon({ orderLineId: null, returnLineId: "rl1", isExchange: true, remainingQty: 2 })])
    expect(rows.map((r) => [r.key, r.qty, r.addedByHand, r.discountBase])).toEqual([["sol1", 60, false, 60], ["rl1", 2, false, 2]])
  })
  it("SỬA: số lượng theo tờ cũ; mốc 'còn lại' = phần chưa xuất + phần tờ cũ đang giữ; mã thêm tay vẫn xoá được", () => {
    const rows = seedForReissue([dongDon({ remainingQty: 0, invoicedQty: 100 })], [
      { orderLineId: "sol1", productId: "p1", unitName: "lon", quantity: 100, unitPrice: 9000, lineDiscount: 0, vatRate: 0, isExchange: false, conversionFactor: 1, productName: "Coca", sku: null, note: null },
      { orderLineId: null, productId: "p5", unitName: "lon", quantity: 2, unitPrice: 7000, lineDiscount: 0, vatRate: 0, isExchange: false, conversionFactor: 1, productName: "Bia", sku: null, note: null },
      { orderLineId: null, productId: "p6", unitName: "lon", quantity: 1, unitPrice: 0, lineDiscount: 0, vatRate: 0, isExchange: true, conversionFactor: 1, productName: "Đổi", sku: null, note: null },
    ])
    expect(rows[0]).toMatchObject({ qty: 100, price: 9000, remainingQty: 100, addedByHand: false, stockKnown: true })
    expect(rows[1]).toMatchObject({ qty: 2, addedByHand: true, stockKnown: false })
    expect(rows[2]).toMatchObject({ addedByHand: false, isExchange: true })
    expect(rowsOverOrdered(rows)).toHaveLength(0)
  })
  it("toDraft chia chiết khấu dòng theo tỉ lệ phần đang xuất", () => {
    const [r] = seedForNew([dongDon({ remainingQty: 10, lineDiscount: 10000 })])
    expect(toDraft([{ ...r, qty: 4 }])[0].lineDiscount).toBe(4000)
    expect(toDraft([{ ...r, qty: 10 }])[0].lineDiscount).toBe(10000)
    expect(toDraft([{ ...r, discountBase: 0 }])[0].lineDiscount).toBe(0)
  })
  it("toDraftCoGiam SL nguyên: giảm 10% dòng 10 × 10.000 → đơn giá 9.000, dấu vết lineDiscount 10.000", () => {
    const [r] = seedForNew([dongDon({ remainingQty: 10 })])
    const [d] = toDraftCoGiam([r], { sol1: { value: 10, unit: "pct" } })
    expect(d.unitPrice).toBe(9000)
    expect(d.lineDiscount).toBe(10000)
    expect(invoiceTotals([d]).total).toBe(90000)
  })
  it("toDraftCoGiam: không giảm / giảm 0 / SL 0 → giữ nguyên dòng", () => {
    const [r] = seedForNew([dongDon({ remainingQty: 10 })])
    expect(toDraftCoGiam([r], {})[0].unitPrice).toBe(10000)
    expect(toDraftCoGiam([r], { sol1: { value: 0, unit: "vnd" } })[0].unitPrice).toBe(10000)
    expect(toDraftCoGiam([{ ...r, qty: 0 }], { sol1: { value: 5000, unit: "vnd" } })[0].unitPrice).toBe(10000)
  })
  it("rowsOverOrdered so theo đơn vị cơ sở: 2 thùng (48) ≤ 50 lon không vượt; 3 thùng (72) vượt; mã thêm tay bỏ qua", () => {
    const [r] = seedForNew([dongDon({ remainingQty: 50 })])
    const thung = (sl: number): EditorRow => ({ ...r, unitName: "Thung 24", conversionFactor: 24, qty: sl })
    expect(rowsOverOrdered([thung(2)])).toHaveLength(0)
    expect(rowsOverOrdered([thung(3)])).toHaveLength(1)
    expect(rowsOverOrdered([{ ...r, orderLineId: null, qty: 999 }])).toHaveLength(0)
  })
  it("patchRowFromCart: SL / giá âm kẹp 0; đổi đơn vị đổi cả hệ số; không nhận listPrice", () => {
    const [r] = seedForNew([dongDon()])
    expect(patchRowFromCart(r, { qty: -5, price: -1 })).toMatchObject({ qty: 0, price: 0 })
    expect(patchRowFromCart(r, { unit: "Thung 24", conversion: 24 })).toMatchObject({ unitName: "Thung 24", conversionFactor: 24 })
    expect(patchRowFromCart(r, { listPrice: 1 }).unitPrice).toBe(10000)
    expect(rowToCartLine(r)).toMatchObject({ productId: "p1", unit: "lon", qty: 100, price: 10000, listPrice: 10000, conversion: 1 })
  })
  it("withStock chỉ gắn tồn cho đúng dòng", () => {
    const rows = seedForNew([dongDon(), dongDon({ orderLineId: "sol2" })])
    const out = withStock(rows.map((x) => ({ ...x, stockKnown: false })), "sol2", 7)
    expect(out.map((x) => [x.stockKnown, x.availableBase])).toEqual([[false, 1000], [true, 7]])
  })
})

// ─────────────────────────────── công nợ / khoản trừ ───────────────────────────────
describe("invoice-credit — bản sao luật _wf2b_recompute_receivable", () => {
  it("phiếu tự sinh trừ từ Chờ xử lý; phiếu tự lập chỉ khi Hoàn thành; Nháp / Đã huỷ không trừ", () => {
    expect(creditCounted({ status: "submitted", credit_with_invoice: true })).toBe(true)
    expect(creditCounted({ status: "completed", credit_with_invoice: true })).toBe(true)
    expect(creditCounted({ status: "draft", credit_with_invoice: true })).toBe(false)
    expect(creditCounted({ status: "submitted", credit_with_invoice: false })).toBe(false)
    expect(creditCounted({ status: "completed", credit_with_invoice: false })).toBe(true)
    expect(creditCounted({ status: "cancelled", credit_with_invoice: true })).toBe(false)
    expect(creditCounted({ status: "completed" })).toBe(true)
  })
  it("tổng khoản trừ + còn phải thu CÓ THỂ ÂM (khớp SQL C3: 10.000 − 25.000 = −15.000)", () => {
    const c = creditOnInvoice([
      { status: "submitted", credit_with_invoice: true, credit_note_amount: 25000 },
      { status: "draft", credit_with_invoice: false, credit_note_amount: 99999 },
      { status: "cancelled", credit_with_invoice: true, credit_note_amount: 99999 },
    ])
    expect(c).toBe(25000)
    expect(netDueOnInvoice(10000, c)).toBe(-15000)
  })
  it("in khoản trừ chỉ khi > 0 và chưa phát hành HĐ điện tử", () => {
    expect(showCreditOnPrint({ credit: 15000, eInvoiceIssued: false })).toBe(true)
    expect(showCreditOnPrint({ credit: 15000, eInvoiceIssued: true })).toBe(false)
    expect(showCreditOnPrint({ credit: 0, eInvoiceIssued: false })).toBe(false)
  })
  it("luật trừ hai nhánh trong SQL hiện hành vẫn đúng như bản sao TS", () => {
    const mig = readFileSync(join(__dirname, "../supabase/migrations/200_phieu_tra_hoan_thanh_gan_hd.sql"), "utf8")
    expect(mig).toMatch(/r\.credit_with_invoice AND r\.status IN \('submitted', 'completed'\)/)
    expect(mig).toMatch(/NOT r\.credit_with_invoice AND r\.status = 'completed'/)
    expect(mig).toMatch(/KHÔNG KẸP VỀ 0|v_net := COALESCE\(v\.total, 0\) - v_credits/)
  })
})

describe("receivable-sum — đơn nhiều phiếu công nợ thì GỘP", () => {
  it("cộng amount / paid; còn một phiếu chưa trả thì đơn chưa trả; hạn sớm nhất", () => {
    const g = gopCongNoCuaDon([
      { amount: "340000", paid: "30000", status: "partial", due_date: "2026-11-03" },
      { amount: 100000, paid: 100000, status: "paid", due_date: "2026-10-20" },
    ])
    expect(g).toEqual({ amount: 440000, paid: 130000, status: "partial", due_date: "2026-10-20" })
  })
  it("công nợ âm không kẹp; tất cả paid → paid; rỗng → null", () => {
    expect(gopCongNoCuaDon([{ amount: -15000, paid: 0, status: "open", due_date: null }])).toMatchObject({ amount: -15000, status: "open" })
    expect(gopCongNoCuaDon([{ amount: 0, paid: 0, status: "paid", due_date: null }])?.status).toBe("paid")
    expect(gopCongNoCuaDon([])).toBeNull()
  })
  it("gộp theo order_id, bỏ phiếu không đơn (nợ đầu kỳ)", () => {
    const g = gopCongNoTheoDon([
      { order_id: "o1", amount: 10, paid: 0, status: "open", due_date: null },
      { order_id: "o1", amount: 5, paid: 5, status: "paid", due_date: null },
      { order_id: null, amount: 999, paid: 0, status: "open", due_date: null },
    ])
    expect(Object.keys(g)).toEqual(["o1"])
    expect(g.o1).toMatchObject({ amount: 15, paid: 5, status: "partial" })
  })
})

// ─────────────────────────────── soạn hàng: vai khớp RPC ───────────────────────────────
describe("vai soạn hàng ở giao diện khớp RPC mig 224 / 225", () => {
  const VAI = ["owner", "manager", "accountant", "sales", "warehouse", "driver", null, undefined, ""]
  const docVai = (tep: string) => {
    const s = readFileSync(join(__dirname, "../supabase/migrations", tep), "utf8")
    const m = /user_role\(\) NOT IN \(([^)]+)\)/.exec(s)
    return new Set((m?.[1] ?? "").split(",").map((x) => x.trim().replace(/'/g, "")))
  }
  it("duocDanhDauSoan = vai trong danh_dau_soan_hang (mig 224)", () => {
    const sql = docVai("224_danh_dau_da_soan_hang.sql")
    expect(sql.size).toBe(4)
    for (const v of VAI) expect(duocDanhDauSoan(v), String(v)).toBe(!!v && sql.has(v))
  })
  it("duocSoanHang = vai trong _luot_soan_quyen (mig 225)", () => {
    const sql = docVai("225_luot_soan_hang.sql")
    for (const v of VAI) expect(duocSoanHang(v), String(v)).toBe(!!v && sql.has(v))
  })
  it("loiLuotSoan dịch đủ mã lỗi RPC", () => {
    expect(loiLuotSoan("KHONG_DU_QUYEN: …")).toMatch(/Chỉ chủ NPP/)
    expect(loiLuotSoan("QUA_NHIEU_RO: …")).toMatch(/26 hoá đơn/)
    expect(loiLuotSoan("HOA_DON_KHONG_HOP_LE: …")).toMatch(/chưa ghi sổ \/ đã huỷ/)
    expect(loiLuotSoan("LUOT_DA_DONG: …")).toMatch(/đã hoàn tất hoặc đã huỷ/)
    expect(loiLuotSoan("CHUA_CHON_HOA_DON")).toMatch(/Chưa chọn/)
    expect(loiLuotSoan(null)).toBe("Lỗi không xác định")
  })
})
