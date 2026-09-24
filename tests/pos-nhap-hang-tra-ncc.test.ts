import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { posTargetFor } from "../src/lib/nav/pos-preview"

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
const read = (p: string) => code(readFileSync(p, "utf8"))

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Bấm tạo phiếu nhập hàng/trả hàng ncc từ danh sách ko ra
 *   pos ? … tạo phiếu nhập hàng / trả hàng ncc trên desktop trên pos hết".
 */
describe("cửa POS cho nhập hàng / trả NCC", () => {
  it("lập và sửa đều có đích POS", () => {
    expect(posTargetFor("/purchasing/receipts/new")).toBe("/pos/nhap-hang/moi")
    expect(posTargetFor("/purchasing/receipts/abc/edit")).toBe("/pos/nhap-hang/abc/sua")
    expect(posTargetFor("/purchase-returns/new")).toBe("/pos/tra-ncc/moi")
    expect(posTargetFor("/purchase-returns/r1/edit")).toBe("/pos/tra-ncc/r1/sua")
    // Danh sách / xem chi tiết không phải lối vào POS.
    expect(posTargetFor("/purchasing/receipts")).toBeNull()
    expect(posTargetFor("/purchase-returns/r1")).toBeNull()
  })

  it.each([
    ["purchasing/receipts/new", "usePosDesktopRedirect(posNewPurchaseHref())"],
    ["purchasing/receipts/[id]/edit", "usePosDesktopRedirect(posEditPurchaseHref(id))"],
    ["purchase-returns/new", "usePosDesktopRedirect(posNewSupplierReturnHref())"],
    ["purchase-returns/[id]/edit", "usePosDesktopRedirect(posEditSupplierReturnHref(id))"],
  ])("/%s chuyển sang POS trước mọi return sớm", (duong, goi) => {
    const S = read(`src/app/(dashboard)/${duong}/page.tsx`)
    const i = S.indexOf(goi)
    expect(i, "chưa chuyển sang POS").toBeGreaterThan(0)
    const than = S.slice(S.indexOf("export default function"))
    expect(than.indexOf(goi)).toBeLessThan(than.indexOf("return ("))
    expect(than.indexOf(goi)).toBeLessThan(than.search(/\n\s+if \([^)]*\) return\b|\n\s+return </) === -1 ? Infinity : than.search(/\n\s+if \([^)]*\) return\b|\n\s+return </))
  })

  it("các nút 'Tạo phiếu nhập' ở phần Mua hàng không còn dẫn màn nhập kho cũ", () => {
    for (const f of ["purchasing/page.tsx", "purchasing/invoices/page.tsx", "suppliers/[id]/page.tsx"]) {
      const S = read(`src/app/(dashboard)/${f}`)
      expect(S, f).not.toContain("/inventory/stock-in")
      expect(S, f).toContain("/purchasing/receipts/new")
    }
    expect(read("src/app/(dashboard)/suppliers/[id]/page.tsx")).toContain('diHoacMoPos(router.push, "/purchasing/receipts/new")')
  })
})
