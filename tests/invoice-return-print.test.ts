import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * HÀNG ĐỔI / TRẢ Ở BA CHỖ CHỦ NHÀ NÊU:
 *   1. Màn soạn hóa đơn chưa hiện khoản trừ.
 *   2. Huỷ hóa đơn phải đưa phiếu trả về NHÁP (mig 135).
 *   3. Mẫu in ghi rõ "(Hàng đổi)/(Hàng trả)" và cộng trừ luôn trên phiếu.
 * Kèm hai việc nhắn sau: phiếu thu thiếu nút huỷ, và khoản nợ phải gọi
 * theo mã HÓA ĐƠN.
 */
const EDITOR = readFileSync("src/components/orders/invoice-editor.tsx", "utf8")
const PRINT = readFileSync("src/components/printing/sales-invoice.tsx", "utf8")
const PRINT_PAGE = readFileSync("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx", "utf8")
const MIG135 = readFileSync("supabase/migrations/135_cancel_invoice_returns_to_draft.sql", "utf8")
const RECEIPT = readFileSync("src/app/(dashboard)/finance/cash-receipts/[id]/page.tsx", "utf8")
const NEWRECEIPT = readFileSync("src/app/(dashboard)/finance/cash-receipts/new/page.tsx", "utf8")

describe("màn soạn hóa đơn hiện khoản trừ hàng trả", () => {
  /**
   * ⚠ NGƯỜI BẤM "XUẤT HÀNG" ĐỌC CON SỐ NÀY CHO KHÁCH. Từ mig 133 khoản
   * trừ vào công nợ ngay khi ghi sổ; chỉ hiện "Tổng cộng" là đọc cho khách
   * một số cao hơn số sẽ ghi vào sổ, đúng bằng khoản trừ.
   */
  it("có dòng Trừ hàng trả và dòng Khách phải trả", () => {
    expect(EDITOR).toContain("Trừ hàng trả")
    expect(EDITOR).toContain("Khách phải trả")
    expect(EDITOR).toContain("Math.max(0, totals.total - retCredit)")
  })

  /** ⚠ Thanh đáy là chỗ ngón tay dừng lại — nó cũng phải nói số thật. */
  it("thanh đáy hiện số khách phải trả, không hiện tổng gộp", () => {
    const bar = EDITOR.slice(EDITOR.indexOf("fixed inset-x-0 bottom-0"))
    expect(bar).toContain("Math.max(0, totals.total - retCredit)")
    expect(bar).toContain("đã trừ")
  })

  /** ⚠ Phiếu đã huỷ không trừ gì — hiện nó là báo khoản giảm không có thật. */
  it("bỏ phiếu trả đã huỷ", () => {
    expect(EDITOR).toContain('.neq("status", "cancelled")')
  })

  /** ⚠ Dòng ĐỔI không trừ tiền — trộn chung là cộng nhầm số khách phải trả. */
  it("tách dòng ĐỔI khỏi dòng TRẢ", () => {
    expect(EDITOR).toContain('l.isExchange ? "ĐỔI" : "TRẢ"')
    expect(EDITOR).toContain('l.isExchange ? "không trừ"')
    expect(EDITOR).toContain("credit: l.is_exchange ? 0 :")
  })
})

describe("mẫu in ghi rõ hàng đổi / hàng trả", () => {
  it("ghi nhãn ngay đầu tên hàng", () => {
    expect(PRINT).toContain('{l.isExchange ? "(Hàng đổi) " : "(Hàng trả) "}')
  })

  /** ⚠ Bắt đầu lại từ 1 là tờ giấy có hai dòng cùng số thứ tự. */
  it("đánh số tiếp từ bảng hàng bán", () => {
    expect(PRINT).toContain("{rows.length + i + 1}")
  })

  /** ⚠ Số 0 trong cột tiền đọc như lỗi nhập; chữ nói rõ đổi không trừ tiền. */
  it("dòng đổi ghi chữ, không ghi số 0", () => {
    expect(PRINT).toContain('l.isExchange ? "không trừ" : `−${formatCurrency(l.credit)}`')
  })

  /**
   * ⚠ KHÔNG GỘP VÀO "TỔNG TIỀN HÀNG". Gộp là tờ hóa đơn chứng nhận đã bán
   * cả thứ khách vừa trả lại, và cột tiền không cộng ra được nữa.
   */
  it("không gộp vào tổng tiền hàng", () => {
    const goods = PRINT.slice(PRINT.indexOf("const goodsTotal"), PRINT.indexOf("const goodsTotal") + 200)
    expect(goods).not.toContain("returnLines")
  })

  /**
   * ⚠ CÙNG MỘT CÁI CỔNG VỚI KHOẢN TRỪ. Hóa đơn đã phát hành điện tử thì
   * tờ in phải khớp từng dòng với tờ đã gửi cơ quan thuế.
   */
  it("hóa đơn điện tử đã phát hành thì không in thêm dòng nào", () => {
    expect(PRINT_PAGE).toContain("const printReturnLines: SalesInvoiceReturnLine[] = printCredit")
    expect(PRINT_PAGE).toContain("invReturns.filter(creditCounted)")
  })
})

describe("migration 135 — huỷ hóa đơn thì phiếu trả về nháp", () => {
  it("hạ trạng thái về nháp", () => {
    expect(MIG135).toContain("status = CASE WHEN credit_with_invoice THEN ''draft'' ELSE status END")
  })

  /**
   * ⚠ CHỈ HẠ PHIẾU MÀ `post_invoice` ĐÃ NÂNG. Hạ bừa mọi phiếu 'submitted'
   * là xoá mất việc ai đó chủ động gửi một phiếu trả độc lập đi.
   */
  it("chỉ hạ phiếu mang dấu đi cùng hóa đơn", () => {
    expect(MIG135).toContain("WHEN credit_with_invoice THEN")
    expect(MIG135).toContain("ELSE status END")
  })

  it("dừng khi 131 hoặc 133 chưa chạy", () => {
    expect(MIG135).toContain("NEEDS_131")
    expect(MIG135).toContain("NEEDS_133")
  })

  /** ⚠ Thiếu vế này là hạ nhầm phiếu của một đơn đang có hóa đơn hiệu lực. */
  it("backfill loại đơn đang có hóa đơn đã ghi sổ", () => {
    const fix = MIG135.slice(MIG135.indexOf("DO $fix$"))
    expect(fix).toContain("WHERE si.order_id = ret.order_id AND si.status = 'posted'")
    expect(fix).toContain("ret.invoice_id IS NULL")
  })

  it("chạy lại thì đứng yên", () => {
    expect(MIG135).toContain("đã vá từ trước")
  })
})

describe("phiếu thu — nút huỷ và cách sửa", () => {
  /**
   * ⚠ ĐÂY LÀ LỖI CHỦ NHÀ BÁO. Nút huỷ nằm BÊN TRONG khối `canConfirm`, mà
   * `canConfirm` đòi `status === 'pending'` — phiếu vừa xác nhận xong là
   * nút biến mất, đúng lúc người ta phát hiện thu nhầm.
   */
  it("nút huỷ có điều kiện riêng, không đi kèm nút xác nhận", () => {
    expect(RECEIPT).toContain("const canVoid =")
    expect(RECEIPT).toContain("{(canConfirm || canVoid) && (")
    expect(RECEIPT).toContain("{canVoid && (")
  })

  /** ⚠ Hiện nút rộng hơn RPC là mời người dùng bấm vào thứ sẽ bị từ chối. */
  it("điều kiện khớp void_cash_receipt", () => {
    expect(RECEIPT).toContain('hasPermission(user.role, "receivables", "update")')
    expect(RECEIPT).toContain('["pending", "received"].includes(receipt?.status ?? "")')
  })

  /** ⚠ Không có nút sửa thì phải nói vì sao, và chỉ đường thay thế. */
  it("nói rõ vì sao không sửa trực tiếp được", () => {
    expect(RECEIPT).toContain("không sửa trực tiếp được")
    expect(RECEIPT).toContain("Lập phiếu thu mới")
  })
})

describe("khoản nợ gọi theo mã hóa đơn", () => {
  /**
   * ⚠ TỪ v2b MỖI HÓA ĐƠN MỘT DÒNG NỢ. Một đơn xuất hai đợt có HAI dòng nợ
   * cùng mang một mã `DH-xxxx`; kế toán nhìn hai dòng giống hệt nhau, số
   * tiền khác nhau, và không biết dòng nào là đợt nào.
   */
  it("hiện mã hóa đơn trước, mã đơn sau", () => {
    expect(NEWRECEIPT).toContain("function debtLabel(")
    expect(NEWRECEIPT).toContain("if (inv && ord) return `${inv} · ${ord}`")
    expect(NEWRECEIPT).toContain("return inv || ord ||")
    expect(NEWRECEIPT).not.toContain('r.order?.order_code || "Công nợ không gắn đơn"')
  })

  it("câu select có kéo mã hóa đơn về", () => {
    expect(NEWRECEIPT).toContain("invoice:sales_invoices(invoice_code)")
  })

  /** ⚠ Công nợ đầu kỳ không gắn chứng từ nào — nói thẳng, đừng để trống. */
  it("dòng không gắn chứng từ vẫn có nhãn", () => {
    expect(NEWRECEIPT).toContain('"Công nợ không gắn chứng từ"')
  })
})
