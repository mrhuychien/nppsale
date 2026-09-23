import { describe, it, expect } from "vitest"
import { posNewInvoiceHref, posNewReturnHref } from "../src/lib/nav/pos-preview"
import { parsePosPath } from "../src/lib/pos/tabs"
import { coQuyenGan } from "../src/components/pos/doc-people"

/** Chủ nhà 23/09/2026: "Màn xuất hàng → POS", "Tạo phiếu trả hàng → chưa chuyển sang pos". */
describe("đường dẫn POS cho xuất hàng / phiếu trả", () => {
  it("xuất hàng mở tab HÓA ĐƠN mới, mang theo đơn", () => {
    const h = posNewInvoiceHref("o 1")
    expect(h).toBe("/pos/hoa-don/moi?order=o%201")
    expect(parsePosPath(h)).toEqual({ docType: "INV", docId: null })
  })
  it("phiếu trả mang hóa đơn gốc và khách nếu có", () => {
    expect(posNewReturnHref()).toBe("/pos/tra-hang/moi")
    expect(posNewReturnHref({ invoiceId: "i1", customerId: "c1" })).toBe("/pos/tra-hang/moi?invoice=i1&customerId=c1")
    expect(posNewReturnHref({ customerId: "c1" })).toBe("/pos/tra-hang/moi?customerId=c1")
  })
})

/** "Người được gán (chỉ NPP có quyền gán)" — cùng luật máy chủ (mig 153 / 178). */
describe("ai được gán người phụ trách", () => {
  it.each([["owner", true], ["manager", true], ["sales", false], ["accountant", false], ["warehouse", false], [null, false]])(
    "%s → %s", (role, dung) => expect(coQuyenGan(role as string | null)).toBe(dung)
  )
})
