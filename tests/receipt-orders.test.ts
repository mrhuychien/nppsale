import { describe, it, expect } from "vitest"
import {
  outstandingOf, searchOrderDebts, amountFor, pickedTotal, rowsOverPaid, customerOf,
  type OrderDebtRow,
} from "../src/lib/finance/receipt-orders"

/**
 * PHIẾU THU TỪ NHIỀU ĐƠN (chủ nhà yêu cầu).
 *
 * ⚠ PHIẾU THU KHÔNG THU THEO ĐƠN, NÓ THU THEO CÔNG NỢ. Từ v2b mỗi hóa
 * đơn sinh một dòng `receivables` giữ cả `order_id` lẫn `invoice_id`.
 * "Chọn đơn" thực chất là chọn DÒNG CÔNG NỢ của đơn ấy — một đơn xuất
 * hai đợt có HAI dòng nợ, và người thu tiền phải thấy cả hai.
 */
const row = (o: Partial<OrderDebtRow> = {}): OrderDebtRow => ({
  receivableId: "r1",
  orderId: "o1",
  orderCode: "DH-0042",
  invoiceCode: "HD-0042",
  customerId: "c1",
  customerName: "Tạp hoá Bà Năm",
  salesUserName: "Trần Minh",
  orderDate: "2026-09-17",
  dueDate: null,
  amount: 1000,
  paid: 0,
  ...o,
})

describe("còn phải thu", () => {
  it("cộng trừ bình thường", () => {
    expect(outstandingOf(row({ amount: 1000, paid: 300 }))).toBe(700)
  })

  /**
   * ⚠ KẸP VỀ 0. Dòng trả dư có `paid > amount`; để số âm chạy tiếp là
   * tổng phiếu thu bị trừ đi một khoản không ai chọn.
   */
  it("trả dư thì ra 0, không ra số âm", () => {
    expect(outstandingOf(row({ amount: 1000, paid: 1500 }))).toBe(0)
  })
})

describe("ô tìm đơn", () => {
  const rows = [
    row(),
    row({ receivableId: "r2", orderCode: "DH-0043", invoiceCode: "HD-0043", customerId: "c2", customerName: "Cửa hàng Minh Anh", salesUserName: "Lê Hoa" }),
    row({ receivableId: "r3", orderCode: "DH-0044", invoiceCode: "HD-0044", amount: 500, paid: 500 }),
  ]

  /** ⚠ Bỏ dấu trước khi so — kế toán gõ "tap hoa" để tìm "Tạp hoá". */
  it("tìm được khi gõ không dấu", () => {
    expect(searchOrderDebts(rows, "tap hoa").map((r) => r.receivableId)).toEqual(["r1"])
  })

  it("tìm được theo mã đơn, mã hóa đơn, tên người bán", () => {
    expect(searchOrderDebts(rows, "DH-0043").map((r) => r.receivableId)).toEqual(["r2"])
    expect(searchOrderDebts(rows, "hd-0042").map((r) => r.receivableId)).toEqual(["r1"])
    expect(searchOrderDebts(rows, "le hoa").map((r) => r.receivableId)).toEqual(["r2"])
  })

  /** ⚠ Nợ đã trả đủ mà vẫn gợi ý là kế toán chọn vào rồi thu thêm lần nữa. */
  it("bỏ dòng không còn phải thu", () => {
    expect(searchOrderDebts(rows, "").map((r) => r.receivableId)).not.toContain("r3")
  })

  /**
   * ⚠ MỘT PHIẾU THU CHỈ CỦA MỘT KHÁCH. RPC nhận đúng một `customer_id`;
   * hiện đơn của khách khác là mời người dùng đi vào một phiếu sẽ bị từ
   * chối — sau khi họ đã gõ xong cả phiếu.
   */
  it("đã chọn đơn thì khoá theo khách đó", () => {
    expect(
      searchOrderDebts(rows, "", { lockedCustomerId: "c1" }).map((r) => r.receivableId)
    ).toEqual(["r1"])
  })

  /** ⚠ Chọn lại lần hai thành hai dòng cùng một khoản nợ, tổng cộng đôi. */
  it("bỏ dòng đã chọn khỏi gợi ý", () => {
    expect(searchOrderDebts(rows, "", { alreadyPicked: new Set(["r1"]) }).map((r) => r.receivableId))
      .toEqual(["r2"])
  })

  it("cắt bớt khi quá nhiều kết quả", () => {
    const many = Array.from({ length: 50 }, (_, i) => row({ receivableId: `x${i}` }))
    expect(searchOrderDebts(many, "")).toHaveLength(20)
  })
})

describe("số tiền và tổng", () => {
  /** ⚠ Việc thường ngày là thu đủ; bắt gõ tay từng dòng là cực hình. */
  it("chưa gõ thì lấy số còn phải thu", () => {
    expect(amountFor(row({ amount: 1000, paid: 200 }), {})).toBe(800)
  })

  it("gõ rồi thì lấy số đã gõ, kể cả số 0", () => {
    expect(amountFor(row(), { r1: 500 })).toBe(500)
    expect(amountFor(row(), { r1: 0 })).toBe(0)
  })

  /**
   * ⚠ CHỖ DỄ SAI NHẤT. Kế toán sửa một dòng xuống 500k để thu một phần;
   * cộng theo số còn phải thu thì tổng vẫn hiện số nợ đầy đủ, và người
   * thu tiền đòi khách nhiều hơn số vừa gõ.
   */
  it("tổng cộng theo SỐ ĐÃ SỬA, không theo số còn phải thu", () => {
    const picked = [row(), row({ receivableId: "r2", amount: 2000 })]
    expect(pickedTotal(picked, {})).toBe(3000)
    expect(pickedTotal(picked, { r1: 500 })).toBe(2500)
    expect(pickedTotal(picked, { r1: 500, r2: 100 })).toBe(600)
  })

  /**
   * ⚠ CẢNH BÁO, KHÔNG CHẶN. Khách trả dư là chuyện có thật và RPC ghi
   * được; chặn ở giao diện là đặt ra luật thứ hai mâu thuẫn với CSDL.
   */
  it("gõ quá số nợ thì nêu ra, không chặn", () => {
    const picked = [row({ amount: 1000 })]
    expect(rowsOverPaid(picked, { r1: 1200 })).toHaveLength(1)
    expect(rowsOverPaid(picked, { r1: 1000 })).toHaveLength(0)
  })
})

describe("khách của phiếu", () => {
  it("suy từ đơn đã chọn", () => {
    expect(customerOf([row(), row({ receivableId: "r2" })])).toBe("c1")
  })

  it("chưa chọn gì thì chưa có khách", () => {
    expect(customerOf([])).toBeNull()
  })

  /**
   * ⚠ TRẢ `null` KHI HAI KHÁCH KHÁC NHAU. Trả bừa khách của dòng đầu là
   * lặng lẽ gửi lên RPC một phiếu gom nợ của hai người.
   */
  it("hai khách khác nhau thì không suy ra được", () => {
    expect(customerOf([row(), row({ receivableId: "r2", customerId: "c2" })])).toBeNull()
  })
})
