import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const FORM = readFileSync(
  resolve(ROOT, "src/components/orders/order-form.tsx"),
  "utf-8"
)

/**
 * Mã đã bỏ chú thích.
 *
 * ⚠ Bản đầu của phép kiểm "chưa chọn ngày giao" soi cả chú thích — mà
 * chú thích ở trên cũng nhắc đúng câu đó. Thử phá bằng cách xoá câu
 * trong MÃ: test vẫn xanh, vì nó đang đọc lời giải thích. Chỗ nào kiểm
 * chuỗi hiển thị thì phải đọc mã, không đọc chú thích.
 */
const CODE = FORM.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("Khối Điều khoản & Giao hàng gập lại", () => {
  /**
   * Hai ô trong khối này gần như luôn để mặc định — điều khoản lấy theo
   * khách, ngày giao thường bỏ trống. Mở sẵn thì chúng đẩy phần SẢN PHẨM
   * (chỗ NVBH thật sự làm việc) xuống một màn cuộn, mỗi lần tạo đơn.
   */
  it("mặc định đóng, bấm mới xổ ra", () => {
    expect(FORM).toContain("const [termsOpen, setTermsOpen] = useState(false)")
    expect(FORM).toContain("onClick={() => setTermsOpen((v) => !v)}")
    expect(FORM).toContain("{termsOpen && (")
  })

  /**
   * ⚠ ĐIỀU KIỆN ĐỂ VIỆC GẬP CÓ NGHĨA. Gập lại mà không cho thấy đang đặt
   * gì thì người dùng phải mở ra mới biết đúng hay sai — tức là gập xong
   * vẫn phải bấm, không tiết kiệm được gì.
   */
  it("khi đóng vẫn cho thấy đang đặt gì", () => {
    expect(FORM).toContain("const termsSummary = useMemo(")
    expect(FORM).toContain("{termsSummary}")
    // Tóm tắt phải nằm trong nút bấm, tức là luôn nhìn thấy kể cả khi đóng.
    const header = FORM.slice(
      FORM.indexOf("onClick={() => setTermsOpen"),
      FORM.indexOf("{termsOpen && (")
    )
    expect(header).toContain("{termsSummary}")
  })

  /**
   * Dùng NHÃN của điều khoản chứ không phải mã: người đọc dòng này là
   * NVBH đứng ở quầy khách, không phải người viết mã.
   */
  it("tóm tắt dùng nhãn tiếng Việt, không phải mã NET30", () => {
    expect(FORM).toContain("PAYMENT_TERMS.find((t) => t.value === paymentTerms)?.label")
  })

  /**
   * ⚠ Chưa chọn ngày giao thì phải NÓI RA. Để trống chỗ đó là người ta
   * không phân biệt được "chưa điền" với "màn hình chưa tải xong".
   */
  it("chưa chọn ngày giao thì nói ra, không để trống", () => {
    expect(CODE).toContain('"chưa chọn ngày giao"')
  })

  /** Nút gập phải là nút thật, đọc được bằng trình đọc màn hình. */
  it("là nút thật, có khai trạng thái đóng mở", () => {
    expect(FORM).toContain("aria-expanded={termsOpen}")
    expect(FORM).toContain('aria-controls="terms-delivery-body"')
    expect(FORM).toContain('id="terms-delivery-body"')
  })

  /** Hai ô bên trong vẫn còn nguyên, chỉ là nằm sau một cú bấm. */
  it("không mất ô nào", () => {
    expect(FORM).toContain("Điều khoản thanh toán")
    expect(FORM).toContain("Ngày giao dự kiến")
    expect(FORM).toContain("onValueChange={setPaymentTerms}")
    expect(FORM).toContain("onChange={(e) => setExpectedDelivery(e.target.value)}")
  })
})
