import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { gopSoanHang, tachDonVi, chuDonVi, docIds, soanHangHref, type PickLine } from "../src/lib/orders/pick-list"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Phần Soạn hàng làm riêng 1 trang bên Kho vận > Soạn hàng >
 *   mở ra chọn danh sách Hoá đơn chứ ko phải đơn hàng. -> tổng hợp lại thành đơn
 *   tổng. Bỏ cái hiện tại trong đơn hàng đi."
 */
const dong = (p: Partial<PickLine>): PickLine => ({
  productId: "sua", productName: "Sữa hộp", sku: "SUA1", unitName: "hộp", conversionFactor: 1, qty: 0, isExchange: false, ...p,
})
const SP = {
  sua: { base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] },
  mi: { base_unit: "gói", units: [{ unit_name: "thùng", conversion: 30 }, { unit_name: "lốc", conversion: 5 }] },
}
const hd = (id: string, lines: PickLine[]) => ({ doc: { id, code: id.toUpperCase(), customerName: `KH ${id}` }, lines })

describe("gộp hóa đơn thành đơn tổng", () => {
  it("cộng qua nhiều hóa đơn QUY VỀ ĐƠN VỊ CƠ SỞ (3 thùng + 5 hộp ≠ 8)", () => {
    const rows = gopSoanHang([
      hd("hd1", [dong({ unitName: "thùng", conversionFactor: 24, qty: 3 })]),
      hd("hd2", [dong({ unitName: "hộp", qty: 5 })]),
    ], SP)
    expect(rows).toHaveLength(1)
    expect(rows[0].totalBase).toBe(77)
    expect(rows[0].baseUnit).toBe("hộp")
    expect(chuDonVi(rows[0].pick)).toBe("3 thùng 5 hộp")
    expect(rows[0].docCount).toBe(2)
    expect(rows[0].details.map((d) => `${d.docCode}:${d.qty} ${d.unitName}`)).toEqual(["HD1:3 thùng", "HD2:5 hộp"])
  })
  it("hàng ĐỔI trên hóa đơn cũng rời kho — tính vào và đánh dấu", () => {
    const rows = gopSoanHang([hd("hd1", [dong({ qty: 2, isExchange: true })])], SP)
    expect(rows[0].totalBase).toBe(2)
    expect(rows[0].hasExchange).toBe(true)
  })
  it("một hóa đơn nhiều dòng cùng mặt hàng chỉ đếm 1 hóa đơn; dòng SL 0 bỏ qua", () => {
    const rows = gopSoanHang([hd("hd1", [dong({ qty: 30 }), dong({ unitName: "thùng", conversionFactor: 24, qty: 1 }), dong({ productId: "mi", qty: 0 })])], SP)
    expect(rows.map((r) => `${r.productId}:${r.totalBase}:${r.docCount}`)).toEqual(["sua:54:1"])
  })
  it("không biết đơn vị cơ sở thì KHÔNG lấy nhầm đơn vị dòng đầu", () => {
    const rows = gopSoanHang([hd("hd1", [dong({ productId: "x", unitName: "thùng", conversionFactor: 24, qty: 2 })])])
    expect(rows[0].totalBase).toBe(48)
    expect(rows[0].baseUnit).not.toBe("thùng")
    const co = gopSoanHang([hd("hd1", [dong({ productId: "x", unitName: "thùng", conversionFactor: 24, qty: 2 }), dong({ productId: "x", unitName: "hộp", qty: 1 })])])
    expect(co[0].baseUnit).toBe("hộp")
  })
  it("tách đơn vị lớn → nhỏ", () => {
    expect(chuDonVi(tachDonVi(137, SP.mi, "gói"))).toBe("4 thùng 3 lốc 2 gói")
    expect(chuDonVi(tachDonVi(60, SP.mi, "gói"))).toBe("2 thùng")
    expect(chuDonVi(tachDonVi(0.5, SP.sua, "hộp"))).toBe("0,5 hộp")
  })
  it("đường dẫn ?ids= ở Kho vận", () => {
    expect(docIds("a, b,,a")).toEqual(["a", "b"])
    expect(soanHangHref(["a", "b"])).toBe("/inventory/soan-hang?ids=a,b")
    expect(soanHangHref([])).toBe("/inventory/soan-hang")
  })
})

describe("màn Kho vận › Soạn hàng", () => {
  const S = readFileSync("src/app/(dashboard)/inventory/soan-hang/page.tsx", "utf8")
  it("chọn HÓA ĐƠN (mặc định đã xuất), đọc dòng hóa đơn — không phải đơn hàng", () => {
    expect(S).toContain('.from("sales_invoice_lines")')
    expect(S).toContain('qd.eq("status", "posted")')
    expect(S).not.toContain("loadInvoiceableLines")
  })
  it("CHỈ ĐỌC: không ghi bảng nào, không gọi RPC", () => {
    expect(S).not.toMatch(/\.from\("[a-z_]+"\)\s*\.(insert|update|delete|upsert)\(/)
    expect(S).not.toMatch(/\.rpc\(/)
  })
  it("có ở menu Kho vận; phần cũ trong Đơn hàng đã bỏ", () => {
    expect(readFileSync("src/components/layout/sidebar.tsx", "utf8")).toContain('{ label: "Soạn hàng", href: "/inventory/soan-hang"')
    expect(readFileSync("src/lib/nav/nav-permission.ts", "utf8")).toContain('"/inventory/soan-hang": { module: "inventory", feature: "inventory" }')
    const L = readFileSync("src/app/(dashboard)/orders/page.tsx", "utf8")
    expect(L).not.toContain("soanHangHref")
    expect(L).not.toContain("Soạn hàng")
  })
})
