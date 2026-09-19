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

describe("bấm vào tên khách từ màn chi tiết", () => {
  const ORDER = readFileSync("src/app/(dashboard)/orders/[id]/page.tsx", "utf8")
  const INV = readFileSync("src/app/(dashboard)/sales-invoices/[id]/page.tsx", "utf8")
  const CHROME = readFileSync("src/components/detail/detail-chrome.tsx", "utf8")

  /**
   * ⚠ TÊN KHÁCH LÀ THỨ NGƯỜI TA BẤM VÀO ĐẦU TIÊN. Đang xem một đơn mà
   * muốn biết khách còn nợ bao nhiêu thì phải quay ra danh sách khách rồi
   * gõ lại tên.
   */
  /**
   * ⚠ MỞ MODAL, KHÔNG CHUYỂN TRANG (chủ nhà chốt). Chuyển trang là mất
   * chỗ đang đứng, và đường về là nút Back — thứ hay đưa họ ra khỏi hẳn
   * màn đơn.
   */
  it("cả hai màn chi tiết mở modal khi bấm tên khách", () => {
    expect(ORDER).toContain("onNameClick={order.customer_id ? () => setQuickCustomer(order.customer_id) : null}")
    expect(INV).toContain("onNameClick={inv.customer_id ? () => setQuickCustomer(inv.customer_id) : null}")
    expect(ORDER).toContain("<CustomerQuickView")
    expect(INV).toContain("<CustomerQuickView")
  })

  /** ⚠ Không có mã khách thì vẽ chữ thường, đừng vẽ một cái nút vô dụng. */
  it("không có gì để mở thì không vẽ nút", () => {
    expect(CHROME).toContain("{onNameClick ? (")
    expect(CHROME).toContain("<button")
    expect(CHROME).not.toContain("<Link")
  })

  /** ⚠ Đóng modal phải trả state về null, nếu không mở lại không được. */
  it("đóng modal thì xoá mã khách đang giữ", () => {
    for (const src of [ORDER, INV]) {
      expect(src).toContain("onClose={() => setQuickCustomer(null)}")
    }
  })
})

describe("tab Lịch sử giao dịch của khách hàng", () => {
  const CUS = readFileSync("src/app/(dashboard)/customers/[id]/page.tsx", "utf8")

  it("đổi tên tab", () => {
    expect(CUS).toContain('<TabsTrigger value="orders">Lịch sử giao dịch</TabsTrigger>')
    expect(CUS).not.toContain("Lịch sử đơn hàng</TabsTrigger>")
  })

  it("có danh sách hóa đơn bán và các khoản thanh toán", () => {
    expect(CUS).toContain("Hóa đơn bán ({allInvoices.length})")
    expect(CUS).toContain("Các khoản thanh toán ({allPayments.length})")
  })

  /**
   * ⚠ `cash_receipts` KHÔNG CÓ `customer_id`. Bảng phiếu thu chỉ nối tới
   * khách qua dòng phiếu → công nợ, nên phải đi qua `receivables`.
   */
  it("khoản thanh toán đi qua receivables, không hỏi thẳng cash_receipts", () => {
    const q = CUS.slice(CUS.indexOf("Bảng phiếu thu chỉ nối tới"))
    expect(q).toContain('.eq("receivable.customer_id", id)')
    expect(q).not.toContain('.from("cash_receipts")')
  })

  /**
   * ⚠ HÓA ĐƠN ĐÃ HUỶ VẪN LIỆT KÊ. Giấu đi thì người đối chiếu thấy một
   * khoảng trống giữa hai số hóa đơn và không biết chuyện gì xảy ra ở đó.
   */
  it("không lọc bỏ hóa đơn đã huỷ", () => {
    const q = CUS.slice(CUS.indexOf('.from("sales_invoices")'), CUS.indexOf('.limit(200)'))
    expect(q).not.toContain('.eq("status"')
    expect(q).not.toContain('.neq("status"')
  })

  /** ⚠ Cắt bớt trong im lặng đọc như "chỉ có bấy nhiêu thôi". */
  it("nói ra khi danh sách bị cắt ở 200", () => {
    expect(CUS).toContain("Mới hiện 200 hóa đơn gần nhất")
    expect(CUS).toContain("Mới hiện 200 khoản thu gần nhất")
  })

  /**
   * ⚠ Lỗi đọc phải được đếm, không nuốt im lặng.
   *
   * Chốt theo TỪNG TÊN chứ không theo nguyên chuỗi danh sách: danh sách
   * truy vấn còn dài thêm theo thời gian, và một chốt vỡ mỗi lần thêm
   * một truy vấn là chốt sẽ bị gỡ.
   */
  it("hai truy vấn mới nằm trong phép kiểm lỗi chung", () => {
    const at = CUS.indexOf("const qErr = (")
    expect(at, "không tìm thấy phép kiểm lỗi chung").toBeGreaterThan(0)
    const block = CUS.slice(at, CUS.indexOf("]", CUS.indexOf("[", at)))
    expect(block).toContain("invoicesRes")
    expect(block).toContain("paymentsRes")
  })
})

describe("dọn mẫu in theo chốt của chủ nhà", () => {
  const TOAST = readFileSync("src/components/ui/toast.tsx", "utf8")
  const CSS = readFileSync("src/app/globals.css", "utf8")

  /**
   * ⚠ HÀNG ĐỔI HIỆN HAI LẦN. `get_invoiceable_lines` đưa hàng đổi lên hóa
   * đơn thành một dòng đơn giá 0 để kho biết mà lấy hàng ra; trên tờ giấy
   * đưa khách thì cùng một món hiện cả dòng 0đ lẫn dòng "(Hàng đổi)".
   */
  it("bản in bỏ dòng hàng đổi xuất đi", () => {
    expect(PRINT_PAGE).toContain("lines.filter((l) => !l.is_exchange).map")
    expect(PRINT_PAGE).toContain("is_exchange, product:products(name, sku)")
  })

  /** ⚠ Chỉ bỏ TRÊN BẢN IN — dòng ấy vẫn trừ kho và vẫn nằm trong `total`. */
  it("không đụng tới dòng hóa đơn trong sổ", () => {
    expect(PRINT_PAGE).toContain("CHỈ BỎ TRÊN BẢN IN")
    expect(PRINT_PAGE).not.toContain("delete(")
  })

  it("bỏ cột CK và dòng chiết khấu hóa đơn", () => {
    expect(PRINT).not.toContain(">CK</th>")
    // Soi Ô ĐƯỢC VẼ, không soi cả tệp — chú thích giải thích việc bỏ nó
    // cũng chứa đúng cụm chữ ấy.
    expect(PRINT).not.toContain(">Chiết khấu hóa đơn ( )</td>")
    expect(PRINT).not.toContain("{formatCurrency(l.discount)}")
  })

  /** ⚠ "Tổng cộng" lặp đúng con số của "Tổng tiền hàng". */
  it("bỏ dòng Tổng cộng, giữ Tổng tiền hàng", () => {
    expect(PRINT).not.toContain(">Tổng cộng</td>")
    expect(PRINT).toContain(">Tổng tiền hàng</td>")
  })

  /**
   * ⚠ VẪN LẤY `total`, KHÔNG LẤY `goodsTotal`. Hai số bằng nhau do dựng,
   * nhưng "Còn phải thu" trừ từ `total`; lấy số khác là một ngày nào đó
   * lệch vài đồng mà không ai lần ra.
   */
  it("dòng tổng lấy đúng total của hóa đơn", () => {
    const row = PRINT.slice(PRINT.indexOf(">Tổng tiền hàng</td>"))
    expect(row.slice(0, 300)).toContain("{formatCurrency(total)}")
    expect(row.slice(0, 300)).not.toContain("goodsTotal")
  })

  /** ⚠ Số ô mỗi hàng phải khớp số cột, nếu không bảng lệch hẳn. */
  it("colSpan theo đúng 6 cột còn lại", () => {
    expect(PRINT).not.toContain("colSpan={7}")
    expect(PRINT).toContain("colSpan={5}>Trừ hàng trả")
    expect(PRINT).toContain("colSpan={5}>Còn phải thu")
  })

  /**
   * ⚠ THÔNG BÁO KHÔNG ĐƯỢC LỌT VÀO TỜ GIẤY. Màn in bật cửa sổ in ngay sau
   * khi lưu, nên toast "Đã xuất hóa đơn HD-0029" còn trên màn và được in
   * kèm xuống cuối tờ hóa đơn đưa khách.
   */
  it("thông báo bị ẩn khi in", () => {
    expect(TOAST).toContain('cn("no-print fixed top-0')
    expect(CSS).toMatch(/@media print \{[\s\S]*\.no-print \{ display: none !important; \}/)
  })
})

describe("modal thông tin khách", () => {
  const QV = readFileSync("src/components/customers/customer-quick-view.tsx", "utf8")

  /**
   * ⚠ ĐỌC KHI MỞ, KHÔNG ĐỌC SẴN. Modal này gắn vào MỌI màn chi tiết đơn
   * và hóa đơn; đọc sẵn là mỗi lần mở một cái đơn lại thêm hai truy vấn
   * cho một khung người dùng có thể không bấm tới.
   */
  it("chỉ đọc khi có mã khách", () => {
    expect(QV).toContain("if (!customerId) return")
  })

  /**
   * ⚠ CÔNG NỢ QUA `fetchAllForAggregate`. Khách lâu năm vượt 1000 dòng là
   * PostgREST cắt bớt trong im lặng, và con số nợ hiện ra THIẾU — đúng con
   * số người ta mở modal này ra để xem.
   */
  it("cộng công nợ không bị cắt ở 1000 dòng", () => {
    expect(QV).toContain("fetchAllForAggregate<ReceivableAmounts>")
    expect(QV).toContain(".range(from, to)")
  })

  /** ⚠ Đọc hỏng thì hiện "chưa đọc được", KHÔNG hiện 0. */
  it("đọc hỏng thì không hiện số 0", () => {
    expect(QV).toContain("setDebt(debtRes.error || debtRes.truncated ? null : totalRemaining(debtRes.rows))")
    expect(QV).toContain("chưa đọc được")
  })

  /** ⚠ RLS từ chối = 0 dòng, HTTP 200, không lỗi — phải nói cả hai khả năng. */
  it("không mở được thì nói cả hai lý do", () => {
    expect(QV).toContain("khách không tồn tại hoặc bạn không có quyền xem")
  })

  /** ⚠ Bắt trừ nhẩm lúc khách đang đứng đợi là chỗ hay trừ sai nhất. */
  it("hiện công nợ, hạn mức và phần còn được nợ", () => {
    expect(QV).toContain('label="Công nợ hiện tại"')
    expect(QV).toContain('label="Hạn mức"')
    expect(QV).toContain('label="Còn được nợ"')
  })

  /** Vẫn có đường sang hồ sơ đầy đủ — modal không phải ngõ cụt. */
  it("có đường mở hồ sơ khách đầy đủ", () => {
    expect(QV).toContain("href={`/customers/${row.id}`}")
    expect(QV).toContain("Mở hồ sơ khách hàng")
  })

  /** ⚠ Địa chỉ ghép qua hàm chung, không tự nối bốn cột lần nữa. */
  it("địa chỉ dùng hàm ghép chung", () => {
    expect(QV).toContain("fullCustomerAddress(row)")
  })
})

describe("bấm khách trên ĐIỆN THOẠI, và hàng nút đầu trang", () => {
  const MOBILE = readFileSync("src/components/orders/mobile-order-detail.tsx", "utf8")
  const ORDER_PAGE = readFileSync("src/app/(dashboard)/orders/[id]/page.tsx", "utf8")

  /**
   * ⚠ CHỦ NHÀ BÁO "trên điện thoại chưa xem được". Màn chi tiết đơn trên
   * điện thoại là MỘT CÂY JSX RIÊNG (`MobileOrderDetail`), không dùng
   * `DetailCustomerCard` — nên chỗ bấm thêm ở bản desktop không tự có ở
   * đó.
   */
  it("màn mobile có chỗ bấm vào tên khách", () => {
    expect(MOBILE).toContain("<ClickableCustomer onClick={onCustomerClick}>")
    expect(ORDER_PAGE).toContain(
      "onCustomerClick={\n              order.customer_id ? () => setQuickCustomer(order.customer_id) : null\n            }"
    )
  })

  /**
   * ⚠ CHỖ BẤM KHÔNG ĐƯỢC BAO CẢ THẺ. Nút gọi nằm bên phải; bọc cả thẻ thì
   * nó nằm TRONG một nút khác — bấm gọi lại ra modal, mà gọi là thao tác
   * hay dùng nhất ở đây trên điện thoại.
   */
  it("nút gọi vẫn nằm ngoài chỗ bấm", () => {
    const card = MOBILE.slice(MOBILE.indexOf("{/* Khách */}"), MOBILE.indexOf("{/* Dòng hàng + tổng */}"))
    const close = card.indexOf("</ClickableCustomer>")
    expect(close).toBeGreaterThan(-1)
    expect(card.indexOf('href={`tel:${customer.phone}`}')).toBeGreaterThan(close)
  })

  /** ⚠ Không có gì để mở thì vẽ chữ thường, đừng vẽ nút câm. */
  it("không truyền gì thì không vẽ nút", () => {
    expect(MOBILE).toContain("if (!onClick) return <span")
  })

  /**
   * ⚠ CHỦ NHÀ CHỐT BỎ THẺ "THAO TÁC". Nó nằm cuối cột phải — sau khách
   * hàng, thông tin đơn, hoá đơn, tiến trình — nên phải cuộn hết trang mới
   * thấy "Rút về nháp".
   */
  it("bỏ hẳn thẻ Thao tác ở cột phải", () => {
    expect(ORDER_PAGE).not.toContain("<CardTitle>Thao tác</CardTitle>")
  })

  /** Bước lùi lên hàng nút đầu trang, cạnh Huỷ đơn. */
  it("Rút về nháp nằm ở hàng nút đầu trang, trước Huỷ đơn", () => {
    const hero = ORDER_PAGE.slice(
      ORDER_PAGE.indexOf("const heroActions = ("),
      ORDER_PAGE.indexOf("const creditLimit =")
    )
    expect(hero).toContain("{backTransitions.map((trans) => {")
    expect(hero.indexOf("backTransitions.map")).toBeLessThan(hero.indexOf("{cancelTransition && ("))
  })

  /** ⚠ Lọc bỏ `cancelled`, nếu không Huỷ đơn vẽ HAI lần cạnh nhau. */
  it("không vẽ Huỷ đơn hai lần", () => {
    expect(ORDER_PAGE).toContain(
      'const backTransitions = roleTransitions.filter((t) => t.value !== "cancelled")'
    )
  })

  /**
   * ⚠ XOÁ ĐƠN VỐN CHỈ NẰM TRONG THẺ "THAO TÁC". Bỏ thẻ mà quên nút này là
   * mất hẳn đường xoá một đơn nhập nhầm.
   */
  it("nút Xóa đơn hàng đi theo lên hàng nút", () => {
    const hero = ORDER_PAGE.slice(
      ORDER_PAGE.indexOf("const heroActions = ("),
      ORDER_PAGE.indexOf("const creditLimit =")
    )
    expect(hero).toContain("{canDelete && (")
    expect(hero).toContain("Xóa đơn hàng")
  })

  /** ⚠ Bước lùi không bao giờ là nút đặc — nút xanh đậm là chỗ mắt rơi vào. */
  it("bước lùi vẽ bằng nút viền, không phải nút đặc", () => {
    const hero = ORDER_PAGE.slice(
      ORDER_PAGE.indexOf("{backTransitions.map((trans) => {"),
      ORDER_PAGE.indexOf("{cancelTransition && (")
    )
    expect(hero).toContain('variant="outline"')
  })
})
