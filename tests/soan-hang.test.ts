import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { gopSoanHang, tachDonVi, chuDonVi, docIds, soanHangHref } from "../src/lib/orders/pick-list"
import type { InvoiceableLine } from "../src/lib/orders/post-invoice"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Phát triển tính năng soạn đơn hàng, Cho phép gộp nhiều
 *   đơn hàng vào -> lượng hàng tổng cần xuất … máy sẽ tổng hợp và in ra."
 */
const dong = (p: Partial<InvoiceableLine>): InvoiceableLine => ({
  orderLineId: "l", returnLineId: null, productId: "sua", productName: "Sữa hộp", sku: "SUA1",
  unitName: "hộp", conversionFactor: 1, orderedQty: 0, invoicedQty: 0, remainingQty: 0,
  unitPrice: 0, listPrice: 0, lineDiscount: 0, vatRate: 0, availableBase: 1000, isExchange: false, note: null, ...p,
})
const SP = {
  sua: { base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] },
  mi: { base_unit: "gói", units: [{ unit_name: "thùng", conversion: 30 }, { unit_name: "lốc", conversion: 5 }] },
}
const don = (id: string, lines: InvoiceableLine[]) => ({ order: { id, code: id.toUpperCase(), customerName: `KH ${id}` }, lines })

describe("gộp soạn hàng", () => {
  it("cộng qua nhiều đơn QUY VỀ ĐƠN VỊ CƠ SỞ (3 thùng + 5 hộp ≠ 8)", () => {
    const rows = gopSoanHang([
      don("d1", [dong({ unitName: "thùng", conversionFactor: 24, remainingQty: 3 })]),
      don("d2", [dong({ unitName: "hộp", remainingQty: 5 })]),
    ], SP)
    expect(rows).toHaveLength(1)
    expect(rows[0].totalBase).toBe(77)
    expect(rows[0].baseUnit).toBe("hộp")
    expect(rows[0].byUnit).toEqual([{ unitName: "thùng", qty: 3 }, { unitName: "hộp", qty: 5 }])
    expect(chuDonVi(rows[0].pick)).toBe("3 thùng 5 hộp")
    expect(rows[0].orderCount).toBe(2)
    expect(rows[0].details.map((d) => `${d.orderCode}:${d.qty} ${d.unitName}`)).toEqual(["D1:3 thùng", "D2:5 hộp"])
  })
  it("chỉ tính PHẦN CÒN PHẢI XUẤT; dòng đã xuất hết bỏ qua", () => {
    const rows = gopSoanHang([
      don("d1", [dong({ orderedQty: 10, invoicedQty: 4, remainingQty: 6 }), dong({ productId: "mi", productName: "Mì", unitName: "gói", remainingQty: 0 })]),
    ], SP)
    expect(rows.map((r) => `${r.productId}:${r.totalBase}`)).toEqual(["sua:6"])
  })
  it("hàng ĐỔI của phiếu trả cũng phải rời kho — tính vào và đánh dấu", () => {
    const rows = gopSoanHang([don("d1", [dong({ remainingQty: 2, isExchange: true })])], SP)
    expect(rows[0].totalBase).toBe(2)
    expect(rows[0].hasExchange).toBe(true)
    expect(rows[0].details[0].isExchange).toBe(true)
  })
  it("thiếu tồn thì nói ra bao nhiêu; một đơn nhiều dòng cùng mặt hàng chỉ đếm 1 đơn", () => {
    const rows = gopSoanHang([
      don("d1", [dong({ remainingQty: 30, availableBase: 40 }), dong({ unitName: "thùng", conversionFactor: 24, remainingQty: 1, availableBase: 40 })]),
    ], SP)
    expect(rows[0].totalBase).toBe(54)
    expect(rows[0].shortBase).toBe(14)
    expect(rows[0].orderCount).toBe(1)
  })
  it("tách đơn vị lớn → nhỏ; không có đơn vị lớn thì giữ đơn vị cơ sở", () => {
    expect(chuDonVi(tachDonVi(137, SP.mi, "gói"))).toBe("4 thùng 3 lốc 2 gói")
    expect(chuDonVi(tachDonVi(60, SP.mi, "gói"))).toBe("2 thùng")
    expect(chuDonVi(tachDonVi(7, { base_unit: "cái" }, "cái"))).toBe("7 cái")
    expect(chuDonVi(tachDonVi(0.5, SP.sua, "hộp"))).toBe("0,5 hộp")
  })
  it("đường dẫn ?ids=: bỏ trùng / rỗng, dựng lại đúng", () => {
    expect(docIds("a, b,,a")).toEqual(["a", "b"])
    expect(docIds(null)).toEqual([])
    expect(soanHangHref(["a", "b"])).toBe("/orders/soan-hang?ids=a,b")
    expect(soanHangHref([])).toBe("/orders/soan-hang")
  })
})

describe("màn soạn hàng", () => {
  const S = readFileSync("src/app/(dashboard)/orders/soan-hang/page.tsx", "utf8")
  it("CHỈ ĐỌC: không ghi bảng nào, không gọi RPC ghi", () => {
    // Mọi lệnh ghi bảng của supabase-js đi sau `.from("…")` — kể cả xuống dòng.
    expect(S).not.toMatch(/\.from\("[a-z_]+"\)\s*\.(insert|update|delete|upsert)\(/)
    expect(S.match(/\.from\("([a-z_]+)"\)/g)?.sort()).toEqual(
      ['.from("customers")', '.from("products")', '.from("sales_orders")', '.from("sales_orders")']
    )
    expect(S).not.toMatch(/\.rpc\(/)
    expect(S).toContain("loadInvoiceableLines(supabase, d.id)")
  })
  it("tìm theo mã đơn, tên khách, SĐT; mặc định chỉ đơn còn phải xuất", () => {
    expect(S).toContain("store_name.ilike.${like},phone.ilike.${like}")
    expect(S).toContain("order_code.ilike.${like},customer_id.in.(")
    expect(S).toContain('if (!caDonKhac) qd = qd.in("status", [...TRANG_THAI_CAN_XUAT])')
  })
  it("danh sách đơn: nút Soạn hàng ở thanh chọn nhiều và đầu trang", () => {
    const L = readFileSync("src/app/(dashboard)/orders/page.tsx", "utf8")
    expect(L).toContain("onClick={() => router.push(soanHangHref(Array.from(selectedIds)))}")
    expect(L).toContain("onClick={() => router.push(soanHangHref([]))}")
  })
})
