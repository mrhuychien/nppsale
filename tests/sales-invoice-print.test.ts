import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

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

  it("có dòng Bằng chữ, đọc từ tổng cộng", () => {
    expect(TPL).toContain("Bằng chữ:")
    expect(TPL).toContain("numberToVietnameseWords(total)")
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
   * ⚠ MẪU GỬI KHÔNG CÓ DÒNG THUẾ, NHƯNG MÀN NÀY IN TỪ BẢNG `invoices` —
   * chứng từ có `vat` và nối với hoá đơn điện tử MISA. Bỏ dòng thuế khỏi
   * một chứng từ thuế là làm mất thông tin pháp lý. Nó hiện KHI CÓ.
   */
  it("thuế GTGT vẫn in khi hoá đơn có thuế", () => {
    expect(TPL).toContain("{vat > 0 && (")
    expect(TPL).toContain("Thuế GTGT")
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
