import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { returnCreditOf, toReturnLine, type ReturnCartLine } from "../src/lib/sell/returns"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const NEW = code(read("src/app/(dashboard)/returns/new/page.tsx"))
const MIG035 = read("supabase/migrations/035_return_exchange.sql")

const r = (over: Partial<ReturnCartLine> = {}): ReturnCartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 1,
  price: 100_000,
  vatRate: 0,
  isExchange: false,
  note: "",
  ...over,
})

describe("Phiếu trả phải có HÀNG, không chỉ có tiền", () => {
  /**
   * ⚠ LỖI GỐC. Màn lập phiếu trả chỉ có: chọn khách, chọn lý do, và GÕ TAY
   * một con số "Giá trị Credit Note" — không dòng hàng nào. Kho không biết
   * nhận lại cái gì; số tiền trừ công nợ là con số ai đó tự gõ, không đối
   * chiếu được với mặt hàng nào; và màn chi tiết phiếu trả VẪN đọc
   * `return_lines` để hiện bảng hàng nên mọi phiếu tạo từ đây mở ra rỗng.
   */
  it("có ghi dòng hàng xuống return_lines", () => {
    expect(NEW).toContain('.from("return_lines")')
    expect(NEW).toContain("lines.map((l) => ({ return_id: head.id, ...toReturnLine(l) }))")
  })

  /** ⚠ Phiếu 0 dòng vẫn hiện ở danh sách, và không ai biết phải nhận lại gì. */
  it("không cho lưu phiếu rỗng", () => {
    expect(NEW).toContain("lines.length === 0")
    expect(NEW).toContain("Thêm ít nhất một mặt hàng")
  })

  /**
   * ⚠ Không còn ô gõ tay số tiền. Con số đó là thứ sinh ra vấn đề: nó không
   * buộc phải bằng tổng các dòng, và trigger cũng không đụng tới phiếu
   * không có dòng nào.
   */
  it("không còn ô nhập tay giá trị credit note", () => {
    expect(NEW).not.toContain("setCreditAmount")
    expect(NEW).not.toContain("Giá trị Credit Note")
  })

  /** Tiền là TỔNG các dòng, tính bằng chính phép dùng ở luồng bán hàng. */
  it("tiền trừ công nợ tính từ các dòng", () => {
    expect(NEW).toContain("const credit = returnCreditOf(lines)")
    expect(NEW).toContain("credit_note_amount: credit,")
  })

  /**
   * ⚠ Trigger `trg_return_lines_sync_credit` mới là NGƯỜI GIỮ SỔ: nó tính
   * lại `credit_note_amount` từ các dòng KHÔNG đổi-hàng mỗi khi dòng đổi.
   * Ghi sẵn ở màn hình chỉ để phiếu không có khoảnh khắc nào mang số 0.
   */
  it("trigger dưới database vẫn là nơi chốt con số", () => {
    expect(MIG035).toContain("CREATE TRIGGER trg_return_lines_sync_credit")
    expect(MIG035).toContain("AND is_exchange = false")
  })
})

describe("Giá trả bám theo giá ĐÃ BÁN", () => {
  /**
   * ⚠ Khách mua có chiết khấu thì trả lại phải tính đúng số tiền họ đã trả.
   * Lấy giá bảng hôm nay là hoàn cho khách nhiều hơn (hoặc ít hơn) số đã
   * thu — và chênh lệch đó không ai đối chiếu được vì phiếu trả không nói
   * nó bám vào đơn nào.
   */
  it("thêm từ đơn thì lấy đơn giá của đơn", () => {
    const i = NEW.indexOf("const addFromOrder =")
    expect(i, "không tìm thấy addFromOrder").toBeGreaterThan(0)
    const body = NEW.slice(i, NEW.indexOf("\n  }", i))
    expect(body).toContain("price: Number(l.unit_price) || 0")
    expect(body).not.toContain("sell_price")
  })

  /** Trần giá cũng là giá đã bán khi có đơn, chứ không phải giá bảng. */
  it("trần giá lấy theo đơn khi phiếu gắn đơn", () => {
    expect(NEW).toContain(
      "const ceiling = sold ? Number(sold.unit_price) : Number(p?.sell_price ?? 0)"
    )
    expect(NEW).toContain("returnPriceViolation(l, ceiling, priceRules)")
    // ⚠ Trần giá trả = trần giá bán của chính người đó, ở CẢ hai màn lập
    // phiếu trả. Hai màn hai trần là mở đường cho người ta chọn màn dễ hơn.
    expect(NEW).toContain("const priceRules = (() => {")
    expect(NEW).toContain("userPriceRulesFrom(user)")
  })

  /** ⚠ Trả cao hơn giá đã bán là một đường rút tiền — phải CHẶN, không chỉ tô đỏ. */
  it("giá vượt trần thì không lưu được", () => {
    expect(NEW).toContain("priceBad > 0")
    expect(NEW).toContain("Có dòng trả vượt trần giá")
  })

  /**
   * Gắn phiếu vào chứng từ gốc để đối chiếu được, nhưng KHÔNG bắt buộc —
   * khách vẫn trả được hàng mua từ lâu không còn tra ra chứng từ.
   *
   * ⚠ V2B ĐỔI MỐC SANG HÓA ĐƠN. Khách chỉ trả được thứ đã THỰC XUẤT; đơn
   * đặt 100 mà mới giao 40 thì trần trả là 40. Gắn vào đơn là cho phép
   * nhập kho 60 món chưa từng rời kho — và cả trigger (mig 124) lẫn RPC
   * (mig 127) đều đếm theo hóa đơn, nên phiếu gắn sai chỗ sẽ vấp lỗi ở
   * màn Hoàn thành, một chỗ chẳng liên quan gì tới việc người ta vừa làm.
   */
  it("gắn hóa đơn là tuỳ chọn", () => {
    expect(NEW).toContain("invoice_id: invoiceId || null")
    expect(NEW).toContain("Không gắn hóa đơn nào")
  })

  /**
   * ⚠ GHI CẢ HAI KHOÁ NGOẠI. `invoice_id` là mốc thật của v2b, còn
   * `order_id` là thứ mọi báo cáo lịch sử đang đọc — bỏ nó là đứt một
   * nửa sổ.
   */
  it("ghi cả order_id suy ra từ hóa đơn đã chọn", () => {
    expect(NEW).toContain(
      "order_id: invoices.find((i) => i.id === invoiceId)?.order_id ?? null,"
    )
  })

  /**
   * ⚠ CHỈ HÓA ĐƠN CÒN HIỆU LỰC. Hóa đơn đã huỷ đã hoàn hàng về kho rồi;
   * gắn phiếu trả vào nó là nhập kho lần thứ hai cho cùng một lô hàng.
   */
  it("danh sách chọn chỉ có hóa đơn đã xuất", () => {
    expect(NEW).toContain('.from("sales_invoices")')
    expect(NEW).toContain('.eq("status", "posted")')
  })

  /**
   * ⚠ GỢI Ý LẤY TỪ DÒNG HÓA ĐƠN, không từ dòng đơn: đúng số đã giao và
   * đúng giá đã bán của chính chuyến đó. Dòng đơn có thể ghi số lớn hơn
   * thứ đã ra khỏi kho, và giá thì có thể đã bị sửa lúc xuất.
   */
  it("gợi ý hàng lấy từ dòng hóa đơn", () => {
    expect(NEW).toContain('.from("sales_invoice_lines")')
    expect(NEW).not.toContain('.from("sales_order_lines")')
  })
})

describe("Ghi hỏng thì nói ra", () => {
  /** ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. */
  it("đầu phiếu không tạo được thì báo, không đi tiếp", () => {
    expect(NEW).toContain("if (!head?.id) {")
    expect(NEW).toContain("bạn không có quyền trên đơn vị này")
  })

  /**
   * ⚠ ĐẦU PHIẾU GHI ĐƯỢC MÀ DÒNG HÀNG BỊ TỪ CHỐI thì sinh ra đúng thứ vừa
   * đi sửa: một phiếu trả có tiền mà không có hàng.
   */
  it("chèn thiếu dòng hàng thì báo, không nói 'đã tạo'", () => {
    expect(NEW).toContain("if (!inserted || inserted.length !== lines.length) {")
    expect(NEW).toContain("dòng hàng. Mở phiếu ra kiểm tra")
  })

  /** Danh mục đọc hỏng mà hiện rỗng là để người dùng kết luận "chưa có khách nào". */
  it("đọc danh mục hỏng thì hiện lỗi", () => {
    expect(NEW).toContain("setLoadError(custRes.error ?? prodRes.error ?? null)")
    expect(NEW).toContain("Không tải được danh mục")
  })

  /** ⚠ Hơn 1.000 khách là chuyện thường, mà server cắt ở 1.000 dòng và không báo. */
  it("danh mục khách và sản phẩm đều phân trang", () => {
    const uses = NEW.match(/fetchAllForAggregate</g) ?? []
    expect(uses.length, "thiếu phân trang ở khách hoặc ở sản phẩm").toBe(2)
  })

  /** Nút mờ không nói gì là người dùng bấm mãi rồi đi hỏi. */
  it("nút bị khoá thì nói rõ vì sao", () => {
    expect(NEW).toContain("disabled={!!blocked || saving}")
    expect(NEW).toContain("title={blocked ?? undefined}")
    expect(NEW).toContain("{saving ? \"Đang lưu...\" : (blocked ?? \"Tạo phiếu trả\")}")
  })
})

describe("Dùng chung phép tính với luồng bán hàng", () => {
  /**
   * ⚠ Hai màn cùng lập phiếu trả — một trong luồng bán hàng, một độc lập.
   * Chép lại phép tính tiền là mở đường cho hai màn ra hai con số khác nhau
   * cho cùng một rổ hàng.
   */
  it("không tự viết lại phép cộng tiền hay phép dựng dòng", () => {
    expect(NEW).toContain('from "@/lib/sell/returns"')
    expect(NEW).toContain("returnCreditOf")
    expect(NEW).toContain("toReturnLine")
    expect(NEW).toContain("addReturnLine")
  })

  it("phép tính đó vẫn đúng: đổi hàng không trừ tiền, trả tiền có VAT", () => {
    expect(returnCreditOf([r({ qty: 2 }), r({ productId: "p2", isExchange: true, qty: 9 })])).toBe(
      200_000
    )
    expect(returnCreditOf([r({ vatRate: 0.08 })])).toBe(108_000)
  })

  it("dòng ghi xuống DB luôn mang is_exchange", () => {
    expect(Object.keys(toReturnLine(r()))).toContain("is_exchange")
  })
})
