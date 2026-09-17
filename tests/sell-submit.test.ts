import { describe, it, expect } from "vitest"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { decideStatus } from "../src/lib/sell/submit"
import { buildOrderPayload } from "../src/lib/sell/create-order"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"
import { DRAFT_APPROVAL_REASON } from "../src/lib/orders/save-gate"
import { DEFAULT_APPROVAL_RULES } from "../src/lib/approval"
import type { ApprovalRules } from "../src/types"

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const SUBMIT = code(read("src/lib/sell/submit.ts"))
const CART_PAGE = code(read("src/app/(dashboard)/sell/cart/page.tsx"))
const POS_PAGE = code(read("src/app/(dashboard)/sell/page.tsx"))

const rules = { ...DEFAULT_APPROVAL_RULES } as unknown as ApprovalRules

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 1,
  price: 1_000_000,
  listPrice: 1_000_000,
  note: "",
  conversion: 1,
  vatRate: 0,
  ...over,
})

const input = (cart: CartLine[], over: Record<string, unknown> = {}) => ({
  payload: buildOrderPayload({
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
  }),
  asDraft: false,
  cart,
  customer: { id: "c1", credit_limit: 0 },
  rules,
  customerDebt: 0,
  customerOverdue: 0,
  repPortfolioDebt: 0,
  role: "sales" as const,
  online: true,
  ...over,
})

describe("Quyết trạng thái đơn khi gửi", () => {
  it("đơn nhỏ trong ngưỡng thì tự duyệt", () => {
    const r = decideStatus(input([line({ qty: 1, price: 1_000_000, listPrice: 1_000_000 })]))
    expect(r.status).toBe("confirmed")
    expect(r.reason).toBe("")
  })

  it("đơn vượt ngưỡng tự duyệt thì nằm ở nháp kèm lý do", () => {
    const r = decideStatus(input([line({ qty: 100, price: 1_000_000, listPrice: 1_000_000 })]))
    expect(r.status).toBe("draft")
    expect(r.reason.length).toBeGreaterThan(0)
  })

  /**
   * ⚠ Chưa gửi đi thì chưa có gì để duyệt. Chạy quy tắc lúc này chỉ tạo ra
   * một kết quả sẽ cũ mất trước khi ai kịp đọc, vì người dùng còn sửa tiếp.
   */
  it("Lưu tạm KHÔNG chạy quy tắc duyệt", () => {
    const small = [line({ qty: 1, price: 1_000, listPrice: 1_000 })]
    // Cùng bộ dữ liệu này khi gửi thật thì tự duyệt được.
    expect(decideStatus(input(small)).status).toBe("confirmed")
    const r = decideStatus(input(small, { asDraft: true }))
    expect(r.status).toBe("draft")
    expect(r.reason).toBe(DRAFT_APPROVAL_REASON)
  })

  /**
   * ⚠ LỖ HỔNG PHẢI BỊT. Mọi ngưỡng đều xét tổng SAU chiết khấu. Sửa giá
   * xuống 0 làm đơn trăm triệu tụt xuống dưới ngưỡng và TỰ ĐỘNG DUYỆT —
   * cho không hàng mà không ai được hỏi. Quy tắc chiết khấu sâu chỉ bắt
   * được khi có `grossBeforeDiscount`.
   */
  it("cho không hàng bằng cách sửa giá về 0 thì KHÔNG tự duyệt", () => {
    const freebie = [line({ qty: 100, price: 0, listPrice: 1_000_000 })]
    expect(cartTotals(freebie).grandTotal).toBe(0)
    const r = decideStatus(input(freebie))
    expect(r.status).toBe("draft")
    expect(r.reason.length).toBeGreaterThan(0)
  })

  it("chiết khấu sâu vẫn bị chặn dù tổng nhỏ", () => {
    const deep = [line({ qty: 10, price: 100_000, listPrice: 1_000_000 })]
    expect(decideStatus(input(deep)).status).toBe("draft")
  })
})

describe("Một đường ghi duy nhất, có mạng hay không", () => {
  /**
   * ⚠ Không mạng thì gói đơn vào hàng đợi, và chính `createOrderRecords`
   * đẩy nó lên sau. Nhờ vậy đường ngoại tuyến không còn là nhánh ít ai
   * chạy tới — nó là chính đường kia, chỉ hoãn lại.
   */
  it("mất mạng thì xếp hàng, không ghi thẳng", () => {
    expect(SUBMIT).toContain("if (!i.online) {")
    expect(SUBMIT).toContain("await enqueueOrder(i.payload)")
  })

  it("có mạng thì đi qua createOrderRecords, không tự viết insert", () => {
    expect(SUBMIT).toContain("await createOrderRecords(supabase, i.payload, ctx)")
    expect(SUBMIT).not.toContain('.insert(')
  })

  /**
   * ⚠ RLS từ chối thì 0 dòng, HTTP 200, không lỗi. Đơn đã tạo nhưng đứng
   * sai trạng thái mà màn hình báo thành công là kiểu hỏng khó tìm nhất.
   */
  it("đặt trạng thái xong phải đếm số dòng trả về", () => {
    expect(SUBMIT).toContain('.select("id")')
    expect(SUBMIT).toMatch(/if \(!rows \|\| rows\.length === 0\)/)
  })
})

describe("Màn giỏ hàng", () => {
  /**
   * ⚠ Khoá nối phải sinh TRƯỚC khi gửi và BẤT BIẾN. Mạng chập chờn thì cú
   * gửi lặp lại; khoá đó là thứ giữ cho lần thứ hai không thành đơn thứ hai.
   */
  it("sinh khoá nối trước khi gửi", () => {
    expect(CART_PAGE).toContain("clientRequestId:")
    expect(CART_PAGE).toContain("crypto.randomUUID")
  })

  /** Bấm hai lần liên tiếp là hai đơn nếu không khoá nút. */
  it("khoá nút trong lúc đang gửi", () => {
    expect(CART_PAGE).toContain("if (submitting ||")
    expect(CART_PAGE).toContain("disabled={submitting ||")
  })

  /** Chặn đúng thứ phải chặn, và nói rõ chặn vì gì. */
  it("chặn vượt tồn và giá ngoài hạn mức", () => {
    expect(CART_PAGE).toContain("hasOver")
    expect(CART_PAGE).toContain("hasPriceBad")
    expect(CART_PAGE).toContain('"Vượt tồn kho"')
    expect(CART_PAGE).toContain('"Giá ngoài hạn mức"')
  })

  /**
   * ⚠ Lưu tạm KHÔNG chặn theo tồn kho — bản tạm không ra kho hôm nay mà
   * tồn đổi từng giờ. Vẫn chặn theo giá vì thẩm quyền không đổi theo
   * thời gian.
   */
  it("nút Lưu tạm không khoá theo tồn kho, vẫn khoá theo giá", () => {
    const m = /disabled=\{submitting \|\| !cart\.customerId \|\| hasPriceBad\}/.exec(CART_PAGE)
    expect(m, "không tìm thấy nút Lưu tạm").toBeTruthy()
  })

  /**
   * ⚠ Đổi khách là đổi bảng giá. Dòng đã có trong giỏ giữ giá cũ — lặng lẽ
   * tính giá của khách trước là báo sai tiền cho khách sau.
   */
  it("nói ra khi dòng đang giữ giá của bảng giá cũ", () => {
    expect(CART_PAGE).toContain("staleList")
    expect(CART_PAGE).toContain("bảng giá cũ")
    // ⚠ Soi ĐÚNG điều kiện vẽ, không chỉ "có nhắc tới ở đâu đó". Thử phá
    // cho thấy đổi điều kiện thành `false` mà hai chốt trên vẫn XANH, vì
    // cả hai chuỗi còn nguyên trong khối không bao giờ chạy.
    expect(CART_PAGE).toContain("{staleCount > 0 && (")
    expect(CART_PAGE).toMatch(/const staleCount = rows\.filter\(\(r\) => r\.staleList\)\.length/)
  })
})

describe("Không nối vào ngõ cụt", () => {
  /**
   * ⚠ Màn quét mã và đơn tạm chưa có. Nút trỏ tới trang 404 còn tệ hơn là
   * chưa có nút — người dùng tưởng tính năng hỏng chứ không tưởng là chưa
   * làm xong.
   */
  it.each([
    ["màn bán hàng", POS_PAGE],
    ["màn giỏ hàng", CART_PAGE],
  ])("%s không trỏ tới màn chưa tồn tại", (_label, src) => {
    // Chỉ lấy ĐƯỜNG DẪN thật (mở đầu bằng dấu nháy), không lấy đường
    // import như "@/components/sell/product-card".
    const links = Array.from(new Set(src.match(/["'`]\/sell\/[a-z-]+/g) ?? []))
    for (const href of links) {
      const dir = href.slice(1).replace("/sell/", "")
      expect(
        existsSync(resolve(ROOT, `src/app/(dashboard)/sell/${dir}/page.tsx`)),
        `${href} chưa có màn`
      ).toBe(true)
    }
  })
})

describe("Đọc hỏng ngữ cảnh duyệt thì KHÔNG được tự duyệt", () => {
  /**
   * ⚠ Công nợ đọc hỏng trả về 0, mà 0 nghĩa là "khách không nợ gì" — đúng
   * cái làm mọi ngưỡng đều lọt. Một lần đọc hỏng không được biến thành một
   * đơn tự duyệt.
   */
  it("cờ hỏng thì đơn rơi về chờ duyệt tay, kèm lý do", () => {
    const small = [line({ qty: 1, price: 1_000, listPrice: 1_000 })]
    expect(decideStatus(input(small)).status).toBe("confirmed")
    const r = decideStatus(input(small, { contextFailed: true }))
    expect(r.status).toBe("draft")
    expect(r.reason).toContain("Không đọc được")
  })

  it("màn giỏ hàng có gắn cờ khi truy vấn hỏng", () => {
    expect(CART_PAGE).toContain(
      "contextFailed = !!(rulesRes.error || recRes.error || repRes.error)"
    )
    expect(CART_PAGE).toContain("contextFailed,")
  })
})
