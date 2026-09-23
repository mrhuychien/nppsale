import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { dongHangDoi, giaTheoHeSo } from "../src/lib/pos/invoice-exchange"
import { invoiceTotals } from "../src/lib/orders/post-invoice"

/**
 * ⚠ CHỦ NHÀ BÁO 23/09/2026: "khi thay đổi hàng đổi, phần hàng đổi tự thêm trên
 *   hoá đơn ko thay đổi cùng (sửa số lượng, sửa quy cách, xoá dòng…)".
 */
describe("dongHangDoi — dòng hóa đơn hàng đổi dựng từ khối hàng đổi trả", () => {
  const hs = (_p: string, u: string) => (u === "thùng" ? 24 : 1)
  it("số lượng, quy cách, hệ số đi theo khối hàng đổi trả; giá 0", () => {
    const d = dongHangDoi([{ productId: "p1", unit: "thùng", qty: 3 }], hs)
    expect(d).toEqual([{
      orderLineId: null, productId: "p1", unitName: "thùng", conversionFactor: 24, quantity: 3,
      unitPrice: 0, lineDiscount: 0, vatRate: 0, isExchange: true, note: "[Exchange]",
    }])
  })
  it("xoá dòng (số 0) là không còn dòng hàng đổi", () => {
    expect(dongHangDoi([{ productId: "p1", unit: "gói", qty: 0 }], hs)).toEqual([])
  })
  it("hàng đổi không cộng vào tiền hóa đơn", () => {
    expect(invoiceTotals(dongHangDoi([{ productId: "p1", unit: "thùng", qty: 3 }], hs)).total).toBe(0)
  })
})

describe("giaTheoHeSo — cùng phép mig 181", () => {
  it.each([[20000, 1, 24, 480000], [480000, 24, 1, 20000], [10000, 6, 4, 6666.67], [5000, 0, 24, 5000]])(
    "%d × %d→%d = %d", (gia, cu, moi, mong) => expect(giaTheoHeSo(gia, cu, moi)).toBe(mong)
  )
})

describe("màn hóa đơn POS dùng MỘT nguồn cho hàng đổi", () => {
  const S = readFileSync(resolve(__dirname, "../src/components/pos/invoice-screen.tsx"), "utf-8")
  it("bảng bán bỏ dòng hàng đổi; tải trọng gộp dòng dựng từ khối hàng đổi trả", () => {
    expect(S).toMatch(/setRows\(tatCa\.filter\(\(r\) => !r\.isExchange\)\)/)
    expect(S).toMatch(/const draft = useMemo\(\(\) => \[\.\.\.toDraft\(rows\), \.\.\.hangDoiXuat\]/)
  })
  it("sửa quy cách dòng trả đi xuống máy chủ", () => {
    expect(S).toMatch(/unitName: traDv\[l\.id\]/)
  })
})
