import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  makeAddedRow, withStock, toDraft, rowsOverOrdered, searchAddable, seedForReissue,
  type EditorRow,
} from "../src/lib/orders/invoice-editor"
import type { PricedProduct } from "../src/lib/sell/pricing"
import type { InvoiceableLine } from "../src/lib/orders/post-invoice"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const EDITOR = strip(read("src/components/orders/invoice-editor.tsx"))
const NEW_PAGE = strip(read("src/app/(dashboard)/sales-invoices/new/page.tsx"))

/**
 * MÀN SOẠN HÓA ĐƠN ĐƯỢC PHÉP THÊM MÃ NGOÀI ĐƠN (chủ nhà chốt).
 *
 * Đó là quyền mạnh: hóa đơn không còn là tấm gương của đơn nữa. Mấy chốt
 * dưới đây giữ cho quyền ấy không kéo theo ba sai lầm im lặng — bán sai
 * giá, thu sai thuế, và cảnh báo kêu oan tới mức không ai còn đọc.
 */

const prod = (o: Partial<PricedProduct> = {}): PricedProduct =>
  ({
    id: "p1",
    sku: "SKU1",
    name: "Bánh hình kẹo 160g",
    base_unit: "hộp",
    vat_rate: 0.1,
    sell_price: 10000,
    price_lists: [],
    units: [{ unit_name: "thùng", conversion: 12 }],
    ...o,
  }) as unknown as PricedProduct

describe("thêm mã hàng ngoài đơn", () => {
  /**
   * ⚠ GIÁ PHẢI QUA `unitPriceFor`. `sell_price` là giá ĐƠN VỊ CƠ SỞ; bán
   * theo thùng mà lấy thẳng là bán 12 hộp với giá 1 hộp.
   */
  it("giá theo đơn vị đang bán, không phải giá đơn vị cơ sở", () => {
    expect(makeAddedRow(prod(), "hộp", null, 1).price).toBe(10000)
    expect(makeAddedRow(prod(), "thùng", null, 1).price).toBe(120000)
  })

  /** ⚠ Bảng giá riêng của nhóm khách phải thắng giá chung. */
  it("khách có nhóm giá thì lấy giá của nhóm đó", () => {
    const p = prod({
      price_lists: [
        { unit_name: "hộp", group_id: "g1", price: 8000 },
        { unit_name: "hộp", group_id: null, price: 9500 },
      ],
    } as unknown as Partial<PricedProduct>)
    expect(makeAddedRow(p, "hộp", "g1", 1).price).toBe(8000)
    expect(makeAddedRow(p, "hộp", null, 1).price).toBe(9500)
  })

  /**
   * ⚠ `vat_rate` LÀ TỈ LỆ (0,1), KHÔNG PHẢI PHẦN TRĂM (10) — đúng như cột
   * `sales_invoice_lines.vat_rate`. Nhân 100 ở đây là thu thuế gấp mười.
   */
  it("thuế suất giữ nguyên dạng tỉ lệ", () => {
    expect(makeAddedRow(prod(), "hộp", null, 1).vatRate).toBe(0.1)
  })

  it("hệ số quy đổi theo đơn vị đã chọn", () => {
    expect(makeAddedRow(prod(), "thùng", null, 1).conversionFactor).toBe(12)
    expect(makeAddedRow(prod(), "hộp", null, 1).conversionFactor).toBe(1)
  })

  /** Dòng tự thêm mới được xoá; dòng của đơn phải đặt số lượng 0. */
  it("đánh dấu là dòng thêm tay", () => {
    expect(makeAddedRow(prod(), "hộp", null, 1).addedByHand).toBe(true)
  })

  /**
   * ⚠ CHƯA TRA XONG KHÁC VỚI TỒN BẰNG 0. Tô vàng "vượt tồn" khi còn chưa
   * hỏi kho là kêu oan — người dùng học được cách bỏ qua màu vàng, rồi
   * lần nó kêu thật thì không ai nhìn.
   */
  it("chưa tra tồn thì chưa dám nói gì về tồn", () => {
    const r = makeAddedRow(prod(), "hộp", null, 1)
    expect(r.stockKnown).toBe(false)
    expect(withStock([r], r.key, 42)[0]).toMatchObject({ stockKnown: true, availableBase: 42 })
  })

  it("gắn tồn đúng dòng, không đụng dòng khác", () => {
    const a = makeAddedRow(prod(), "hộp", null, 1)
    const b = makeAddedRow(prod({ id: "p2" }), "hộp", null, 2)
    const out = withStock([a, b], b.key, 7)
    expect(out[0].stockKnown).toBe(false)
    expect(out[1].availableBase).toBe(7)
  })

  /**
   * ⚠ MÃ THÊM TAY KHÔNG CÓ "PHẦN CÒN LẠI" CỦA ĐƠN. Kể nó vào cảnh báo
   * "xuất vượt đơn" là mọi hóa đơn có mã thêm tay đều hiện cảnh báo, tức
   * cảnh báo mất sạch ý nghĩa.
   */
  it("mã thêm tay không bị kể là xuất vượt đơn", () => {
    const added = { ...makeAddedRow(prod(), "hộp", null, 1), qty: 99 }
    expect(rowsOverOrdered([added])).toEqual([])
  })

  it("dòng CỦA ĐƠN xuất quá phần còn lại thì vẫn bị kể", () => {
    const row = {
      orderLineId: "ol1", remainingQty: 5, qty: 6,
    } as unknown as EditorRow
    expect(rowsOverOrdered([row])).toHaveLength(1)
  })

  /**
   * ⚠ CHIẾT KHẤU CHIA THEO PHẦN ĐANG XUẤT. Mã thêm tay có
   * `discountBase = 0` nên phải ra 0 — chia cho 0 là NaN chui thẳng vào
   * tải trọng gửi lên máy chủ.
   */
  it("mã thêm tay không sinh NaN ở chiết khấu", () => {
    const d = toDraft([makeAddedRow(prod(), "hộp", null, 1)])
    expect(d[0].lineDiscount).toBe(0)
    expect(Number.isNaN(d[0].lineDiscount)).toBe(false)
  })

  /**
   * ⚠ CHỐT TRÊN KHÔNG ĐỦ, và bản đầu của nó NÓI DỐI: `makeAddedRow` đặt
   * cả `discountBase` lẫn `lineDiscount` về 0, nên bỏ hẳn vế
   * `discountBase > 0` thì phép nhân vẫn không chạy và chốt vẫn xanh.
   * Phải dựng đúng tình huống chia cho 0 mới bắt được: một dòng có khoản
   * giảm nhưng không có mẫu số. NaN ở đây chui thẳng vào tải trọng gửi
   * lên máy chủ và thành một con số tiền không ai đọc nổi.
   */
  it("có khoản giảm mà không có mẫu số thì ra 0, không ra NaN", () => {
    const row = {
      orderLineId: null, productId: "p", unitName: "hộp", conversionFactor: 1,
      qty: 2, price: 100, lineDiscount: 500, discountBase: 0, vatRate: 0,
      isExchange: false, note: null,
    } as unknown as EditorRow
    const out = toDraft([row])[0].lineDiscount
    expect(Number.isNaN(out)).toBe(false)
    expect(out).toBe(0)
  })

  it("dòng của đơn chia chiết khấu theo tỉ lệ phần đang xuất", () => {
    const row = {
      orderLineId: "ol1", productId: "p", unitName: "hộp", conversionFactor: 1,
      qty: 3, price: 100, lineDiscount: 600, discountBase: 6, vatRate: 0,
      isExchange: false, note: null,
    } as unknown as EditorRow
    expect(toDraft([row])[0].lineDiscount).toBe(300)
  })
})

describe("ô tìm mã hàng để thêm", () => {
  const cat = [prod(), prod({ id: "p2", sku: "SKU2", name: "Kem Đậu Xanh" })]

  /** ⚠ Bỏ dấu trước khi so — người bán gõ "banh" để tìm "Bánh". */
  it("tìm được khi gõ không dấu", () => {
    expect(searchAddable(cat, "banh", new Set()).map((p) => p.id)).toEqual(["p1"])
    expect(searchAddable(cat, "dau xanh", new Set()).map((p) => p.id)).toEqual(["p2"])
  })

  it("tìm được theo mã SKU", () => {
    expect(searchAddable(cat, "sku2", new Set()).map((p) => p.id)).toEqual(["p2"])
  })

  /**
   * ⚠ LOẠI MÃ ĐÃ CÓ TRÊN MÀN. Thêm lần hai thành hai dòng cùng một mã, và
   * người tra sổ không hiểu vì sao một mặt hàng xuất hiện hai lần trong
   * cùng một tờ hóa đơn.
   */
  it("không gợi ý mã đã có trên hóa đơn", () => {
    expect(searchAddable(cat, "banh", new Set(["p1"]))).toEqual([])
  })

  /** Ô rỗng thì KHÔNG đổ cả danh mục ra màn. */
  it("chưa gõ gì thì không gợi ý gì", () => {
    expect(searchAddable(cat, "", new Set())).toEqual([])
    expect(searchAddable(cat, "   ", new Set())).toEqual([])
  })

  it("cắt bớt khi quá nhiều kết quả", () => {
    const many = Array.from({ length: 50 }, (_, i) => prod({ id: `x${i}`, name: `Bánh ${i}` }))
    expect(searchAddable(many, "banh", new Set())).toHaveLength(20)
  })
})

describe("sửa hóa đơn: dòng thêm tay của bản cũ", () => {
  const lines: InvoiceableLine[] = []

  /**
   * ⚠ DÒNG THÊM TAY CỦA LẦN LẬP TRƯỚC PHẢI XOÁ TIẾP ĐƯỢC, còn HÀNG ĐỔI
   * thì không — cả hai đều không có `orderLineId`, nên suy ra từ mỗi cột
   * đó là cho phép xoá mất hàng đổi bằng nút "bỏ dòng".
   */
  it("phân biệt được mã thêm tay với hàng đem đổi", () => {
    const seed = [
      { orderLineId: null, isExchange: false, productId: "p1", unitName: "hộp", quantity: 1,
        unitPrice: 0, lineDiscount: 0, vatRate: 0, conversionFactor: 1,
        productName: "Thêm tay", sku: null, note: null },
      { orderLineId: null, isExchange: true, productId: "p2", unitName: "hộp", quantity: 1,
        unitPrice: 0, lineDiscount: 0, vatRate: 0, conversionFactor: 1,
        productName: "Hàng đổi", sku: null, note: null },
    ]
    const rows = seedForReissue(lines, seed)
    expect(rows[0].addedByHand).toBe(true)
    expect(rows[1].addedByHand).toBe(false)
  })
})

describe("màn soạn: ràng buộc giao diện", () => {
  /** ⚠ Chỉ dòng tự thêm mới có nút xoá. */
  it("nút xoá dòng chỉ hiện cho dòng thêm tay", () => {
    expect(EDITOR).toContain("{r.addedByHand && (")
  })

  /** ⚠ Tồn chưa tra xong thì in "…", đừng in 0 — 0 đọc như "hết hàng". */
  it("tồn chưa tra xong hiện dấu ba chấm, không hiện 0", () => {
    expect(EDITOR).toContain("{r.stockKnown ? r.availableBase : \"…\"}")
  })

  /** ⚠ Cảnh báo thiếu tồn chỉ tính dòng ĐÃ biết tồn. */
  it("cảnh báo thiếu tồn bỏ qua dòng chưa tra xong", () => {
    expect(EDITOR).toContain("r.qty > 0 && r.stockKnown && shortageOf(r, r.qty) > 0")
  })

  /** ⚠ Tra tồn theo đúng kho bán, giống hệt `get_invoiceable_lines`. */
  it("tra tồn theo kho bán", () => {
    expect(EDITOR).toContain('.eq("warehouse_zone", "sale")')
  })

  /**
   * ⚠ THIẾU MÃ ĐƠN THÌ NÓI RÕ, đừng hiện màn soạn trống. RLS từ chối trả
   * 0 dòng kèm `error` null, nên `data` rỗng mà không báo gì là trường
   * hợp thường gặp nhất.
   */
  it("mở thiếu mã đơn, hoặc đơn không đọc được, đều nói rõ", () => {
    expect(NEW_PAGE).toContain("Thiếu mã đơn")
    expect(NEW_PAGE).toContain("else if (!data) setErr(")
  })
})
