import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { reissueLock, reissuePaymentNote, invoiceEditTotals } from "../src/lib/pos/invoice-edit"

/**
 * MÀN 7 — SỬA HÓA ĐƠN ĐÃ GHI SỔ. Spec §6, §7.2.
 *
 * ⚠ ĐÂY LÀ MÀN ĐỨNG TRƯỚC MỘT BÚT TOÁN KHO VÀ MỘT TỜ HÓA ĐƠN ĐÃ PHÁT
 * HÀNH. Mọi câu chữ trên đó phải khớp với cơ chế THẬT, không phải với
 * cơ chế nghe hợp lý.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const vnd = (value: number) => ({ value, unit: "vnd" as const })
const pct = (value: number) => ({ value, unit: "pct" as const })

describe("vì sao chưa lập lại được", () => {
  /**
   * ⚠ ĐỔI LUẬT 24/09/2026 (mig 184) — chủ nhà chốt: "Hủy hóa đơn cũ và tạo hóa
   *   đơn mới · Tất cả các phiếu thanh toán của hóa đơn cũ sẽ được gắn với hóa
   *   đơn mới". Tiền thu KHÔNG còn khoá lập lại; `reissue_invoice` chuyển phiếu
   *   thu sang tờ mới trong cùng giao dịch. (Trước đó: LOCKED_HAS_PAYMENT.)
   */
  it("có tiền thu vẫn lập lại được — không khoá", () => {
    expect(reissueLock({ paidAmount: 1_500_000, receiptCount: 1, eInvoiceIssued: false })).toBeNull()
    expect(reissueLock({ paidAmount: 0, receiptCount: 1, eInvoiceIssued: false })).toBeNull()
  })

  it("có tiền thu thì NÓI RA là phiếu thu đi sang tờ mới, không bảo huỷ phiếu", () => {
    const c = reissuePaymentNote({ paidAmount: 1_500_000, receiptRefs: ["PT-0031"] })!
    expect(c).toContain("1.500.000")
    expect(c).toContain("PT-0031")
    expect(c).toContain("hóa đơn mới")
    expect(c).not.toMatch(/huỷ phiếu thu trước/i)
    expect(reissuePaymentNote({ paidAmount: 0, receiptRefs: [] })).toBeNull()
  })

  /** ⚠ Khoá hóa đơn điện tử vẫn còn — `LOCKED_EINVOICE` (mig 120). */
  it("phát hành hóa đơn điện tử thì khoá, và nói đúng mã", () => {
    expect(reissueLock({ paidAmount: 0, receiptCount: 0, eInvoiceIssued: true })?.code).toBe("LOCKED_EINVOICE")
    expect(reissueLock({ paidAmount: 1_500_000, receiptCount: 1, eInvoiceIssued: true })?.code).toBe("LOCKED_EINVOICE")
  })

  it("không hóa đơn điện tử thì lập lại được", () => {
    expect(reissueLock({ paidAmount: 0, receiptCount: 0, eInvoiceIssued: false })).toBeNull()
  })

  it("migration 184: chỉ reissue_invoice bật cờ bỏ khoá, và tự tắt; Huỷ HĐ trực tiếp vẫn khoá", () => {
    const m = read("supabase/migrations/184_lap_lai_hoa_don_chuyen_phieu_thu.sql")
    expect(m).toContain("npp.reissue_chuyen_thu")
    expect(m).toContain("LOCKED_HAS_PAYMENT")
    expect(m).toContain("PERFORM set_config(''npp.reissue_chuyen_thu'', '''', true);")
  })
})

describe("cộng tiền màn sửa hóa đơn", () => {
  /** Đúng bộ số của artboard 7. */
  const lines = [{ qty: 1, price: 2_568_000, discount: vnd(0) }]

  /**
   * ⚠ ĐO ĐÚNG BẢN THIẾT KẾ:
   *   2.568.000 − 128.400 = 2.439.600
   *   2.439.600 − 1.500.000 = 939.600
   *   939.600 − 528.000 = 411.600
   */
  it("ra đúng ba bậc của bản thiết kế", () => {
    const t = invoiceEditTotals({
      lines,
      docDiscount: pct(5),
      vatRate: 0,
      paid: 1_500_000,
      returnCredit: 528_000,
    })
    expect(t.docDiscount).toBe(128_400)
    expect(t.total).toBe(2_439_600)
    expect(t.remaining).toBe(939_600)
    expect(t.netDebt).toBe(411_600)
  })

  /**
   * ⚠ TỔNG HÓA ĐƠN KHÔNG TRỪ HÀNG TRẢ — giống màn 2 và giống
   * `_wf2b_recompute_receivable`. Tờ hóa đơn là chứng từ của lô hàng ĐÃ
   * GIAO; khoản trừ nằm ở bậc CÔNG NỢ, không nằm ở tổng.
   */
  it("tổng hóa đơn không bị hàng trả trừ vào", () => {
    const t = invoiceEditTotals({ lines, docDiscount: pct(5), returnCredit: 528_000 })
    expect(t.total).toBe(2_439_600)
    expect(t.total).not.toBe(2_439_600 - 528_000)
  })

  /** ⚠ Thuế tính trên số ĐÃ trừ giảm giá — thuế trên số chưa giảm là thu thuế phần không ai trả. */
  it("thuế tính trên số đã trừ giảm giá", () => {
    const t = invoiceEditTotals({ lines, docDiscount: pct(5), vatRate: 10 })
    expect(t.vat).toBe(243_960)
    expect(t.vat).not.toBe(256_800)
    expect(t.total).toBe(2_439_600 + 243_960)
  })

  /** ⚠ Thu nhiều hơn tổng thì còn lại về 0, không âm. */
  it("thu quá tổng thì còn lại về 0", () => {
    const t = invoiceEditTotals({ lines, paid: 9_000_000 })
    expect(t.remaining).toBe(0)
    expect(t.netDebt).toBe(0)
  })

  /** ⚠ Hàng trả lớn hơn phần còn lại thì công nợ ròng về 0, không âm. */
  it("hàng trả lớn hơn phần còn lại thì công nợ ròng về 0", () => {
    const t = invoiceEditTotals({ lines, paid: 2_400_000, returnCredit: 500_000 })
    expect(t.netDebt).toBe(0)
  })
})

/**
 * ⚠ CÂU CHỮ TRÊN MÀN PHẢI KHỚP CƠ CHẾ THẬT. Spec §7.2 chốt nguyên văn:
 * "Nội dung banner mô tả cơ chế đang có, không phải cơ chế mới."
 */
describe("câu chữ màn 7 không hứa điều phần mềm không làm", () => {
  const SCREEN = read("src/components/pos/invoice-screen.tsx")
  const code = SCREEN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

  /**
   * ⚠ KHÔNG ĐƯỢC HỨA "TIỀN ĐÃ THU GIỮ NGUYÊN QUA LẬP LẠI". Bản thiết
   * kế ghi thế, cơ chế thật thì CHẶN hẳn. Hứa sai ở đây là người dùng
   * bấm lưu rồi nhận `LOCKED_HAS_PAYMENT` mà không hiểu vì sao.
   */
  it("không nói tiền đã thu giữ nguyên qua lập lại", () => {
    expect(
      /GIỮ NGUYÊN QUA LẬP LẠI/i.test(code),
      "màn hứa tiền đã thu đi qua được lần lập lại — cơ chế thật thì chặn"
    ).toBe(false)
  })

  /** ⚠ Và phải chặn sớm: có khoá thì nút chính mờ, kèm lý do. */
  it("có khoá thì nút chính mờ và nói lý do", () => {
    expect(code).toContain("reissueLock")
    const i = code.indexOf('variant="primary"')
    expect(i, "không thấy nút chính").toBeGreaterThan(-1)
    const nut = code.slice(i, i + 320)
    expect(nut).toMatch(/disabled=\{[^}]*khoa/)
    expect(nut, "nút mờ mà không nói vì sao").toMatch(/title=/)
  })

  /**
   * ⚠ BANNER PHẢI NÓI ĐÚNG BA VIỆC CƠ CHẾ THẬT LÀM: huỷ tờ cũ, lập tờ
   * mới, TRONG MỘT GIAO DỊCH. Thiếu vế "một giao dịch" là người đọc
   * tưởng có lúc kho đã trừ mà hóa đơn chưa lập.
   */
  it("banner nói đủ huỷ · lập lại · một giao dịch", () => {
    expect(code).toContain("một giao dịch")
    expect(code).toMatch(/huỷ/i)
  })
})
