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

  /** ⚠ A4: bảy cột ở khổ A5 thì chữ còn 8pt và hai cột tiền dính nhau. */
  it("mặc định khổ A4", () => {
    expect(CODE).toContain('defaultPaper="A4"')
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
   * ⚠ THUẾ SUẤT HIỆN RA TRÊN TỪNG DÒNG. Hai hóa đơn của cùng một đơn có
   * thể mang thuế suất khác nhau (snapshot theo ngày xuất) — không hiện
   * thì đó trông như một con số nhảy lung tung.
   */
  it("bảng dòng hiện thuế suất đã chốt", () => {
    expect(CODE).toContain("Math.round(Number(l.vat_rate || 0) * 100)")
  })
})

// =====================================================================

describe("Danh sách hóa đơn bán", () => {
  const CODE = strip(LIST)

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
   * ⚠ Ô TÌM CHỈ LỌC TRANG ĐANG XEM — nó không hỏi lại máy chủ. Placeholder
   * phải nói ra, nếu không người dùng gõ mã của một hóa đơn ở trang 3,
   * không thấy gì, và kết luận là hóa đơn đã mất.
   */
  it("placeholder ô tìm nói đúng phạm vi nó tìm", () => {
    expect(CODE).toContain("Tìm trong trang này")
  })

  /**
   * ⚠ BẤM MÃ ĐƠN GỐC PHẢI SANG ĐƠN, không sang hóa đơn. Cả hàng đã điều
   * hướng; không chặn nổi bọt thì hai lệnh cùng chạy và người dùng đáp
   * xuống đúng chỗ họ không chọn.
   */
  it("liên kết đơn gốc chặn nổi bọt khỏi hàng", () => {
    expect(CODE).toContain("onClick={(e) => e.stopPropagation()}")
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
