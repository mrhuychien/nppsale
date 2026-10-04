import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  duongSuaPhieuTra,
  hanhDongPhieuTra,
  laNhapTheoDon,
  laPhieuTuSinh,
  LY_DO_RONG,
  LY_DO_THEO_DON,
  LY_DO_TU_SINH,
} from "@/lib/returns/loai-phieu"
import { laDaNhapTuSinh, phieuDaNhapCuaHoaDon, traSuaDuoc } from "@/lib/returns/tra-da-nhap"
import { loiNgayNhap } from "@/lib/returns/ngay-nhap"
import { cancelReturn, completeReturn, explainReturnError } from "@/lib/returns/complete-return"
import { tenPhieuTra } from "@/lib/returns/ma-phieu"
import { creditCounted, creditOnInvoice, netDueOnInvoice } from "@/lib/orders/invoice-credit"
import { debtAfterReturn, returnTotals, warehouseSentence } from "@/lib/pos/return-totals"
import { savePosReturn } from "@/lib/pos/save"
import type { PosLine } from "@/lib/pos/types"

/**
 * ĐỘI TEST "TRẢ HÀNG" — logic TypeScript thuần của phiếu trả TỰ SINH / TỰ LẬP.
 *
 * Luật (CLAUDE.md, chủ nhà 25/09/2026 mig 191; 28/09/2026 mig 210/211/216):
 *   · Tự sinh: Chờ xử lý → chỉ Hoàn thành; đã nhập kho → huỷ = về Chờ xử lý; không sửa ở phiếu.
 *   · Tự lập: Nháp → Hoàn thành → Đã huỷ; sửa / huỷ luôn được.
 *   · Nợ: tự sinh trừ từ lúc Chờ xử lý; tự lập trừ khi hoàn thành. Công nợ âm không kẹp 0.
 * Các con số kỳ vọng khớp kịch bản SQL scripts/sql/doi-test/tra-hang.sql.
 */

const TRANG_THAI = ["draft", "submitted", "completed", "cancelled"] as const

describe("hanhDongPhieuTra — ma trận đủ trạng thái × loại phiếu", () => {
  const tuSinh = { credit_with_invoice: true, order_id: "o1", invoice_id: "i1" }
  const tuLapDocLap = { credit_with_invoice: false, order_id: null, invoice_id: null }
  const tuLapGanHd = { credit_with_invoice: false, order_id: null, invoice_id: "i1" }
  const theoDon = { credit_with_invoice: false, order_id: "o1", invoice_id: null }

  it("đã huỷ: mọi loại phiếu không còn nút nào, không lý do", () => {
    for (const base of [tuSinh, tuLapDocLap, tuLapGanHd, theoDon]) {
      expect(hanhDongPhieuTra({ ...base, status: "cancelled" })).toEqual({ hoanThanh: false, huy: false, sua: false, lyDo: null })
      expect(hanhDongPhieuTra({ ...base, status: "cancelled" }, 0)).toEqual({ hoanThanh: false, huy: false, sua: false, lyDo: null })
    }
  })

  it("tự sinh Chờ xử lý: chỉ Hoàn thành; KHÔNG huỷ, KHÔNG sửa; lý do chỉ sang sửa hóa đơn", () => {
    expect(hanhDongPhieuTra({ ...tuSinh, status: "submitted" })).toEqual({ hoanThanh: true, huy: false, sua: false, lyDo: LY_DO_TU_SINH })
    // biết số dòng (> 0) cũng không đổi
    expect(hanhDongPhieuTra({ ...tuSinh, status: "submitted" }, 3)).toEqual({ hoanThanh: true, huy: false, sua: false, lyDo: LY_DO_TU_SINH })
  })

  it("tự sinh đã nhập kho: huỷ = về Chờ xử lý ('ve_cho'), không Hoàn thành lại, không sửa", () => {
    expect(hanhDongPhieuTra({ ...tuSinh, status: "completed" })).toEqual({ hoanThanh: false, huy: "ve_cho", sua: false, lyDo: LY_DO_TU_SINH })
  })

  it("tự sinh nháp (bị bỏ hết dòng khi sửa HĐ, mig 213): rỗng → huỷ được; còn dòng / chưa biết → khoá hết", () => {
    expect(hanhDongPhieuTra({ ...tuSinh, invoice_id: null, status: "draft" }, 0)).toEqual({ hoanThanh: false, huy: "huy", sua: false, lyDo: LY_DO_RONG })
    expect(hanhDongPhieuTra({ ...tuSinh, invoice_id: null, status: "draft" }, 2)).toMatchObject({ hoanThanh: false, huy: false, sua: false })
    expect(hanhDongPhieuTra({ ...tuSinh, invoice_id: null, status: "draft" })).toMatchObject({ huy: false })
  })

  it("tự lập độc lập: Nháp → Hoàn thành / Huỷ / Sửa; Hoàn thành → Huỷ + Sửa (kể cả tiền đã thu)", () => {
    expect(hanhDongPhieuTra({ ...tuLapDocLap, status: "draft" })).toEqual({ hoanThanh: true, huy: "huy", sua: true, lyDo: null })
    expect(hanhDongPhieuTra({ ...tuLapDocLap, status: "completed" })).toEqual({ hoanThanh: false, huy: "huy", sua: true, lyDo: null })
  })

  it("tự lập gắn HĐ: cùng luật tự lập; huỷ là 'huy' chứ không bao giờ 've_cho'", () => {
    for (const st of TRANG_THAI) {
      const h = hanhDongPhieuTra({ ...tuLapGanHd, status: st })
      expect(h.huy).not.toBe("ve_cho")
    }
    expect(hanhDongPhieuTra({ ...tuLapGanHd, status: "draft" }, 0)).toMatchObject({ hoanThanh: true, huy: "huy", sua: true })
  })

  it("'submitted' cũ của phiếu tự lập (trước mig 191) được xử như Nháp", () => {
    expect(hanhDongPhieuTra({ ...tuLapDocLap, status: "submitted" })).toEqual({ hoanThanh: true, huy: "huy", sua: true, lyDo: null })
  })

  it("hàng trả nháp đi theo ĐƠN chưa xuất HĐ: khoá, chỉ sang sửa đơn", () => {
    expect(laNhapTheoDon({ ...theoDon, status: "draft" })).toBe(true)
    expect(laNhapTheoDon({ ...theoDon, status: "completed" })).toBe(false)
    expect(laNhapTheoDon({ ...theoDon, status: "draft", credit_with_invoice: true })).toBe(false)
    expect(hanhDongPhieuTra({ ...theoDon, status: "draft" })).toEqual({ hoanThanh: false, huy: false, sua: false, lyDo: LY_DO_THEO_DON })
  })

  it("laPhieuTuSinh chỉ đúng khi cờ là true (null / undefined / false = tự lập)", () => {
    expect(laPhieuTuSinh({ status: "draft", credit_with_invoice: true })).toBe(true)
    expect(laPhieuTuSinh({ status: "draft", credit_with_invoice: null })).toBe(false)
    expect(laPhieuTuSinh({ status: "draft" })).toBe(false)
  })

  it("bất biến: 'Chờ xử lý' chỉ có ở tự sinh — không trạng thái nào của tự lập trả về 've_cho'; tự sinh không bao giờ 'sua'", () => {
    for (const st of TRANG_THAI) {
      for (const n of [undefined, 0, 1]) {
        expect(hanhDongPhieuTra({ ...tuLapDocLap, status: st }, n).huy).not.toBe("ve_cho")
        expect(hanhDongPhieuTra({ ...tuSinh, status: st }, n).sua).toBe(false)
      }
    }
  })
})

describe("duongSuaPhieuTra — nút Sửa đi đâu", () => {
  it("tự sinh → sửa hóa đơn; tự sinh mất HĐ → không có nút", () => {
    expect(duongSuaPhieuTra({ id: "r1", status: "submitted", credit_with_invoice: true, invoice_id: "i9" })).toEqual({ href: "/sales-invoices/i9/edit", nhan: "Sửa hóa đơn" })
    expect(duongSuaPhieuTra({ id: "r1", status: "draft", credit_with_invoice: true, invoice_id: null })).toBeNull()
  })
  it("nháp theo đơn → sửa đơn ở POS", () => {
    expect(duongSuaPhieuTra({ id: "r1", status: "draft", order_id: "o7", invoice_id: null })).toEqual({ href: "/pos/don-hang/o7", nhan: "Sửa đơn" })
  })
  it("tự lập (nháp / đã hoàn thành) → POS sửa phiếu; đã huỷ → null", () => {
    expect(duongSuaPhieuTra({ id: "r2", status: "draft" })).toEqual({ href: "/pos/tra-hang/r2", nhan: "Sửa" })
    expect(duongSuaPhieuTra({ id: "r2", status: "completed", invoice_id: "i1" })).toEqual({ href: "/pos/tra-hang/r2", nhan: "Sửa" })
    expect(duongSuaPhieuTra({ id: "r2", status: "cancelled", credit_with_invoice: true, invoice_id: "i1" })).toBeNull()
  })
})

describe("sửa HĐ có phiếu tự sinh đã nhập kho (mig 210/216)", () => {
  const ds = [
    { id: "a", status: "completed", invoice_id: "i1", credit_with_invoice: true },
    { id: "b", status: "completed", invoice_id: "i1", credit_with_invoice: false }, // tự lập — không hỏi
    { id: "c", status: "submitted", invoice_id: "i1", credit_with_invoice: true }, // chưa nhập
    { id: "d", status: "completed", invoice_id: "i2", credit_with_invoice: true }, // tờ khác
    { id: "e", status: "completed", invoice_id: "i1", credit_with_invoice: null },
  ]
  it("chỉ hỏi cho phiếu TỰ SINH đã nhập kho của ĐÚNG tờ đang sửa", () => {
    expect(phieuDaNhapCuaHoaDon(ds, "i1").map((r) => r.id)).toEqual(["a"])
    expect(phieuDaNhapCuaHoaDon(ds, null)).toEqual([])
    expect(laDaNhapTuSinh(ds[4], "i1")).toBe(false)
  })
  it("traSuaDuoc: Chờ xử lý / Nháp của tờ sửa được; đã nhập chỉ sửa được khi chọn 'lam_lai' (Có)", () => {
    expect(traSuaDuoc(ds[2], "i1", null)).toBe(true)
    expect(traSuaDuoc(ds[0], "i1", null)).toBe(false)
    expect(traSuaDuoc(ds[0], "i1", "giu")).toBe(false)
    expect(traSuaDuoc(ds[0], "i1", "lam_lai")).toBe(true)
    // tự lập đã hoàn thành: chọn Có cũng không mở khoá (máy chủ chỉ huỷ nhập phiếu tự sinh)
    expect(traSuaDuoc(ds[1], "i1", "lam_lai")).toBe(false)
    // phiếu của tờ khác
    expect(traSuaDuoc({ id: "x", status: "submitted", invoice_id: "i2" }, "i1", null)).toBe(false)
    // đơn chưa có HĐ (màn sửa đơn): nháp chưa gắn HĐ sửa được, đã gắn thì không
    expect(traSuaDuoc({ id: "x", status: "draft", invoice_id: null }, null, null)).toBe(true)
    expect(traSuaDuoc({ id: "x", status: "draft", invoice_id: "i1" }, null, null)).toBe(false)
    expect(traSuaDuoc({ id: "x", status: "cancelled", invoice_id: "i1" }, "i1", "lam_lai")).toBe(false)
  })
})

describe("loiNgayNhap — ngày nhập kho phiếu tự sinh (mig 211, cùng luật máy chủ)", () => {
  it("rỗng / sai định dạng → bắt chọn", () => {
    expect(loiNgayNhap("", "2026-10-04")).toBe("Chọn ngày nhập kho")
    expect(loiNgayNhap("04/10/2026", "2026-10-04")).toBe("Chọn ngày nhập kho")
    expect(loiNgayNhap("2026-10-4", "2026-10-04")).toBe("Chọn ngày nhập kho")
  })
  it("biên: đúng hôm nay & đúng ngày HĐ được; ngày mai / trước HĐ một ngày bị chặn", () => {
    expect(loiNgayNhap("2026-10-04", "2026-10-04", "2026-10-01")).toBeNull()
    expect(loiNgayNhap("2026-10-01", "2026-10-04", "2026-10-01")).toBeNull()
    expect(loiNgayNhap("2026-10-05", "2026-10-04", "2026-10-01")).toBe("Ngày nhập kho không được sau hôm nay")
    expect(loiNgayNhap("2026-09-30", "2026-10-04", "2026-10-01")).toBe("Ngày nhập kho không được trước ngày hóa đơn")
  })
  it("qua năm / qua tháng so chuỗi vẫn đúng; không có ngày HĐ thì chỉ chặn tương lai", () => {
    expect(loiNgayNhap("2025-12-31", "2026-01-01", "2025-12-31")).toBeNull()
    expect(loiNgayNhap("2026-01-02", "2026-01-01")).toBe("Ngày nhập kho không được sau hôm nay")
    expect(loiNgayNhap("2020-01-01", "2026-01-01", null)).toBeNull()
  })
})

describe("explainReturnError — mã máy chủ ra câu tiếng Việt", () => {
  it("các mã của luật tự sinh / tự lập lấy đúng phần sau dấu hai chấm", () => {
    expect(explainReturnError("RETURN_FOLLOWS_INVOICE: phiếu trả tự sinh theo hóa đơn — muốn bỏ hàng trả thì sửa hóa đơn"))
      .toBe("phiếu trả tự sinh theo hóa đơn — muốn bỏ hàng trả thì sửa hóa đơn")
    expect(explainReturnError("RETURN_LOCKED: phiếu trả đã huỷ — không sửa được")).toBe("phiếu trả đã huỷ — không sửa được")
    expect(explainReturnError("NGAY_NHAP_TRUOC_HOA_DON: ngày nhập kho 30/09/2026 trước ngày hóa đơn 01/10/2026"))
      .toBe("ngày nhập kho 30/09/2026 trước ngày hóa đơn 01/10/2026")
    expect(explainReturnError("FORBIDDEN: bạn không có quyền hoàn thành đơn trả")).toBe("bạn không có quyền hoàn thành đơn trả")
    expect(explainReturnError("RETURN_NOT_CANCELLABLE: phiếu ở trạng thái cancelled không huỷ được")).toBe("phiếu ở trạng thái cancelled không huỷ được")
  })
  it("mã không kèm câu → câu cố định; mã lạ trả nguyên văn", () => {
    expect(explainReturnError("RETURN_NOT_SUBMITTED: phiếu trả không ở Phiếu tạm")).toContain("Tải lại trang")
    expect(explainReturnError("BAD_ZONE: x")).toBe("Phải chọn kho nhận: kho bán hoặc kho cận date.")
    expect(explainReturnError("CUSTOMER_NOT_FOUND: x")).toBe("Không tìm thấy khách hàng.")
    expect(explainReturnError("XYZ_LA: gì đó")).toBe("XYZ_LA: gì đó")
    expect(explainReturnError("")).toBe("")
  })
})

/** Supabase giả: ghi lại lời gọi RPC, trả lời theo kịch bản. */
function sbGia(tra: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const goi: Array<{ fn: string; args: Record<string, unknown> }> = []
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      goi.push({ fn, args })
      return { data: tra.data ?? null, error: tra.error ?? null }
    },
  } as unknown as SupabaseClient
  return { sb, goi }
}

describe("completeReturn / cancelReturn — tham số gửi lên RPC", () => {
  it("không chọn ngày → KHÔNG gửi p_ngay (máy chủ lấy hôm nay); đọc entry_id từ mảng RETURNS TABLE", async () => {
    const { sb, goi } = sbGia({ data: [{ entry_id: "e1" }] })
    expect(await completeReturn(sb, "r1", "sale")).toBe("e1")
    expect(goi).toEqual([{ fn: "complete_return", args: { p_return_id: "r1", p_zone: "sale" } }])
  })
  it("chọn ngày (tự sinh) → gửi p_ngay; data rỗng → null", async () => {
    const { sb, goi } = sbGia({ data: [] })
    expect(await completeReturn(sb, "r1", "date", "2026-10-02")).toBeNull()
    expect(goi[0].args).toEqual({ p_return_id: "r1", p_zone: "date", p_ngay: "2026-10-02" })
  })
  it("lỗi máy chủ → ném câu đã dịch", async () => {
    const { sb } = sbGia({ error: { message: "RETURN_FOLLOWS_INVOICE: muốn bỏ hàng trả thì sửa hóa đơn" } })
    await expect(cancelReturn(sb, "r1", "x")).rejects.toThrow("muốn bỏ hàng trả thì sửa hóa đơn")
  })
  it("huỷ gửi đúng lý do", async () => {
    const { sb, goi } = sbGia({})
    await cancelReturn(sb, "r9", "khách lấy lại")
    expect(goi).toEqual([{ fn: "cancel_return", args: { p_return_id: "r9", p_reason: "khách lấy lại" } }])
  })
})

describe("khoản trừ trên hóa đơn — bản sao luật _wf2b_recompute_receivable", () => {
  it("tự sinh trừ từ lúc Chờ xử lý; tự lập chỉ khi hoàn thành; huỷ / nháp không trừ", () => {
    expect(creditCounted({ status: "submitted", credit_with_invoice: true })).toBe(true)
    expect(creditCounted({ status: "completed", credit_with_invoice: true })).toBe(true)
    expect(creditCounted({ status: "draft", credit_with_invoice: true })).toBe(false)
    expect(creditCounted({ status: "cancelled", credit_with_invoice: true })).toBe(false)
    expect(creditCounted({ status: "submitted", credit_with_invoice: false })).toBe(false)
    expect(creditCounted({ status: "draft" })).toBe(false)
    expect(creditCounted({ status: "completed" })).toBe(true)
  })
  it("HĐ 700.000: tự sinh Chờ xử lý 120.000 + tự lập hoàn thành 20.000 + tự lập nháp 50.000 → trừ 140.000, còn 560.000 (C3)", () => {
    const c = creditOnInvoice([
      { status: "submitted", credit_with_invoice: true, credit_note_amount: 120000 },
      { status: "completed", credit_with_invoice: false, credit_note_amount: 20000 },
      { status: "draft", credit_with_invoice: false, credit_note_amount: 50000 },
      { status: "cancelled", credit_with_invoice: false, credit_note_amount: 999 },
    ])
    expect(c).toBe(140000)
    expect(netDueOnInvoice(700000, c)).toBe(560000)
  })
  it("trả vượt: còn phải thu ÂM, không kẹp 0 (mig 186) — HĐ 700.000 trả 840.000 = −140.000 (C1)", () => {
    expect(netDueOnInvoice(700000, creditOnInvoice([{ status: "completed", credit_note_amount: 840000 }]))).toBe(-140000)
  })
  it("credit_note_amount null / chuỗi số", () => {
    expect(creditOnInvoice([{ status: "completed", credit_note_amount: null }])).toBe(0)
    expect(creditOnInvoice([{ status: "completed", credit_note_amount: "198000" as unknown as number }])).toBe(198000)
  })
})

describe("tiền phiếu trả ở POS", () => {
  it("hàng đổi không vào tiền; phí % tính trên hàng trả; kẹp 0 khi phí > tiền", () => {
    const t = returnTotals({
      lines: [{ qty: 2, price: 120000 }, { qty: 3, price: 8000, isExchange: true }],
      fee: { value: 10, unit: "pct" },
    })
    expect(t.goodsReturned).toBe(240000)
    expect(t.exchangeValue).toBe(24000)
    expect(t.fee).toBe(24000)
    expect(t.dueToCustomer).toBe(216000)
    expect(t.returnQty).toBe(2)
    expect(t.exchangeQty).toBe(3)
    expect(returnTotals({ lines: [{ qty: 1, price: 10000 }], fee: { value: 50000, unit: "vnd" } }).dueToCustomer).toBe(0)
  })
  it("nợ sau trả không kẹp 0 (dư có); nợ chưa đọc được → null", () => {
    expect(debtAfterReturn(100000, 240000)).toBe(-140000)
    expect(debtAfterReturn(0, 120000)).toBe(-120000)
    expect(debtAfterReturn(null, 120000)).toBeNull()
    expect(debtAfterReturn(undefined, 120000)).toBeNull()
  })
  it("câu kho nói cả hai chiều; phiếu rỗng không có câu", () => {
    const t = returnTotals({ lines: [{ qty: 2, price: 1 }, { qty: 3, price: 1, isExchange: true }] })
    expect(warehouseSentence(t, "Kho bán")).toBe("Ghi nhận sẽ nhập 2 sản phẩm vào Kho bán và xuất 3 sản phẩm hàng đổi khỏi Kho bán trong cùng một giao dịch.")
    expect(warehouseSentence(returnTotals({ lines: [] }))).toBeNull()
  })
})

describe("savePosReturn — tải trọng gửi save_pos_return", () => {
  const dong = (o: Partial<PosLine>): PosLine => ({
    key: Math.random().toString(36), productId: "p1", sku: "S", name: "SP", unit: "thung", units: [],
    qty: 1, price: 120000, discount: { value: 0, unit: "vnd" }, ...o,
  }) as PosLine

  it("bỏ dòng SL 0 / âm / thiếu SP; không gửi line_total (máy chủ tự tính); ngày rỗng → null", async () => {
    const { sb, goi } = sbGia({ data: "r-moi" })
    const kq = await savePosReturn(sb, {
      returnId: null, orgId: "org", userId: "u", customerId: "c1", invoiceId: undefined, reason: "", notes: "",
      returnDate: "", complete: true, zone: "date",
      lines: [dong({ qty: 2, vatRate: 0.1 }), dong({ qty: 0 }), dong({ qty: -3 }), dong({ productId: "" }),
        dong({ productId: "p3", unit: "chai", qty: 3, price: 8000, isExchange: true, reason: "damaged" })],
    })
    expect(kq).toEqual({ returnId: "r-moi" })
    expect(goi).toHaveLength(1)
    const p = goi[0].args.p as Record<string, unknown> & { lines: Array<Record<string, unknown>> }
    expect(goi[0].fn).toBe("save_pos_return")
    expect(p).toMatchObject({ return_id: null, customer_id: "c1", invoice_id: null, reason: null, notes: null, return_date: null, complete: true, zone: "date" })
    expect(p.lines).toHaveLength(2)
    expect(p.lines[0]).toMatchObject({ product_id: "p1", unit_name: "thung", quantity: 2, unit_price: 120000, vat_rate: 0.1, is_exchange: false })
    expect(p.lines[1]).toMatchObject({ product_id: "p3", is_exchange: true })
    // dòng đổi không mang lý do trả; không dòng nào mang line_total / return_id
    expect(p.lines[1]).not.toHaveProperty("reason")
    for (const l of p.lines) {
      expect(l).not.toHaveProperty("line_total")
      expect(l).not.toHaveProperty("return_id")
    }
  })

  it("sửa phiếu: gửi return_id + ngày chứng từ cũ (không để máy chủ đổi sang hôm nay)", async () => {
    const { sb, goi } = sbGia({ data: "r1" })
    await savePosReturn(sb, {
      returnId: "r1", orgId: "org", userId: "u", customerId: "c1", invoiceId: "i1", reason: "damaged", notes: "n",
      returnDate: "2026-09-25", complete: false, zone: "sale", lines: [dong({})],
    })
    expect(goi[0].args.p).toMatchObject({ return_id: "r1", invoice_id: "i1", return_date: "2026-09-25", reason: "damaged", complete: false })
  })

  it("máy chủ chặn (sửa phiếu tự sinh) → ném câu tiếng Việt, không lùi sang đường ghi thẳng", async () => {
    const { sb, goi } = sbGia({ error: { message: "RETURN_FOLLOWS_INVOICE: phiếu trả tự sinh theo hóa đơn — muốn sửa thì sửa hóa đơn", code: "P0001" } })
    await expect(savePosReturn(sb, {
      returnId: "r1", orgId: "org", userId: "u", customerId: "c1", reason: "", notes: "", complete: true, zone: "sale", lines: [dong({})],
    })).rejects.toThrow("muốn sửa thì sửa hóa đơn")
    expect(goi).toHaveLength(1)
  })
})

describe("tên phiếu trả", () => {
  it("có mã TH- thì hiện mã; không có thì 'Phiếu trả'", () => {
    expect(tenPhieuTra("TH-0001")).toBe("TH-0001")
    expect(tenPhieuTra(null)).toBe("Phiếu trả")
    expect(tenPhieuTra("")).toBe("Phiếu trả")
  })
})
