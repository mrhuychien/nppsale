import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  makeAddedRow, withStock, toDraft, rowsOverOrdered, searchAddable, seedForReissue,
  returnsBrokenBy,
  type EditorRow, type PendingReturnLine,
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
  it("ghi chú chung của đơn vẫn được vẽ", () => {
    expect(EDITOR).toContain('const orderNotes = (head?.notes ?? "").trim() || null')
    expect(EDITOR).toMatch(/\{orderNotes && \([\s\S]{0,400}Ghi chú đơn hàng/)
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

/**
 * SỬA HÓA ĐƠN CÓ HÀNG ĐỔI / TRẢ.
 *
 * ⚠ CHỦ NHÀ BÁO 21/09/2026: sửa hóa đơn có hàng đổi/trả thì vấp
 * "REISSUE_BREAKS_RETURN: hóa đơn mới không còn bán "bắp nếp tím pho
 * mai 250g" mà phiếu trả đang chờ xử lý đòi trả. Huỷ phiếu trả trước,
 * rồi sửa lại hóa đơn." — và chỉ biết SAU KHI đã sửa xong cả tờ.
 */
const INV = "inv-dang-sua"
const rr = (o: Partial<PendingReturnLine> = {}): PendingReturnLine => ({
  returnId: "r1",
  returnStatus: "submitted",
  invoiceId: INV,
  productId: "p1",
  productName: "Bắp nếp tím pho mai 250g",
  isExchange: false,
  ...o,
})
const row = (o: Partial<EditorRow> = {}): EditorRow =>
  ({ key: "k", productId: "p1", qty: 5, isExchange: false, ...o }) as unknown as EditorRow

describe("phiếu trả đang chờ vỡ vì hóa đơn bỏ mất món", () => {
  it("bỏ hẳn món khỏi hóa đơn thì báo xung đột", () => {
    expect(returnsBrokenBy([row({ productId: "p2" })], [rr()], INV)).toEqual([
      { returnId: "r1", productName: "Bắp nếp tím pho mai 250g" },
    ])
  })

  /**
   * ⚠ ĐỂ SỐ LƯỢNG 0 CŨNG LÀ BỎ. `reissue_invoice` soi
   * `quantity > 0`, nên một dòng còn trên màn mà để 0 thì máy chủ vẫn
   * coi như hóa đơn không bán món ấy. Chốt theo đúng luật của máy chủ,
   * không theo "dòng có còn trên màn không".
   */
  it("để số lượng 0 cũng tính là không bán", () => {
    expect(returnsBrokenBy([row({ qty: 0 })], [rr()], INV)).toHaveLength(1)
  })

  it("còn bán thì không báo gì", () => {
    expect(returnsBrokenBy([row()], [rr()], INV)).toEqual([])
  })

  /**
   * ⚠ DÒNG ĐỔI KHÔNG TÍNH — hàng đổi không trừ công nợ, và
   * `reissue_invoice` cũng lọc `rl.is_exchange = false`. Kể vào đây là
   * chặn một tờ hóa đơn mà máy chủ sẽ nhận.
   */
  it("hàng đổi không bị kể là xung đột", () => {
    expect(returnsBrokenBy([row({ productId: "p2" })], [rr({ isExchange: true })], INV)).toEqual([])
  })

  /**
   * ⚠ VÀ DÒNG ĐỔI TRÊN HÓA ĐƠN KHÔNG ĐƯỢC TÍNH LÀ "CÒN BÁN". Máy chủ
   * soi `is_exchange = false` ở CẢ hai vế; nhận nhầm một dòng đổi làm
   * bằng chứng "vẫn bán" là để lọt đúng tờ hóa đơn máy chủ sẽ từ chối.
   */
  it("dòng đổi trên hóa đơn không cứu được xung đột", () => {
    expect(returnsBrokenBy([row({ isExchange: true })], [rr()], INV)).toHaveLength(1)
  })

  /** ⚠ Phiếu đã huỷ / đã xong không chặn ai. */
  it("chỉ phiếu đang chờ mới chặn", () => {
    for (const st of ["cancelled", "completed"]) {
      expect(returnsBrokenBy([row({ productId: "p2" })], [rr({ returnStatus: st })], INV)).toEqual([])
    }
    expect(returnsBrokenBy([row({ productId: "p2" })], [rr({ returnStatus: "draft" })], INV))
      .toHaveLength(1)
  })

  /**
   * ⚠ PHIẾU TRẢ CỦA MỘT HÓA ĐƠN KHÁC KHÔNG ĐƯỢC CHẶN. Đây là lỗi chủ
   * nhà vấp phải 21/09/2026 ("Đoạn này là sao?"): bản đầu đọc phiếu trả
   * theo ĐƠN, mà một đơn giao nhiều đợt có NHIỀU hóa đơn.
   * `reissue_invoice` chỉ soi `WHERE r.invoice_id = p_invoice_id`, nên
   * màn hình chặn một tờ mà máy chủ sẽ nhận — người dùng kẹt cứng, và
   * không hiểu vì sao. Một lời từ chối SAI tệ hơn không cảnh báo.
   */
  it("phiếu trả của hóa đơn KHÁC không chặn tờ đang sửa", () => {
    expect(
      returnsBrokenBy([row({ productId: "p2" })], [rr({ invoiceId: "inv-khac" })], INV)
    ).toEqual([])
  })

  /** ⚠ Phiếu trả chưa gắn hóa đơn nào cũng không — máy chủ không soi nó. */
  it("phiếu trả chưa gắn hóa đơn không chặn", () => {
    expect(
      returnsBrokenBy([row({ productId: "p2" })], [rr({ invoiceId: null })], INV)
    ).toEqual([])
  })

  it("không báo trùng khi một phiếu có nhiều dòng cùng mã", () => {
    expect(
      returnsBrokenBy([row({ productId: "p2" })], [rr(), rr()], INV)
    ).toHaveLength(1)
  })

  /**
   * ⚠ MÀN HÌNH PHẢI KHOÁ NÚT, KHÔNG CHỈ VẼ MỘT DÒNG CHỮ. Máy chủ sẽ từ
   * chối tờ này; để bấm được là bắt người dùng sửa cả màn rồi đổi lấy
   * một câu lỗi.
   */
  it("màn hình khoá nút lưu khi có xung đột", () => {
    expect(EDITOR_UI).toContain("returnConflicts.length > 0")
    expect(EDITOR_UI).toContain("disabled={saving || picked.length === 0 || returnConflicts.length > 0}")
  })

  /**
   * ⚠ VÀ CHỈ ĐƯỜNG, KHÔNG CHỈ CHẶN. Câu lỗi của máy chủ bảo "huỷ phiếu
   * trả" — huỷ CẢ phiếu là mất luôn những dòng khác trên đó.
   */
  it("mở được đúng phiếu trả đang vướng", () => {
    expect(EDITOR_UI).toContain("`/returns/${rid}`")
    /* ⚠ TAB MỚI — đang sửa dở một tờ hóa đơn CHƯA LƯU. */
    expect(EDITOR_UI).toContain('window.open(`/returns/${rid}`, "_blank")')
  })

  /**
   * ⚠ CHỈ CẢNH BÁO KHI ĐANG SỬA LẠI. Lập lần đầu thì phiếu trả kèm đơn
   * còn `draft` và chưa gắn hóa đơn nào; cảnh báo ở đó là kêu oan cho
   * một xung đột chưa tồn tại — và người dùng học được cách bỏ qua.
   */
  it("lập hóa đơn lần đầu thì không cảnh báo", () => {
    expect(EDITOR_UI).toContain("returnsBrokenBy(rows, pendingReturns, reissueOf.invoiceId)")
    /* ⚠ VÀ CHỈ SOI PHIẾU GẮN VÀO ĐÚNG TỜ ĐANG SỬA — xem chốt
       "phiếu trả của hóa đơn KHÁC" ở trên. */
    expect(EDITOR_UI).toContain("const returnConflicts = reissueOf")
  })

  /**
   * ⚠ LUẬT Ở MÁY CHỦ PHẢI CÒN ĐÓ. Phép tính trên trình duyệt chỉ để
   * NÓI SỚM; nó không thay được chốt chặn. Ngày nào `reissue_invoice`
   * thôi kiểm thì một tab cũ mở sẵn vẫn lưu được tờ hóa đơn phá phiếu
   * trả — nhập kho khống và trừ công nợ khống.
   */
  it("máy chủ vẫn là chỗ chặn thật", () => {
    const mig = readFileSync(
      resolve(__dirname, "..", "supabase/migrations/125_wf2b_invoice_rpcs.sql"), "utf-8"
    )
    expect(mig, "reissue_invoice thôi chặn phiếu trả bị vỡ").toContain("REISSUE_BREAKS_RETURN")
    expect(mig).toContain("AND rl.is_exchange = false")
  })
})
