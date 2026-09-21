import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  creditOnInvoice, creditCounted, netDueOnInvoice, showCreditOnPrint,
  type InvoiceReturnRow,
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
   * PHIẾU TRẢ ĐỘC LẬP — luật cũ, vẫn đúng.
   *
   * ⚠ CHỈ TRỪ KHI HOÀN THÀNH. Phiếu còn nháp / đã gửi thì hàng chưa về
   * kho và công nợ chưa đổi — hiện nó như đã trừ là báo cho kế toán một
   * con số chưa có thật.
   */
  it("phiếu độc lập: chỉ cộng khi đã hoàn thành", () => {
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

  /**
   * PHIẾU ĐI CÙNG HÓA ĐƠN — luật chủ nhà chốt (mig 133).
   *
   * ⚠ TRỪ NGAY TỪ 'submitted'. Hàng đã đổi tay lúc NVBH giao và khách đã
   * trả tiền phần chênh; đợi thủ kho nhập kho mới trừ là sổ ghi khách nợ
   * đủ cả lô trong suốt quãng giữa, và kế toán đi đối chiếu thấy hai con
   * số khác nhau.
   */
  it("phiếu đi cùng hóa đơn: trừ ngay từ khi đã gửi", () => {
    const wi = { credit_with_invoice: true }
    expect(creditOnInvoice([ret({ ...wi, status: "submitted" })])).toBe(800_000)
    expect(creditOnInvoice([ret({ ...wi, status: "completed" })])).toBe(800_000)
  })

  /** ⚠ Nháp thì chưa xuất hóa đơn — chưa có gì để trừ vào. */
  it("phiếu đi cùng hóa đơn còn nháp thì chưa trừ", () => {
    expect(creditOnInvoice([ret({ credit_with_invoice: true, status: "draft" })])).toBe(0)
  })

  /** ⚠ Huỷ là huỷ, dù đi cùng hóa đơn hay không. */
  it("phiếu đã huỷ không trừ, kiểu nào cũng vậy", () => {
    expect(creditOnInvoice([ret({ credit_with_invoice: true, status: "cancelled" })])).toBe(0)
    expect(creditOnInvoice([ret({ credit_with_invoice: false, status: "cancelled" })])).toBe(0)
  })

  /** ⚠ Thiếu cột (máy chủ chưa chạy mig 133) thì rơi về luật cũ, không nổ. */
  it("thiếu cột thì coi như phiếu độc lập", () => {
    expect(creditCounted({ status: "submitted" })).toBe(false)
    expect(creditCounted({ status: "completed" })).toBe(true)
  })
})

describe("luật trừ của màn hình phải khớp luật của sổ", () => {
  /**
   * ⚠ ĐÂY LÀ CHỐT CHỐNG TRÔI. `creditCounted` là BẢN SAO bằng TypeScript
   * của câu WHERE trong `_wf2b_recompute_receivable` (mig 133). Hai bên
   * lệch nhau thì màn hình nói một số, sổ ghi một số — và không test nào
   * khác bắt được, vì mỗi bên tự nó đều đúng.
   */
  it("câu SQL của mig 133 vẫn mang đúng hai nhánh ấy", () => {
    const mig = read("supabase/migrations/133_return_credit_rides_invoice.sql")
    expect(mig).toContain("(r.credit_with_invoice AND r.status IN ('submitted', 'completed'))")
    expect(mig).toContain("(NOT r.credit_with_invoice AND r.status = 'completed')")

    const ts = read("src/lib/orders/invoice-credit.ts")
    expect(ts).toContain('r.status === "submitted" || r.status === "completed"')
    expect(ts).toContain('r.status === "completed"')
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

  /**
   * ⚠ HAI LUẬT NÀY NAY NẰM TRONG KHỐI DÙNG CHUNG `InvoiceMoneySummary`
   * (chủ nhà chốt 21/09/2026: ngăn xem nhanh cũng phải hiện đủ), và
   * `tests/cong-tien-hoa-don.test.ts` CHẠY THẬT khối ấy — cả dòng "Trừ
   * hàng trả / Còn phải thu" lẫn luật "chỉ nhắc phiếu CHƯA trừ".
   *
   * Ở đây chỉ còn canh đúng một điều: màn chi tiết không quay về tự
   * cộng lấy. Hai phép trừ cho cùng một tờ hóa đơn thì sẽ lệch nhau
   * đúng vào hôm có người sửa một bên.
   */
  it("màn chi tiết không tự cộng khoản trừ", () => {
    expect(DETAIL).toContain("<InvoiceMoneySummary")
    expect(/creditOnInvoice\s*\(/.test(DETAIL), "tự cộng lần thứ hai").toBe(false)
  })

  it("màn in đi qua showCreditOnPrint, không tự quyết", () => {
    expect(PRINT_PAGE).toContain("showCreditOnPrint({")
    expect(PRINT_PAGE).toContain("eInvoiceIssued,")
  })
})
