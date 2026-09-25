import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  grossUpLines,
  type SalesInvoiceLine,
} from "../src/components/printing/sales-invoice"

/**
 * MẪU IN HOÁ ĐƠN BÁN HÀNG — dựng theo bản KiotViet chủ NPP gửi.
 *
 * Chốt ở đây neo vào NHỮNG GÌ CÓ TRÊN TỜ GIẤY, không neo vào cách viết
 * mã. Mẫu in sai thì không lỗi nào bắn ra — nó chỉ in ra một tờ giấy
 * thiếu ô, và người ta phát hiện sau khi đã đưa cho khách.
 */
const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const TPL = read("src/components/printing/sales-invoice.tsx")
const TPL_CODE = code(TPL)
const PAGE = read("src/app/(dashboard)/invoices/[id]/print/page.tsx")
const CSS = read("src/app/globals.css")
const BTN = read("src/components/ui/print-button.tsx")

describe("Tờ hoá đơn có đủ ô như mẫu", () => {
  it("tiêu đề đúng chữ của mẫu, và là MẶC ĐỊNH chứ không phải chuỗi cứng", () => {
    /**
     * ⚠ KHUÔN NAY DÙNG CHO CẢ ĐƠN ĐẶT HÀNG (chủ nhà chốt: "mẫu in Đơn
     * đặt hàng giống Hoá đơn bán"), nên tiêu đề nhận từ ngoài. Nhưng
     * MẶC ĐỊNH phải vẫn là hóa đơn: nơi gọi quên truyền thì tờ giấy
     * không được mang tiêu đề trống.
     */
    expect(TPL).toContain('title = "HÓA ĐƠN BÁN HÀNG"')
    expect(TPL).toContain('numberLabel = "Số HĐ"')
    expect(TPL).toContain("{numberLabel}: {invoiceNumber")
  })

  /** Phần đầu là tên · địa chỉ · điện thoại NPP (chủ nhà chốt). */
  it("phần đầu in địa chỉ và điện thoại NPP", () => {
    expect(TPL).toContain("Địa chỉ: {org.address}")
    expect(TPL).toContain("Điện thoại: {org.phone}")
    /**
     * ⚠ VÀ PHẢI CÓ CHỖ NHẬP CHÚNG. Trước đây ba ô này chỉ có ở trình
     * hướng dẫn `/setup` — chạy MỘT LẦN — nên ai bỏ qua bước đó thì mọi
     * tờ hóa đơn in ra thiếu hẳn phần đầu mà không có gì báo.
     */
    const ORG_SETTINGS = read("src/app/(dashboard)/settings/org/page.tsx")
    expect(ORG_SETTINGS).toContain("<Label>Địa chỉ</Label>")
    expect(ORG_SETTINGS).toContain("<Label>Điện thoại</Label>")
    // ⚠ Gộp vào `settings` cũ, không ghi đè sạch các khoá khác.
    expect(ORG_SETTINGS).toContain("...existing,")
  })

  /** Bảy cột, đúng thứ tự trái → phải của mẫu. */
  it("bảng đủ bảy cột, đúng thứ tự", () => {
    /**
     * ⚠ BỎ CHÚ THÍCH TRƯỚC KHI DÒ THỨ TỰ. Trong `<thead>` có khối chú
     * thích giải thích bề rộng cột, và nó nhắc tên cột ("một cột CK
     * toàn số 0…") SỚM HƠN thẻ `<th>` thật — dò trên chữ thô thì thứ tự
     * đọc ra là thứ tự của câu văn, không phải của bảng.
     */
    const head = TPL.slice(TPL.indexOf("<thead>"), TPL.indexOf("</thead>"))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    const cols = ["STT", "Tên hàng và quy cách", "ĐVT", "SL", "Đ.giá", "CK", "Thành tiền"]
    let at = -1
    for (const c of cols) {
      const i = head.indexOf(c)
      expect(i, `thiếu cột ${c}`).toBeGreaterThan(-1)
      expect(i, `cột ${c} sai thứ tự`).toBeGreaterThan(at)
      at = i
    }
  })

  /**
   * CỘT **CK** ĐÃ KHÔI PHỤC — chủ nhà chốt "in giống mẫu".
   *
   * Chốt này đã đảo chiều HAI lần, nên ghi lại cả hai để lần sau không
   * đảo mù: bản đầu đòi in cột CK; bản thứ hai bỏ nó vì `grossUpLines`
   * in `Đ.giá = Thành tiền / SL` (suy ngược), nên cộng tay luôn khớp mà
   * không cần cột CK; bản này in lại vì tờ giấy đưa khách phải giống tờ
   * họ vẫn quen nhận.
   *
   * ⚠ VÀ VÌ THẾ CỘT CK PHẢI THAM GIA PHÉP TÍNH. In thẳng `discount` thô
   * bên cạnh một đơn giá đã quy đổi là dòng đó hết cộng ra được. Đẳng
   * thức phải giữ: Đ.giá × SL − CK = Thành tiền — xem chốt `grossUpLines`
   * bên dưới.
   */
  it("có cột CK, và CK quy cùng thang với thành tiền", () => {
    expect(TPL).toContain(">CK</th>")
    expect(TPL).toContain("{formatCurrency(l.ck)}")
    // ⚠ KHÔNG in `l.discount` thô — đó là số chưa quy đổi.
    expect(TPL).not.toContain("formatCurrency(l.discount)")
    expect(TPL).toContain("price: qty > 0 ? (amount + ck) / qty : Number(l.unitPrice || 0)")
    expect(TPL).toContain("{formatCurrency(l.price)}")
  })

  /**
   * BA DÒNG TỔNG — chủ nhà chốt "khôi phục phiếu in giống mẫu".
   *
   * Bản trước bỏ "Chiết khấu hóa đơn" và "Tổng cộng" vì chúng không thêm
   * thông tin: chiết khấu ở mức hóa đơn luôn là 0, và "Tổng cộng" lặp
   * đúng con số của "Tổng tiền hàng". Đúng về số học, nhưng tờ giấy đi
   * tới tay khách phải giống tờ họ vẫn quen nhận.
   */
  it("đủ ba dòng tổng nằm TRONG bảng như mẫu", () => {
    const body = TPL.slice(TPL.indexOf("<tbody>"), TPL.indexOf("</tbody>"))
    let at = -1
    for (const row of [">Tổng tiền hàng</td>", ">Chiết khấu hóa đơn ( )</td>", ">Tổng cộng</td>"]) {
      const i = body.indexOf(row)
      expect(i, `thiếu dòng ${row}`).toBeGreaterThan(-1)
      expect(i, `dòng ${row} sai thứ tự`).toBeGreaterThan(at)
      at = i
    }
    // "Tổng tiền hàng" của mẫu có cả TỔNG SỐ LƯỢNG ở cột SL.
    expect(TPL).toContain("const qtyTotal = lines.reduce")
    expect(TPL).toContain("{qtyTotal}")
  })

  /**
   * ⚠ ĐỌC SỐ PHẢI TRẢ, KHÔNG ĐỌC TỔNG HÓA ĐƠN. Người cầm tờ giấy đi thu
   * tiền đọc đúng dòng này. Không có hàng trả thì `netDue === total` nên
   * không đổi gì; có hàng trả thì đọc tổng hóa đơn là đòi khách nhiều
   * hơn số họ phải đưa.
   */
  it("có dòng Bằng chữ, đọc từ số còn phải thu", () => {
    expect(TPL).toContain("Bằng chữ:")
    expect(TPL).toContain("{bangChu(netDue)}")
    expect(TPL).toContain("const netDue = netDueOnInvoice(total, returnCredit)")
  })

  /** Mẫu có BA ô ký; bản cũ chỉ hai. */
  it("ba ô ký, mỗi ô có dòng (Ký, họ tên)", () => {
    for (const r of ["Người nhận hàng", "Kế toán", "Người bán"]) {
      expect(TPL, `thiếu ô ký "${r}"`).toContain(r)
    }
    expect(TPL).toContain("(Ký, họ tên)")
    expect(TPL).toContain("grid-cols-3")
  })

  /**
   * ⚠ HAI MỐC NÀY ĐÃ RA `lib/printing/doc-stamp` VÀ GHIM GIỜ VIỆT NAM.
   * Bản cũ nằm ngay trong component và dùng `d.getHours()` — tức giờ MÁY
   * ĐANG CHẠY. Trang in là Client Component nhưng Next vẫn dựng trước ở
   * máy chủ (UTC), nên tờ giấy mang giờ nào là tuỳ lúc bấm. Phép so ngày
   * giờ đúng đã được chốt riêng ở `tests/doc-stamp.test.ts`.
   */
  it("mốc thời gian lấy từ lib đã ghim giờ Việt Nam, không tự tính", () => {
    expect(TPL).toContain('from "@/lib/printing/doc-stamp"')
    expect(TPL).toContain("{stampVN(issuedAt)}")
    expect(TPL).toContain("{longDateVN(issuedAt)}")
    // Tự đọc giờ máy là quay lại đúng lỗi vừa sửa.
    expect(TPL_CODE).not.toContain("getHours()")
    expect(TPL_CODE).not.toContain("getFullYear()")
  })

  /** Mẫu in cả GIỜ ở dòng dưới tiêu đề, `formatDate` chỉ có ngày. */
  it("mốc dưới tiêu đề có cả giờ, và giờ đến từ created_at", () => {
    expect(TPL).toContain("Ngày {stampVN(issuedAt)}")
    const SALES_PAGE = read("src/app/(dashboard)/sales-invoices/[id]/print/page.tsx")
    // ⚠ `invoice_date` là cột kiểu `date` — in kèm giờ từ nó là in
    //   "07:00" cho mọi hóa đơn.
    expect(SALES_PAGE).toContain("docStampAt(inv.created_at, inv.invoice_date).at")
  })

  /**
   * ⚠ IN NHÃN CẢ KHI THIẾU DỮ LIỆU, như mẫu ("Liên hệ:" để trống). Ẩn cả
   * dòng là người đọc không biết ô đó vốn có tồn tại.
   */
  it("bốn nhãn khối khách hàng luôn in ra", () => {
    for (const label of ["Khách hàng:", "Địa chỉ:", "Liên hệ:", "Nhân Viên Bán Hàng:"]) {
      expect(TPL, `thiếu nhãn "${label}"`).toContain(label)
    }
    expect(TPL_CODE, "Địa chỉ bị ẩn khi trống").not.toContain("{customerAddress && (")
    expect(TPL_CODE, "Liên hệ bị ẩn khi trống").not.toContain("{customerPhone && (")
  })

  it("màn in lấy được SĐT khách và người bán hàng", () => {
    expect(PAGE).toContain("customer:customers(phone)")
    expect(PAGE).toContain("sales_user:users!sales_orders_sales_user_id_fkey(full_name, phone)")
    expect(PAGE).toContain("customerPhone={order?.customer?.phone}")
    expect(PAGE).toContain("salesPersonName={order?.sales_user?.full_name}")
  })
})

describe("Những chỗ KHÔNG được làm mất", () => {
  /**
   * ⚠ CHỐT NÀY ĐÃ ĐẢO CHIỀU, CÓ CHỦ Ý — chủ NPP chốt "bỏ dòng thuế đi,
   * in giống mẫu". Bản trước in dòng "Thuế GTGT" khi `vat > 0`.
   */
  it("không còn dòng thuế nào trên tờ giấy", () => {
    expect(TPL_CODE).not.toContain("Thuế GTGT")
    // Ba dòng tổng, đúng như mẫu — không hơn.
    const body = TPL.slice(TPL.indexOf("<tbody>"), TPL.indexOf("</tbody>"))
    expect(body).not.toContain("vat")
  })

  /**
   * ⚠ ĐÂY LÀ CHỐT GIỮ CHO TỜ GIẤY CỘNG ĐÚNG, và nó quan trọng hơn cả
   * việc bỏ dòng thuế.
   *
   * `invoices.total = subtotal + vat`. Bỏ dòng thuế mà giữ nguyên các
   * con số là in ra: hàng 600.000, chiết khấu 0, tổng cộng 660.000 —
   * khách cộng tay thấy lệch 60.000 và không dòng nào giải thích. Nên
   * mẫu quy mọi dòng về GIÁ ĐÃ GỒM THUẾ theo tỉ lệ `total / tổng dòng`.
   */
  it("cột tiền cộng KHỚP TUYỆT ĐỐI với tổng cộng", () => {
    const line = (id: string, qty: number, net: number): SalesInvoiceLine => ({
      id, name: id, unitName: "hộp", quantity: qty,
      unitPrice: net / qty, discount: 0, lineTotal: net,
    })

    /**
     * ⚠ PHẢI CÓ ÍT NHẤT HAI DÒNG. Hoá đơn một dòng thì dòng đó CHÍNH LÀ
     * dòng cuối, nên nó nhận trọn phần chênh và cột tiền khớp kể cả khi
     * phép quy đổi bị bỏ hẳn. Chốt một dòng là chốt không hỏi gì cả —
     * đã thử phá và nó vẫn xanh.
     */
    const a = grossUpLines([line("a", 20, 600_000), line("b", 10, 400_000)], 1_100_000)
    expect(a.goodsTotal).toBe(1_100_000)
    expect(a.rows.reduce((s, r) => s + r.amount, 0)).toBe(1_100_000)
    // Dòng KHÔNG PHẢI cuối cũng phải nở lên: 600.000 × 1,1.
    expect(a.rows[0].amount).toBe(660_000)
    expect(a.rows[0].price).toBe(33_000)
    expect(a.rows[1].amount).toBe(440_000)

    // Nhiều dòng + số lẻ: tổng vẫn phải khớp TUYỆT ĐỐI, không lệch 1 đồng.
    const b = grossUpLines(
      [line("x", 3, 100_000), line("y", 7, 33_333), line("z", 1, 1)],
      146_668
    )
    expect(b.rows.reduce((s, r) => s + r.amount, 0)).toBe(146_668)

    /**
     * ⚠ CỘT TIỀN LUÔN CỘNG RA ĐÚNG `total`, KHÔNG CỘNG RA GÌ KHÁC.
     *
     * Bản cũ nhận thêm `invoiceDiscount` và quy các dòng lên
     * `total + chiết khấu`, vì mẫu in khi ấy có một dòng "Chiết khấu hóa
     * đơn" để trừ lại. Chủ nhà đã chốt bỏ dòng đó; giữ tham số lại thì
     * cột tiền cộng ra một số lớn hơn ô tổng và không còn dòng nào trên
     * giấy giải thích phần chênh.
     */
    const c = grossUpLines([line("a", 10, 500_000)], 450_000)
    expect(c.goodsTotal).toBe(450_000)
    expect(c.rows.reduce((s, r) => s + r.amount, 0)).toBe(450_000)
  })

  /**
   * ⚠ HÀM TÍNH ĐÚNG MÀ JSX IN SỐ KHÁC THÌ VẪN LÀ TỜ GIẤY SAI. Chốt trên
   * chỉ kiểm hàm thuần; chốt này kiểm đúng ô "Tổng tiền hàng" trên bảng
   * thật sự in con số đã quy đổi.
   */
  it("ô Tổng tiền hàng in số đã quy đổi, không in tổng dòng thô", () => {
    const i = TPL.indexOf(">Tổng tiền hàng</td>")
    const row = TPL.slice(i, i + 400)
    // ⚠ Từ mig 183: ô này là `goodsTotal` (= total + chiết khấu hóa đơn) —
    //   cột tiền các dòng cộng lại; "Tổng cộng" vẫn là `total`.
    expect(row).toContain("{formatCurrency(goodsTotal)}")
    expect(row).not.toContain("lineTotal")
    expect(TPL).toContain("const { rows, goodsTotal } = grossUpLines(lines, total, chietKhauHD)")
  })

  it("có chiết khấu hóa đơn: các dòng cộng ra tiền hàng, tiền hàng − chiết khấu = tổng cộng", async () => {
    const { grossUpLines } = await import("../src/components/printing/sales-invoice")
    const dong = [
      { id: "a", name: "A", unitName: "hộp", quantity: 2, unitPrice: 100_000, discount: 0, lineTotal: 200_000 },
      { id: "b", name: "B", unitName: "hộp", quantity: 1, unitPrice: 50_000, discount: 0, lineTotal: 50_000 },
    ]
    // Tiền hàng 250.000, thuế 10% = 25.000, giảm đơn 30.000 → tổng 245.000.
    const { rows, goodsTotal } = grossUpLines(dong as never, 245_000, 30_000)
    expect(goodsTotal).toBe(275_000)
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(275_000)
    expect(goodsTotal - 30_000).toBe(245_000)
    // Không có chiết khấu thì y như trước.
    expect(grossUpLines(dong as never, 250_000).goodsTotal).toBe(250_000)
  })

  /**
   * ⚠ MÀN IN PHẢI TRUYỀN `total`, KHÔNG PHẢI `subtotal`. Truyền nhầm là
   * cả tờ giấy thiếu đúng phần thuế — mọi phép cộng vẫn khớp nhau nên
   * không chốt nào khác bắt được, chỉ có khách phát hiện.
   */
  it("màn in truyền TỔNG CỘNG đã gồm thuế xuống mẫu", () => {
    expect(PAGE).toContain("total={Number(invoice.total) || 0}")
    expect(PAGE).not.toContain("total={Number(invoice.subtotal)")
  })

  /** Hoá đơn không thuế: không dòng nào được đổi một đồng. */
  it("hoá đơn không thuế in ra y hệt số đã lưu", () => {
    const rows = grossUpLines(
      [
        { id: "a", name: "A", unitName: "hộp", quantity: 20, unitPrice: 30_000, discount: 0, lineTotal: 600_000 },
        { id: "b", name: "B", unitName: "lon", quantity: 5, unitPrice: 8_000, discount: 0, lineTotal: 40_000 },
      ],
      640_000
    )
    expect(rows.rows[0].amount).toBe(600_000)
    expect(rows.rows[0].price).toBe(30_000)
    expect(rows.rows[1].amount).toBe(40_000)
    expect(rows.rows[1].price).toBe(8_000)
  })

  /** Không dòng nào thì không nổ, và không bịa ra tiền. */
  it("bảng rỗng không làm hàm nổ", () => {
    const r = grossUpLines([], 0)
    expect(r.rows).toEqual([])
    expect(r.goodsTotal).toBe(0)
  })

  /**
   * ⚠ HOÁ ĐƠN KHÔNG NỐI ĐƠN VẪN PHẢI IN ĐƯỢC. `order_id` trống thì
   * `lines` rỗng — bản cũ có nhánh dựng một dòng gộp, đừng đánh rơi nó.
   */
  it("hoá đơn nhập tay vẫn có một dòng hàng", () => {
    expect(PAGE).toContain("lines.length > 0")
    expect(PAGE).toContain("Theo hóa đơn ${invoice.invoice_number")
  })

  it("bảng rỗng vẫn nói ra, không để trắng", () => {
    expect(TPL).toContain("Hoá đơn chưa có dòng hàng nào.")
  })
})

describe("Khổ giấy", () => {
  /**
   * ⚠ CHỦ NHÀ 25/09/2026: "tao muốn chọn khổ nào thì tràn ra khổ đấy trên hộp thoại
   * in của trình duyệt". Nút In không còn dropdown khổ — hộp thoại in quyết.
   */
  it("nút in của hoá đơn không ép khổ", () => {
    expect(PAGE).toContain('<PrintButton label="In hóa đơn" />')
    expect(BTN).not.toContain("defaultPaper")
  })

  /**
   * ⚠ Chọn A5 trong hộp thoại thì mẫu phải co lại. Không có khối gốc này thì bảng
   * tràn lề và cột tiền bị cắt — hỏng chỉ lộ ra trên giấy, sau khi đã in.
   */
  it("khổ nhỏ (A5) có cỡ riêng, khổ lớn giãn theo bề rộng giấy", () => {
    expect(CSS).toContain("html .a4-doc {")
    expect(CSS).toContain("html .a4-doc table")
    expect(CSS).toContain("@media print and (min-width: 160mm) {")
    expect(TPL).toContain('className="a4-doc')
  })
})
