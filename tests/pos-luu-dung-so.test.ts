import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cartTotals } from "../src/lib/sell/cart"
import { posTotals } from "../src/lib/pos/totals"
import { posLinesToCart } from "../src/lib/pos/save"
import type { PosLine } from "../src/lib/pos/types"

/**
 * MÀN `/pos` PHẢI GHI XUỐNG SỔ ĐÚNG THỨ NÓ VỪA HIỆN LÊN.
 *
 * Chủ nhà báo 22/09/2026 hai lỗi, và chúng là hai mặt của cùng một
 * thói quen: màn hình tính một đằng, tải trọng gửi đi một nẻo.
 *
 * ⚠ LỖI 1 — "ấn Gửi đơn thì ra phiếu nháp, đúng ra phải ra phiếu tạm".
 *   `savePosOrder` nhận `status` rồi vứt đi, chỉ truyền `payload` xuống
 *   `createOrderRecords` — mà hàm ấy đọc trạng thái từ
 *   `payload.targetStatus`. Không ai đặt cột ấy, nên MỌI đơn mới lập ở
 *   `/pos` rơi vào `draft`. Màn `/sell` không dính vì nó đi qua
 *   `submitSellOrder`, và hàm ấy có đặt.
 *
 * ⚠ LỖI 2 — "tạo đơn kèm hàng đổi/trả thì xem đơn chi tiết tiền không
 *   trừ phần hàng trả". Panel tính bằng `posTotals` (có trừ hàng trả),
 *   tải trọng dựng bằng `cartTotals(cart)` trần — mà `cart` chỉ có dòng
 *   BÁN. Sổ ghi `total` chưa trừ, còn màn chi tiết đơn suy khoản trừ ra
 *   từ `subtotal + vat − total`: hiệu bằng 0 nên không vẽ dòng nào.
 *
 * ⚠ VÀ MỘT LỖI THỨ BA LỘ RA Ở ĐÚNG DÒNG MÃ ẤY, chủ nhà chưa báo: ô
 *   "Giảm giá đơn" cũng không vào sổ, vì `cartTotals` không có khái
 *   niệm giảm giá cấp chứng từ. Gõ vào, thấy tổng tụt, lưu xong sổ
 *   không ghi đồng nào.
 */

const ROOT = resolve(__dirname, "..")
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf-8")
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const SAVE = code(read("src/lib/pos/save.ts"))
const DON = code(read("src/components/pos/order-screen.tsx"))

describe("Gửi đơn phải ra PHIẾU TẠM, không ra nháp", () => {
  /**
   * ⚠ NEO VÀO LỜI GỌI `createOrderRecords`, chỗ trạng thái thật sự đi
   *   xuống. Neo vào chữ "submitted" ở đâu đó trong tệp là chốt xanh
   *   nhờ một hằng số chẳng liên quan.
   */
  it("savePosOrder truyền trạng thái vào tải trọng", () => {
    const i = SAVE.indexOf("createOrderRecords(")
    expect(i, "màn /pos không còn ghi đơn qua createOrderRecords").toBeGreaterThan(-1)
    const goi = SAVE.slice(i, SAVE.indexOf("\n  )", i))
    expect(goi, "trạng thái vẫn bị vứt đi — Gửi đơn lại ra nháp")
      .toMatch(/targetStatus:\s*o\.status/)
  })

  /**
   * ⚠ LÝ DO DUYỆT CHỈ GỬI KHI ĐÃ GỬI ĐƠN. Đơn nháp để
   *   `createOrderRecords` tự điền `DRAFT_APPROVAL_REASON`; đè bằng một
   *   chuỗi rỗng là mất nhãn "nháp" trên danh sách đơn.
   */
  it("chỉ gửi lý do duyệt cho đơn đã gửi, không gửi cho nháp", () => {
    const i = SAVE.indexOf("createOrderRecords(")
    const goi = SAVE.slice(i, SAVE.indexOf("\n  )", i))
    expect(goi, "lý do duyệt gửi cả cho đơn nháp").toMatch(
      /o\.status === "submitted"\s*\?\s*\{\s*approvalReason/
    )
  })

  /**
   * ⚠ VÀ PHẢI LÀ CHUỖI RỖNG, KHÔNG PHẢI `null`. `createOrderRecords`
   *   dùng `??`, nên `null` vẫn rơi xuống câu "Tạo offline — NPP kiểm
   *   tồn/công nợ trước khi xuất hàng": một câu SAI về đơn lập khi đang
   *   có mạng, và nó hiện thành huy hiệu cảnh báo ở danh sách đơn.
   */
  it("đơn sạch gửi chuỗi RỖNG, không gửi null", () => {
    expect(DON, "màn đơn không gửi lý do duyệt").toContain("approvalReason: lyDoCanh,")
    /* Lý do dựng một lần (`lyDoCanh`) — dùng cho cả đơn mới và sửa đơn. */
    const i = DON.indexOf("const lyDoCanh =")
    expect(i, "màn đơn không còn dựng lý do duyệt").toBeGreaterThan(-1)
    const khoi = DON.slice(i, i + 200)
    expect(khoi, "đơn sạch gửi null — sẽ bị gán nhãn 'Tạo offline'")
      .not.toMatch(/:\s*null/)
    expect(khoi, "không còn nhánh đơn sạch").toContain('""')
  })
})

describe("tiền ghi xuống sổ = tiền màn hình vừa hiện", () => {
  it("tải trọng dựng từ tổng CÓ hàng trả và CÓ giảm giá đơn", () => {
    const i = DON.indexOf("const tongGoc = cartTotals(")
    expect(i, "màn đơn không còn dựng tổng cho tải trọng").toBeGreaterThan(-1)
    const khoi = DON.slice(i, DON.indexOf("}", DON.indexOf("grandTotal:", i)))
    /* Hàng trả phải đi vào phép cộng, không chỉ hiện trên panel. */
    expect(khoi, "tổng gửi đi không biết gì về hàng trả")
      .toMatch(/cartTotals\(cart,\s*totals\.returnCredit\)/)
    /**
     * ⚠ ĐÒI PHÉP TRỪ, KHÔNG ĐÒI CÁI TÊN. Bản đầu của chốt này chỉ hỏi
     *   chuỗi `totals.docDiscount` có xuất hiện không — mà nó còn xuất
     *   hiện ở dòng `discount:` chỉ để GHI NHỚ. Bỏ hẳn phép trừ đi mà
     *   chốt vẫn xanh, và giảm giá đơn lại bốc hơi như cũ. Đã thử phá
     *   đúng kiểu đó một lần.
     */
    expect(khoi, "giảm giá đơn vẫn là lời hứa suông — không thấy phép trừ")
      .toMatch(/-\s*totals\.docDiscount/)

    /* Và tải trọng phải dùng ĐÚNG tổng ấy, không dùng lại bản trần. */
    const j = DON.indexOf("totals:", i)
    expect(DON.slice(j, j + 40), "tải trọng vẫn gửi tổng trần").toContain("tienDon")
    expect(DON, "vẫn còn đường gửi cartTotals trần vào tải trọng")
      .not.toMatch(/totals:\s*cartTotals\(cart\)/)
  })

  /**
   * ⚠ ĐÂY LÀ CHỐT CHẠY THẬT, không soi chữ: dựng đúng cảnh chủ nhà gặp
   *   rồi hỏi hai phép cộng xem chúng có ra cùng một số không.
   *
   *   Màn chi tiết đơn SUY khoản trừ hàng trả ra từ
   *   `subtotal + vat − total`. Nếu tải trọng không trừ hàng trả thì
   *   hiệu ấy bằng 0 và dòng "Trừ hàng trả" không bao giờ hiện.
   */
  it("đơn 328.000 kèm hàng trả 250.000: sổ phải suy lại đúng 250.000", () => {
    const lines = [
      dong("p1", 1, 210_000),
      dong("p2", 1, 53_000),
      dong("p3", 1, 55_000),
      dong("p4", 1, 10_000),
    ]
    const cart = posLinesToCart(lines)
    const panel = posTotals({ lines, docDiscount: { value: 0, unit: "vnd" }, other: 0, returnCredit: 250_000 })
    expect(panel.due, "dựng sai cảnh — panel không ra 78.000").toBe(78_000)

    /* Cách CŨ: tải trọng không biết hàng trả. */
    const cu = cartTotals(cart)
    expect(cu.subtotal + cu.vat - cu.grandTotal, "cảnh cũ lẽ ra phải hụt 0").toBe(0)

    /* Cách MỚI: đúng con số panel đã hiện. */
    const moi = cartTotals(cart, panel.returnCredit)
    expect(moi.grandTotal, "tổng gửi đi không khớp panel").toBe(panel.due)
    expect(
      moi.subtotal + moi.vat - moi.grandTotal,
      "màn chi tiết đơn vẫn suy ra 0 — không có dòng Trừ hàng trả"
    ).toBe(250_000)
  })

  /** ⚠ Giảm giá đơn cũng phải suy lại được, không bốc hơi. */
  it("giảm giá đơn 30.000 phải hạ đúng tổng", () => {
    const lines = [dong("p1", 2, 100_000)]
    const cart = posLinesToCart(lines)
    const panel = posTotals({
      lines,
      docDiscount: { value: 30_000, unit: "vnd" },
      other: 0,
      returnCredit: 0,
    })
    expect(panel.due, "dựng sai cảnh").toBe(170_000)

    const goc = cartTotals(cart, 0)
    const subtotal = Math.max(0, goc.subtotal - panel.docDiscount)
    const tong = Math.max(0, subtotal + goc.vat - goc.returnCredit)
    expect(tong, "giảm giá đơn không vào sổ").toBe(panel.due)
    expect(goc.grandTotal, "cảnh cũ lẽ ra ghi nguyên 200.000").toBe(200_000)
  })

  /** ⚠ Hàng trả lớn hơn đơn thì kẹp về 0, không ghi số âm vào sổ. */
  it("hàng trả lớn hơn đơn thì tổng kẹp về 0", () => {
    const cart = posLinesToCart([dong("p1", 1, 50_000)])
    expect(cartTotals(cart, 900_000).grandTotal).toBe(0)
  })
})

/** Một dòng POS tối thiểu, đủ cho phép cộng tiền. */
function dong(productId: string, qty: number, price: number): PosLine {
  return {
    key: productId,
    productId,
    name: productId,
    sku: productId,
    unit: "cái",
    units: [{ unit_name: "cái", conversion: 1 }],
    qty,
    price,
    listPrice: price,
    discount: { value: 0, unit: "vnd" },
    vatRate: 0,
  } as PosLine
}
