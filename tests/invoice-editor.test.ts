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

  /**
   * ⚠ LUẬT NÀY ĐÃ BỊ ĐẢO NGƯỢC, VÀ CHỐT PHẢI NÓI RA. Bản cũ khẳng định
   * "chưa gõ gì thì không gợi ý gì". Chủ nhà chốt 20/09/2026 "bấm vào
   * là phải xổ list rồi (như khi chọn NCC ấy)" — bốn màn phiếu đã đổi
   * theo, màn hóa đơn bị bỏ sót vì nó tự vẽ ô tìm riêng, tới
   * 21/09/2026 chủ nhà hỏi lại "Bấm vào vẫn phải xổ list kèm tìm kiếm
   * chứ?".
   *
   * ⚠ NHƯNG VẪN CÓ TRẦN. Đổ cả 1.700 mã xuống là dựng lại đúng cái danh
   * sách phải cuộn mà ô tìm sinh ra để thay thế — đó là lý do luật cũ
   * tồn tại, và nó vẫn đúng. Xổ `limit` mục đầu giữ được cả hai.
   */
  it("ô trống thì xổ danh sách, có trần", () => {
    expect(searchAddable(cat, "", new Set()).map((p) => p.id)).toEqual(["p1", "p2"])
    expect(searchAddable(cat, "   ", new Set()).map((p) => p.id)).toEqual(["p1", "p2"])
    const many = Array.from({ length: 50 }, (_, i) => prod({ id: `x${i}`, name: `Bánh ${i}` }))
    expect(searchAddable(many, "", new Set(), 30)).toHaveLength(30)
  })

  /** Ô trống vẫn phải bỏ mã đã có trên hóa đơn — kể cả khi chưa gõ gì. */
  it("ô trống vẫn loại mã đã có trên hóa đơn", () => {
    expect(searchAddable(cat, "", new Set(["p1"])).map((p) => p.id)).toEqual(["p2"])
  })

  /**
   * ⚠ KHỚP TỪNG TỪ RỜI. Bản cũ `includes` nguyên từ khoá, nên gõ
   * "banh xanh" không ra "Bánh Đậu Xanh" — mà gõ rời rạc, sai thứ tự là
   * cách người bán thật sự gõ giữa lúc giao hàng.
   */
  it("gõ rời rạc, sai thứ tự vẫn ra", () => {
    const c = [prod({ id: "p9", sku: "S9", name: "Bánh Đậu Xanh Rồng Vàng" })]
    expect(searchAddable(c, "xanh banh", new Set()).map((p) => p.id)).toEqual(["p9"])
    expect(searchAddable(c, "vang dau", new Set()).map((p) => p.id)).toEqual(["p9"])
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
  /**
   * ⚠ LUẬT NÀY ĐÃ BỊ ĐẢO NGƯỢC, VÀ CHỐT PHẢI NÓI RA. Bản cũ: "Chỉ dòng
   * tự thêm mới có nút xoá" — dòng của đơn phải tự đặt số lượng về 0,
   * với lý do ghi trong mã là "xoá nó khỏi màn là giấu mất phần đơn
   * chưa xuất".
   *
   * Chủ nhà chốt 21/09/2026: "Màn Xuất hàng và Sửa Hoá đơn bán chưa có
   * phần xoá dòng mặt hàng đi?". Việc bỏ dòng an toàn vì
   * `postInvoice`/`reissueInvoice` đều lọc `quantity > 0` — một dòng để
   * 0 và một dòng bị bỏ đi là CÙNG MỘT THỨ đối với cơ sở dữ liệu. Lý do
   * cũ chỉ đúng về mặt NHÌN, và phần nhìn ấy nay được trả lại bằng
   * thanh "Đã bỏ N dòng … vẫn còn trên đơn" cộng nút hoàn tác.
   *
   * Xem trọn bộ chốt ở "bỏ dòng khỏi tờ hóa đơn" cuối tệp này.
   */
  it("nút bỏ dòng hiện cho mọi dòng trừ hàng đổi", () => {
    expect(EDITOR).toContain("{!r.isExchange && (")
    expect(
      EDITOR.includes("{r.addedByHand && ("),
      "nút bỏ dòng vẫn chỉ hiện trên dòng thêm tay"
    ).toBe(false)
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

// =====================================================================

/**
 * CỘT TRONG CÂU EMBED PHẢI CÓ THẬT.
 *
 * ⚠ CHUYỆN ĐÃ XẢY RA: màn sửa hóa đơn hỏi `customers(price_group_id)` —
 * một cột KHÔNG TỒN TẠI. Tên nghe hợp lý, tsc không biết gì về schema,
 * và mọi chốt cấu trúc đều xanh; nó chỉ nổ khi người dùng bấm vào, và
 * nổ thành nguyên một màn đỏ. Cột thật tên `group_id`.
 *
 * ⚠ ĐỐI CHIẾU VỚI `schema_full.sql`, KHÔNG VỚI TRÍ NHỚ. Đây là chỗ duy
 * nhất trong kho này biết cột nào có thật.
 */
describe("câu embed customers dùng cột có thật", () => {
  const SCHEMA = read("supabase/schema_full.sql")
  const EDIT_PAGE = read("src/app/(dashboard)/sales-invoices/[id]/edit/page.tsx")

  /** Các cột của bảng `customers` theo DDL. */
  const customerCols = (() => {
    const i = SCHEMA.indexOf("CREATE TABLE customers (")
    if (i < 0) throw new Error("không tìm thấy DDL bảng customers trong schema_full.sql")
    const body = SCHEMA.slice(i, SCHEMA.indexOf("\n);", i))
    return new Set(
      body
        .split("\n")
        .slice(1)
        .map((l) => l.trim().split(/[\s(]/)[0])
        .filter((w) => /^[a-z_][a-z0-9_]*$/.test(w))
    )
  })()

  it("schema đọc ra được, và có cột nhóm khách", () => {
    // Nếu phép cắt DDL hỏng thì tập cột rỗng và mọi chốt dưới thành vô
    // nghĩa — kiểm chính phép cắt trước.
    expect(customerCols.size).toBeGreaterThan(10)
    expect(customerCols.has("group_id")).toBe(true)
    expect(customerCols.has("price_group_id")).toBe(false)
  })

  for (const [ten, src] of [
    ["màn lập hóa đơn", NEW_PAGE],
    ["màn sửa hóa đơn", EDIT_PAGE],
    ["khối đầu đơn ở màn soạn", EDITOR],
  ] as const) {
    it(`${ten}: mọi cột trong customers(...) đều có trong schema`, () => {
      const m = src.match(/customer:customers\(([^)]*)\)/)
      expect(m, `${ten} không còn câu embed customers`).toBeTruthy()
      const cols = m![1].split(",").map((c) => c.trim()).filter(Boolean)
      expect(cols.length).toBeGreaterThan(0)
      for (const c of cols) {
        expect(customerCols.has(c), `${ten} hỏi cột "${c}" không có trong bảng customers`).toBe(true)
      }
    })
  }

  /** Giá của mã thêm tay phải nhận đúng nhóm khách, không nhận undefined. */
  it("nhóm giá truyền vào màn soạn lấy từ đúng cột đó", () => {
    expect(strip(NEW_PAGE)).toContain("priceGroupId={order.customer?.group_id ?? null}")
    expect(strip(EDIT_PAGE)).toContain("priceGroupId={inv.customer?.group_id ?? null}")
  })
})

// =====================================================================

/**
 * MÀN XUẤT HÀNG PHẢI NÓI RÕ ĐANG XUẤT CHO AI.
 *
 * ⚠ CHUYỆN ĐÃ XẢY RA: màn này chỉ có tiêu đề "Xuất hàng" và một viên mã
 * đơn "DH-0108". Chủ nhà hỏi 20/09/2026: "sao màn Xuất hàng không có
 * thông tin đơn hàng như tên khách hàng". Người đứng ở kho phải mở tab
 * khác tra đơn mới biết mình đang xuất cho cửa hàng nào — đúng thao tác
 * mà người bận sẽ bỏ qua, và đúng lúc dễ xuất nhầm đơn nhất.
 *
 * ⚠ ĐỌC TRONG CHÍNH MÀN SOẠN, KHÔNG NHẬN QUA PROPS. Màn này có hai lối
 * vào; nhận qua props là hai câu truy vấn phải sửa song song, và lối vào
 * nào quên sửa thì ở đó tên khách lại trống y như cũ.
 */
describe("khối đầu đơn ở màn Xuất hàng", () => {
  /** Câu đọc `sales_orders` trong chính màn soạn. */
  const headSelect = (() => {
    const i = EDITOR.indexOf('.from("sales_orders")')
    if (i < 0) throw new Error("màn soạn không còn đọc sales_orders")
    return EDITOR.slice(i, EDITOR.indexOf('.eq("id", orderId)', i))
  })()

  it("đọc tên khách, liên hệ, ngày đặt, hình thức trả và nhân viên bán", () => {
    for (const col of ["store_name", "phone", "address"]) {
      expect(headSelect, `câu đọc đầu đơn thiếu customers.${col}`).toContain(col)
    }
    expect(headSelect).toContain("order_date")
    expect(headSelect).toContain("payment_terms")
    expect(headSelect).toContain("notes")
    expect(headSelect).toMatch(/sales_user:users!sales_orders_sales_user_id_fkey\(full_name\)/)
  })

  /**
   * ⚠ TÊN KHÁCH PHẢI THỰC SỰ ĐƯỢC VẼ RA. Đọc về rồi bỏ trong state là
   * đúng y cái lỗi chủ nhà báo — chốt phải bắt cả câu đọc lẫn chỗ vẽ.
   */
  it("vẽ tên khách ra màn, bằng khuôn chung của chi tiết đơn / hóa đơn", () => {
    expect(EDITOR).toContain("<DetailCustomerCard")
    expect(EDITOR).toContain("head.customer?.store_name")
    expect(EDITOR).toMatch(/import \{ DetailCustomerCard \} from "@\/components\/detail\/detail-chrome"/)
  })

  /**
   * ⚠ ĐỊA CHỈ GHÉP BẰNG `fullCustomerAddress`. Lấy trơ `address` là in
   * "47 Cẩm" — người xuất hàng không biết đó là phường nào (xem
   * `src/lib/customers/address.ts`).
   */
  it("địa chỉ ghép bằng một chỗ ghép duy nhất của kho", () => {
    expect(EDITOR).toContain("fullCustomerAddress(head.customer ?? {})")
    for (const col of ["ward", "district", "province"]) {
      expect(headSelect, `ghép địa chỉ cần customers.${col}`).toContain(col)
    }
  })

  /**
   * ⚠ RLS TỪ CHỐI = 0 DÒNG, HTTP 200, `error` null. Nếu ô xương cá được
   * khoá trên `head === null` thì người không có quyền xem đơn nhìn một
   * ô xám quay mãi mãi. Phải có cờ "đã đọc xong" riêng, và cờ đó phải
   * được bật trong CHÍNH nhánh trả về.
   */
  it("đọc xong mà không ra dòng nào thì thôi vẽ, không quay xương cá mãi", () => {
    expect(EDITOR).toContain("!headLoaded ? (")
    expect(EDITOR).not.toContain("!head ? (")
    const then = EDITOR.slice(EDITOR.indexOf(".then(", EDITOR.indexOf('.from("sales_orders")')))
    expect(then.slice(0, 300)).toContain("setHeadLoaded(true)")
  })

  /**
   * ⚠ NGÀY / HÌNH THỨC TRẢ TRỐNG THÌ GẮN NHÃN "chưa xác định". In một
   * dấu gạch đọc như "không có", in ngày hôm nay thì là bịa.
   */
  it("trường trống được gắn nhãn chưa xác định", () => {
    expect(EDITOR).toContain('head.order_date ? formatDate(head.order_date) : "chưa xác định"')
    expect(EDITOR).toContain('shortTermLabel(head.payment_terms) || "chưa xác định"')
  })

  /**
   * ⚠ GHI CHÚ ĐƠN VẪN PHẢI CÒN. Nó được gộp vào cùng câu đọc đầu đơn ở
   * lần sửa này; gộp nhầm là mất luôn khối ghi chú chủ nhà chốt trước đó
   * ("phần Xuất hàng cũng phải có ghi chú đầy đủ cho NPP duyệt").
   */
  /* ⚠ LẬT 26/09/2026 — chủ nhà: "Bỏ hết phần ghi chú đơn hàng, chỉ dùng ghi chú dòng". */
  it("không còn khối ghi chú đơn hàng", () => {
    expect(EDITOR).not.toContain("orderNotes")
    expect(EDITOR).not.toContain("Ghi chú đơn hàng")
  })
})

// =====================================================================

const EDITOR_UI = readFileSync(
  resolve(__dirname, "..", "src/components/orders/invoice-editor.tsx"), "utf-8"
).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const POST_INVOICE = readFileSync(
  resolve(__dirname, "..", "src/lib/orders/post-invoice.ts"), "utf-8"
)

/**
 * BỎ MỘT DÒNG KHỎI TỜ HÓA ĐƠN ĐANG SOẠN.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Màn Xuất hàng và Sửa Hoá đơn bán chưa có
 * phần xoá dòng mặt hàng đi?". Trước nay chỉ dòng THÊM TAY mới bỏ được;
 * dòng của đơn phải tự đặt số lượng về 0.
 *
 * ⚠ LUẬT CŨ CÓ LÝ DO, VÀ LÝ DO ẤY ĐÃ ĐƯỢC CÂN NHẮC CHỨ KHÔNG BỊ GẠT ĐI.
 * Chú thích cũ viết: "xoá nó khỏi màn là giấu mất phần đơn chưa xuất".
 * Đúng về mặt NHÌN, nhưng không đúng về mặt DỮ LIỆU — và chốt ngay dưới
 * canh chính chỗ đó.
 */
describe("bỏ dòng khỏi tờ hóa đơn", () => {
  /**
   * ⚠ ĐÂY LÀ ĐIỀU KIỆN KHIẾN VIỆC BỎ DÒNG AN TOÀN. `postInvoice` và
   * `reissueInvoice` đều lọc `quantity > 0` trước khi gọi RPC, nên một
   * dòng để 0 và một dòng bị bỏ đi là CÙNG MỘT THỨ đối với cơ sở dữ
   * liệu. Ngày nào phép lọc ấy mất đi thì nút bỏ dòng thành một đường
   * ghi khác hẳn — chốt này đỏ trước khi chuyện đó kịp ra máy chủ thật.
   */
  it("hai đường cho ra dữ liệu y hệt: RPC vẫn lọc quantity > 0", () => {
    const n = POST_INVOICE.match(
      /payload\.lines\.filter\(\(l\) => \(Number\(l\.quantity\) \|\| 0\) > 0\)/g
    )
    expect(n, "post-invoice thôi lọc dòng số lượng 0").not.toBeNull()
    expect(n!.length, "chỉ một trong hai đường (lập mới / lập lại) còn lọc").toBe(2)
  })

  /**
   * ⚠ HÀNG ĐỔI KHÔNG BỎ ĐƯỢC. Dòng `isExchange` đến từ phiếu trả của
   * khách, không phải từ đơn — bỏ nó đi là hàng khách đã đưa lại mà tờ
   * hóa đơn không ghi nhận, và khoản trừ công nợ biến mất.
   */
  it("hàng đổi vẫn không bỏ được", () => {
    expect(
      /const row = p\.find\(\(r\) => r\.key === key\)\s*if \(!row \|\| row\.isExchange\) return p/.test(
        EDITOR_UI
      ),
      "dropRow thôi chặn dòng hàng đổi — khoản trừ công nợ của khách biến mất"
    ).toBe(true)
    expect(EDITOR_UI, "nút bỏ dòng hiện cả trên dòng hàng đổi").toContain("{!r.isExchange && (")
  })

  /**
   * ⚠ Và dòng CỦA ĐƠN thì bỏ được — đúng thứ chủ nhà yêu cầu.
   *
   * ⚠ BÁM VÀO ĐIỀU KIỆN, KHÔNG BÁM VÀO Ô BẢNG. Bản cũ đọc
   * `<td className="px-2 py-2">`; bố cục 21/09/2026 bỏ hẳn bảng, nên
   * chốt đỏ vì một tên thẻ chứ không vì hành vi.
   */
  it("dòng của đơn bỏ được, không chỉ dòng thêm tay", () => {
    expect(EDITOR_UI, "nút bỏ dòng không còn chặn hàng đổi").toContain("{!r.isExchange && (")
    expect(
      EDITOR_UI.includes("{r.addedByHand && ("),
      "nút bỏ dòng vẫn chỉ hiện trên dòng thêm tay"
    ).toBe(false)
  })

  /**
   * ⚠ BỎ NHẦM PHẢI LẤY LẠI ĐƯỢC. Màn này không có bản nháp — không có
   * gì được ghi xuống cho tới nút cuối. Bấm nhầm mà cách duy nhất để
   * lấy lại là tải lại trang thì mất sạch số lượng và giá đã sửa tay.
   */
  it("bỏ nhầm thì hoàn tác được", () => {
    expect(EDITOR_UI, "không giữ lại dòng đã bỏ").toContain("setDropped((d) => [...d, row])")
    expect(EDITOR_UI, "không có đường hoàn tác").toContain("const undoDrop =")
    expect(EDITOR_UI, "không có nút hoàn tác").toContain("Hoàn tác")
  })

  /**
   * ⚠ VÀ NÓI RÕ BỎ KHỎI ĐÂU. "Đã bỏ 3 dòng" mà không nói bỏ khỏi cái
   * gì là để người xuất hàng tưởng mình vừa xoá hàng khỏi ĐƠN của
   * khách — thứ màn này không làm và không được phép làm.
   */
  it("nói rõ phần chưa xuất vẫn còn trên đơn", () => {
    expect(EDITOR_UI).toContain("khỏi tờ hóa đơn này")
    expect(EDITOR_UI).toContain("vẫn còn")
  })
})

// =====================================================================


// =====================================================================

const MIG149 = readFileSync(
  resolve(__dirname, "..", "supabase/migrations/149_reissue_updates_returns.sql"), "utf-8"
)
const POST_INV = readFileSync(
  resolve(__dirname, "..", "src/lib/orders/post-invoice.ts"), "utf-8"
)

/**
 * SỬA HÓA ĐƠN THÌ SỬA LUÔN PHIẾU TRẢ — CÙNG MỘT GIAO DỊCH.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Khi sửa và tạo hoá đơn cho phép sửa cả
 * đổi trả -> sửa thế nào cập nhật vào phiếu trả là xong".
 */
describe("phần sửa phiếu trả đi kèm khi lập lại hóa đơn", () => {
  /**
   * ⚠ PHẢI NẰM TRONG RPC. Sửa `return_lines` là đụng
   * `returns.credit_note_amount` (trigger mig 035) và từ đó đụng CÔNG
   * NỢ. Ghi từ trình duyệt rồi mới gọi RPC là hai bước: bước một xong,
   * bước hai hỏng, và phiếu trả đã bị sửa cho một hóa đơn không bao
   * giờ được lập.
   */
  it("màn hình KHÔNG tự ghi thẳng vào return_lines", () => {
    expect(
      /from\("return_lines"\)[\s\S]{0,80}?\.(update|delete|insert|upsert)\(/.test(EDITOR_UI),
      "màn soạn hóa đơn đang ghi thẳng vào return_lines — phải đi qua RPC"
    ).toBe(false)
  })

  it("gửi phần sửa kèm lời gọi reissue", () => {
    expect(POST_INV).toContain("return_edits")
    expect(EDITOR_UI).toContain("returnEdits: returnEdits")
  })

  /**
   * ⚠ KHÔNG GỬI `line_total`. Con số ấy đi thẳng vào công nợ; để trình
   * duyệt gửi là mở một đường ghi tiền tuỳ ý. RPC tính lại từ
   * `unit_price` và `vat_rate` đang lưu.
   */
  it("chỉ gửi số lượng, không gửi thành tiền", () => {
    /* Cả hai đường (xuất lần đầu, lập lại) dựng qua MỘT hàm `suaTraGuiLen`. */
    expect(POST_INV.match(/return_edits: payload\.returnEdits\.map\(suaTraGuiLen\)/g) ?? [], "một đường không đi qua suaTraGuiLen").toHaveLength(2)
    const blk = POST_INV.match(/function suaTraGuiLen\([\s\S]*?\n\}/)
    expect(blk, "không đọc được phần dựng return_edits").not.toBeNull()
    expect(blk![0]).toContain("line_id")
    expect(blk![0]).toContain("quantity")
    expect(blk![0], "đang gửi thành tiền lên máy chủ").not.toContain("line_total")
    expect(MIG149, "RPC không tự tính lại line_total").toContain("line_total = round(")
  })

  /**
   * ⚠ CHỈ GỬI DÒNG THẬT SỰ ĐỔI. Gửi cả dòng không đổi là ghi đè
   * `line_total` của chúng bằng phép tính lại — một dòng cũ có
   * `line_total` lệch sẽ lặng lẽ đổi số tiền.
   */
  it("chỉ gửi những dòng người dùng thật sự sửa", () => {
    expect(EDITOR_UI).toContain("retEdits[l.id] !== undefined && retEdits[l.id] !== l.qty")
  })

  /**
   * ⚠ ÁP PHẦN SỬA TRƯỚC KHI KIỂM. Đó là cả điểm của migration 149 —
   * kiểm trên trạng thái CŨ thì người dùng vừa bỏ dòng trả xong vẫn bị
   * từ chối.
   */
  it("RPC áp phần sửa TRƯỚC phép kiểm", () => {
    /* ⚠ SOI TRONG THÂN HÀM, KHÔNG SOI CẢ TỆP. `REISSUE_BREAKS_RETURN`
       còn xuất hiện ở khối chú thích đầu migration — bắt phải nó là
       chốt đỏ vì một dòng chữ, không vì thứ tự lệnh. */
    const body = MIG149.slice(MIG149.indexOf("FUNCTION public.reissue_invoice"))
    const iApply = body.indexOf("_apply_return_edits(p_invoice_id, p->'return_edits')")
    const iCheck = body.indexOf("REISSUE_BREAKS_RETURN")
    expect(iApply, "RPC không gọi _apply_return_edits").toBeGreaterThan(-1)
    expect(iCheck, "RPC bỏ mất phép kiểm").toBeGreaterThan(-1)
    expect(iApply, "áp phần sửa SAU phép kiểm — vô nghĩa").toBeLessThan(iCheck)
  })

  /**
   * ⚠ CHỐT CHẶN GIỮ NGUYÊN. Phép tính trên trình duyệt chỉ để nói sớm;
   * một tab cũ mở sẵn, hay một nơi gọi quên gửi phần sửa, vẫn phải bị
   * từ chối chứ không được lặng lẽ tạo phiếu trả đòi món chưa rời kho.
   */
  it("phép kiểm của máy chủ vẫn còn nguyên", () => {
    expect(MIG149).toContain("AND rl.is_exchange = false")
    expect(MIG149).toContain("r.status IN ('draft', 'submitted')")
  })

  /**
   * ⚠ CHỈ ĐỤNG DÒNG CỦA HÓA ĐƠN NÀY. `SECURITY DEFINER` bỏ qua RLS,
   * nên không chặn thì một `line_id` gõ bừa sửa được phiếu trả của
   * khách khác.
   */
  it("RPC chặn line_id của hóa đơn khác", () => {
    const fn = MIG149.slice(
      MIG149.indexOf("FUNCTION public._apply_return_edits"),
      MIG149.indexOf("COMMENT ON FUNCTION public._apply_return_edits")
    )
    expect(fn).toContain("AND r.invoice_id = p_invoice_id")
    expect(fn).toContain("AND r.status IN ('draft', 'submitted')")
  })

  /** ⚠ Không gửi gì thì không đụng gì — nơi gọi cũ không phải sửa. */
  it("không gửi phần sửa thì RPC không đụng gì", () => {
    expect(MIG149).toContain("IF p_edits IS NULL OR jsonb_typeof(p_edits) <> 'array' THEN")
  })

  /**
   * ⚠ BỎ HẾT DÒNG THÌ HUỶ HẲN PHIẾU. Để lại một phiếu `submitted`
   * không dòng nào là một việc treo vĩnh viễn ở hàng đợi kho.
   */
  it("phiếu trả rỗng dòng thì bị huỷ, không nằm chờ", () => {
    expect(MIG149).toContain("SET status = 'cancelled'")
    expect(MIG149).toContain("NOT EXISTS (SELECT 1 FROM return_lines rl WHERE rl.return_id = returns.id)")
  })
})

// =====================================================================

const MIG152 = readFileSync(
  resolve(__dirname, "..", "supabase/migrations/152_invoice_adds_return_lines.sql"), "utf-8"
)

/**
 * HUỶ HÓA ĐƠN KHÔNG ĐƯỢC HUỶ PHIẾU TRẢ CỦA ĐƠN.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: "tại sao khi huỷ hoá đơn lại huỷ cả phần
 * trả về của Đơn hàng", kèm ảnh một phiếu trả mang nhãn "Đã huỷ · −0đ".
 *
 * ⚠ ĐÂY LÀ LỖI LẶP LẠI, VÀ ĐÓ MỚI LÀ ĐIỀU ĐÁNG GHI. Migration 131 đã
 * sửa đúng sai lầm này một lần cho `cancel_invoice`: phiếu trả kèm đơn
 * bám vào ĐƠN, không bám vào hóa đơn; huỷ nó là ghi vào sổ rằng khách
 * CHƯA TỪNG trả hàng, trong khi hàng có thể đang nằm đó thật. Migration
 * 149 của tôi dựng một câu huỷ MỚI ở `reissue_invoice` cho phiếu rỗng
 * dòng — cùng sai lầm, chỗ khác, và không chốt nào canh.
 *
 * ⚠ KHÔNG CẦN THÊM TRẠNG THÁI MỚI. Chủ nhà hỏi "có cần để thêm 1 trạng
 * thái phiếu tạm cho phiếu trả để còn back trạng thái khi huỷ hoá đơn?"
 * — `draft` đã là đúng trạng thái ấy, và `cancel_invoice` (mig 131 +
 * 133) đã hạ phiếu về đó từ trước.
 */
describe("phiếu trả kèm đơn không bị huỷ theo hóa đơn", () => {
  /** ⚠ `cancel_invoice` hạ về `draft` và gỡ liên kết — không huỷ. */
  it("cancel_invoice hạ phiếu của ĐƠN về phiếu tạm, chỉ huỷ phiếu độc lập", () => {
    const m131 = readFileSync(
      resolve(__dirname, "..", "supabase/migrations/131_cancel_invoice_keeps_returns.sql"),
      "utf-8"
    )
    expect(m131).toContain("order_id IS NOT NULL")
    expect(m131).toContain("order_id IS NULL")
  })

  /**
   * ⚠ VÀ `reissue_invoice` CŨNG KHÔNG ĐƯỢC HUỶ. Câu của mig 149 nay hạ
   * về `draft`; một câu `status = 'cancelled'` nhắm vào `returns` ở
   * đây là sai lầm cũ quay lại.
   */
  it("reissue_invoice không huỷ phiếu trả nào", () => {
    const than = MIG152.slice(
      MIG152.indexOf("FUNCTION public.reissue_invoice"),
      MIG152.indexOf("GRANT EXECUTE ON FUNCTION public.reissue_invoice")
    )
    const code = than.replace(/--[^\n]*/g, "")
    expect(
      /UPDATE returns[\s\S]{0,200}?status\s*=\s*'cancelled'/.test(code),
      "reissue_invoice đang huỷ phiếu trả — hàng khách đã đưa lại sẽ biến " +
        "mất khỏi sổ. Hạ về 'draft' như cancel_invoice vẫn làm."
    ).toBe(false)
    expect(code, "phiếu rỗng dòng không được hạ về phiếu tạm").toContain("SET status = 'draft'")
  })

  /**
   * ⚠ VÀ CHỈ ĐỤNG KHI CHÍNH LƯỢT NÀY LÀM RỖNG NÓ. Không có điều kiện
   * ấy thì một phiếu vốn dĩ đã rỗng bị hạ trạng thái ở lần sửa hóa đơn
   * kế tiếp, dù người dùng không hề chạm vào.
   */
  it("chỉ hạ trạng thái khi lượt sửa này làm rỗng phiếu", () => {
    expect(MIG152).toContain("IF v_edited > 0 THEN")
  })
})

/**
 * THÊM HÀNG ĐỔI / TRẢ NGAY TRÊN MÀN HÓA ĐƠN.
 *
 * ⚠ CHỦ NHÀ CHỐT 21/09/2026: "Tao muốn nó đủ chức năng như khi Tạo đơn
 * hàng cơ mà?".
 */
describe("thêm hàng đổi / trả khi xuất và sửa hóa đơn", () => {
  it("cả hai đường đều gửi được phần thêm", () => {
    expect(POST_INV, "postInvoice chưa gửi return_adds").toContain(
      "returnAddsPayload(payload.returnAdds)"
    )
    expect(
      (POST_INV.match(/returnAddsPayload\(payload\.returnAdds\)/g) ?? []).length,
      "chỉ một trong hai đường (xuất lần đầu / sửa) gửi được"
    ).toBe(2)
    expect(EDITOR_UI).toContain("returnAdds: retAdds.map(")
  })

  /**
   * ⚠ GỠ `return_adds` TRƯỚC KHI `reissue_invoice` GỌI `post_invoice` —
   * NẾU KHÔNG DÒNG TRẢ BỊ THÊM HAI LẦN. Đo trên Postgres thật trước khi
   * phát hành: thêm 1 dòng trả 216.000 và 1 dòng đổi thì sổ ghi hai bản
   * mỗi loại, credit vọt từ 316.000 lên 532.000 — trừ công nợ khách GẤP
   * ĐÔI.
   */
  it("không thêm hai lần khi sửa hóa đơn", () => {
    expect(MIG152).toContain("v_payload := v_payload - 'return_adds'")
    const than = MIG152.slice(
      MIG152.indexOf("FUNCTION public.reissue_invoice"),
      MIG152.indexOf("GRANT EXECUTE ON FUNCTION public.reissue_invoice")
    )
    expect(
      than.indexOf("v_payload - 'return_adds'"),
      "gỡ SAU khi gọi post_invoice thì vô nghĩa"
    ).toBeLessThan(than.indexOf("SELECT * INTO v_new FROM public.post_invoice"))
  })

  /** ⚠ `line_total` tính ở server — nó đi thẳng vào công nợ. */
  it("không gửi thành tiền lên máy chủ", () => {
    const blk = POST_INV.match(/function returnAddsPayload[\s\S]{0,600}?\n\}/)
    expect(blk, "không đọc được phần dựng return_adds").not.toBeNull()
    expect(blk![0], "đang gửi thành tiền lên máy chủ").not.toContain("line_total")
    expect(MIG152, "RPC không tự tính line_total").toContain("round(v_qty * v_price * (1 + v_vat))")
  })

  /** ⚠ Chưa có phiếu nào thì DỰNG, và phiếu mới luôn ở `draft`. */
  it("dựng phiếu trả khi đơn chưa có, và để ở phiếu tạm", () => {
    const fn = MIG152.slice(
      MIG152.indexOf("FUNCTION public._pending_return_for"),
      MIG152.indexOf("COMMENT ON FUNCTION public._pending_return_for")
    )
    expect(fn).toContain("INSERT INTO returns")
    expect(fn, "phiếu mới không được tự nhảy sang submitted").toContain("'draft'")
  })
})
