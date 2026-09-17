import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  applyOrderEdit,
  decideEditStatus,
  isSellEditable,
  orderLinesToCart,
  type OrderLineRow,
} from "../src/lib/sell/order-edit"
import { buildOrderPayload } from "../src/lib/sell/create-order"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"
import type { SellProduct } from "../src/lib/sell/ref-data"
import { DEFAULT_APPROVAL_RULES } from "../src/lib/approval"
import type { ApprovalRules } from "../src/types"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const EDIT = code(read("src/lib/sell/order-edit.ts"))
const CART_PAGE = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const CART_HOOK = code(read("src/hooks/use-sell-cart.tsx"))
const LOADER = code(read("src/app/(dashboard)/sell/edit/[id]/page.tsx"))
const POS = code(read("src/app/(dashboard)/sell/page.tsx"))

const rules = { ...DEFAULT_APPROVAL_RULES } as unknown as ApprovalRules

const product = (over: Partial<SellProduct> = {}): SellProduct =>
  ({
    id: "p1",
    name: "Mì Hảo Hảo",
    sku: "MHH",
    base_unit: "gói",
    vat_rate: 8,
    sell_price: 4_000,
    units: [{ unit_name: "thùng", conversion: 30 }],
    prices: [],
    ...over,
  }) as unknown as SellProduct

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 1,
  price: 1_000_000,
  listPrice: 1_000_000,
  note: "",
  conversion: 30,
  vatRate: 0,
  ...over,
})

const decision = (over: Record<string, unknown> = {}) => ({
  asDraft: false,
  orderTotal: 1_000_000,
  subtotal: 1_000_000,
  grossBeforeDiscount: 1_000_000,
  customer: { id: "c1", credit_limit: 0 },
  rules,
  customerDebt: 0,
  customerOverdue: 0,
  repPortfolioDebt: 0,
  role: "sales" as const,
  ...over,
})

describe("Nạp đơn đã lưu ngược vào giỏ", () => {
  const rows: OrderLineRow[] = [
    {
      product_id: "p1",
      unit_name: "thùng",
      quantity: 2,
      unit_price: 90_000,
      conversion_factor: 24,
      note: "lấy lô mới",
    },
  ]

  /**
   * ⚠ `listPrice` PHẢI TÍNH LẠI theo bảng giá, không lấy `unit_price`. Hai
   * con số khác nhau chính là thứ màn giỏ dùng để gắn nhãn "Giá sửa" và để
   * chặn giá dưới sàn. Gán bằng nhau là xoá sạch dấu vết một đơn từng bị
   * sửa giá — lần lưu sau nó đi qua mọi chốt như một đơn bình thường.
   */
  it("giá gốc lấy từ bảng giá, không lấy giá đã bán", () => {
    const [l] = orderLinesToCart(rows, [product()], null)
    expect(l.price).toBe(90_000)
    // 4.000đ/gói × 24? Không — hệ số của BẢNG GIÁ là 30.
    expect(l.listPrice).toBe(4_000 * 30)
    expect(l.listPrice).not.toBe(l.price)
  })

  /**
   * ⚠ Hệ số quy đổi lấy từ ĐƠN, không lấy từ danh mục. Quy cách đóng gói
   * có thể đã đổi từ lúc tạo đơn; lấy hệ số mới là âm thầm đổi số lượng
   * xuất kho của một đơn đã thoả thuận với khách.
   */
  it("hệ số quy đổi giữ theo đơn, không theo danh mục hôm nay", () => {
    const [l] = orderLinesToCart(rows, [product()], null)
    expect(l.conversion).toBe(24)
  })

  it("đơn không ghi hệ số thì mới tra danh mục", () => {
    const [l] = orderLinesToCart([{ ...rows[0], conversion_factor: null }], [product()], null)
    expect(l.conversion).toBe(30)
  })

  it("sản phẩm đã rời danh mục thì giữ nguyên giá đã lưu", () => {
    const [l] = orderLinesToCart(rows, [], null)
    expect(l.listPrice).toBe(90_000)
    expect(l.qty).toBe(2)
    expect(l.note).toBe("lấy lô mới")
  })

  it("chỉ mở được đơn chưa ra kho", () => {
    expect(isSellEditable("draft")).toBe(true)
    expect(isSellEditable("confirmed")).toBe(true)
    expect(isSellEditable("picking")).toBe(false)
    expect(isSellEditable("delivered")).toBe(false)
  })
})

describe("Trạng thái sau khi lưu bản sửa", () => {
  it("đơn nháp trong ngưỡng thì lưu xong là duyệt luôn", () => {
    const r = decideEditStatus({ prevStatus: "draft", decision: decision() })
    expect(r.status).toBe("confirmed")
  })

  it("đơn nháp vượt ngưỡng thì vẫn nằm chờ duyệt kèm lý do", () => {
    const r = decideEditStatus({
      prevStatus: "draft",
      decision: decision({ orderTotal: 100_000_000, subtotal: 100_000_000, grossBeforeDiscount: 100_000_000 }),
    })
    expect(r.status).toBe("draft")
    expect(r.reason.length).toBeGreaterThan(0)
  })

  /**
   * ⚠ LỖ HỔNG PHẢI BỊT. Sửa đơn ĐÃ DUYỆT mà không chạy lại quy tắc thì bước
   * duyệt thành vô nghĩa: gửi một đơn nhỏ cho quản lý bấm duyệt, xong sửa
   * lên gấp mười. Người duyệt đã ký vào một tờ giấy khác với tờ ra kho.
   */
  it("sửa đơn đã duyệt lên quá ngưỡng thì trả về chờ duyệt lại", () => {
    const r = decideEditStatus({
      prevStatus: "confirmed",
      decision: decision({
        orderTotal: 100_000_000,
        subtotal: 100_000_000,
        grossBeforeDiscount: 100_000_000,
      }),
    })
    expect(r.status).toBe("draft")
    expect(r.reason).toContain("Sửa sau khi duyệt")
  })

  it("sửa đơn đã duyệt mà vẫn trong ngưỡng thì giữ nguyên đã duyệt", () => {
    const r = decideEditStatus({ prevStatus: "confirmed", decision: decision() })
    expect(r.status).toBe("confirmed")
    expect(r.reason).toBe("")
  })

  /**
   * Chủ tự sửa đơn của mình thì không phải nhờ ai duyệt lại — họ vốn duyệt
   * được mức đó. Bắt thêm một bước ở đây không thêm chốt chặn nào.
   */
  it("người sửa đủ thẩm quyền duyệt mức đó thì không phải duyệt lại", () => {
    const r = decideEditStatus({
      prevStatus: "confirmed",
      decision: decision({
        orderTotal: 100_000_000,
        subtotal: 100_000_000,
        grossBeforeDiscount: 100_000_000,
        role: "owner",
      }),
    })
    expect(r.status).toBe("confirmed")
  })

  /** ⚠ Cho không hàng bằng cách sửa giá về 0 vẫn phải bị chặn. */
  it("chiết khấu sâu trên đơn đã duyệt vẫn bị trả về", () => {
    const r = decideEditStatus({
      prevStatus: "confirmed",
      decision: decision({ orderTotal: 0, subtotal: 0, grossBeforeDiscount: 100_000_000 }),
    })
    expect(r.status).toBe("draft")
  })

  /** ⚠ Đọc hỏng công nợ trả 0 = "khách không nợ gì" — mọi ngưỡng đều lọt. */
  it("đọc hỏng ngữ cảnh thì không được giữ đã duyệt", () => {
    const r = decideEditStatus({
      prevStatus: "confirmed",
      decision: decision({ contextFailed: true }),
    })
    expect(r.status).toBe("draft")
    expect(r.reason).toContain("Không đọc được")
  })

  it("lưu tạm thì không chạy quy tắc, dù đơn to", () => {
    const r = decideEditStatus({
      prevStatus: "draft",
      decision: decision({ asDraft: true, orderTotal: 100_000_000 }),
    })
    expect(r.status).toBe("draft")
  })
})

/** Khách hàng giả lập của PostgREST, đủ để đo THỨ TỰ và số lần gọi. */
function fakeClient(opts: {
  /** Xoá xong còn sót dòng nào không — mô phỏng RLS từ chối trong im lặng. */
  linesLeftAfterDelete?: number
  /** UPDATE đầu đơn sửa được mấy dòng. 0 = RLS từ chối. */
  headerRows?: number
}) {
  const calls: string[] = []
  const inserted: unknown[] = []
  const left = opts.linesLeftAfterDelete ?? 0
  const headerRows = opts.headerRows ?? 1
  const client = {
    from(table: string) {
      const q = {
        _op: "",
        update(_v: unknown) {
          calls.push(`update:${table}`)
          q._op = "update"
          return q
        },
        delete() {
          calls.push(`delete:${table}`)
          q._op = "delete"
          return q
        },
        insert(rows: unknown) {
          calls.push(`insert:${table}`)
          inserted.push(rows)
          return Promise.resolve({ data: null, error: null })
        },
        select(_c: string) {
          if (q._op === "") {
            calls.push(`select:${table}`)
            q._op = "select"
            return q
          }
          return Promise.resolve({
            data: Array.from({ length: q._op === "update" ? headerRows : 1 }, (_, i) => ({
              id: `r${i}`,
            })),
            error: null,
          })
        },
        eq(_c: string, _v: unknown) {
          return q
        },
        limit(_n: number) {
          return Promise.resolve({
            data: Array.from({ length: left }, (_, i) => ({ id: `old${i}` })),
            error: null,
          })
        },
      }
      return q
    },
  }
  return { client, calls, inserted }
}

const payload = (cart: CartLine[]) =>
  buildOrderPayload({
    clientRequestId: "r1",
    orderCode: "DH-1",
    customerId: "c1",
    customerName: "KH",
    paymentTerms: "COD",
    expectedDelivery: null,
    notes: "",
    cart,
    totals: cartTotals(cart),
    createdAt: "2026-09-17T00:00:00.000Z",
    returnReason: "damaged",
    returnLines: [],
  })

describe("Ghi bản sửa xuống đơn đã có", () => {
  const cart = [line()]

  it("xoá dòng cũ, chèn dòng mới, rồi mới sửa đầu đơn", async () => {
    const { client, calls } = fakeClient({})
    await applyOrderEdit(client, {
      orderId: "o1",
      payload: payload(cart),
      cart,
      status: "confirmed",
      reason: "",
      userId: "u1",
    })
    expect(calls).toEqual([
      "delete:sales_order_lines",
      "select:sales_order_lines",
      "insert:sales_order_lines",
      "update:sales_orders",
    ])
  })

  /**
   * ⚠ ĐÂY LÀ CA HỎNG TỐN TIỀN NHẤT. RLS từ chối DELETE thì 0 dòng, HTTP 200,
   * `error` là null. Chèn tiếp thì đơn có HAI bộ dòng hàng — kho lấy gấp đôi
   * số hàng và hoá đơn ghi gấp đôi tiền.
   */
  it("xoá bị từ chối trong im lặng thì DỪNG, không chèn thêm", async () => {
    const { client, calls, inserted } = fakeClient({ linesLeftAfterDelete: 3 })
    await expect(
      applyOrderEdit(client, {
        orderId: "o1",
        payload: payload(cart),
        cart,
        status: "draft",
        reason: "x",
        userId: "u1",
      })
    ).rejects.toThrow(/không còn quyền/i)
    expect(inserted).toHaveLength(0)
    expect(calls).not.toContain("insert:sales_order_lines")
    expect(calls).not.toContain("update:sales_orders")
  })

  /** ⚠ Sửa đầu đơn cũng 0 dòng mà không lỗi — phải đếm dòng trả về. */
  it("sửa đầu đơn 0 dòng thì báo lỗi, không im lặng", async () => {
    const { client } = fakeClient({ headerRows: 0 })
    await expect(
      applyOrderEdit(client, {
        orderId: "o1",
        payload: payload(cart),
        cart,
        status: "draft",
        reason: "x",
        userId: "u1",
      })
    ).rejects.toThrow(/tổng đơn/i)
  })

  it("trả đơn về chờ duyệt thì xoá luôn dấu vết đã duyệt", () => {
    // Để đơn mang tên người duyệt cũ trên một bộ số liệu họ chưa từng thấy
    // là ghi sai vào sổ ai đã chịu trách nhiệm.
    expect(EDIT).toContain("{ approved_by: null, approved_at: null }")
  })
})

describe("Màn giỏ khi đang sửa đơn", () => {
  /**
   * ⚠ GIỮ NGUYÊN MÃ ĐƠN. Sinh mã mới là tạo thêm một đơn thứ hai cho cùng
   * số hàng — khách có hai đơn, kho xuất hai lần.
   */
  it("dùng lại mã đơn cũ, không sinh mã mới", () => {
    expect(CART_PAGE).toContain("orderCode: editing?.orderCode || generateOrderCode()")
  })

  it("đang sửa thì ghi đè đơn cũ, không đi đường tạo đơn mới", () => {
    const i = CART_PAGE.indexOf("if (editing) {")
    expect(i, "không tìm thấy nhánh sửa đơn").toBeGreaterThanOrEqual(0)
    const body = CART_PAGE.slice(i, CART_PAGE.indexOf("\n      }", i))
    expect(body).toContain("await applyOrderEdit(supabase, {")
    expect(body).toContain("orderId: editing.orderId")
    // ⚠ Phải RETURN. Thiếu nó thì chạy tiếp xuống `submitSellOrder` và
    // đơn vừa sửa xong lại đẻ thêm một đơn mới y hệt.
    expect(body).toContain("return")
  })

  /**
   * ⚠ Sửa đơn KHÔNG xếp được vào hàng đợi ngoại tuyến. Hàng đợi chỉ biết
   * TẠO đơn mới; gói một bản sửa vào đó là lát nữa có mạng sẽ ra đơn thứ
   * hai cho cùng số hàng.
   */
  it("mất mạng thì chặn hẳn, không xếp hàng", () => {
    expect(CART_PAGE).toContain("if (editing && !online) {")
  })

  /** Nói TRƯỚC khi bấm rằng đơn đã duyệt có thể quay lại chờ duyệt. */
  it("có lời nhắc theo trạng thái đơn", () => {
    expect(CART_PAGE).toContain("{editHint(editing.status)}")
    expect(CART_PAGE).toContain("{editing && (")
  })

  /**
   * ⚠ ĐƠN ĐÃ DUYỆT KHÔNG CÓ "LƯU TẠM". Lưu mà không chạy lại quy tắc là
   * đúng cái lỗ hổng gửi đơn nhỏ cho duyệt rồi sửa lên gấp mười.
   */
  it("đơn đã duyệt không còn nút Lưu tạm", () => {
    expect(CART_PAGE).toContain('editing?.status === "confirmed" ? (')
    const i = CART_PAGE.indexOf('editing?.status === "confirmed" ? (')
    const branch = CART_PAGE.slice(i, CART_PAGE.indexOf(") : (", i))
    expect(branch).toContain("Bỏ sửa")
    expect(branch).not.toContain("submit(true)")
  })

  it("nhãn nút chính nói đúng việc sắp làm", () => {
    expect(CART_PAGE).toContain('? "Lưu thay đổi"')
    expect(CART_PAGE).toContain('? "Gửi duyệt"')
  })
})

describe("Giỏ nhớ mình đang sửa đơn nào", () => {
  /**
   * ⚠ `clear()` PHẢI trả `editing` về rỗng. Còn sót mã đơn thì đơn TIẾP
   * THEO người ta soạn sẽ ghi đè lên đơn vừa sửa xong.
   */
  it("xoá giỏ là xoá luôn mã đơn đang sửa", () => {
    expect(CART_HOOK).toMatch(/const EMPTY: SellCartState = \{[\s\S]*?editing: null,[\s\S]*?\}/)
    expect(CART_HOOK).toContain("const clear = useCallback(() => setState(EMPTY), [])")
  })

  /** Bản lưu cũ không có khoá này; một `editing` méo mó là ghi đè nhầm đơn. */
  it("đọc lại từ bộ nhớ máy có kiểm", () => {
    expect(CART_HOOK).toContain("editing: validEditing(saved.editing),")
    expect(CART_HOOK).toContain('if (e.status !== "draft" && e.status !== "confirmed") return null')
  })

  /**
   * ⚠ Vào thẳng màn bán hàng từ trang chủ mà giỏ còn mang mã một đơn cũ thì
   * mọi thứ thêm vào sẽ GHI ĐÈ lên đơn đó. Phải nói ra và cho lối thoát.
   */
  it("màn bán hàng nói rõ đang sửa đơn nào và cho thoát", () => {
    expect(POS).toContain("{cart.editing && (")
    expect(POS).toContain("Đang sửa đơn {cart.editing.orderCode}")
    expect(POS).toContain("cart.clear()")
  })
})

describe("Màn nạp đơn để sửa", () => {
  /** ⚠ Giỏ đang có hàng chưa gửi thì KHÔNG được lặng lẽ thay. */
  it("hỏi trước khi thay giỏ đang có hàng", () => {
    expect(LOADER).toMatch(/const clash =\s*\n?\s*cart\.ready &&\s*\n?\s*cart\.cart\.length > 0/)
    expect(LOADER).toContain("cart.editing?.orderId !== id")
    expect(LOADER).toContain("Thay giỏ, mở đơn này")
    expect(LOADER).toContain("Giữ giỏ đang có")
  })

  it("không nạp khi còn đang hỏi hoặc chưa đọc xong danh mục", () => {
    expect(LOADER).toContain(
      "if (!head || !lines || dataLoading || !cart.ready || blocked || clash) return"
    )
  })

  /** ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi — nói cả hai khả năng. */
  it("không thấy đơn thì nói rõ, không để màn trống", () => {
    expect(LOADER).toContain("if (!headRes.data) {")
    expect(LOADER).toContain("không tồn tại hoặc bạn không có quyền xem")
  })

  it("đơn đã ra kho thì chặn và chỉ đường sang màn chi tiết", () => {
    expect(LOADER).toContain("!isSellEditable(head.status)")
    expect(LOADER).toContain("canEditOrder(editCtx)")
    expect(LOADER).toContain("Xem chi tiết đơn")
  })

  /**
   * ⚠ Hàng trả của đơn cũ nằm ở phiếu trả riêng. Kéo vào giỏ rồi lưu lại là
   * tạo thêm một phiếu trả thứ hai cho cùng số hàng.
   */
  it("không kéo hàng trả của đơn cũ vào giỏ", () => {
    expect(LOADER).toContain("returnLines: [],")
  })

  /** Chỉ nạp MỘT lần — effect chạy lượt nữa mà nạp lại là mất phần đã sửa. */
  it("chỉ nạp một lần", () => {
    expect(LOADER).toContain("if (!head || !lines || openedRef.current) return")
    expect(LOADER).toContain("openedRef.current = true")
  })
})
