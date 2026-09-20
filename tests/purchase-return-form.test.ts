import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  searchReturnProducts, friendlyReturnError, ratioToPercent, percentToRatio,
  type ReturnProduct,
} from "../src/lib/purchasing/return-form"
import {
  lineFromProduct, lineTotalOf, receiptTotals, unitPatch, validReceiptLines,
  type ReceiptLine,
} from "../src/lib/purchasing/receipt-form"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
/** Bỏ chú thích trước khi soi — chữ trong chú thích không phải là code. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

/**
 * ⚠ BIỂU MẪU NẰM Ở HAI TỆP. `FORM` chỉ còn khối "Thông tin chung" riêng
 * của phiếu trả (NCC, ngày trả, kho nguồn, lý do, ghi chú); ô tìm hàng,
 * bảng chín cột, khối tổng và modal nằm ở `EDITOR` — dùng chung với
 * phiếu nhập hàng. Chốt nào nói về phần dùng chung mà vẫn soi `FORM` thì
 * xanh vì đọc phải chuỗi rỗng, chứ không vì hành vi còn đúng.
 */
const FORM = strip(read("src/components/purchasing/purchase-return-form.tsx"))
const EDITOR = strip(read("src/components/purchasing/purchasing-lines-editor.tsx"))
const NEW_PAGE = strip(read("src/app/(dashboard)/purchase-returns/new/page.tsx"))
const EDIT_PAGE = strip(read("src/app/(dashboard)/purchase-returns/[id]/edit/page.tsx"))
const DETAIL = strip(read("src/app/(dashboard)/purchase-returns/[id]/page.tsx"))
const SAVE = strip(read("src/lib/purchasing/save-receipt.ts"))

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

const line = (o: Partial<ReceiptLine> = {}): ReceiptLine => ({
  id: "l1",
  product_id: "p1",
  product_name: "Bánh hình kẹo 160g",
  sku: "SKU1",
  note: "",
  unit_name: "hộp",
  quantity: "2",
  unit_price: "8000",
  line_discount: "",
  discount_mode: "amount",
  vat_percent: "10",
  conversion_factor: "1",
  available_units: [],
  base_unit: "hộp",
  ...o,
})

/**
 * HAI ĐƠN VỊ THUẾ, MỘT CHỖ QUY ĐỔI.
 *
 * ⚠ CỘT `supplier_return_lines.vat_rate` LÀ TỈ LỆ TỪ MIGRATION 141, ô
 * nhập trên biểu mẫu vẫn là PHẦN TRĂM. Trước 141 cột này là bảng dòng
 * hàng DUY NHẤT trong kho giữ phần trăm — và chính sự lẻ loi đó làm giá
 * trị 0,1 của `products.vat_rate` chui thẳng vào ô phần trăm mà không
 * ai nhận ra, cho ra thuế 0,1% thay vì 10%.
 */
describe("quy đổi thuế suất giữa tỉ lệ và phần trăm", () => {
  it("tỉ lệ sang phần trăm", () => {
    expect(ratioToPercent(0.1)).toBe("10")
    expect(ratioToPercent(0)).toBe("0")
    expect(ratioToPercent(0.05)).toBe("5")
  })

  /** ⚠ `0.08 * 100` ra `8.000000000000002` — chuỗi đó rơi vào ô nhập. */
  it("không để đuôi rác của dấu phẩy động lọt vào ô nhập", () => {
    expect(ratioToPercent(0.08)).toBe("8")
    expect(ratioToPercent(0.015)).toBe("1.5")
  })

  /** ⚠ "NaN" trong ô `type="number"` là một ô không xoá được nữa. */
  it("giá trị rỗng hoặc hỏng ra 0, không ra NaN", () => {
    expect(ratioToPercent(null)).toBe("0")
    expect(ratioToPercent(undefined)).toBe("0")
    expect(ratioToPercent("abc")).toBe("0")
  })

  it("phần trăm sang tỉ lệ", () => {
    expect(percentToRatio("10")).toBe(0.1)
    expect(percentToRatio("8")).toBe(0.08)
    expect(percentToRatio(0)).toBe(0)
  })

  /** ⚠ Ô trống là 0 — gửi `NaN` lên cột `numeric` là ghi rác. */
  it("ô trống ra 0, không gửi NaN lên máy chủ", () => {
    expect(percentToRatio("")).toBe(0)
    expect(percentToRatio(null)).toBe(0)
    expect(percentToRatio("--")).toBe(0)
  })

  /** ⚠ Đọc lên rồi lưu lại nhiều lần không được làm thuế trôi đi. */
  it("đọc ra rồi lưu lại không làm thuế trôi đi", () => {
    for (const r of [0, 0.05, 0.08, 0.1, 0.015]) {
      expect(percentToRatio(ratioToPercent(r))).toBe(r)
    }
  })
})

describe("dựng dòng từ mặt hàng vừa chọn", () => {
  /**
   * ⚠ `products.vat_rate` LÀ TỈ LỆ (0,1) CÒN Ô NÀY LÀ PHẦN TRĂM. Bản cũ
   * chép thẳng `String(p.vat_rate)` → ô "VAT %" nhận "0.1", và phép tính
   * `/100` biến nó thành 0,1% thay cho 10%. Thuế hụt đúng 100 lần, không
   * một dòng nào trên màn kêu lên.
   */
  it("thuế suất đổi từ tỉ lệ sang phần trăm", () => {
    expect(lineFromProduct(prod(), 1).vat_percent).toBe("10")
    expect(lineFromProduct(prod({ vat_rate: 0.08 } as Partial<ReturnProduct>), 1).vat_percent).toBe("8")
    expect(lineFromProduct(prod({ vat_rate: 0 } as Partial<ReturnProduct>), 1).vat_percent).toBe("0")
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
   * ⚠ BA Ô CỦA PHIẾU NHẬP PHẢI CÓ LUÔN Ở PHIẾU TRẢ (chủ nhà chốt
   * 20/09/2026: "hãy làm phiếu trả NCC tương tự"). Trước đây phiếu trả
   * có bản `lineFromProduct` RIÊNG, và đúng vì thế mà nó thiếu cả ba.
   * Chốt này là thứ duy nhất giữ hai chứng từ không tách nhau lần nữa.
   */
  it("dòng mới có đủ ghi chú, giảm giá và chế độ giảm giá", () => {
    const l = lineFromProduct(prod(), 1)
    expect(l.note).toBe("")
    expect(l.line_discount).toBe("")
    expect(l.discount_mode, "chế độ mặc định phải là TIỀN, không phải %").toBe("amount")
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

/**
 * PHIẾU TRẢ CỘNG TIỀN ĐÚNG BẰNG PHÉP CỦA PHIẾU NHẬP.
 *
 * ⚠ MỘT PHÉP TÍNH CHO CẢ HAI CHỨNG TỪ. Bản cũ của phiếu trả có
 * `returnTotals` riêng: KHÔNG có giảm giá dòng, KHÔNG có giảm giá phiếu,
 * KHÔNG có tiền thuế gõ tay. Hai phép tính cho hai chiều của cùng một
 * việc với cùng một NCC là chỗ để con số hai bên không bao giờ khớp.
 */
describe("cộng phiếu", () => {
  it("cộng tiền hàng và thuế theo phần trăm", () => {
    const t = receiptTotals([line({ quantity: "2", unit_price: "8000", vat_percent: "10" })], "")
    expect(t.subtotal).toBe(16000)
    expect(t.vat).toBe(1600)
    expect(t.total).toBe(17600)
  })

  /**
   * ⚠ GIẢM GIÁ CẢ PHIẾU TRỪ SAU THUẾ (chủ nhà chốt 20/09/2026). Trừ
   * trước thuế là đổi luôn căn cứ tính thuế — con số khai lên tờ hoá đơn
   * sẽ khác con số NCC ghi.
   */
  it("giảm giá cả phiếu trừ SAU thuế", () => {
    const t = receiptTotals([line({ quantity: "2", unit_price: "8000", vat_percent: "10" })], "1000")
    expect(t.vat, "thuế bị đổi vì giảm giá — đang trừ TRƯỚC thuế").toBe(1600)
    expect(t.total).toBe(16600)
  })

  /** ⚠ Giảm giá dòng ở chế độ % tính trên tiền hàng của CHÍNH dòng đó. */
  it("giảm giá dòng theo phần trăm quy ra tiền rồi mới tính thuế", () => {
    const t = receiptTotals(
      [line({ quantity: "2", unit_price: "8000", line_discount: "10", discount_mode: "percent" })],
      ""
    )
    expect(t.subtotal).toBe(14400)
    expect(t.vat).toBe(1440)
  })

  /** ⚠ Tiền thuế gõ tay THẮNG số tự cộng; ô trống thì máy tự cộng. */
  it("tiền thuế gõ tay đè lên số tự cộng, ô trống thì không", () => {
    const l = [line({ quantity: "2", unit_price: "8000", vat_percent: "10" })]
    expect(receiptTotals(l, "", "999").vat).toBe(999)
    expect(receiptTotals(l, "", "").vat, "ô trống mà vẫn đè").toBe(1600)
    expect(receiptTotals(l, "", "0").vat, "số 0 phải giữ — đó là hoá đơn không thuế").toBe(0)
  })

  /**
   * ⚠ Ô TRỐNG LÀ 0, KHÔNG PHẢI `NaN`. Một dòng vừa thêm chưa gõ số lượng
   * mà làm cả phiếu thành "NaN đ" là màn hình nói dối về một phiếu hoàn
   * toàn bình thường đang soạn dở.
   */
  it("dòng còn trống không làm hỏng tổng", () => {
    const t = receiptTotals([
      line({ quantity: "2", unit_price: "8000", vat_percent: "10" }),
      line({ id: "l2", quantity: "", unit_price: "", vat_percent: "" }),
    ], "")
    expect(Number.isNaN(t.total)).toBe(false)
    expect(t.total).toBe(17600)
  })

  it("phiếu rỗng ra 0", () => {
    const t = receiptTotals([], "")
    expect(t.subtotal).toBe(0)
    expect(t.vat).toBe(0)
    expect(t.total).toBe(0)
  })

  it("thành tiền một dòng đã gồm thuế", () => {
    expect(lineTotalOf(line({ quantity: "2", unit_price: "8000", vat_percent: "10" }))).toBe(17600)
    expect(Number.isNaN(lineTotalOf(line({ quantity: "", unit_price: "" })))).toBe(false)
  })
})

describe("dòng nào được ghi xuống", () => {
  /**
   * ⚠ SỐ LƯỢNG PHẢI DƯƠNG. Dòng số lượng 0 ghi xuống là một dòng phiếu
   * không trả gì, mà RPC vẫn đi tìm lô để trừ cho nó.
   */
  it("bỏ dòng chưa chọn hàng và dòng số lượng 0", () => {
    const out = validReceiptLines([
      line({ id: "ok" }),
      line({ id: "chưa chọn", product_id: "" }),
      line({ id: "không số", quantity: "0" }),
      line({ id: "trống", quantity: "" }),
    ])
    expect(out.map((l) => l.id)).toEqual(["ok"])
  })

  it("giá 0 vẫn được ghi — hàng trả không tính tiền là chuyện có thật", () => {
    expect(validReceiptLines([line({ unit_price: "0" })])).toHaveLength(1)
  })
})

/**
 * GHI DÒNG XUỐNG `supplier_return_lines`.
 *
 * ⚠ MỘT PHÉP GHI CHO CẢ HAI CHỨNG TỪ. Bản cũ có `linePayload` riêng cho
 * phiếu trả — và nó KHÔNG ghi `notes`, KHÔNG ghi `line_discount`, KHÔNG
 * ghi `sort_order`, nên ba ô người dùng vừa gõ biến mất lúc lưu mà không
 * có gì kêu.
 */
describe("ghi dòng hàng phiếu trả", () => {
  it("ghi qua hàm chung, không có phép ghi riêng của phiếu trả", () => {
    expect(SAVE).toContain("export async function saveReturnLines")
    expect(SAVE).toContain('.from("supplier_return_lines")')
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không dùng phép ghi chung`).toContain("saveReturnLines(supabase")
      expect(src, `${ten} còn tự dựng tải trọng dòng`).not.toContain("linePayload(")
    }
  })

  /**
   * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Chèn mà không
   * `.select()` rồi đếm là một phiếu KHÔNG CÓ DÒNG NÀO được báo "đã lưu".
   */
  it("có select rồi đếm, không tin mỗi error", () => {
    const ins = SAVE.slice(SAVE.indexOf('.from("supplier_return_lines")\n    .insert'))
    expect(ins).toContain('.select("id")')
    expect(SAVE).toContain("data.length === 0")
    expect(SAVE).toContain("không có quyền")
  })

  /**
   * ⚠ CỘT `line_discount` LÀ TIỀN, ô nhập có thể là PHẦN TRĂM. Ghi thẳng
   * số người dùng gõ xuống là cột ấy mang hai nghĩa tuỳ dòng, và máy chủ
   * trừ "10 đồng" cho một dòng người ta bảo giảm 10%.
   */
  it("giảm giá quy ra TIỀN trước khi ghi xuống", () => {
    expect(SAVE).toContain("line_discount: lineDiscountAmountOf(l)")
    expect(SAVE, "đang ghi thẳng ô nhập xuống cột tiền")
      .not.toContain("line_discount: Number(l.line_discount)")
  })

  /** ⚠ Cột là TỈ LỆ, ô nhập là PHẦN TRĂM — quên quy đổi là thuế hụt 100 lần. */
  it("thuế suất quy đổi phần trăm → tỉ lệ khi ghi xuống", () => {
    expect(SAVE).toContain("vat_rate: percentToRatio(l.vat_percent)")
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không truyền hàm quy đổi`).toContain("percentToRatio")
    }
  })

  /** STT phải được ghi xuống, nếu không tờ in mỗi lần một thứ tự. */
  it("ghi sort_order 1-based, và màn đọc lên theo đúng cột đó", () => {
    expect(SAVE).toContain("sort_order: i + 1")
    expect(EDIT_PAGE).toContain('.order("sort_order")')
    expect(DETAIL).toContain('.order("sort_order")')
  })
})

describe("ô tìm hàng của phiếu", () => {
  const catalog = [
    prod(),
    prod({ id: "p2", sku: "SKU2", name: "Sữa tươi 180ml", barcode: "1112223334445" } as Partial<ReturnProduct>),
  ]

  it("tìm được khi gõ không dấu", () => {
    expect(searchReturnProducts(catalog, "banh", new Set()).map((p) => p.id)).toEqual(["p1"])
    expect(searchReturnProducts(catalog, "sua tuoi", new Set()).map((p) => p.id)).toEqual(["p2"])
  })

  it("tìm được theo mã SKU và mã vạch", () => {
    expect(searchReturnProducts(catalog, "SKU2", new Set()).map((p) => p.id)).toEqual(["p2"])
    expect(searchReturnProducts(catalog, "8934567890123", new Set()).map((p) => p.id)).toEqual(["p1"])
  })

  /** ⚠ Thêm lần hai là hai dòng cùng một mã — người đối chiếu không hiểu. */
  it("không gợi ý mã đã có trên phiếu", () => {
    expect(searchReturnProducts(catalog, "banh", new Set(["p1"]))).toHaveLength(0)
  })

  /** ⚠ Chưa gõ gì mà đổ cả danh mục xuống là dựng lại đúng danh sách phải cuộn. */
  it("chưa gõ gì thì không gợi ý gì", () => {
    expect(searchReturnProducts(catalog, "", new Set())).toHaveLength(0)
    expect(searchReturnProducts(catalog, "   ", new Set())).toHaveLength(0)
  })

  it("cắt bớt khi quá nhiều kết quả", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      prod({ id: `x${i}`, sku: `S${i}`, name: `Bánh số ${i}` } as Partial<ReturnProduct>)
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
 * PHIẾU TRẢ NCC DÙNG ĐÚNG KHUÔN PHIẾU NHẬP HÀNG.
 *
 * ⚠ CHỦ NHÀ CHỐT 20/09/2026: "hãy làm phiếu trả NCC tương tự". Trước đó
 * là "phiếu trả hàng NCC làm theo form mẫu như tạo đơn hàng đi" — bản cũ
 * bắt chọn hàng trong một `<Select>` liệt kê cả 1.700 mặt hàng, Ở TỪNG
 * DÒNG, sau khi bấm "Thêm dòng" để lấy một thẻ trống.
 */
describe("biểu mẫu phiếu trả NCC theo khuôn phiếu nhập", () => {
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

  /**
   * ⚠ PHẦN DÙNG CHUNG PHẢI THẬT SỰ DÙNG CHUNG. Đây là chốt giữ lời hứa
   * "tương tự": phiếu trả không được có bản sao của bảng hàng, ô tìm hay
   * khối tổng — có bản sao là ngày mai sửa một bên quên bên kia.
   */
  it("dùng chung đúng một bảng hàng với phiếu nhập", () => {
    expect(FORM).toContain("<PurchasingLinesEditor")
    expect(FORM, "phiếu trả tự vẽ lại bảng hàng").not.toContain("<thead")
    expect(FORM, "phiếu trả tự vẽ lại ô tìm").not.toContain("searchReturnProducts")
    expect(FORM, "phiếu trả tự cộng tiền lấy một lần nữa").not.toContain("receiptTotals")
  })

  /** ⚠ Nhãn riêng của phiếu trả — "Cần trả NCC" là chiều ngược lại. */
  it("nhãn tổng và tiêu đề bảng nói đúng chiều tiền", () => {
    expect(FORM).toContain('totalLabel="NCC hoàn lại"')
    expect(FORM).toContain('linesTitle="Chi tiết hàng trả"')
    expect(FORM, "đang mượn nhãn của phiếu nhập").not.toContain("Cần trả NCC")
  })

  /** ⚠ Bốn ô riêng của phiếu trả phải còn nguyên ở đầu phiếu. */
  it("đầu phiếu có ngày trả, kho nguồn, lý do và ghi chú", () => {
    expect(FORM).toContain("Ngày trả *")
    expect(FORM).toContain("Xuất từ kho *")
    expect(FORM).toContain("RETURN_REASONS.map(")
    expect(FORM).toContain('id="pr-notes"')
  })

  /**
   * ⚠ PHIẾU MỞ RA LÀ RỖNG, và chỗ rỗng phải nói việc tiếp theo. Bản cũ
   * dựng sẵn một thẻ TRỐNG "để có cái mà nhìn" — thẻ đó đi thẳng vào
   * phép đếm dòng và vào cả vòng lặp lưu.
   */
  it("phiếu rỗng nói rõ việc tiếp theo, và không dựng sẵn dòng trống", () => {
    const flat = EDITOR.replace(/\s+/g, " ")
    expect(flat).toContain("{value.lines.length === 0 ? (")
    expect(flat).toContain("Tìm ở ô trên rồi bấm Thêm")
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} vẫn dựng sẵn dòng trống`).not.toContain("newLine()")
    }
    expect(NEW_PAGE).toContain("lines: [],")
  })

  /** ⚠ Tổng tiền và nút đi tiếp phải luôn trong tầm mắt trên biểu mẫu dài. */
  it("có thanh dính đáy mang tổng tiền và nút hành động", () => {
    expect(EDITOR).toContain("fixed inset-x-0 bottom-0")
    const bar = EDITOR.slice(EDITOR.indexOf("fixed inset-x-0 bottom-0"))
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
    expect(EDIT_PAGE).toContain("vat_percent: ratioToPercent(l.vat_rate)")
    expect(EDIT_PAGE, "ghi chú dòng đã lưu bị bỏ rơi khi nạp lại").toContain('note: l.notes || ""')
    /* Mã đã xoá khỏi danh mục vẫn phải hiện ra, không vẽ dòng không tên. */
    expect(EDIT_PAGE).toContain('prod?.name || "Sản phẩm đã xoá"')
  })

  /**
   * ⚠ CỘT LƯU LÀ TIỀN, nên dòng nạp lại LUÔN ở chế độ tiền. Đoán ngược
   * ra phần trăm là bịa — cùng một số tiền ra vô số phần trăm tuỳ giá.
   */
  it("màn sửa nạp dòng về chế độ tiền", () => {
    expect(EDIT_PAGE).toContain('discount_mode: "amount"')
  })

  /** Ô tìm cần mã vạch thì câu đọc danh mục phải lấy cột đó về. */
  it("hai màn đều đọc mã vạch cho ô tìm", () => {
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không đọc cột barcode`).toContain("id, name, sku, barcode, base_unit")
    }
  })

  /** ⚠ NCC và tồn kho ở ô tìm — hai màn nạp bằng đúng hàm chung. */
  it("ô tìm của phiếu trả cũng có NCC và tồn kho", () => {
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không nạp NCC / tồn cho ô tìm`).toContain("loadPickerExtras(supabase, prods)")
      expect(src, `${ten} không truyền xuống biểu mẫu`).toContain("extras={extras}")
    }
  })
})

// =====================================================================

/**
 * TIỀN VÀ KHO CỦA PHIẾU TRẢ ĐI QUA RPC, KHÔNG QUA TRÌNH DUYỆT.
 */
describe("ghi phiếu trả: màn hình không tự đụng kho hay công nợ", () => {
  for (const [ten, src] of [
    ["màn tạo", NEW_PAGE],
    ["màn sửa", EDIT_PAGE],
    ["màn chi tiết", DETAIL],
  ] as const) {
    it(`${ten} không GHI thẳng vào batches / payables / stock_entries`, () => {
      /* ⚠ CẤM GHI, KHÔNG CẤM ĐỌC — ô tìm cần ĐỌC tồn kho để hiện ra. */
      const flat = src.replace(/\s+/g, " ")
      for (const t of ["batches", "payables", "stock_entries", "stock_entry_lines"]) {
        for (const verb of ["insert", "update", "delete", "upsert"]) {
          expect(
            flat,
            `${ten} đang tự ${verb} bảng ${t} — kho và công nợ phải đi qua RPC`
          ).not.toContain(`.from("${t}") .${verb}(`)
        }
      }
    })
  }

  it("kho và công nợ chỉ đi qua hai RPC", () => {
    expect(NEW_PAGE).toContain('supabase.rpc("complete_supplier_return"')
    expect(EDIT_PAGE).toContain('rpc("cancel_supplier_return"')
    expect(DETAIL).toContain("complete_supplier_return")
    expect(DETAIL).toContain("cancel_supplier_return")
  })

  /**
   * ⚠ HUỶ TRƯỚC RỒI LẬP LẠI, không sửa đè. Sửa đè lên một chứng từ đã
   * ra khỏi kho và vào sổ nợ là chứng từ nói một đằng, kho nói một nẻo.
   */
  it("phiếu đã gửi thì huỷ trước rồi mới ghi đè", () => {
    const submit = EDIT_PAGE.slice(
      EDIT_PAGE.indexOf("const handleSubmit = async"),
      EDIT_PAGE.indexOf("if (authLoading || loading)")
    )
    const cancelAt = submit.indexOf('rpc("cancel_supplier_return"')
    const updateAt = submit.indexOf('.from("supplier_returns")')
    const completeAt = submit.indexOf('rpc("complete_supplier_return"')
    expect(cancelAt, "không huỷ bản cũ trước khi sửa").toBeGreaterThan(0)
    expect(updateAt, "ghi đè TRƯỚC khi huỷ — kho vẫn giữ số đã trừ").toBeGreaterThan(cancelAt)
    expect(completeAt).toBeGreaterThan(updateAt)
    expect(EDIT_PAGE).toContain("wasCompleted")
  })

  /**
   * ⚠ BA BƯỚC KHÔNG NẰM TRONG MỘT GIAO DỊCH. Hỏng ở bước cuối thì kho
   * đã hoàn về đúng nhưng phiếu chưa gửi lại — phải NÓI RA, nếu không
   * người dùng tưởng mất hàng.
   */
  it("gửi lại hỏng thì nói rõ kho đã hoàn về đúng", () => {
    expect(EDIT_PAGE).toContain("NHÁP")
    expect(EDIT_PAGE).toContain("kho đã hoàn về đúng")
  })

  /**
   * ⚠ Ô TRỐNG → `null`, KHÔNG → 0. Gửi 0 lên là khai "chứng từ này không
   * có thuế"; để trống là "máy tự cộng".
   */
  it("hai màn gửi vat_override null khi để trống, và giữ số 0 khi gõ 0", () => {
    for (const [ten, src] of [["màn tạo", NEW_PAGE], ["màn sửa", EDIT_PAGE]] as const) {
      expect(src, `${ten} không gửi vat_override`).toContain(
        'vat_override: form.vatOverride.trim() === "" ? null : Number(form.vatOverride)'
      )
      expect(src, `${ten} không gửi giảm giá cả phiếu`).toContain("discount: totals.discount")
    }
    expect(EDIT_PAGE, "nạp lại đang biến số 0 thành ô trống").toContain(
      'vatOverride: hdr.vat_override == null ? "" : String(hdr.vat_override)'
    )
  })

  /** ⚠ Màn chi tiết phải hiện ba thứ mới, nếu không người dùng lưu xong không thấy đâu. */
  it("màn chi tiết hiện ghi chú dòng, giảm giá dòng và giảm giá cả phiếu", () => {
    expect(DETAIL).toContain(">Ghi chú<")
    expect(DETAIL).toContain(">Giảm giá<")
    expect(DETAIL).toContain("Giảm giá cả phiếu")
    const totals = DETAIL.slice(DETAIL.indexOf("Tổng hàng (chưa VAT)"))
    const vat = totals.indexOf('label="VAT"')
    const disc = totals.indexOf("Giảm giá cả phiếu")
    expect(disc, "giảm giá đứng TRÊN thuế — sai thứ tự phép tính").toBeGreaterThan(vat)
  })
})

// =====================================================================

/**
 * MIGRATION 146 — MÁY CHỦ TÍNH LẠI TIỀN, KHÔNG NHẬN SỐ CỦA TRÌNH DUYỆT.
 *
 * ⚠ LỖ HỔNG CÓ THẬT TRƯỚC 146. `complete_supplier_return` đọc
 * `supplier_returns.total` — con số do MÀN HÌNH ghi xuống — rồi ghi
 * thẳng vào `payables.amount`. Một tab mở lâu, một ô để trống, hay một
 * người sửa bảng bằng tay là công nợ NCC lệch mà không có chỗ đối chiếu.
 */
describe("migration 146 — phiếu trả dùng đúng khuôn phiếu nhập", () => {
  const MIG = read("supabase/migrations/146_supplier_return_same_shape.sql")
  const SQL = MIG.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")

  it("thêm đủ bốn cột, và thêm được nhiều lần", () => {
    for (const c of ["discount numeric", "vat_override numeric"]) {
      expect(SQL, `supplier_returns thiếu ${c}`).toContain(c)
    }
    for (const c of ["line_discount numeric", "sort_order integer"]) {
      expect(SQL, `supplier_return_lines thiếu ${c}`).toContain(c)
    }
    expect(
      (SQL.match(/ADD COLUMN IF NOT EXISTS/g) ?? []).length,
      "có ADD COLUMN không IF NOT EXISTS — migration chạy lại sẽ nổ"
    ).toBe(4)
  })

  /**
   * ⚠ TIỀN PHẢI CỘNG TỪ DÒNG HÀNG. Nếu hàm còn đọc `total` của bảng đầu
   * phiếu thì cả migration này vô nghĩa — công nợ vẫn nhận số của trình
   * duyệt.
   */
  it("tính lại tiền từ dòng hàng, không đọc total của trình duyệt", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION complete_supplier_return"))
    expect(fn).toContain("v_sub := v_sub +")
    expect(fn).toContain("v_vat := v_vat +")
    expect(fn).toContain("v_total := GREATEST(0, v_sub + v_vat - v_discount)")
    expect(
      /INTO[^;]*\bv_total\b/.test(fn.slice(0, fn.indexOf("FOR r IN"))),
      "vẫn đang đọc total từ bảng đầu phiếu"
    ).toBe(false)
  })

  /** ⚠ Giảm giá trừ SAU thuế, đúng bằng phép của màn hình. */
  it("giảm giá cả phiếu trừ sau thuế, và tiền thuế gõ tay thắng số tự cộng", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION complete_supplier_return"))
    const vatOvr = fn.indexOf("IF v_vat_ovr IS NOT NULL THEN")
    const total = fn.indexOf("v_total := GREATEST(0, v_sub + v_vat - v_discount)")
    expect(vatOvr, "không có đường gõ tay tiền thuế").toBeGreaterThan(0)
    expect(total, "tính tổng TRƯỚC khi áp tiền thuế gõ tay").toBeGreaterThan(vatOvr)
    expect(fn).toContain("v_vat := GREATEST(0, v_vat_ovr)")
  })

  /**
   * ⚠ `line_discount` CHỈ ĐỤNG TỚI TIỀN. Số lượng hàng trả về NCC vẫn là
   * `quantity × conversion_factor`; lẫn hai thứ là "giảm giá 10%" biến
   * thành "trả thiếu 10% số hàng".
   */
  it("giảm giá dòng không đụng tới số lượng trừ kho", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION complete_supplier_return"))
    expect(fn).toContain("v_base_qty := COALESCE(r.quantity, 0) * r.cf")
    const qtyLine = fn.slice(fn.indexOf("v_base_qty :="), fn.indexOf("v_need := v_base_qty"))
    expect(qtyLine, "giảm giá đang bị trừ vào số lượng hàng").not.toContain("line_discount")
  })

  /** ⚠ Dòng nợ mang số ÂM — đây là khoản NCC trả lại mình. */
  it("ghi công nợ bằng số âm, từ tổng máy chủ vừa tính", () => {
    expect(SQL).toContain("-v_total, 0, 'open'")
  })

  /**
   * ⚠ CÂU LỖI GIỮ NGUYÊN VĂN CỦA 071. Màn hình nhận dạng lỗi thiếu tồn
   * bằng đúng chuỗi `INSUFFICIENT_STOCK` rồi cắt theo dấu `|`; đổi chữ ở
   * SQL là người dùng nhận nguyên câu lỗi thô của Postgres.
   */
  it("câu lỗi thiếu tồn khớp với hàm dịch của màn hình", () => {
    expect(SQL).toContain("INSUFFICIENT_STOCK | ")
    expect(friendlyReturnError("INSUFFICIENT_STOCK | Bánh (hộp): cần 10, kho hàng date còn 3, kho hàng bán còn 0"))
      .toContain("Bánh (hộp): cần 10")
  })

  it("dọn quyền, ghi chú hàm và nạp lại lược đồ", () => {
    expect(SQL).toContain("REVOKE EXECUTE ON FUNCTION complete_supplier_return(uuid) FROM PUBLIC")
    expect(SQL).toContain("GRANT EXECUTE ON FUNCTION complete_supplier_return(uuid) TO authenticated")
    expect(SQL).toContain("RAISE NOTICE")
    expect(SQL).toContain("NOTIFY pgrst, 'reload schema'")
  })
})

// =====================================================================

/**
 * MIGRATION 141 — CỘT `vat_rate` VỀ ĐÚNG QUY ƯỚC CỦA CẢ KHO.
 *
 * ⚠ `supplier_return_lines` LÀ BẢNG DÒNG HÀNG DUY NHẤT TỪNG GIỮ PHẦN
 * TRĂM. `products`, `sales_invoice_lines` và `stock_entry_lines` đều
 * giữ tỉ lệ. Chính sự lẻ loi đó làm giá trị 0,1 của danh mục chui thẳng
 * vào ô "VAT %" của phiếu trả mà không ai nhận ra.
 */
describe("migration 141 — đơn vị thuế suất của phiếu trả NCC", () => {
  /**
   * ⚠ BỎ DÒNG CHÚ THÍCH SQL TRƯỚC KHI SOI. Chốt bản đầu bám vào chuỗi
   * "COMMENT ON COLUMN ..." và vẫn XANH khi đem dòng đó biến thành chú
   * thích bằng `-- ` — chuỗi còn nguyên trong tệp mà lệnh thì không
   * chạy. Đó đúng là đột biến nguy hiểm nhất ở đây: không có COMMENT
   * thì chốt chặn chạy lại không bao giờ bật, và lần chạy thứ hai chia
   * 100 thêm một lần nữa. Phần đầu tệp cũng nói cả câu "TỈ LỆ" trong
   * chú thích, nên không lọc là mấy chốt dưới đọc nhầm văn xuôi.
   */
  const MIG = read("supabase/migrations/141_supplier_return_vat_ratio.sql")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n")

  it("đổi đơn vị bằng phép chia 100, không đoán lại ý người nhập", () => {
    expect(MIG).toContain("SET vat_rate = vat_rate / 100")
  })

  /**
   * ⚠ CHẠY LẠI LẦN HAI LÀ CHIA 100 THÊM LẦN NỮA — thuế thành một phần
   * vạn. Không có cột "phiên bản" nào để bám, nên COMMENT của cột chính
   * là dấu: có chữ "TỈ LỆ" nghĩa là đã đổi rồi.
   */
  it("chạy lại được: có chốt chặn dựa trên COMMENT của cột", () => {
    expect(MIG).toContain("col_description('public.supplier_return_lines'::regclass")
    expect(MIG).toContain("RETURN;")
    expect(MIG).toContain("COMMENT ON COLUMN supplier_return_lines.vat_rate IS")
  })

  /**
   * ⚠ HAI NỬA PHẢI KHỚP NHAU. Chốt chặn đi tìm một chuỗi trong COMMENT;
   * COMMENT thì do chính migration này đặt. Có đủ CẢ HAI lệnh vẫn chưa
   * đủ — đặt một COMMENT KHÔNG chứa chuỗi mà chốt chặn tìm là chốt chặn
   * không bao giờ bật, và lần chạy thứ hai chia 100 thêm một lần nữa.
   * Bản đầu của chốt này chỉ kiểm từng nửa nên vẫn xanh trước đúng đột
   * biến đó.
   */
  it("chuỗi chốt chặn đi tìm phải nằm thật trong COMMENT được đặt", () => {
    const guard = MIG.match(/v_marker LIKE '%(.+?)%'/)
    expect(guard, "không tìm thấy chốt chặn chạy lại").toBeTruthy()
    const marker = guard![1]

    const i = MIG.indexOf("COMMENT ON COLUMN supplier_return_lines.vat_rate IS")
    const comment = MIG.slice(i, MIG.indexOf(";", i))
    expect(
      comment.includes(marker),
      `COMMENT đặt xuống không chứa "${marker}" — chốt chặn chạy lại sẽ ` +
        "không bao giờ bật, và lần chạy thứ hai chia 100 thêm lần nữa."
    ).toBe(true)
  })

  it("đếm số dòng đã đổi và nạp lại lược đồ", () => {
    expect(MIG).toContain("GET DIAGNOSTICS v_n = ROW_COUNT")
    expect(MIG).toContain("RAISE NOTICE")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema'")
  })

  /**
   * ⚠ MÀN CHI TIẾT IN THẲNG `{l.vat_rate}%` LÀ HIỆN "0.1%" cho một dòng
   * thuế 10%. Đổi đơn vị dưới cơ sở dữ liệu mà quên màn đọc nó là dời
   * lỗi sang chỗ khác chứ không sửa được gì.
   */
  it("màn chi tiết quy đổi trước khi in, không in thẳng cột", () => {
    expect(DETAIL).toContain("{ratioToPercent(l.vat_rate)}%")
    expect(DETAIL).not.toContain("{l.vat_rate}%")
    expect(DETAIL).toContain('import { ratioToPercent } from "@/lib/purchasing/return-form"')
  })

  /** Biểu mẫu chỉ được chạm cột qua hai hàm quy đổi, không parse thẳng. */
  it("biểu mẫu không đọc thẳng cột vat_rate", () => {
    /* ⚠ Ô THUẾ SUẤT NẰM TRONG MODAL CỦA PHẦN DÙNG CHUNG, không ở khối
       đầu phiếu — nên soi `EDITOR`. Để nguyên `FORM` là chốt xanh vì
       đọc phải một tệp không còn ô nào, chứ không vì hành vi còn đúng. */
    expect(EDITOR).toContain("l.vat_percent")
    expect(EDITOR).not.toContain("l.vat_rate")
    expect(EDIT_PAGE).toContain("ratioToPercent(l.vat_rate)")
  })
})
