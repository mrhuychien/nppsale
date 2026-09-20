import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  lineFromProduct, lineTotalOf, linePayload, returnTotals, searchReturnProducts,
  unitPatch, validReturnLines, friendlyReturnError,
  type ReturnLine, type ReturnProduct,
} from "../src/lib/purchasing/return-form"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích trước khi soi — chữ trong chú thích không phải là code. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const FORM = strip(read("src/components/purchasing/purchase-return-form.tsx"))
const NEW_PAGE = strip(read("src/app/(dashboard)/purchase-returns/new/page.tsx"))
const EDIT_PAGE = strip(read("src/app/(dashboard)/purchase-returns/[id]/edit/page.tsx"))

const prod = (o: Partial<ReturnProduct> = {}): ReturnProduct =>
  ({
    id: "p1",
    sku: "SKU1",
    name: "Bánh hình kẹo 160g",
    barcode: "8934567890123",
    base_unit: "hộp",
    vat_rate: 0.1,
    cost_price: 8000,
    units: [{ id: "u1", product_id: "p1", unit_name: "thùng", conversion: 12 }],
    ...o,
  }) as unknown as ReturnProduct

const line = (o: Partial<ReturnLine> = {}): ReturnLine => ({
  id: "l1",
  product_id: "p1",
  product_name: "Bánh hình kẹo 160g",
  sku: "SKU1",
  unit_name: "hộp",
  quantity: "2",
  unit_price: "8000",
  vat_rate: "10",
  conversion_factor: "1",
  available_units: [],
  base_unit: "hộp",
  ...o,
})

describe("dựng dòng từ mặt hàng vừa chọn", () => {
  /**
   * ⚠ `products.vat_rate` LÀ TỈ LỆ (0,1) CÒN Ô NÀY LÀ PHẦN TRĂM. Bản cũ
   * chép thẳng `String(p.vat_rate)` → ô "VAT %" nhận "0.1", và phép tính
   * `/100` biến nó thành 0,1% thay cho 10%. Thuế hụt đúng 100 lần, không
   * một dòng nào trên màn kêu lên.
   */
  it("thuế suất đổi từ tỉ lệ sang phần trăm", () => {
    expect(lineFromProduct(prod(), 1).vat_rate).toBe("10")
    expect(lineFromProduct(prod({ vat_rate: 0.08 } as Partial<ReturnProduct>), 1).vat_rate).toBe("8")
    expect(lineFromProduct(prod({ vat_rate: 0 } as Partial<ReturnProduct>), 1).vat_rate).toBe("0")
  })

  /**
   * ⚠ KHÔNG ĐIỀN SẴN SỐ LƯỢNG. Điền 1 là để một con số KHÔNG AI GÕ có cơ
   * hội đi thẳng vào phiếu — và phiếu trả NCC thì trừ kho thật.
   */
  it("số lượng để trống cho người dùng gõ", () => {
    expect(lineFromProduct(prod(), 1).quantity).toBe("")
  })

  /** ⚠ Kho trừ theo đơn vị cơ sở — mặc định phải là nó, hệ số 1. */
  it("mặc định đơn vị cơ sở, hệ số 1", () => {
    const l = lineFromProduct(prod(), 1)
    expect(l.unit_name).toBe("hộp")
    expect(l.conversion_factor).toBe("1")
  })

  it("điền sẵn giá vốn và giữ tên, mã, bảng quy đổi", () => {
    const l = lineFromProduct(prod(), 1)
    expect(l.unit_price).toBe("8000")
    expect(l.product_name).toBe("Bánh hình kẹo 160g")
    expect(l.sku).toBe("SKU1")
    expect(l.available_units).toHaveLength(1)
  })

  /**
   * ⚠ CHƯA CÓ GIÁ VỐN THÌ ĐỂ TRỐNG, đừng điền 0. Số 0 đọc như "hàng này
   * cho không" và đi thẳng vào khoản giảm công nợ NCC.
   */
  it("chưa có giá vốn thì để trống, không điền 0", () => {
    expect(lineFromProduct(prod({ cost_price: 0 } as Partial<ReturnProduct>), 1).unit_price).toBe("")
  })

  /** Hai lần thêm cùng một mã phải ra hai khoá khác nhau. */
  it("khoá dòng không đụng nhau", () => {
    expect(lineFromProduct(prod(), 1).id).not.toBe(lineFromProduct(prod(), 2).id)
  })
})

describe("đổi đơn vị của dòng", () => {
  it("đơn vị quy đổi kéo theo hệ số của nó", () => {
    const l = line({ available_units: [{ id: "u1", product_id: "p1", unit_name: "thùng", conversion: 12 }] })
    expect(unitPatch(l, "thùng")).toEqual({ unit_name: "thùng", conversion_factor: "12" })
  })

  /**
   * ⚠ ĐƠN VỊ CƠ SỞ LUÔN LÀ 1, kể cả khi nó cũng nằm trong bảng quy đổi
   * với một hệ số khác. Tra bảng trước rồi mới xét là mở đường cho một
   * dòng "hộp × 20" trong khi hộp chính là đơn vị cơ sở — kho bị trừ gấp
   * hai mươi lần.
   */
  it("đơn vị cơ sở luôn hệ số 1, dù bảng quy đổi nói khác", () => {
    const l = line({
      base_unit: "hộp",
      available_units: [{ id: "u9", product_id: "p1", unit_name: "hộp", conversion: 20 }],
    })
    expect(unitPatch(l, "hộp")).toEqual({ unit_name: "hộp", conversion_factor: "1" })
  })

  it("đơn vị lạ thì về hệ số 1, không ra NaN", () => {
    expect(unitPatch(line(), "lố").conversion_factor).toBe("1")
  })
})

describe("cộng phiếu", () => {
  it("cộng tiền hàng và thuế theo phần trăm", () => {
    const t = returnTotals([line({ quantity: "2", unit_price: "8000", vat_rate: "10" })])
    expect(t.sub).toBe(16000)
    expect(t.vat).toBe(1600)
    expect(t.total).toBe(17600)
  })

  /**
   * ⚠ Ô TRỐNG LÀ 0, KHÔNG PHẢI `NaN`. Một dòng vừa thêm chưa gõ số lượng
   * mà làm cả phiếu thành "NaN đ" là màn hình nói dối về một phiếu hoàn
   * toàn bình thường đang soạn dở.
   */
  it("dòng còn trống không làm hỏng tổng", () => {
    const t = returnTotals([
      line({ quantity: "2", unit_price: "8000", vat_rate: "10" }),
      line({ id: "l2", quantity: "", unit_price: "", vat_rate: "" }),
    ])
    expect(Number.isNaN(t.total)).toBe(false)
    expect(t.total).toBe(17600)
  })

  it("phiếu rỗng ra 0", () => {
    expect(returnTotals([])).toEqual({ sub: 0, vat: 0, total: 0 })
  })

  it("thành tiền một dòng đã gồm thuế", () => {
    expect(lineTotalOf(line({ quantity: "2", unit_price: "8000", vat_rate: "10" }))).toBe(17600)
    expect(Number.isNaN(lineTotalOf(line({ quantity: "", unit_price: "" })))).toBe(false)
  })
})

describe("dòng nào được ghi xuống", () => {
  /**
   * ⚠ SỐ LƯỢNG PHẢI DƯƠNG. Dòng số lượng 0 ghi xuống là một dòng phiếu
   * không trả gì, mà RPC vẫn đi tìm lô để trừ cho nó.
   */
  it("bỏ dòng chưa chọn hàng và dòng số lượng 0", () => {
    const out = validReturnLines([
      line({ id: "ok" }),
      line({ id: "chưa chọn", product_id: "" }),
      line({ id: "không số", quantity: "0" }),
      line({ id: "trống", quantity: "" }),
    ])
    expect(out.map((l) => l.id)).toEqual(["ok"])
  })

  it("giá 0 vẫn được ghi — hàng trả không tính tiền là chuyện có thật", () => {
    expect(validReturnLines([line({ unit_price: "0" })])).toHaveLength(1)
  })
})

describe("tải trọng gửi lên máy chủ", () => {
  it("đúng hình dạng bảng supplier_return_lines", () => {
    expect(linePayload("r1", line({ quantity: "2", unit_price: "8000", vat_rate: "10" }))).toEqual({
      return_id: "r1",
      product_id: "p1",
      unit_name: "hộp",
      quantity: 2,
      unit_price: 8000,
      vat_rate: 10,
      conversion_factor: 1,
      line_total: 17600,
    })
  })

  /** ⚠ Đơn vị trống thì lấy đơn vị cơ sở — cột `unit_name` là NOT NULL. */
  it("đơn vị trống thì rơi về đơn vị cơ sở", () => {
    expect(linePayload("r1", line({ unit_name: "" })).unit_name).toBe("hộp")
  })

  it("hệ số quy đổi hỏng thì về 1, không gửi NaN", () => {
    expect(linePayload("r1", line({ conversion_factor: "" })).conversion_factor).toBe(1)
  })
})

describe("ô tìm hàng của phiếu", () => {
  const cat = [prod(), prod({ id: "p2", sku: "SKU2", name: "Kem Đậu Xanh", barcode: "111" } as Partial<ReturnProduct>)]

  /** ⚠ Bỏ dấu trước khi so — người nhập kho gõ "banh" để tìm "Bánh". */
  it("tìm được khi gõ không dấu", () => {
    expect(searchReturnProducts(cat, "banh", new Set()).map((p) => p.id)).toEqual(["p1"])
    expect(searchReturnProducts(cat, "dau xanh", new Set()).map((p) => p.id)).toEqual(["p2"])
  })

  it("tìm được theo mã SKU và mã vạch", () => {
    expect(searchReturnProducts(cat, "sku2", new Set()).map((p) => p.id)).toEqual(["p2"])
    expect(searchReturnProducts(cat, "8934567890123", new Set()).map((p) => p.id)).toEqual(["p1"])
  })

  /**
   * ⚠ LOẠI MÃ ĐÃ CÓ TRÊN PHIẾU. Thêm lần hai thành hai dòng cùng một mã,
   * và người đối chiếu với NCC không hiểu vì sao một mặt hàng xuất hiện
   * hai lần trong cùng một phiếu.
   */
  it("không gợi ý mã đã có trên phiếu", () => {
    expect(searchReturnProducts(cat, "banh", new Set(["p1"]))).toEqual([])
  })

  /**
   * ⚠ CHƯA GÕ GÌ THÌ KHÔNG GỢI Ý GÌ. Đổ cả danh mục xuống là dựng lại
   * đúng cái danh sách phải cuộn mà ô tìm sinh ra để thay thế.
   */
  it("chưa gõ gì thì không gợi ý gì", () => {
    expect(searchReturnProducts(cat, "", new Set())).toEqual([])
    expect(searchReturnProducts(cat, "   ", new Set())).toEqual([])
  })

  it("cắt bớt khi quá nhiều kết quả", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      prod({ id: `x${i}`, name: `Bánh ${i}` } as Partial<ReturnProduct>)
    )
    expect(searchReturnProducts(many, "banh", new Set())).toHaveLength(12)
  })
})

describe("dịch lỗi của complete_supplier_return", () => {
  /** ⚠ Giữ nguyên phần sau dấu `|` — đó là danh sách mặt hàng thiếu. */
  it("giữ lại phần liệt kê mặt hàng thiếu", () => {
    const out = friendlyReturnError("INSUFFICIENT_STOCK | Bánh: cần 10, còn 3")
    expect(out).toContain("Bánh: cần 10, còn 3")
    expect(out).not.toContain("INSUFFICIENT_STOCK")
  })

  it("lỗi khác thì trả nguyên văn", () => {
    expect(friendlyReturnError("P0001: gì đó")).toBe("P0001: gì đó")
  })
})

// =====================================================================

/**
 * BIỂU MẪU PHIẾU TRẢ NCC THEO KHUÔN MÀN ĐẶT HÀNG.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "phiếu trả hàng NCC làm theo form mẫu như
 * tạo đơn hàng đi". Bản cũ bắt chọn hàng trong một `<Select>` liệt kê cả
 * 1.700 mặt hàng — Ở TỪNG DÒNG — sau khi bấm "Thêm dòng" để lấy một thẻ
 * trống. Chính chủ nhà đã bác cách đó một lần rồi cho ô chọn NCC ở phiếu
 * nhập kho; phiếu trả NCC là chỗ cuối còn sót.
 */
describe("biểu mẫu phiếu trả NCC theo khuôn màn đặt hàng", () => {
  it("chọn NCC bằng ô gõ được, không bằng danh sách xổ", () => {
    expect(FORM).toContain("<SearchSelect")
    expect(FORM).toContain("options={supplierOptions}")
  })

  /**
   * ⚠ NCC PHẢI CÓ TRONG DANH MỤC. Phiếu trả ghi thẳng `supplier_id` và
   * RPC giảm công nợ của đúng NCC đó; một cái tên gõ tay không có mã thì
   * không có sổ nợ nào để giảm, và phiếu lưu xuống sẽ trượt khoá ngoại.
   */
  it("không cho gõ tay tên NCC", () => {
    expect(FORM).not.toContain("allowFreeText")
  })

  /**
   * ⚠ KIỂM CẢ SỰ VẮNG MẶT. Chỉ tìm ô tìm mới thì để nguyên danh sách xổ
   * 1.700 mục bên cạnh nó vẫn xanh — mà đó đúng là thứ chủ nhà bảo bỏ.
   */
  it("không còn danh sách xổ cả danh mục ở từng dòng", () => {
    expect(FORM).not.toContain("products.map(")
    expect(FORM).not.toContain("Chọn sản phẩm")
  })

  it("thêm hàng bằng ô tìm rồi chạm, và xoá ô tìm sau khi thêm", () => {
    expect(FORM).toContain("searchReturnProducts(products, term, onSlip)")
    const add = FORM.slice(FORM.indexOf("const addProduct"), FORM.indexOf("return (", FORM.indexOf("const addProduct")))
    expect(add).toContain("lineFromProduct(p, seqRef.current)")
    expect(add, "thêm xong phải xoá ô tìm").toContain('setTerm("")')
  })

  /**
   * ⚠ PHIẾU MỞ RA LÀ RỖNG, và chỗ rỗng phải nói việc tiếp theo. Bản cũ
   * dựng sẵn một thẻ TRỐNG "để có cái mà nhìn" — thẻ đó đi thẳng vào
   * phép đếm dòng và vào cả vòng lặp lưu.
   */
  it("phiếu rỗng nói rõ việc tiếp theo, và không dựng sẵn dòng trống", () => {
    const flat = FORM.replace(/\s+/g, " ")
    expect(flat).toContain("{value.lines.length === 0 ? (")
    expect(flat).toContain("Tìm ở ô trên rồi bấm Thêm")
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} vẫn dựng sẵn dòng trống`).not.toContain("newLine()")
    }
    expect(NEW_PAGE).toContain("lines: [],")
  })

  /** ⚠ Tổng tiền và nút đi tiếp phải luôn trong tầm mắt trên biểu mẫu dài. */
  it("có thanh dính đáy mang tổng tiền và nút hành động", () => {
    expect(FORM).toContain("fixed inset-x-0 bottom-0")
    const bar = FORM.slice(FORM.indexOf("fixed inset-x-0 bottom-0"))
    expect(bar).toContain("formatCurrency(totals.total)")
    expect(bar).toContain("{actions}")
    /* Thanh dính đáy che mất cuối trang nếu trang không chừa chỗ. */
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} thiếu chỗ chừa cho thanh dính đáy`).toContain("pb-28")
    }
  })

  /**
   * ⚠ MỘT BIỂU MẪU, KHÔNG PHẢI HAI. Hai màn trước đây là hai bản sao
   * chép gần như từng dòng; sửa một phép tính ở một bên rồi quên bên kia
   * là hai màn cho ra hai con số khác nhau cho đúng cùng mấy dòng hàng.
   */
  it("màn tạo và màn sửa dùng chung đúng một biểu mẫu", () => {
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không dùng biểu mẫu chung`).toContain("<PurchaseReturnForm")
      expect(src, `${ten} còn tự dựng dòng hàng`).not.toContain("const pickProduct")
      expect(src, `${ten} còn tự cộng phiếu`).not.toContain("let sub = 0")
      expect(src, `${ten} còn tự lọc dòng hợp lệ`).not.toContain("lines.filter(")
    }
  })

  /**
   * ⚠ SỬA PHIẾU CŨ THÌ GIỮ SỐ ĐÃ GÕ. Dựng lại dòng bằng `lineFromProduct`
   * là lặng lẽ đè số lượng, đơn giá và thuế suất của người dùng bằng giá
   * vốn hôm nay — đúng kiểu ghi đè im lặng mà kho mã này cấm.
   */
  it("màn sửa dựng dòng từ phiếu đã lưu, không từ danh mục", () => {
    expect(EDIT_PAGE).not.toContain("lineFromProduct")
    expect(EDIT_PAGE).toContain("quantity: String(l.quantity)")
    expect(EDIT_PAGE).toContain("unit_price: String(l.unit_price)")
    expect(EDIT_PAGE).toContain("vat_rate: String(l.vat_rate || 0)")
    /* Mã đã xoá khỏi danh mục vẫn phải hiện ra, không vẽ dòng không tên. */
    expect(EDIT_PAGE).toContain('prod?.name || "Sản phẩm đã xoá"')
  })

  /** Ô tìm cần mã vạch thì câu đọc danh mục phải lấy cột đó về. */
  it("hai màn đều đọc mã vạch cho ô tìm", () => {
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không đọc cột barcode`).toContain("id, name, sku, barcode, base_unit")
    }
  })
})
