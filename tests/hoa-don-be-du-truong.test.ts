import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dongGuiLen, invoiceTotals, suaTraGuiLen, type InvoiceDraftLine } from "../src/lib/orders/post-invoice"
import { giamCuaChungTu, giamGiaDonConLai } from "../src/lib/pos/invoice-discount"
import { toOrderLine } from "../src/lib/sell/create-order"
import { orderLinesToCart, returnLinesToCart } from "../src/lib/sell/order-edit"
import { dongTraGhiSo } from "../src/lib/pos/save"
import type { PosLine } from "../src/lib/pos/types"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Khi Xuất hàng từ Đơn hàng / Sửa hóa đơn -> Mất ghi
 *   chú cho từng dòng · Bê nguyên các trường từ Đơn hàng sang Hóa đơn, ko được
 *   để sót · Tương tự với phần Trả hàng". Xem đầu tệp mig 183.
 */
const dongHD = (p: Partial<InvoiceDraftLine>): InvoiceDraftLine => ({
  orderLineId: "sol1", productId: "p1", unitName: "hộp", conversionFactor: 1,
  quantity: 2, unitPrice: 100_000, lineDiscount: 0, vatRate: 0.08, isExchange: false, note: "giao chiều", ...p,
})

describe("dòng hóa đơn lên RPC mang ĐỦ trường", () => {
  it("mọi khoá của InvoiceDraftLine đều đi lên — kể cả vat_rate và note", () => {
    const l = dongHD({})
    const gui = dongGuiLen(l)
    expect(gui).toEqual({
      order_line_id: "sol1", product_id: "p1", unit_name: "hộp", conversion_factor: 1,
      quantity: 2, unit_price: 100_000, line_discount: 0, vat_rate: 0.08, is_exchange: false, note: "giao chiều",
    })
    /* Thêm một trường vào InvoiceDraftLine mà quên ở đây là chốt này đỏ. */
    expect(Object.keys(gui)).toHaveLength(Object.keys(l).length)
  })

  it("xuất lần đầu và lập lại đi qua CÙNG hàm, cùng gửi giảm giá đơn", () => {
    const S = readFileSync("src/lib/orders/post-invoice.ts", "utf8")
    expect(S.match(/lines: lines\.map\(dongGuiLen\)/g) ?? []).toHaveLength(2)
    expect(S.match(/\.\.\.giamGiaDonPayload\(payload\.discount\)/g) ?? []).toHaveLength(2)
  })
})

describe("giảm giá cả đơn", () => {
  it("tổng hóa đơn trừ giảm vào subtotal, thuế vẫn trên giá dòng — như máy chủ", () => {
    const t = invoiceTotals([dongHD({})], 30_000)
    expect(t).toEqual({ goods: 200_000, discount: 30_000, subtotal: 170_000, vat: 16_000, total: 186_000 })
  })
  it("giảm lớn hơn tiền hàng thì kẹp; giảm âm bỏ", () => {
    expect(invoiceTotals([dongHD({ vatRate: 0 })], 999_999_999).total).toBe(0)
    expect(invoiceTotals([dongHD({ vatRate: 0 })], -5).discount).toBe(0)
  })
  it("khoản giảm của một chứng từ = Σ(SL × giá) − subtotal; sai số làm tròn không tính", () => {
    expect(giamCuaChungTu([{ quantity: 2, unitPrice: 100_000 }], 170_000)).toBe(30_000)
    expect(giamCuaChungTu([{ quantity: 3, unitPrice: 333.4 }], 1000)).toBe(0)
    expect(giamCuaChungTu([{ quantity: 2, unitPrice: 100_000 }], null)).toBe(200_000)
  })
  it("phần còn lại = giảm của đơn − phần các hóa đơn khác đã dùng, không âm", () => {
    const dongDon = [{ quantity: 10, unitPrice: 10_000 }]
    expect(giamGiaDonConLai({ dongDon, subtotalDon: 90_000, hoaDonKhac: [] })).toBe(10_000)
    expect(giamGiaDonConLai({
      dongDon, subtotalDon: 90_000,
      hoaDonKhac: [{ dong: [{ quantity: 5, unitPrice: 10_000 }], subtotal: 46_000 }],
    })).toBe(6_000)
    expect(giamGiaDonConLai({
      dongDon, subtotalDon: 90_000,
      hoaDonKhac: [{ dong: [{ quantity: 5, unitPrice: 10_000 }], subtotal: 30_000 }],
    })).toBe(0)
  })
})

describe("thuế theo dòng của đơn được lưu và đọc lại", () => {
  const dongGio = { productId: "p1", unit: "hộp", qty: 2, price: 100_000, listPrice: 100_000, note: "", conversion: 1, vatRate: 0.08 }
  it("dòng đơn gửi lên mang vat_rate đã chọn", () => {
    expect(toOrderLine(dongGio as never).vat_rate).toBe(0.08)
  })
  it("mở lại đơn: thuế dòng đã lưu đi trước thuế danh mục; đơn cũ (NULL) rơi về danh mục", () => {
    const sp = [{ id: "p1", name: "Sữa", base_unit: "hộp", sell_price: 100_000, vat_rate: 0.1, units: [] }] as never
    const row = { product_id: "p1", unit_name: "hộp", quantity: 2, unit_price: 100_000 }
    expect(orderLinesToCart([{ ...row, vat_rate: 0.05 }], sp, null)[0].vatRate).toBe(0.05)
    expect(orderLinesToCart([{ ...row, vat_rate: 0 }], sp, null)[0].vatRate).toBe(0)
    expect(orderLinesToCart([{ ...row, vat_rate: null }], sp, null)[0].vatRate).toBe(0.1)
  })
})

describe("phiếu trả: lý do / ghi chú từng dòng không rơi", () => {
  it("mở lại đơn mang lý do dòng trả về giỏ — lưu là xoá rồi chèn lại dòng", () => {
    const c = returnLinesToCart({
      id: "r", reason: "damaged", notes: null, status: "draft", invoice_id: null,
      lines: [{ product_id: "p1", unit_name: "hộp", quantity: 1, unit_price: 5000, note: "móp", reason: "expired" }],
    })
    expect(c[0]).toMatchObject({ note: "móp", reason: "expired" })
  })
  it("POS trả hàng ghi lý do dòng; dòng đổi không mang lý do trả", () => {
    const l = (p: Partial<PosLine>): PosLine => ({
      key: "k", productId: "p1", sku: "", name: "Sữa", unit: "hộp", units: [], qty: 1, price: 5000,
      discount: { value: 0, unit: "vnd" }, ...p,
    })
    expect(dongTraGhiSo("r", l({ reason: "expired" })).reason).toBe("expired")
    expect("reason" in dongTraGhiSo("r", l({ reason: "expired", isExchange: true }))).toBe(false)
  })
  it("sửa dòng trả ở hóa đơn: ghi chú / lý do chỉ đi lên khi có — vắng là giữ", () => {
    expect(suaTraGuiLen({ lineId: "l", quantity: 1 })).toEqual({ line_id: "l", quantity: 1 })
    expect(suaTraGuiLen({ lineId: "l", quantity: 1, note: "", reason: "damaged" })).toEqual({ line_id: "l", quantity: 1, note: "", reason: "damaged" })
  })
})

describe("màn hóa đơn đủ ô như màn đơn (chủ nhà 24/09/2026)", () => {
  it("giảm giá dòng quy về đơn giá, cộng vào line_discount; dòng không giảm giữ nguyên", async () => {
    const { toDraftCoGiam, seedForNew } = await import("../src/lib/orders/invoice-editor")
    const rows = seedForNew([
      { orderLineId: "a", returnLineId: null, productId: "p1", productName: "A", sku: null, unitName: "hộp", conversionFactor: 1,
        orderedQty: 2, invoicedQty: 0, remainingQty: 2, unitPrice: 100_000, listPrice: 100_000, lineDiscount: 0, vatRate: 0,
        availableBase: 10, isExchange: false, note: null },
      { orderLineId: "b", returnLineId: null, productId: "p2", productName: "B", sku: null, unitName: "hộp", conversionFactor: 1,
        orderedQty: 1, invoicedQty: 0, remainingQty: 1, unitPrice: 50_000, listPrice: 50_000, lineDiscount: 0, vatRate: 0,
        availableBase: 10, isExchange: false, note: null },
    ])
    const d = toDraftCoGiam(rows, { a: { value: 10_000, unit: "vnd" }, b: { value: 10, unit: "pct" } })
    expect(d[0]).toMatchObject({ unitPrice: 95_000, lineDiscount: 10_000 })
    expect(d[1]).toMatchObject({ unitPrice: 45_000, lineDiscount: 5_000 })
    expect(toDraftCoGiam(rows, {})[0]).toMatchObject({ unitPrice: 100_000, lineDiscount: 0 })
  })

  it("cột dòng hóa đơn theo cùng bộ cột / thiết lập với màn đơn", () => {
    const HD = readFileSync("src/components/pos/invoice-screen.tsx", "utf8")
    /* Chủ nhà 24/09/2026: giảm giá dòng vào "chi tiết dòng", thùng rác đầu dòng,
       đơn vị cạnh số lượng; "Bỏ VAT từng dòng cả ở POS" — thuế chỉ còn cả hóa đơn. */
    for (const nhan of ['label: "Đơn vị"', 'label: "Đơn giá"', 'label: "Thành tiền"', "<TrashButton", "<UnitCycleButton", "<LineDetailToggle", "<LineDetailPanel", "<DiscountCell", "<DocDiscountRow", "vatChungKeTiep"]) {
      expect(HD, `màn hóa đơn thiếu ${nhan}`).toContain(nhan)
    }
    expect(HD).not.toContain("Thuế GTGT dòng")
    expect(HD).not.toContain("<LineMenu")
  })
})
