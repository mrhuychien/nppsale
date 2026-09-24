import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { invoiceToMisaPayload } from "../src/lib/misa/mapper"
import type { SellerInfo } from "../src/lib/misa/types"

/**
 * WORKFLOW V2B — P5: module Hóa đơn bán, in, và hoá đơn điện tử đổi nguồn.
 *
 * ⚠ BẤT BIẾN LỚN NHẤT CỦA TỆP NÀY: mọi thứ nói về "hàng đã xuất" phải
 * đọc `sales_invoice_lines`, không đọc `sales_order_lines`. Một đơn xuất
 * làm hai đợt thì đọc theo đơn là cả hai đợt đều mang toàn bộ hàng của
 * đơn — khách bị xuất thuế hai lần, và hoá đơn đã phát hành thì không
 * sửa được.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")

const LIST = read("src/app/(dashboard)/sales-invoices/page.tsx")
const INV_TABLE = read("src/components/sales-invoices/desktop-invoice-table.tsx")
const INV_DRAWER = read("src/components/sales-invoices/invoice-drawer.tsx")
const DETAIL = read("src/app/(dashboard)/sales-invoices/[id]/page.tsx")
const PRINT = read("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx")
const ROUTE = read("src/app/api/einvoice/publish/route.ts")
const EPRINT = read("src/app/(dashboard)/invoices/[id]/print/page.tsx")
const PUB = read("src/lib/einvoice/publish.ts")
const EDITOR = read("src/components/orders/invoice-editor.tsx")
const EDIT_PAGE = read("src/app/(dashboard)/sales-invoices/[id]/edit/page.tsx")
const EDITOR_LIB = read("src/lib/orders/invoice-editor.ts")
const ORDER = read("src/app/(dashboard)/orders/[id]/page.tsx")

/** Bản đã lược chú thích — cho mọi chốt khẳng định một thứ KHÔNG có mặt. */
const strip = (s: string) => s.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "")

// =====================================================================

describe("Hoá đơn điện tử đọc dòng của HÓA ĐƠN BÁN", () => {
  const CODE = strip(ROUTE)

  /**
   * ⚠ NHÁNH HÓA ĐƠN BÁN PHẢI ĐỨNG TRƯỚC. Viết `if (order_id)` trước thì
   * mọi hoá đơn đều rơi vào nhánh theo đơn — `order_id` luôn có giá trị,
   * kể cả khi `sales_invoice_id` đã được gán.
   */
  it("thử sales_invoice_id trước, mới tới order_id", () => {
    const a = CODE.indexOf("if (invoice.sales_invoice_id) {")
    const b = CODE.indexOf("} else if (invoice.order_id) {")
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
  })

  it("lấy cột sales_invoice_id về, nếu không nhánh kia không bao giờ chạy", () => {
    expect(CODE).toMatch(/\.select\("id, order_id, sales_invoice_id,/)
  })

  it("đọc dòng từ sales_invoice_lines", () => {
    expect(CODE).toContain("lines:sales_invoice_lines(")
  })

  /**
   * ⚠ THUẾ SUẤT LẤY SNAPSHOT TRÊN DÒNG HÓA ĐƠN, không tra lại
   * `products.vat_rate`. Thuế theo ngày xuất; tra lại bảng sản phẩm khi
   * phát hành hoá đơn của đợt cũ là khai sai kỳ.
   */
  it("nhánh hóa đơn bán dùng vat_rate của dòng, không của sản phẩm", () => {
    const i = CODE.indexOf("if (invoice.sales_invoice_id) {")
    const j = CODE.indexOf("} else if (invoice.order_id) {")
    const branch = CODE.slice(i, j)
    expect(branch).toContain("const rate = Number(l.vat_rate ?? 0)")
    expect(branch, "đang tra lại products.vat_rate").not.toContain("p.vat_rate")
  })

  /**
   * ⚠ `sales_invoice_lines.vat_rate` LÀ TỈ LỆ (0,1); MISA ĐÒI PHẦN TRĂM
   * (10). Quên nhân 100 là khai thuế 0% cho mọi dòng — và hoá đơn đã
   * phát hành thì không sửa được.
   */
  it("đổi tỉ lệ sang phần trăm trước khi gửi MISA", () => {
    const i = CODE.indexOf("if (invoice.sales_invoice_id) {")
    const branch = CODE.slice(i, CODE.indexOf("} else if (invoice.order_id) {"))
    expect(branch).toContain("Math.round(rate * (rate <= 1 ? 100 : 1))")
  })

  /**
   * ⚠ NHÁNH THEO ĐƠN GIỮ LẠI cho hoá đơn lập trước v2b — chúng chỉ có
   * `order_id`. Bỏ đi là mọi hoá đơn cũ chưa phát hành rơi xuống dòng
   * tổng hợp "Hàng hoá, dịch vụ", tức mất hết chi tiết mặt hàng.
   */
  it("vẫn còn nhánh đọc theo đơn cho dữ liệu cũ", () => {
    expect(CODE).toContain("lines:sales_order_lines(")
  })

  /** Chiết khấu cộng ngược ở CẢ HAI nhánh, không chỉ nhánh cũ. */
  it("cả hai nhánh đều cộng ngược chiết khấu vào đơn giá", () => {
    const n = (CODE.match(/const grossPrice = qty > 0 \? netPrice \+ discount \/ qty : netPrice/g) ?? []).length
    expect(n, "một nhánh còn truyền giá đã giảm kèm chiết khấu").toBe(2)
  })
})

// =====================================================================

describe("Số tiền khai thuế đúng là số của hóa đơn bán", () => {
  const seller = {} as SellerInfo
  const build = (lines: Array<Record<string, unknown>>) =>
    invoiceToMisaPayload({
      buyer: { name: "Tạp hoá A" },
      seller,
      lines: lines.map((l) => ({
        product_name: "Sữa",
        unit_name: "thùng",
        quantity: 2,
        unit_price: 100_000,
        vat_rate: 10,
        ...l,
      })),
    })[0]

  /**
   * ⚠ ĐÂY LÀ HÌNH DẠNG CỦA LỖI mà P5 đi sửa, viết ra thành số. Đơn 4
   * thùng xuất làm hai đợt 2 thùng: mỗi hoá đơn điện tử phải khai 200.000
   * chứ không phải 400.000. Khai theo đơn thì tổng hai tờ là 800.000 —
   * gấp đôi thứ đã bán.
   */
  it("một đợt hai thùng khai 200.000, không khai cả đơn 400.000", () => {
    const dot = build([{ quantity: 2 }])
    expect(dot.TotalAmountWithoutVATOC).toBe(200_000)
    const caDon = build([{ quantity: 4 }])
    expect(caDon.TotalAmountWithoutVATOC).toBe(400_000)
    expect(dot.TotalAmountWithoutVATOC * 2).toBe(caDon.TotalAmountWithoutVATOC)
  })

  /**
   * ⚠ MAPPER HIỂU `vat_rate` LÀ PHẦN TRĂM: nó chia cho 100. Truyền tỉ lệ
   * 0,1 vào thì thuế ra 200 đồng thay vì 20.000 — thấp hơn ĐÚNG 100 LẦN,
   * và vẫn là một con số trông hợp lý nên không ai nhìn ra. Đây là lý do
   * nhánh đọc `sales_invoice_lines` phải nhân 100 trước khi gửi.
   */
  it("truyền tỉ lệ thay vì phần trăm là khai thiếu 100 lần", () => {
    const dung = build([{ vat_rate: 10 }]).TotalVATAmountOC
    const sai = build([{ vat_rate: 0.1 }]).TotalVATAmountOC
    expect(dung).toBe(20_000)
    expect(sai).toBe(200)
    expect(sai * 100).toBe(dung)
  })
})

// =====================================================================

describe("Dòng `invoices` gắn đúng hóa đơn bán", () => {
  const CODE = strip(PUB)

  /**
   * ⚠ TÌM THEO `sales_invoice_id`, KHÔNG THEO `order_id`. Tìm theo đơn
   * thì đợt xuất thứ hai vớ phải hoá đơn điện tử của đợt một, API trả
   * "đã phát hành trước đó", và đợt hai KHÔNG BAO GIỜ có hoá đơn.
   */
  it("tìm dòng cũ theo hóa đơn bán", () => {
    expect(CODE).toContain('.eq("sales_invoice_id", si.id)')
    expect(CODE).not.toMatch(/from\("invoices"\)[\s\S]{0,200}?\.eq\("order_id"/)
  })

  it("ghi cả order_id lẫn sales_invoice_id", () => {
    expect(CODE).toContain("order_id: si.order_id,")
    expect(CODE).toContain("sales_invoice_id: si.id,")
  })

  /**
   * ⚠ TIỀN LẤY TỪ HÓA ĐƠN BÁN, không từ đơn. Lấy từ đơn thì đợt xuất một
   * nửa vẫn khai thuế cho cả đơn.
   */
  it("tiền lấy từ hóa đơn bán", () => {
    expect(CODE).toContain("subtotal: si.subtotal,")
    expect(CODE).toContain("vat: si.vat,")
    expect(CODE).toContain("total: si.total,")
  })

  /** Hóa đơn đã huỷ không phát hành hoá đơn điện tử được. */
  it("chặn hóa đơn không còn hiệu lực", () => {
    expect(CODE).toContain('if (si.status !== "posted")')
  })

  /**
   * ⚠ ĐỌC BODY BẰNG `text()` RỒI MỚI PARSE. Route có thể trả HTML của
   * một lỗi hạ tầng; `res.json()` khi đó ném lỗi cú pháp và người dùng
   * nhận "Unexpected token <" thay vì biết chuyện gì xảy ra.
   */
  it("đọc body an toàn, không res.json() thẳng", () => {
    expect(CODE).toContain("const text = await res.text()")
    expect(CODE).not.toContain("await res.json()")
  })
})

// =====================================================================

describe("Màn đơn hàng không phát hành gộp nhiều hóa đơn", () => {
  const CODE = strip(ORDER)

  /**
   * ⚠ NHIỀU HƠN MỘT HÓA ĐƠN THÌ DỪNG, KHÔNG ĐOÁN. Chọn bừa một cái là
   * phát hành nhầm chứng từ thuế — và hoá đơn đã phát hành thì không sửa
   * được, chỉ huỷ và lập lại với cơ quan thuế.
   */
  it("dừng khi đơn có nhiều hơn một hóa đơn bán", () => {
    expect(CODE).toContain("if (posted.length > 1) {")
    expect(CODE).toContain("phát hành riêng")
  })

  it("dừng khi đơn chưa có hóa đơn bán nào", () => {
    expect(CODE).toContain("if (posted.length === 0) {")
  })

  /**
   * ⚠ KHÔNG CÒN TỰ INSERT `invoices` TỪ TỔNG CỦA ĐƠN. Bản cũ lập hoá đơn
   * điện tử thẳng từ `sales_orders` với tiền của cả đơn.
   */
  it("không tự dựng hoá đơn điện tử từ tổng của đơn", () => {
    expect(CODE).not.toMatch(/from\("invoices"\)\s*\n?\s*\.insert\(/)
    expect(CODE).toContain("ensureEInvoiceRow(supabase, {")
  })
})

// =====================================================================

describe("Bản in hóa đơn bán", () => {
  const CODE = strip(PRINT)

  it("đọc dòng từ sales_invoice_lines, không từ dòng đơn", () => {
    expect(CODE).toContain('.from("sales_invoice_lines")')
    expect(CODE).not.toContain('.from("sales_order_lines")')
  })

  /**
   * ⚠ HÓA ĐƠN ĐÃ HUỶ VẪN IN ĐƯỢC, và có dòng chữ nói rõ. Chặn in thì
   * người đang cầm tờ cũ không có cách nào đối chiếu; in ra một tờ trông
   * y như tờ còn hiệu lực thì tệ hơn nhiều.
   */
  it("hóa đơn đã huỷ in ra có dòng cảnh báo", () => {
    expect(CODE).toContain("HÓA ĐƠN ĐÃ HUỶ — không có giá trị thanh toán.")
    expect(CODE).not.toMatch(/canPrint|disabled=\{[^}]*status/)
  })

  /**
   * ⚠ A5 (chủ nhà chốt). Trước để A4 vì bảy cột ở khổ A5 thì chữ rơi
   * xuống 8pt; nhưng giấy A5 mới là thứ nằm trong máy in của kho, và
   * nhà phân phối in tờ này mỗi ngày vài chục lần. A4 vẫn chọn được ở
   * dropdown.
   */
  it("mặc định khổ A5", () => {
    expect(CODE).toContain('defaultPaper="A5"')
  })

  /** Mẫu không có dòng thuế — chỉ truyền `total` đã gồm thuế. */
  it("không truyền vat vào mẫu in", () => {
    expect(CODE).toContain("total={Number(inv.total) || 0}")
    expect(CODE).not.toMatch(/vat=\{/)
  })
})

// =====================================================================

describe("Bản in hoá đơn điện tử cũng đổi nguồn", () => {
  const CODE = strip(EPRINT)

  it("ưu tiên dòng hóa đơn bán, rơi về dòng đơn cho dữ liệu cũ", () => {
    const a = CODE.indexOf("if (invoiceData.sales_invoice_id) {")
    const b = CODE.indexOf('.from("sales_order_lines")')
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(CODE).toContain('.from("sales_invoice_lines")')
  })

  it("lấy cột sales_invoice_id về", () => {
    expect(CODE).toContain("sales_invoice_id, invoice_number")
  })
})

// =====================================================================

describe("Dialog ở chế độ sửa hóa đơn", () => {
  const CODE = strip(EDITOR) + "\n" + strip(EDITOR_LIB)

  /**
   * ⚠ KHÔNG DÙNG `remainingQty` KHI SỬA. Bản cũ chưa bị huỷ nên số lượng
   * của nó vẫn đang nằm trong `invoiced_qty`, tức `remainingQty` đã trừ
   * đi rồi — lấy thẳng là mở ra một hóa đơn trống trơn và người dùng
   * tưởng mất hàng.
   */
  it("gieo dòng từ bản cũ, không từ phần còn lại của đơn", () => {
    expect(CODE).toContain("function seedForReissue(")
    expect(CODE).toContain("qty: sd.quantity,")
  })

  /**
   * ⚠ MỐC "XUẤT VƯỢT" PHẢI CỘNG PHẦN BẢN CŨ ĐANG GIỮ, vì bản cũ sắp được
   * hoàn về. Không cộng thì mọi dòng đều bị nhuộm vàng "xuất vượt số
   * đặt" ngay khi mở dialog sửa.
   */
  it("mốc xuất vượt cộng cả phần bản cũ đang giữ", () => {
    expect(CODE).toContain("remainingQty: (info?.remainingQty ?? 0) + sd.quantity,")
  })

  /**
   * ⚠ DÒNG CỦA BẢN CŨ KHÔNG CÓ TRONG ĐƠN VẪN PHẢI GIỮ (hàng đem đổi,
   * hoặc dòng nhà phân phối thêm tay). Duyệt theo `seed` chứ không theo
   * `lines`; duyệt theo `lines` là lặng lẽ xoá hàng khỏi hóa đơn khi
   * người ta chỉ định sửa một con số.
   */
  it("duyệt theo dòng của bản cũ, không theo dòng của đơn", () => {
    expect(CODE).toContain("return seed.map((sd, i) => {")
  })

  it("gọi reissue_invoice khi đang sửa, post_invoice khi lập mới", () => {
    expect(CODE).toContain("? await reissueInvoice(supabase, reissueOf.invoiceId, {")
    expect(CODE).toContain(": await postInvoice(supabase, {")
  })
})

// =====================================================================

describe("Trang chi tiết hóa đơn bán", () => {
  const CODE = strip(DETAIL)

  /**
   * ⚠ ĐÂY LÀ CHỖ DUY NHẤT GỌI `cancel_invoice` VÀ `reissue_invoice`.
   * Không có hai nút này thì hai RPC ấy là mã chết, và một hóa đơn lập
   * sai không có đường nào sửa.
   */
  it("có nút huỷ và nút sửa", () => {
    expect(CODE).toContain("cancelInvoice(supabase, inv.id, cancelReason.trim())")
    // Sửa giờ là MỘT TRANG riêng, không còn hộp thoại gắn ở đây.
    expect(CODE).toContain("/sales-invoices/${inv.id}/edit")
    expect(strip(EDIT_PAGE)).toContain("reissueOf={{ invoiceId: inv.id,")
  })

  /**
   * ⚠ ĐIỀU HƯỚNG SANG BẢN MỚI SAU KHI LẬP LẠI. Đứng lại ở trang cũ là
   * người dùng nhìn một hóa đơn vừa bị huỷ và tưởng việc sửa thất bại —
   * rồi bấm Sửa lần nữa.
   */
  it("sửa xong thì chuyển sang bản mới", () => {
    expect(strip(EDITOR)).toContain("/sales-invoices/${r.invoiceId}")
  })

  /**
   * ⚠ CHỈ SỬA ĐƯỢC HÓA ĐƠN ĐÃ XUẤT. RPC cũng chặn, nhưng để người dùng
   * soạn xong cả màn rồi mới nhận mã lỗi là phí công họ — và một hóa đơn
   * đã huỷ mở ra ở màn sửa trông y như một hóa đơn còn hiệu lực.
   */
  it("màn sửa chặn hóa đơn không ở trạng thái đã xuất", () => {
    expect(strip(EDIT_PAGE)).toContain('if (row.status !== "posted")')
  })

  /**
   * ⚠ HOÁ ĐƠN ĐIỆN TỬ ĐÃ PHÁT HÀNH LÀ KHOÁ CỨNG. RPC cũng chặn
   * (`LOCKED_EINVOICE`); mờ nút ở đây để người dùng không bấm rồi nhận
   * một mã lỗi, chứ không phải để THAY chỗ chặn.
   */
  it("mờ nút huỷ/sửa khi đã phát hành hoá đơn điện tử", () => {
    expect(CODE).toContain("const eInvoiceIssued = !!eInvoice?.misa_inv_no")
    expect((CODE.match(/disabled=\{eInvoiceIssued\}/g) ?? []).length).toBe(2)
  })

  /**
   * ⚠ PHIẾU XUẤT RỖNG KHÔNG PHẢI LỖI HIỂN THỊ. Hóa đơn do backfill của
   * migration 124 tạo cho đơn cũ không có phiếu xuất đã ghi sổ — tồn kho
   * chưa bao giờ bị trừ cho chúng. Nói ra thay vì để một ô trống.
   */
  it("nói rõ khi hóa đơn không có phiếu xuất kho", () => {
    expect(CODE).toContain("tồn kho chưa từng bị trừ cho nó")
  })

  /**
   * ⚠ HÓA ĐƠN ĐÃ HUỶ PHẢI NÓI VÌ SAO VÀ THAY BẰNG CÁI GÌ. Để trống thì
   * người tra sổ thấy một chứng từ bị huỷ không rõ lý do, cạnh một phiếu
   * nhập hoàn kho không ai giải thích.
   */
  it("hóa đơn đã huỷ hiện lý do và liên kết bản thay thế", () => {
    expect(CODE).toContain("{inv.cancel_reason}")
    expect(CODE).toContain("Xem bản thay thế")
  })

  /** Lý do huỷ là bắt buộc — RPC cũng đòi (`REASON_REQUIRED`). */
  it("ô lý do huỷ ghi rõ là bắt buộc", () => {
    expect(CODE).toContain("Lý do (bắt buộc)")
  })

  /**
   * ⚠ LUẬT ĐÃ ĐỔI CÓ CHỦ Ý. Trước đây bảng dòng hiện thuế suất từng dòng;
   * chủ nhà 24/09/2026: "chi tiết hóa đơn có VAT từng dòng, cái này bỏ" —
   * như POS, thuế nói một lần ở khối Cộng tiền. Thay bằng cột Giảm giá.
   */
  it("bảng dòng không còn cột thuế từng dòng; có cột Giảm giá", () => {
    expect(CODE).not.toContain("Math.round(Number(l.vat_rate || 0) * 100)")
    expect(CODE).toContain('>Giảm giá</th>')
    expect(CODE).toContain("formatCurrency(donGiaTruocGiam(l))")
  })
})

// =====================================================================

describe("Danh sách hóa đơn bán", () => {
  // Màn này gồm trang + bảng + ngăn xem nhanh; chốt về "màn" soi cả ba.
  const CODE = strip(LIST) + "\n" + strip(INV_TABLE) + "\n" + strip(INV_DRAWER)

  /**
   * ⚠ NÓI RA KHI HÓA ĐƠN LÀ BẢN LẬP LẠI. Không có dấu này thì một hóa
   * đơn đã huỷ nằm cạnh một hóa đơn gần như y hệt, và người tra sổ không
   * biết cái nào thay cái nào.
   */
  it("đánh dấu bản lập lại và bản đã bị thay", () => {
    expect(CODE).toContain("{r.replaced_from && <Badge")
    expect(CODE).toContain("{r.replaced_by && <Badge")
  })

  /** Mặc định chỉ hiện hóa đơn còn hiệu lực, nhưng xem được cả đã huỷ. */
  it("lọc mặc định là hóa đơn đã xuất, và mở được cả đã huỷ", () => {
    expect(CODE).toContain('useState<string>("posted")')
    expect(CODE).toContain('{ key: "cancelled"')
    expect(CODE).toContain('{ key: "all"')
  })

  /**
   * ⚠ SỐ TRÊN THẺ ĐẾM CẢ SỔ, KHÔNG ĐẾM TRANG ĐANG XEM. Đếm từ `rows` thì
   * thẻ "Đã xuất" hiện 50 dù sổ có 4.000 — và con số trên thẻ mâu thuẫn
   * với con số dưới chân trang, ngay trên cùng một màn.
   */
  it("số trên thẻ trạng thái đếm từ máy chủ", () => {
    expect(CODE).toContain('{ count: "exact", head: true }')
    expect(CODE).not.toMatch(/count:\s*rows\.filter/)
  })

  /**
   * ⚠ LUẬT NÀY ĐÃ ĐẢO ngày 21/09/2026 (chủ nhà báo: "Tìm kiếm chỉ tìm
   * trong trang 1, phải tìm toàn bộ chứ?").
   *
   *   Luật cũ mà chốt này từng canh: placeholder PHẢI thú nhận "Tìm
   *   trong trang này", vì ô tìm chỉ lọc 50 dòng đang hiện. Đó là vá
   *   một lỗi bằng một dòng chữ.
   *
   *   Nay ô tìm hỏi máy chủ thật, nên placeholder KHÔNG được thú nhận
   *   nữa — và cũng không được hứa suông: chốt dưới buộc mỗi thứ nó hứa
   *   phải có một lượt tra thật trong mã. Xem
   *   `tests/list-search-server-side.test.ts`.
   */
  it("placeholder ô tìm nói đúng phạm vi nó tìm", () => {
    expect(CODE, "vẫn còn thú nhận chỉ tìm trong trang đang xem")
      .not.toContain("Tìm trong trang này")
    expect(CODE).toContain("Tìm số hóa đơn, mã đơn, tên khách…")
    /* Hứa gì thì phải tra thật thứ đó. */
    expect(CODE).toContain('table: "sales_orders", columns: ["order_code"]')
    expect(CODE).toContain('table: "customers", columns: ["store_name", "owner_name", "phone"]')
  })

  /**
   * ⚠ BẤM MÃ ĐƠN GỐC PHẢI SANG ĐƠN, không sang hóa đơn. Cả hàng đã điều
   * hướng; không chặn nổi bọt thì hai lệnh cùng chạy và người dùng đáp
   * xuống đúng chỗ họ không chọn.
   */
  it("liên kết đơn gốc chặn nổi bọt khỏi hàng", () => {
    expect(CODE).toContain("onClick={(e) => e.stopPropagation()}")
  })


  /**
   * ⚠ CÙNG KHUÔN DỰNG HÌNH VỚI MÀN ĐƠN HÀNG, không chỉ "cũng là bảng".
   * Chủ nhà nhìn ra ngay khi hai màn lệch nhau: bản trước dùng `<table>`
   * nên cột co giãn theo nội dung, còn màn đơn hàng dựng bằng CSS grid
   * với bề rộng cột cố định. Chốt này neo ba thứ dễ trôi nhất — vỏ thẻ,
   * hàng tiêu đề, và kiểu dòng — vào đúng chuỗi lớp màn đơn hàng đang
   * dùng, lấy TỪ CHÍNH FILE ĐÓ chứ không chép tay.
   */
  it("dùng chung khuôn thẻ và lưới với màn đơn hàng", () => {
    const ORDERS = read("src/app/(dashboard)/orders/page.tsx")
    const TABLE = read("src/components/orders/desktop-order-table.tsx")

    const SHELL =
      "hidden lg:flex flex-col overflow-hidden rounded-2xl border border-outline-variant/60 bg-surface-container-lowest"
    const TOOLBAR =
      "flex flex-wrap items-center gap-2 border-b border-outline-variant/40 px-4 py-3"
    const HEADROW =
      "grid h-[42px] items-center border-b border-outline-variant/40 bg-surface-container-low px-2"

    // Nếu màn đơn hàng đổi khuôn thì chốt đỏ ở đây TRƯỚC, thay vì hai màn
    // lặng lẽ trôi xa nhau cho tới khi có người nhìn thấy.
    expect(ORDERS, "màn đơn hàng đã đổi vỏ thẻ").toContain(SHELL)
    expect(ORDERS, "màn đơn hàng đã đổi thanh công cụ").toContain(TOOLBAR)
    expect(TABLE, "bảng đơn hàng đã đổi hàng tiêu đề").toContain(HEADROW)

    expect(strip(LIST)).toContain(SHELL)
    expect(strip(LIST)).toContain(TOOLBAR)
    expect(strip(INV_TABLE)).toContain(HEADROW)
  })

  /**
   * ⚠ MỘT HẰNG SỐ CỘT, DÙNG CHO CẢ TIÊU ĐỀ LẪN DÒNG. Chép ra hai chỗ là
   * một ngày nào đó sửa một chỗ, và tiêu đề lệch khỏi dữ liệu đúng một
   * cột — lỗi khó thấy nhất trong các lỗi dựng hình.
   */
  it("bề rộng cột dựng một lần, dùng cho tiêu đề lẫn dòng", () => {
    const T = strip(INV_TABLE)
    expect(T).toContain("const cols = [")
    expect((T.match(/gridTemplateColumns: cols/g) ?? []).length).toBe(2)
  })

  /** ⚠ Điện thoại phải có danh sách riêng — lưới 930px không vừa màn. */
  it("điện thoại có danh sách thẻ riêng", () => {
    expect(CODE).toContain('className="space-y-3 lg:hidden"')
  })


  /**
   * ⚠ CỘT TRÙNG NGHĨA PHẢI TRÙNG TÊN KHOÁ với màn đơn hàng. Đặt tên khác
   * cho cùng một thứ là hai màn trôi xa nhau từ từ, và người sửa sau phải
   * đọc cả hai file mới biết chúng có giống nhau không.
   */
  it("khoá cột trùng nghĩa dùng chung tên với màn đơn", () => {
    const ORDER_CFG = read("src/app/(dashboard)/orders/list-config.ts")
    const INV_CFG = read("src/app/(dashboard)/sales-invoices/list-config.ts")
    const keys = (src: string, name: string) => {
      const i = src.indexOf(`export const ${name} = [`)
      expect(i, `không tìm thấy ${name}`).toBeGreaterThan(-1)
      const body = src.slice(i, src.indexOf("] as const", i))
      return new Set((body.match(/key: "([a-zA-Z]+)"/g) ?? []).map((m) => m.slice(6, -1)))
    }
    const oc = keys(ORDER_CFG, "ORDER_COLUMNS")
    const ic = keys(INV_CFG, "INVOICE_COLUMNS")
    for (const k of ["customer", "route", "address", "salesUser", "date", "total", "status"]) {
      expect(oc.has(k), `màn đơn thiếu cột ${k}`).toBe(true)
      expect(ic.has(k), `màn hóa đơn thiếu cột ${k}`).toBe(true)
    }
  })

  /**
   * ⚠ ĐỊA CHỈ VÀ TUYẾN LÀ THỨ CHỦ NHÀ YÊU CẦU THÊM. Cả hai màn phải có,
   * và cả hai phải đi kèm cột `address` trong câu embed — thiếu cột thì
   * ô địa chỉ hiện "—" cho mọi dòng mà không lỗi nào bắn.
   */
  it("hai màn đều hỏi địa chỉ khách trong câu embed", () => {
    const ORDERS = read("src/app/(dashboard)/orders/page.tsx")
    expect(ORDERS).toContain("customer:customers(store_name, phone, channel, ward, address)")
    expect(strip(LIST)).toContain("customer:customers(store_name, phone, channel, ward, address)")
  })

  /**
   * ⚠ Lọc theo tuyến cần `!inner`, nếu không PostgREST không lọc nổi. Và
   * CHỈ khi đang lọc: `!inner` luôn là âm thầm bỏ mất hóa đơn nào RLS
   * không cho thấy dòng khách của nó.
   *
   * ⚠ ĐẾM CẢ HAI CHỖ. Bản đầu của chốt này NÓI DỐI: nó chỉ hỏi "chuỗi
   * ba ngôi có xuất hiện không", mà nó xuất hiện ở HAI chỗ — câu danh
   * sách và câu đếm. Sửa một chỗ thành `!inner` cứng thì chốt vẫn xanh,
   * và số trên thẻ trạng thái lặng lẽ lệch khỏi số dòng bên dưới.
   */
  it("lọc tuyến bật !inner, chỉ khi đang lọc, ở CẢ HAI câu", () => {
    const L = strip(LIST)
    expect(L).toContain('customer:customers!inner(store_name, phone, channel, ward, address)')
    /**
     * ⚠ BA CÂU, KHÔNG PHẢI HAI: danh sách · phép đếm của chip · phép
     * CỘNG TIỀN của dải tóm tắt trên điện thoại (mẫu mới). Câu nào quên
     * `!inner` khi đang lọc tuyến thì PostgREST trả lỗi "column
     * customer.channel does not exist" và con số của câu ấy về 0 — cạnh
     * hai con số kia vẫn đúng.
     */
    expect(
      (L.match(/routeFilter !== "all" \? CUSTOMER_EMBED_INNER : CUSTOMER_EMBED/g) ?? []).length,
      "danh sách, phép đếm và phép cộng tiền phải cùng một phép chọn embed"
    ).toBe(3)
    // Không chỗ nào dùng `!inner` vô điều kiện.
    expect(L).not.toMatch(/const cust = CUSTOMER_EMBED_INNER/)
  })

  /**
   * ⚠ LỌC Ở MÁY CHỦ, KHÔNG LỌC TRONG 50 DÒNG ĐANG XEM. Lọc tại chỗ thì
   * chọn "khách A" mà hóa đơn của A nằm ở trang 3 sẽ ra rỗng, và người
   * dùng kết luận là hóa đơn đã mất.
   */
  it("khách · NVBH · ngày · giá trị lọc ở máy chủ", () => {
    const L = strip(LIST)
    expect(L).toContain('x.eq("customer_id", customerFilter)')
    expect(L).toContain('x.eq("sales_user_id", salesFilter)')
    expect(L).toContain('x.gte("invoice_date", dateFrom)')
    expect(L).toContain('x.lte("total", Number(amountMax))')
  })

  /**
   * ⚠ MỘT HÀM LỌC, DÙNG CHO CẢ DANH SÁCH LẪN PHÉP ĐẾM. Chép ra hai chỗ
   * là một ngày nào đó thêm điều kiện vào một chỗ, và số trên thẻ trạng
   * thái không còn khớp với số dòng bên dưới — ngay trên cùng một màn.
   */
  it("phép đếm dùng chung bộ lọc với danh sách", () => {
    const L = strip(LIST)
    expect(L).toContain("const applyFilters = useCallback(")
    // Danh sách · phép đếm · phép cộng tiền — xem chốt embed ở trên.
    expect((L.match(/applyFilters\(q as never\)/g) ?? []).length).toBe(3)
  })

  /** Đổi bộ lọc mà đứng lại trang 7 của một kết quả 2 dòng là màn trắng. */
  it("đổi bộ lọc thì về trang 1", () => {
    const L = strip(LIST)
    const i = L.indexOf("pg.setPage(1)")
    expect(i).toBeGreaterThan(0)
    expect(L.slice(i, i + 260)).toContain("customerFilter")
  })

  /**
   * ⚠ XEM NHANH LÀ PHẦN CHỦ NHÀ GỌI TÊN. Không có nó thì muốn liếc một
   * hóa đơn phải rời danh sách, xem, rồi bấm quay lại — mà danh sách khi
   * đó đã về trang 1 và mất hết bộ lọc.
   */
  it("có ngăn xem nhanh, mở bằng cách chạm một dòng", () => {
    expect(strip(LIST)).toContain("<InvoiceDrawer")
    expect(strip(LIST)).toContain("onOpen={(inv) => setDrawerId(inv.id)}")
    expect(strip(INV_DRAWER)).toContain('side="right"')
  })

  /**
   * ⚠ TẢI DÒNG HÀNG HỎNG THÌ NÓI RA, đừng hiện "0 mặt hàng". Số 0 cho
   * một lỗi mạng đọc như một hóa đơn rỗng, và đó là một câu nói dối.
   */
  it("ngăn xem nhanh nói ra khi không tải được dòng hàng", () => {
    expect(strip(INV_DRAWER)).toContain("Không tải được dòng hàng")
  })

  /**
   * ⚠ TỔNG LẤY TỪ HÓA ĐƠN ĐÃ LƯU, không cộng lại từ dòng. Cộng lại là
   * dựng một phép tính thứ hai cạnh phép tính của RPC; hai phép thì sẽ có
   * ngày lệch, và con số trên màn không còn là con số trong sổ.
   */
  it("ngăn xem nhanh in tổng của hóa đơn, không tự cộng", () => {
    const D = strip(INV_DRAWER)
    /* ⚠ GHIM LUẬT, KHÔNG GHIM CHỮ. Con số đi qua khối dùng chung
       `InvoiceMoneySummary` từ 21/09/2026; điều phải giữ là nó lấy
       `invoice.total` chứ không cộng lại từ dòng hàng. */
    expect(D).toMatch(/total:\s*invoice\.total|formatCurrency\(invoice\.total\)/)
    expect(D).not.toMatch(/lines[^\n]*reduce\(/)
  })

  /**
   * ⚠ CHỈ HÓA ĐƠN ĐÃ XUẤT MỚI SỬA ĐƯỢC. Hiện nút Sửa trên một hóa đơn đã
   * huỷ là mời người ta đi vào một màn sẽ từ chối họ.
   */
  it("nút sửa trong ngăn chỉ hiện với hóa đơn đã xuất", () => {
    expect(strip(INV_DRAWER)).toContain("{canEdit && posted && (")
  })

  /**
   * ⚠ DÙNG LẠI `repAvatar` CỦA BẢNG ĐƠN, không chép sang. Avatar cùng một
   * nhân viên mà ra hai màu khác nhau ở hai màn cạnh nhau thì người dùng
   * tưởng là hai người.
   */
  it("avatar NVBH dùng chung hàm với bảng đơn", () => {
    expect(strip(INV_TABLE)).toContain('from "@/components/orders/desktop-order-table"')
    expect(strip(INV_TABLE)).toContain("repAvatar(r.sales_user?.full_name)")
  })

  it("không để màn hình thành ngõ cụt khi rỗng", () => {
    expect(CODE).toContain("Tới danh sách đơn")
  })
})

// =====================================================================

describe("Điều hướng phân biệt hai loại hóa đơn", () => {
  /**
   * ⚠ HAI MỤC KHÁC NHAU, TÊN PHẢI KHÁC NHAU. `/invoices` là hoá đơn điện
   * tử MISA; `/sales-invoices` là chứng từ thực xuất của kho. Cùng gọi
   * "Hóa đơn" là người dùng vào nhầm và tưởng dữ liệu biến mất.
   */
  it("thanh bên có cả hai, tên không trùng", () => {
    const SIDEBAR = read("src/components/layout/sidebar.tsx")
    expect(SIDEBAR).toContain('{ label: "Hóa đơn bán", href: "/sales-invoices"')
    expect(SIDEBAR).toContain('{ label: "Hóa đơn điện tử", href: "/invoices"')
  })

  /**
   * ⚠ THIẾU DÒNG TRONG BẢNG QUYỀN LÀ TRANG BỊ CHẶN VỚI MỌI VAI TRÒ TRỪ
   * CHỦ SỞ HỮU — và chặn không một lời giải thích.
   */
  it("trang mới có dòng trong bảng quyền điều hướng", () => {
    const NAV = read("src/lib/nav/nav-permission.ts")
    expect(NAV).toContain('"/sales-invoices": { module: "orders", feature: "orders" }')
  })
})
