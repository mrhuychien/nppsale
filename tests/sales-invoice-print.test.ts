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
  it("tiêu đề đúng chữ của mẫu", () => {
    expect(TPL).toContain("HÓA ĐƠN BÁN HÀNG")
    expect(TPL).toContain("Số HĐ:")
  })

  /** Bảy cột, đúng thứ tự trái → phải của mẫu. */
  it("bảng đủ bảy cột, đúng thứ tự", () => {
    const head = TPL.slice(TPL.indexOf("<thead>"), TPL.indexOf("</thead>"))
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
   * ⚠ CỘT **CK** LÀ THỨ MẪU CŨ KHÔNG CÓ. Thiếu nó thì hoá đơn có chiết
   * khấu dòng in ra đúng tổng nhưng không giải thích được vì sao — khách
   * cộng tay theo đơn giá × SL sẽ ra số khác.
   */
  it("chiết khấu từng dòng thật sự được in", () => {
    expect(TPL).toContain("formatCurrency(l.discount)")
    expect(PAGE).toContain("discount: Number(l.line_discount) || 0")
    expect(PAGE).toContain("line_discount")
  })

  it("ba dòng tổng nằm TRONG bảng như mẫu", () => {
    for (const row of ["Tổng tiền hàng", "Chiết khấu hóa đơn ( )", "Tổng cộng"]) {
      expect(TPL, `thiếu dòng "${row}"`).toContain(row)
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
    expect(TPL).toContain("numberToVietnameseWords(netDue)")
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

  it("có dòng ngày dài trên ô ký", () => {
    expect(TPL).toContain("function longDate")
    expect(TPL).toContain("`Ngày ${p(x.getDate())} tháng ${p(x.getMonth() + 1)} năm ${x.getFullYear()}`")
  })

  /** Mẫu in cả GIỜ ở dòng dưới tiêu đề, `formatDate` chỉ có ngày. */
  it("mốc dưới tiêu đề có cả giờ", () => {
    expect(TPL).toContain("function stamp")
    expect(TPL).toContain("${p(d.getHours())}:${p(d.getMinutes())}")
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

    // Có chiết khấu hoá đơn: Tổng tiền hàng − CK = Tổng cộng.
    const c = grossUpLines([line("a", 10, 500_000)], 450_000, 50_000)
    expect(c.goodsTotal).toBe(500_000)
    expect(c.goodsTotal - 50_000).toBe(450_000)
  })

  /**
   * ⚠ HÀM TÍNH ĐÚNG MÀ JSX IN SỐ KHÁC THÌ VẪN LÀ TỜ GIẤY SAI. Chốt trên
   * chỉ kiểm hàm thuần; chốt này kiểm đúng ô "Tổng tiền hàng" trên bảng
   * thật sự in con số đã quy đổi.
   */
  it("ô Tổng tiền hàng in số đã quy đổi, không in tổng dòng thô", () => {
    const i = TPL.indexOf("Tổng tiền hàng")
    const row = TPL.slice(i, i + 400)
    expect(row).toContain("{formatCurrency(goodsTotal)}")
    expect(row).not.toContain("lineTotal")
    expect(TPL).toContain("const { rows, goodsTotal } = grossUpLines(lines, total, invoiceDiscount)")
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
   * ⚠ MẶC ĐỊNH CỦA KHO NÀY LÀ A5 (phiếu giao). Hoá đơn bảy cột ở A5 thì
   * chữ rơi xuống 8pt và hai cột tiền dính nhau — nên chứng từ này phải
   * tự khai A4, không bắt người dùng nhớ mở dropdown mỗi lần in.
   */
  it("nút in của hoá đơn mặc định A4", () => {
    expect(PAGE).toContain('<PrintButton label="In hóa đơn" defaultPaper="A4" />')
    expect(BTN).toContain("defaultPaper?: PaperSize")
    expect(BTN).toContain('defaultPaper = "A5"')
  })

  /** Dấu tick trong dropdown phải chỉ đúng khổ mặc định của chứng từ. */
  it("dropdown đánh dấu đúng khổ mặc định", () => {
    expect(BTN).toContain("sz === defaultPaper ? (")
  })

  /**
   * ⚠ Dropdown VẪN cho chọn A5. Không có khối CSS này thì chọn A5 là
   * bảng tràn lề và cột tiền bị cắt — hỏng chỉ lộ ra trên giấy, sau khi
   * đã in.
   */
  it("chọn A5 thì mẫu co lại, không tràn lề", () => {
    expect(CSS).toContain('html:not([data-paper-size="A4"]) .a4-doc {')
    expect(CSS).toContain('html:not([data-paper-size="A4"]) .a4-doc table')
    expect(TPL).toContain('className="a4-doc')
  })
})
