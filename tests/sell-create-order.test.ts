import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildOrderPayload,
  grossBeforeDiscountOf,
  lineDiscountOf,
  toOrderLine,
} from "../src/lib/sell/create-order"
import { cartTotals, type CartLine } from "../src/lib/sell/cart"

const ROOT = resolve(__dirname, "..")
const CARD = readFileSync(resolve(ROOT, "src/components/sell/product-card.tsx"), "utf-8")
const CARD_CODE = CARD.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const line = (over: Partial<CartLine> = {}): CartLine => ({
  productId: "p1",
  unit: "thùng",
  qty: 2,
  price: 600000,
  listPrice: 675000,
  note: "",
  conversion: 15,
  vatRate: 0.08,
  ...over,
})

const base = {
  clientRequestId: "req-1",
  orderCode: "DH-260917-001",
  customerId: "c1",
  customerName: "Tạp hoá Bà Năm",
  paymentTerms: "NET15",
  expectedDelivery: "2026-09-20",
  notes: "  giao trước 10h  ",
  createdAt: "2026-09-17T06:00:00.000Z",
  returnReason: "damaged",
  returnLines: [],
}

describe("Dựng gói đơn từ giỏ", () => {
  it("mỗi dòng giỏ thành đúng một dòng đơn", () => {
    const cart = [line(), line({ productId: "p2", unit: "gói", conversion: 1 })]
    const p = buildOrderPayload({ ...base, cart, totals: cartTotals(cart) })
    expect(p.lines).toHaveLength(2)
    expect(p.lines[0].product_id).toBe("p1")
    expect(p.lines[0].unit_name).toBe("thùng")
  })

  /**
   * ⚠ Chốt hệ số quy đổi NGAY LÚC TẠO. Đơn nằm trong hàng đợi vài giờ rồi
   * mới đẩy lên; tra lại lúc đó mà ai vừa sửa quy cách đóng gói thì số
   * lượng xuất kho lệch, không ai biết vì sao.
   */
  it("chốt hệ số quy đổi vào từng dòng", () => {
    const l = toOrderLine(line({ conversion: 15 }))
    expect(l.conversion_factor).toBe(15)
    // Không có hệ số thì là 1, không phải 0 — 0 làm số lượng cơ sở về 0.
    expect(toOrderLine(line({ conversion: 0 })).conversion_factor).toBe(1)
  })

  it("thành tiền dòng theo giá ĐANG áp dụng", () => {
    expect(toOrderLine(line({ qty: 2, price: 600000 })).line_total).toBe(1200000)
  })

  /**
   * ⚠ Chiết khấu dòng chỉ nhận phần GIẢM. Nhân viên được nâng giá trong
   * hạn mức, và một dòng "chiết khấu âm" ghi xuống sổ kế toán thì không ai
   * đối chiếu nổi.
   */
  it("chiết khấu dòng không bao giờ âm", () => {
    expect(lineDiscountOf(line({ qty: 2, price: 600000, listPrice: 675000 }))).toBe(150000)
    expect(lineDiscountOf(line({ qty: 2, price: 700000, listPrice: 675000 }))).toBe(0)
  })

  it("ghi chú rỗng thì không gửi cột note", () => {
    expect(toOrderLine(line({ note: "   " })).note).toBeUndefined()
    expect(toOrderLine(line({ note: " date mới " })).note).toBe("date mới")
  })

  it("tổng đơn lấy từ phép cộng của giỏ, không tính lại", () => {
    const cart = [line()]
    const t = cartTotals(cart)
    const p = buildOrderPayload({ ...base, cart, totals: t })
    expect(p.order.subtotal).toBe(t.subtotal)
    expect(p.order.vat).toBe(t.vat)
    expect(p.order.total).toBe(t.grandTotal)
  })

  it("ghi chú đơn cắt khoảng trắng, rỗng thì là null", () => {
    const cart = [line()]
    expect(buildOrderPayload({ ...base, cart, totals: cartTotals(cart) }).order.notes).toBe(
      "giao trước 10h"
    )
    expect(
      buildOrderPayload({ ...base, notes: "   ", cart, totals: cartTotals(cart) }).order.notes
    ).toBeNull()
  })

  it("ngày giao để trống thì là null, không phải chuỗi rỗng", () => {
    const cart = [line()]
    const p = buildOrderPayload({ ...base, expectedDelivery: "", cart, totals: cartTotals(cart) })
    expect(p.order.expected_delivery).toBeNull()
  })

  /**
   * ⚠ Khoá nối phải sinh TRƯỚC và BẤT BIẾN. `createOrderRecords` dựa vào
   * nó để gửi lại không tạo đơn trùng — mà gửi lại là chuyện thường của
   * một đơn xếp hàng chờ mạng.
   */
  it("giữ nguyên khoá nối được truyền vào", () => {
    const cart = [line()]
    const p = buildOrderPayload({ ...base, cart, totals: cartTotals(cart) })
    expect(p.clientRequestId).toBe("req-1")
  })

  /** Thông tin hiển thị trong hàng chờ — không có thì đơn chờ là một dòng trống. */
  it("kèm đủ thông tin để hiện trong hàng chờ đồng bộ", () => {
    const cart = [line(), line({ productId: "p2" })]
    const p = buildOrderPayload({ ...base, cart, totals: cartTotals(cart) })
    expect(p.meta).toMatchObject({
      customerName: "Tạp hoá Bà Năm",
      lineCount: 2,
      createdAt: base.createdAt,
    })
    expect(p.meta.total).toBe(cartTotals(cart).grandTotal)
  })
})

describe("Giá trị trước chiết khấu — để quy tắc duyệt không bị qua mặt", () => {
  /**
   * ⚠ Mọi ngưỡng duyệt đều xét tổng SAU chiết khấu. Chiết khấu 100% làm
   * đơn tụt xuống dưới ngưỡng và TỰ ĐỘNG DUYỆT — cho không hàng mà không
   * ai được hỏi. Con số này là thứ chặn ca đó.
   */
  it("tính trên giá BẢNG, không phải giá đã sửa", () => {
    const cart = [line({ qty: 2, price: 0, listPrice: 675000 })]
    expect(grossBeforeDiscountOf(cart)).toBe(1350000)
    expect(cartTotals(cart).subtotal).toBe(0)
  })

  it("cộng mọi dòng", () => {
    const cart = [
      line({ qty: 1, listPrice: 100000 }),
      line({ productId: "p2", qty: 3, listPrice: 50000 }),
    ]
    expect(grossBeforeDiscountOf(cart)).toBe(250000)
  })
})

describe("Thẻ sản phẩm gọn lại khi chưa có ảnh", () => {
  /**
   * ⚠ Danh mục hiện gần như chưa mặt hàng nào có ảnh. Để ô xám 56px ghi
   * "ảnh SP" cho tất cả thì cả màn hình thành một cột ô giống hệt nhau:
   * ăn 68px bề ngang mỗi thẻ, đẩy tên hàng dài xuống thêm một dòng, mà
   * không nói được điều gì.
   */
  it("không còn ô giữ chỗ 'ảnh SP'", () => {
    expect(CARD_CODE).not.toContain("ảnh SP")
  })

  it("chỉ chia hai cột khi THẬT SỰ có ảnh", () => {
    expect(CARD_CODE).toMatch(
      /image \? "grid grid-cols-\[56px_minmax\(0,1fr\)\] gap-3" : "block"/
    )
    expect(CARD_CODE).toContain("{image && (")
  })

  /** Có ảnh thì vẫn vẽ ảnh — gọn lại không có nghĩa là bỏ ảnh. */
  it("vẫn vẽ ảnh khi có", () => {
    expect(CARD_CODE).toContain("src={image}")
    expect(CARD_CODE).toContain("loading=\"lazy\"")
  })
})
