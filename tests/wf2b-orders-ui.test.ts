import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  explainInvoiceError,
  invoiceTotals,
  invoiceWarnings,
  shortageOf,
  type InvoiceDraftLine,
  type PostInvoiceResult,
} from "../src/lib/orders/post-invoice"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"
import { orderTone } from "../src/lib/orders/status-tone"
import { TERMINAL_STATUSES } from "../src/lib/orders/edit-permission"
import { ORDER_STATUS_MAP } from "../src/lib/constants"

/**
 * WORKFLOW V2B — P4: màn Đơn hàng + dialog Xuất hàng.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const LIST = read("src/app/(dashboard)/orders/page.tsx")
const DETAIL = read("src/app/(dashboard)/orders/[id]/page.tsx")
const EDITOR = read("src/components/orders/invoice-editor.tsx")
const EDITOR_LIB = read("src/lib/orders/invoice-editor.ts")
const LIB = read("src/lib/orders/post-invoice.ts")

/** Bản đã lược chú thích — cho mọi chốt khẳng định một thứ KHÔNG có mặt. */
const strip = (s: string) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")

const line = (over: Partial<InvoiceDraftLine> = {}): InvoiceDraftLine => ({
  orderLineId: "l1",
  productId: "p1",
  unitName: "thùng",
  conversionFactor: 10,
  quantity: 3,
  unitPrice: 90_000,
  lineDiscount: 0,
  vatRate: 0.1,
  isExchange: false,
  note: null,
  ...over,
})

// =====================================================================

describe("invoiceTotals ra đúng con số mà SQL sẽ ghi", () => {
  /**
   * ⚠ MÀN HÌNH HIỆN MỘT SỐ, HÓA ĐƠN IN RA MỘT SỐ KHÁC thì không ai tin
   * được màn hình nữa. `post_invoice` làm tròn Ở TỔNG, và `total` làm
   * tròn tổng `subtotal + vat` CHƯA làm tròn.
   *
   * ⚠ CA NÀY PHÂN BIỆT ĐƯỢC HAI CÁCH, và phải thế mới có nghĩa. Hầu hết
   * bộ số cho ra cùng kết quả dù làm tròn ở đâu — chốt chạy trên một bộ
   * như vậy là chốt không nói gì. Ở đây hai phần thô đều lẻ đúng 0,5:
   *   tiền hàng thô 27,5 · thuế thô 2,5
   *   làm tròn RỜI rồi cộng → 28 + 3 = 31
   *   cộng rồi làm tròn      → round(30) = 30   ← đúng
   */
  it("total làm tròn tổng chưa làm tròn, không phải tổng hai số đã tròn", () => {
    const t = invoiceTotals([
      line({ quantity: 0.5, unitPrice: 5, vatRate: 0 }),    // 2,5 · thuế 0
      line({ quantity: 1, unitPrice: 25, vatRate: 0.1 }),   // 25   · thuế 2,5
    ])
    expect(t.subtotal).toBe(28) // round(27,5)
    expect(t.vat).toBe(3) // round(2,5)
    expect(t.total).toBe(30) // round(27,5 + 2,5)
    expect(t.total, "đang cộng hai số đã làm tròn").not.toBe(t.subtotal + t.vat)
  })

  it("tiền hàng và thuế mỗi cái làm tròn từ tổng thô của chính nó", () => {
    // 3 × 33.333 = 99.999 · thuế 10% = 9.999,9
    const t = invoiceTotals([line({ quantity: 3, unitPrice: 33_333 })])
    expect(t.subtotal).toBe(99_999)
    expect(t.vat).toBe(10_000)
    expect(t.total).toBe(109_999)
  })

  /**
   * ⚠ CÙNG CÔNG THỨC VỚI GIỎ HÀNG. Hai nơi cộng tiền của cùng một dãy
   * dòng mà ra hai số là chỗ lệch không ai phát hiện bằng mắt.
   */
  it("khớp cartTotals trên cùng bộ số", () => {
    const rows = [
      { qty: 3, price: 90_000, vatRate: 0.1 },
      { qty: 2, price: 33_333, vatRate: 0.08 },
      { qty: 1.5, price: 12_345, vatRate: 0 },
    ]
    const mine = invoiceTotals(
      rows.map((r) => line({ quantity: r.qty, unitPrice: r.price, vatRate: r.vatRate }))
    )
    const theirs = cartTotals(
      rows.map(
        (r): CartLine => ({
          productId: "p", unit: "u", qty: r.qty, price: r.price,
          listPrice: r.price, note: "", conversion: 1, vatRate: r.vatRate,
        })
      )
    )
    expect(mine.subtotal).toBe(theirs.subtotal)
    expect(mine.vat).toBe(theirs.vat)
    expect(mine.total).toBe(theirs.grandTotal)
  })

  /** ⚠ KHÔNG trừ `lineDiscount`: chiết khấu đã nằm trong `unitPrice`. */
  it("không trừ chiết khấu lần nữa", () => {
    const a = invoiceTotals([line({ lineDiscount: 0 })])
    const b = invoiceTotals([line({ lineDiscount: 50_000 })])
    expect(b.total).toBe(a.total)
  })

  it("bỏ qua dòng số lượng 0 và số lượng âm", () => {
    expect(invoiceTotals([line({ quantity: 0 }), line({ quantity: -5 })]).total).toBe(0)
  })
})

// =====================================================================

describe("shortageOf quy về đơn vị cơ sở trước khi so", () => {
  /**
   * ⚠ SO THẲNG HAI CON SỐ LÀ SAI CẢ HAI CHIỀU. Dòng đặt "2 thùng" mà tồn
   * ghi "20 hộp" thì so thẳng ra "thừa 18" trong khi thực tế vừa đủ.
   */
  it("2 thùng × 10 với tồn 20 hộp là vừa đủ", () => {
    expect(shortageOf({ conversionFactor: 10, availableBase: 20 }, 2)).toBe(0)
  })

  it("3 thùng × 10 với tồn 20 hộp là thiếu 10 hộp", () => {
    expect(shortageOf({ conversionFactor: 10, availableBase: 20 }, 3)).toBe(10)
  })

  it("thừa hàng trả 0, không trả số âm", () => {
    expect(shortageOf({ conversionFactor: 1, availableBase: 100 }, 1)).toBe(0)
  })
})

// =====================================================================

describe("explainInvoiceError dịch đúng mã lỗi của RPC", () => {
  it.each([
    ["… ORDER_NOT_INVOICEABLE: đơn DH-1 đang ở trạng thái closed", "không còn xuất hàng được"],
    ["… NO_LINES: hóa đơn phải có ít nhất một dòng số lượng > 0", "Chưa chọn dòng nào"],
    ["… HAS_INVOICE: đơn DH-1 đã xuất 2 hóa đơn. Huỷ hết hóa đơn trước", "Huỷ hết hóa đơn trước"],
    ["… ORDER_NOT_PARTIAL: chỉ đóng được đơn đã xuất một phần", "chỉ đóng được đơn"],
    ["… ORDER_LOCKED: đơn đã xuất hàng, không sửa dòng được", "không sửa dòng được"],
    ["… LOCKED_HAS_PAYMENT: hóa đơn đã có tiền thu", "đã có tiền thu"],
    ["… LOCKED_EINVOICE: hóa đơn đã phát hành hóa đơn điện tử", "hóa đơn điện tử"],
    ["… REISSUE_BREAKS_RETURN: hóa đơn mới không còn bán \"Sữa X\"", "Sữa X"],
    ["… RETURN_NEEDS_INVOICE: đơn có 2 hóa đơn đã xuất", "2 hóa đơn"],
    ["… USE_RPC: dùng nút Xuất hàng", "không đổi trạng thái trực tiếp"],
  ])("%s", (raw, want) => {
    expect(explainInvoiceError(raw)).toContain(want)
  })

  /**
   * ⚠ GỌI THẲNG HÀM, đừng soi chuỗi trong tệp — mọi mã lỗi ở trên đều có
   * mặt trong khối chú thích đầu tệp, nên chốt kiểu `toContain` vẫn xanh
   * cả khi đã xoá hẳn nhánh dịch.
   */
  it("bỏ tiền tố kỹ thuật, không chỉ ghép thêm chữ", () => {
    expect(explainInvoiceError('… INSUFFICIENT_STOCK: thiếu 24 đơn vị của "Sữa X"')).toBe(
      'Không đủ tồn: thiếu 24 đơn vị của "Sữa X"'
    )
    expect(explainInvoiceError("… FORBIDDEN: bạn không có quyền xuất hàng")).toBe(
      "bạn không có quyền xuất hàng"
    )
  })

  /** Migration chưa chạy thì nói đúng việc phải làm, đừng để tưởng đơn hỏng. */
  it("hàm chưa có trên cơ sở dữ liệu thì chỉ đúng việc cần làm", () => {
    expect(
      explainInvoiceError("function public.post_invoice(jsonb) does not exist")
    ).toContain("supabase db push")
  })

  /** ⚠ Lỗi lạ trả NGUYÊN VĂN — đoán sai rồi họ đi sửa nhầm chỗ còn tệ hơn. */
  it("lỗi không nhận ra thì giữ nguyên văn", () => {
    expect(explainInvoiceError("connection reset by peer")).toBe("connection reset by peer")
  })
})

// =====================================================================

describe("invoiceWarnings: xuất thành công ≠ xuất đủ hàng", () => {
  const r = (over: Partial<PostInvoiceResult>): PostInvoiceResult => ({
    invoiceId: null, invoiceCode: null, entryId: null, receivableId: null,
    shortQty: 0, nearExpirySkipped: 0, orderStatus: null, ...over,
  })

  it("không có gì bất thường thì im lặng", () => {
    expect(invoiceWarnings(r({}))).toBeNull()
  })

  /** short_qty là ĐƠN VỊ CƠ SỞ, không phải đơn vị bán — phải nói rõ. */
  it("thiếu hàng: nói đúng đơn vị và nói tồn đang âm", () => {
    const w = invoiceWarnings(r({ shortQty: 24 }))
    expect(w).toContain("24 đơn vị cơ sở")
    expect(w).toContain("âm")
  })

  /**
   * ⚠ LƯỢT LẤY LÔ, không phải số lô hết hạn — và là chuyện bình thường
   * của FIFO, nên câu chữ phải nhẹ.
   */
  it("cận hạn: câu chữ nhẹ, không nhắc tồn âm", () => {
    const w = invoiceWarnings(r({ nearExpirySkipped: 3 }))
    expect(w).toContain("3 lượt")
    expect(w).not.toContain("âm")
  })
})

// =====================================================================

describe("Màn soạn hóa đơn (toàn trang)", () => {
  const CODE = strip(EDITOR) + "\n" + strip(EDITOR_LIB)

  /**
   * ⚠ KHÔNG CÓ CHỐT CHẶN GIÁ Ở ĐÂY (PATCH 1: NPP toàn quyền). Trần giá
   * của nhân viên bán hàng (`priceViolation` ở màn `/sell`) giữ nguyên và
   * không liên quan tới màn này — chủ nhà đã chốt Q3 = (a).
   */
  it("không gọi priceViolation, không chặn giá", () => {
    expect(CODE).not.toContain("priceViolation")
    expect(CODE).not.toContain("ceilingFor")
  })

  /**
   * ⚠ SO GIÁ VỚI GIÁ TRÊN ĐƠN, KHÔNG VỚI `products.sell_price`.
   * `sell_price` là giá theo ĐƠN VỊ CƠ SỞ, còn dòng đơn có thể bán theo
   * thùng — so thẳng là nhuộm vàng mọi dòng bán theo thùng.
   */
  it("cảnh báo lệch giá so với giá trên đơn", () => {
    expect(CODE).toContain("Math.abs(r.price - r.unitPrice) > (r.unitPrice * priceWarnPct) / 100")
    expect(CODE).not.toContain("r.listPrice")
  })

  /**
   * ⚠ THIẾU HÀNG LÀ CẢNH BÁO, KHÔNG PHẢI CHẶN. Tổ chức bật cho phép bán
   * âm thì `post_stock_export` vẫn xuất; chặn ở giao diện là đặt ra một
   * luật thứ hai mâu thuẫn với cấu hình của chính tổ chức đó.
   */
  it("thiếu tồn không khoá nút Xuất", () => {
    /**
     * ⚠ SOI THỨ CÓ TRONG `disabled`, ĐỪNG GHIM NGUYÊN CÂU. Bản cũ đòi
     * đúng chuỗi `disabled={saving || picked.length === 0}`, nên thêm
     * một điều kiện HỢP LỆ (xung đột phiếu trả, 21/09/2026) cũng làm
     * chốt đỏ — đỏ vì cách viết, không vì hành vi. Thứ phải giữ: nút
     * khoá theo `saving` và "chưa nhập dòng nào", và TUYỆT ĐỐI không
     * theo thiếu tồn.
     */
    /* ⚠ NEO VÀO `onClick={submit}`. Nút "Huỷ" cũng có
       `disabled={saving}` và đứng TRƯỚC — bắt nhầm nó là chốt đỏ vì
       đọc sai nút, không vì hành vi. */
    const m = CODE.match(/onClick=\{submit\}[\s\S]{0,120}?disabled=\{([^}]*)\}/)
    expect(m, "không đọc được điều kiện khoá nút Xuất").not.toBeNull()
    expect(m![1]).toContain("picked.length === 0")
    expect(m![1], "thiếu tồn đang khoá nút Xuất").not.toContain("shortRows")
    expect(CODE).not.toMatch(/disabled=\{[^}]*shortRows/)
  })

  /**
   * ⚠ MẶC ĐỊNH XUẤT HẾT PHẦN CÒN LẠI. Việc thường ngày là xuất đủ; bắt
   * gõ tay từng dòng là biến việc thường ngày thành cực hình.
   */
  it("mặc định điền số lượng bằng phần còn lại", () => {
    expect(CODE).toContain("qty: l.remainingQty")
  })

  /**
   * ⚠ CHIẾT KHẤU LÀ SỐ TIỀN CỦA CẢ DÒNG. Giữ nguyên số của đơn thì dòng
   * xuất một nửa mang khoản giảm của cả đơn — và nó đi thẳng vào hóa đơn
   * điện tử.
   */
  it("chiết khấu chia theo tỉ lệ phần đang xuất", () => {
    expect(CODE).toContain("Math.round((r.lineDiscount * r.qty) / r.discountBase)")
  })

  /**
   * ⚠ MẪU SỐ KHÔNG PHẢI LÚC NÀO CŨNG LÀ `remainingQty`. Khi lập MỚI,
   * chiết khấu đến từ dòng đơn và ứng với phần còn lại. Khi SỬA hóa đơn,
   * nó đến từ dòng của bản cũ và ứng với đúng số lượng bản cũ — chia
   * theo `remainingQty` ở ca đó là chia cho một mẫu số lớn hơn, và khoản
   * giảm teo lại sau mỗi lần sửa mà không ai để ý.
   */
  it("mẫu số của chiết khấu khác nhau giữa lập mới và sửa lại", () => {
    expect(CODE).toContain("discountBase: l.remainingQty,")
    expect(CODE).toContain("discountBase: sd.quantity,")
  })

  /** ⚠ Cảnh báo đi TOAST RIÊNG, không nhét vào toast thành công. */
  it("cảnh báo thiếu hàng là toast riêng, biến thể destructive", () => {
    expect(CODE).toContain('toast({ title: "Xuất thiếu hàng", description: w, variant: "destructive" })')
  })

  it("có trạng thái tải, trạng thái lỗi và trạng thái rỗng", () => {
    expect(CODE).toContain("<Skeleton")
    expect(CODE).toContain("loadError")
    expect(CODE).toContain("Đơn không còn dòng nào để xuất")
  })

  /**
   * ⚠ XUẤT XONG PHẢI ĐI SANG BẢN VỪA LẬP. Đứng lại ở màn soạn là người
   * dùng nhìn đúng những con số vừa gửi đi và tưởng chưa có gì xảy ra —
   * rồi bấm Xuất lần nữa, và lần này kho trừ thật hai lượt.
   */
  /**
   * ⚠ `replace`, KHÔNG `push` (đổi 20/09/2026). Hai lý do cùng hướng:
   *   · hóa đơn đã ghi sổ thì màn soạn nó KHÔNG được nằm lại trong lịch
   *     sử — lùi một bước vào đó là mời bấm Xuất hàng lần nữa cho một
   *     đơn đã xuất;
   *   · màn in nay tự rời đi khi đóng hộp thoại in (`useLeaveAfterPrint`),
   *     nên `push` làm "đường về" của nó là màn soạn vừa xong, còn
   *     `replace` trả người dùng về chỗ họ đứng TRƯỚC khi bấm Xuất hàng.
   */
  it("xuất xong thì THAY màn soạn bằng màn in và tự bật cửa sổ in", () => {
    const i = CODE.indexOf("router.replace(r.invoiceId")
    expect(i, "còn dùng push — màn soạn vẫn nằm lại trong lịch sử").toBeGreaterThan(0)
    expect(CODE.slice(i, i + 160)).toContain("/sales-invoices/${r.invoiceId}/print?auto=1")
    expect(CODE).not.toContain("router.push(r.invoiceId")
  })

  /**
   * ⚠ MÀN XUẤT HÀNG PHẢI HIỆN ĐỦ GHI CHÚ CHO NPP DUYỆT (chủ nhà chốt
   * 20/09/2026). Đây là chỗ NPP quyết định xuất bao nhiêu; giấu lời dặn
   * của người bán ("lấy lô mới", "giao trước 8h") đúng vào lúc cần đọc
   * nó nhất là bỏ phí cả việc nhập.
   */
  it("hiện ghi chú của từng dòng hàng", () => {
    /* ⚠ BÁM VÀO LUẬT, KHÔNG BÁM VÀO THẺ. Bản cũ đòi đúng một chuỗi JSX
       có `<div>`; bố cục 21/09/2026 đổi sang thẻ dòng nên nó thành
       `<span>`, và chốt đỏ vì một tên thẻ chứ không vì hành vi. Thứ
       phải giữ: ghi chú CÓ hiện ra, và hiện nguyên xuống dòng. */
    const flat = EDITOR.replace(/\s+/g, " ")
    expect(flat).toContain("{r.note && (")
    expect(flat).toContain("Ghi chú: {r.note}")
    expect(flat, "ghi chú nhiều dòng bị ép thành một dòng").toContain("whitespace-pre-wrap")
  })

  /**
   * ⚠ GHI CHÚ CỦA ĐƠN CHỈ ĐỌC, KHÔNG CHÉP VÀO Ô "Ghi chú hóa đơn". Hai
   * thứ khác nhau; chép sang là tờ hóa đơn in hai lần cùng một câu với
   * hai nhãn khác nhau.
   */
  it("hiện ghi chú chung của đơn, và KHÔNG chép vào ô nhập", () => {
    expect(EDITOR).toContain('.from("sales_orders")')
    /**
     * ⚠ GHI CHÚ LẤY TỪ CỘT `notes` CỦA ĐƠN, không phải từ một state nào
     * khác. Từ 20/09/2026 nó đi chung câu đọc đầu đơn (cùng tên khách,
     * ngày đặt, hình thức trả) — nên chốt phải bám vào phép rút ra, thứ
     * còn lại sau khi cách nạp đổi.
     */
    expect(EDITOR).toContain('const orderNotes = (head?.notes ?? "").trim() || null')
    expect(EDITOR).toContain("notes, order_date, payment_terms,")
    /**
     * ⚠ KIỂM CẢ ĐIỀU KIỆN LẪN THÂN. Chỉ tìm chữ "Ghi chú đơn hàng" thì
     * đổi điều kiện thành `{false && (` vẫn xanh — khối còn nguyên trong
     * file mà màn hình không hiện gì.
     */
    const flat = EDITOR.replace(/\s+/g, " ")
    expect(flat).toContain(
      '{orderNotes && ( <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3">'
    )
    expect(flat).toContain("{orderNotes} </p>")
    expect(EDITOR, "đang chép ghi chú đơn sang ô ghi chú hóa đơn").not.toContain(
      "setNotes(orderNotes"
    )
    // Và phải đứng TRƯỚC ô nhập — NPP đọc rồi mới ghi.
    expect(EDITOR.indexOf("Ghi chú đơn hàng")).toBeLessThan(EDITOR.indexOf('htmlFor="inv-note"'))
  })

  /**
   * ⚠ SỐ LƯỢNG PHẢI XUỐNG ĐƯỢC 0, và luật ấy sống sót qua lần đổi bố
   * cục 21/09/2026. Ở màn hóa đơn, 0 nghĩa là "đợt này KHÔNG xuất dòng
   * này" — một trạng thái CÓ THẬT, khác hẳn bỏ dòng: phần còn lại vẫn
   * nằm trên đơn và dòng vẫn hiện ra. Ép sàn 1 (mặc định của `Stepper`
   * ở giỏ hàng) là bắt người dùng bỏ hẳn dòng để nói "chưa xuất".
   */
  it("số lượng xuống được 0", () => {
    expect(CODE, "Stepper của màn hóa đơn không hạ được sàn về 0").toContain("min={0}")
  })
})

// =====================================================================

describe("Màn danh sách đơn", () => {
  const CODE = strip(LIST)

  /**
   * ⚠ ĐƠN ĐÃ XUẤT MỘT PHẦN VẪN XUẤT TIẾP ĐƯỢC. Bỏ nó khỏi điều kiện hiện
   * nút là bắt người dùng mở từng đơn một chỉ để bấm đúng cái nút này.
   */
  it("thanh chọn nhiều nhận cả đơn đã xuất một phần", () => {
    expect(CODE).toContain('o.status === "submitted" || o.status === "partially_invoiced"')
  })

  /**
   * ⚠ NÚT XUẤT HÀNG PHẢI ĐIỀU HƯỚNG, không mở lại hộp thoại. Chủ nhà đã
   * chốt đổi sang toàn trang; để sót một đường mở dialog là hai màn soạn
   * song song, và chỉ một trong hai thêm được mã ngoài đơn.
   */
  it("nút Xuất hàng sang màn soạn, không mở hộp thoại", () => {
    expect(CODE).toContain("/sales-invoices/new?order=${o.id}")
    expect(CODE).not.toMatch(/<InvoiceDialog\s/)
  })

  /**
   * ⚠ HAI ĐƯỜNG XUẤT HÀNG. Nút trên TỪNG DÒNG và trong NGĂN CHI TIẾT mở
   * dialog; chỉ thanh chọn nhiều mới xuất thẳng. Đếm đủ hai chỗ, vì sửa
   * một chỗ về `approveOrders` là mất chỗ sửa số lượng ở đúng đường
   * người ta hay dùng nhất.
   */
  /**
   * ⚠ SANG TAB MỚI, KHÔNG CHUYỂN TRANG CÙNG TAB (chủ nhà chốt
   * 20/09/2026). Trước đây hai chỗ này gọi `router.push`; giữ nguyên
   * kiểu ấy là nút hay dùng nhất vẫn ném người dùng ra khỏi danh sách
   * đang lọc. Xem `openInNewTab`.
   */
  it("hai chỗ sang màn soạn ở tab mới, không chỗ nào xuất thẳng", () => {
    expect(
      (CODE.match(/onApprove=\{\(o\) => openInNewTab\(`\/sales-invoices\/new\?order=\$\{o\.id\}`\)\}/g) ?? [])
        .length
    ).toBe(2)
    expect(CODE).not.toContain("onApprove={(o) => approveOrders([o.id])}")
    expect(CODE, "còn sót đường chuyển trang cùng tab").not.toContain(
      "router.push(`/sales-invoices/new?order="
    )
  })

  /**
   * ⚠ VÁ STATE THEO `orderStatus` CỦA RPC. Đoán "completed" là màn hình
   * nói đơn đã giao đủ trong khi còn hàng nằm lại, rồi không ai bấm Xuất
   * tiếp nữa.
   */
  /**
   * ⚠ CANH CẢ NƠI GHI LẪN NƠI ĐỌC. Bản đầu của chốt này chỉ kiểm chỗ ĐỌC
   * `newStatus` — hardcode `newStatus.set(id, "completed")` ở chỗ GHI thì
   * mọi đơn xuất một phần vẫn hiện "Hoàn thành", và chốt vẫn xanh.
   */
  it("không đoán trạng thái sau khi xuất", () => {
    expect(CODE).toContain('newStatus.set(id, r.orderStatus ?? "completed")')
    expect(CODE).toContain('(newStatus.get(o.id) ?? "completed") as OrderStatus')
    expect(CODE).not.toMatch(/status: "completed" as const/)
  })

  /** Hàm cũ gọi một RPC đã bị migration 124 gỡ. */
  it("không còn gọi complete_order", () => {
    expect(CODE).not.toContain("completeOrder")
    expect(CODE).not.toContain("complete-order")
  })
})

// =====================================================================

describe("Màn chi tiết đơn", () => {
  const CODE = strip(DETAIL)

  /**
   * ⚠ ĐÂY LÀ CHỖ DUY NHẤT TRONG ỨNG DỤNG GỌI `close_order`. Bỏ nút là
   * hàm đó thành mã chết, và đơn giao thiếu kẹt ở "Xuất một phần" vĩnh
   * viễn — không nút nào đưa nó ra được.
   */
  /**
   * ⚠ NEO CẢ BIỂU THỨC. Chuỗi `order.status === "partially_invoiced"`
   * còn nằm trong điều kiện của nút Xuất hàng, nên hỏi trống không thì
   * gỡ hẳn điều kiện của nút Đóng đơn mà chốt vẫn xanh — và khi đó đơn
   * chưa xuất gì cũng "đóng" được, trong khi đúng ra là HUỶ.
   */
  it("có nút Đóng đơn, và chỉ cho đơn đã xuất một phần", () => {
    expect(CODE).toContain("closeOrder(supabase, order.id, closeReason.trim())")
    expect(CODE).toContain('canInvoice && order.status === "partially_invoiced"')
  })

  it("có nút Xuất hàng cho cả phiếu tạm lẫn đơn xuất một phần", () => {
    expect(CODE).toContain(
      '(order.status === "submitted" || order.status === "partially_invoiced")'
    )
  })

  /**
   * ⚠ `maybeSingle()` TRÊN CÔNG NỢ LÀ MỘT QUẢ MÌN CỦA V2B. Mỗi hóa đơn
   * một dòng nợ, nên đơn xuất hai đợt có hai dòng — và `maybeSingle()`
   * trên hai dòng là lỗi PGRST116, cả trang trắng.
   */
  /**
   * ⚠ BẢN ĐẦU CỦA CHỐT NÀY VÔ NGHĨA: nó `not.toContain` một chuỗi nhiều
   * dòng đã không còn khớp sau khi sửa, nên gắn `maybeSingle()` trở lại
   * vẫn xanh. Dò trong VÙNG quanh truy vấn mới bắt được.
   */
  it("công nợ đọc nhiều dòng rồi cộng lại", () => {
    expect(CODE, "maybeSingle() trên công nợ: đơn hai hóa đơn là PGRST116").not.toMatch(
      /\.from\("receivables"\)[\s\S]{0,300}?maybeSingle\(\)/
    )
    // Phép gộp nay dùng chung với danh sách đơn — `gopCongNoCuaDon`.
    expect(CODE).toContain("setReceivable(gopCongNoCuaDon(recRows))")
    expect(read("src/lib/orders/receivable-sum.ts")).toContain("rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)")
  })

  /**
   * ⚠ LIỆT KÊ HẾT, ĐỪNG DẪN VÀO DÒNG ĐẦU. Đơn xuất hai đợt có hai dòng
   * nợ; hiện một liên kết thì đợt kia trông như chưa ghi nợ, và người
   * dùng đi tạo tay một dòng đã tồn tại sẵn.
   */
  it("khung công nợ liệt kê từng dòng, không chỉ dòng đầu", () => {
    expect(CODE).toContain("receivables.map((rc) => (")
    expect(CODE).toContain("href={`/receivables/${rc.id}`}")
    expect(CODE).not.toContain("href={`/receivables/${receivableId}`}")
  })

  /**
   * ⚠ TRẠNG THÁI GỘP LẤY THEO CHỖ XẤU NHẤT. Lấy `status` của dòng đầu thì
   * một đơn có đợt 1 đã thu, đợt 2 chưa thu sẽ hiện "đã thanh toán".
   */
  it("một dòng nợ chưa trả hết thì cả đơn chưa trả hết", () => {
    expect(read("src/lib/orders/receivable-sum.ts")).toContain('const conNo = rows.some((r) => r.status !== "paid")')
  })

  /**
   * ⚠ BA TRẠNG THÁI CỦA HÓA ĐƠN PHẢI CÓ Ô RỖNG, không được thiếu khoá.
   * `Record<OrderStatus, …>` bắt buộc đủ khoá, nhưng ô rỗng là CÂU TRẢ
   * LỜI ĐÚNG chứ không phải chỗ chưa làm xong: chúng chỉ đi qua RPC.
   */
  it("bảng chuyển trạng thái không mở ô nào cho ba trạng thái hóa đơn", () => {
    const i = CODE.indexOf("const STATUS_FLOW")
    const block = CODE.slice(i, CODE.indexOf("\n}", i))
    expect(block).toContain("partially_invoiced: []")
    expect(block).toContain("completed: []")
    expect(block).toContain("closed: []")
  })

  it("hiện danh sách hóa đơn của đơn, kể cả hóa đơn đã huỷ", () => {
    expect(CODE).toContain('.from("sales_invoices")')
    expect(CODE).toContain("Hóa đơn bán ({salesInvoices.length})")
    expect(CODE).not.toMatch(/sales_invoices[\s\S]{0,200}\.eq\("status", "posted"\)/)
  })
})

// =====================================================================

describe("Sáu trạng thái đi tới mọi bảng tra cứu", () => {
  const ALL = [
    "draft", "submitted", "partially_invoiced", "completed", "closed", "cancelled",
  ] as const

  it("có nhãn cho cả sáu", () => {
    for (const s of ALL) expect(ORDER_STATUS_MAP[s], `thiếu nhãn ${s}`).toBeTruthy()
  })

  /**
   * ⚠ THIẾU MỘT KHOÁ MÀU thì `orderTone` rơi về màu của `draft` — xám,
   * nghĩa là "chưa gửi" — và một đơn đã giao một phần trông y hệt một đơn
   * chưa ai đụng tới.
   */
  /**
   * ⚠ SO VỚI CẢ NĂM CÁI KIA, không chỉ so với `draft`. Bản đầu của chốt
   * này chỉ hỏi "có khác màu nháp không", nên gán cho `closed` đúng màu
   * xanh của `completed` vẫn xanh — và khi đó "đã giao đủ" với "thôi
   * không giao nốt" trông y hệt nhau trên màn hình.
   */
  it("sáu trạng thái sáu màu, không cái nào trùng cái nào", () => {
    const bgs = ALL.map((s) => orderTone(s).bg)
    expect(new Set(bgs).size, `màu trùng nhau: ${bgs.join(" ")}`).toBe(ALL.length)
    const accents = ALL.map((s) => orderTone(s).accent)
    expect(new Set(accents).size).toBe(ALL.length)
  })

  it("nhãn của tone lấy từ bảng nhãn chung, không viết lại", () => {
    for (const s of ALL) {
      expect(orderTone(s).label).toBe(ORDER_STATUS_MAP[s].label)
    }
  })

  /**
   * ⚠ BA TRẠNG THÁI ĐÃ XUẤT HÀNG ĐỀU PHẢI KHOÁ. Trigger
   * `guard_order_lines_locked` (mig 124) ném `ORDER_LOCKED` cho chúng;
   * sót một cái là màn hình mở nút Sửa rồi cơ sở dữ liệu từ chối.
   */
  it("khoá sửa đủ ba trạng thái đã xuất hàng", () => {
    for (const s of ["partially_invoiced", "completed", "closed"] as const) {
      expect(TERMINAL_STATUSES, `thiếu ${s}`).toContain(s)
    }
  })
})

// =====================================================================

describe("Thư viện không còn dấu vết luồng cũ", () => {
  it("post-invoice.ts đọc mảng, không đọc thẳng object", () => {
    // `RETURNS TABLE` nên `data` là MỘT MẢNG. Đọc `data.short_qty` ra
    // undefined rồi Number(...) ra NaN — cảnh báo im lặng biến mất.
    expect(LIB).toContain("Array.isArray(data) ? data[0] : data")
  })

  it("complete-order.ts đã bị gỡ", () => {
    expect(() => read("src/lib/orders/complete-order.ts")).toThrow()
  })

  it("không tệp nào còn gọi RPC complete_order", () => {
    for (const [name, src] of [["danh sách", LIST], ["chi tiết", DETAIL], ["màn soạn", EDITOR]] as const) {
      expect(strip(src), `${name} còn gọi complete_order`).not.toContain('rpc("complete_order"')
    }
  })
})
