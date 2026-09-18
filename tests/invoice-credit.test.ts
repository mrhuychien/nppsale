import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  creditOnInvoice, netDueOnInvoice, showCreditOnPrint, type InvoiceReturnRow,
} from "../src/lib/orders/invoice-credit"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

/**
 * HÀNG TRẢ TRỪ TIỀN TRÊN HÓA ĐƠN.
 *
 * Chủ nhà hỏi: "hàng trả trừ tiền không xuất hiện trên hoá đơn à?" —
 * đúng, và có chủ ý. `_wf2b_recompute_receivable` để
 * `sales_invoices.total` NGUYÊN VẸN và chỉ tính
 *
 *     nợ phải thu = tổng hóa đơn − tổng phiếu trả ĐÃ HOÀN THÀNH
 *
 * Nhưng màn chi tiết trước đây chỉ hiện tổng, nên người mở tờ hóa đơn ra
 * nhìn 10.000.000 mà sổ ghi 9.200.000 và không có gì giải thích chênh
 * lệch. Giờ hiện thêm hai dòng — trên MÀN và trên BẢN IN.
 */
const ret = (o: Partial<InvoiceReturnRow> = {}): InvoiceReturnRow => ({
  id: "r1", status: "completed", credit_note_amount: 800_000, ...o,
})

describe("khoản trừ hàng trả", () => {
  /**
   * ⚠ CHỈ PHIẾU ĐÃ HOÀN THÀNH MỚI TRỪ. Phiếu còn nháp / đã gửi thì hàng
   * chưa về kho và công nợ chưa đổi — hiện nó như đã trừ là báo cho kế
   * toán một con số chưa có thật.
   */
  it("chỉ cộng phiếu đã hoàn thành", () => {
    expect(creditOnInvoice([ret()])).toBe(800_000)
    expect(creditOnInvoice([ret({ status: "draft" })])).toBe(0)
    expect(creditOnInvoice([ret({ status: "submitted" })])).toBe(0)
    expect(creditOnInvoice([ret({ status: "cancelled" })])).toBe(0)
  })

  it("cộng nhiều phiếu", () => {
    expect(creditOnInvoice([ret(), ret({ id: "r2", credit_note_amount: 200_000 })])).toBe(1_000_000)
  })

  /** ⚠ Số âm hoặc rỗng không được kéo tổng xuống. */
  it("số rỗng hoặc âm coi như 0", () => {
    expect(creditOnInvoice([ret({ credit_note_amount: null })])).toBe(0)
    expect(creditOnInvoice([ret({ credit_note_amount: -500 })])).toBe(0)
  })
})

describe("còn phải thu", () => {
  it("trừ bình thường", () => {
    expect(netDueOnInvoice(10_000_000, 800_000)).toBe(9_200_000)
  })

  /**
   * ⚠ KẸP GIỐNG HỆT RPC. `_wf2b_recompute_receivable` ghi `GREATEST(0,…)`;
   * màn hiện số âm là nói khác sổ, và người đọc tưởng nhà phân phối đang
   * nợ ngược khách trên chính tờ hóa đơn này.
   */
  it("trả nhiều hơn hóa đơn thì về 0, không âm", () => {
    expect(netDueOnInvoice(1_000_000, 1_500_000)).toBe(0)
  })
})

describe("bản in", () => {
  /**
   * ⚠ ĐÃ PHÁT HÀNH HÓA ĐƠN ĐIỆN TỬ THÌ KHÔNG IN DÒNG TRỪ. Tờ in phải
   * khớp từng con số với tờ đã gửi cơ quan thuế; thêm một dòng là hai tờ
   * cùng một số hóa đơn mang hai con số khác nhau. Chủ nhà chốt hiện
   * trên bản in, nhưng chốt đó dừng lại ở đây.
   */
  it("hóa đơn đã phát hành điện tử thì không in dòng trừ", () => {
    expect(showCreditOnPrint({ credit: 800_000, eInvoiceIssued: true })).toBe(false)
    expect(showCreditOnPrint({ credit: 800_000, eInvoiceIssued: false })).toBe(true)
  })

  /** ⚠ In "Trừ hàng trả: 0" là thêm một dòng không nói gì vào tờ giấy đã chật. */
  it("không có khoản trừ thì không in", () => {
    expect(showCreditOnPrint({ credit: 0, eInvoiceIssued: false })).toBe(false)
  })
})

describe("mẫu in và màn chi tiết", () => {
  const PRINT = read("src/components/printing/sales-invoice.tsx")
  const DETAIL = read("src/app/(dashboard)/sales-invoices/[id]/page.tsx")
  const PRINT_PAGE = read("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx")

  /**
   * ⚠ "TỔNG CỘNG" KHÔNG ĐỔI. Nó là giá trị lô hàng đã giao — thứ tờ hóa
   * đơn chứng nhận. Trừ thẳng vào đó là sửa một chứng từ đã phát hành.
   */
  it("mẫu in giữ nguyên Tổng cộng, thêm hai dòng dưới", () => {
    expect(PRINT).toContain("{formatCurrency(total)}")
    expect(PRINT).toContain("{returnCredit > 0 && (")
    expect(PRINT).toContain("Trừ hàng trả")
    expect(PRINT).toContain("Còn phải thu")
  })

  /**
   * ⚠ BẰNG CHỮ ĐỌC SỐ PHẢI TRẢ, không đọc tổng hóa đơn. Người cầm tờ
   * giấy đi thu tiền đọc đúng dòng đó.
   */
  it("dòng bằng chữ đọc số còn phải thu", () => {
    expect(PRINT).toContain("numberToVietnameseWords(netDue)")
    expect(PRINT).not.toContain("numberToVietnameseWords(total)")
  })

  it("màn chi tiết hiện khoản trừ và số còn phải thu", () => {
    expect(DETAIL).toContain("{returnCredit > 0 && (")
    expect(DETAIL).toContain('label="Trừ hàng trả"')
    expect(DETAIL).toContain('label="Còn phải thu"')
  })

  /**
   * ⚠ PHIẾU CHƯA HOÀN THÀNH CHƯA TRỪ GÌ — nói ra để người đi đòi tiền
   * không đòi nhầm một số sắp thay đổi.
   */
  it("màn chi tiết nói ra khi còn phiếu trả chưa hoàn thành", () => {
    expect(DETAIL).toContain("{pendingReturns > 0 && (")
    expect(DETAIL).toContain("chưa hoàn thành")
  })

  it("màn in đi qua showCreditOnPrint, không tự quyết", () => {
    expect(PRINT_PAGE).toContain("showCreditOnPrint({")
    expect(PRINT_PAGE).toContain("eInvoiceIssued,")
  })
})
