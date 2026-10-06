/**
 * Chủ nhà 06/10/2026: "vá luôn vat đi". Màn POS nhập hàng / trả NCC trước đây không nạp lại thuế của phiếu đã lưu —
 * sửa phiếu có VAT là lưu lại thuế 0, công nợ NCC hụt đúng tiền thuế. Bấm thật: e2e/pos-vat-nap-lai.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { purchaseTotals, supplierReturnTotals, tienVatPos, vatNapLai } from "@/lib/pos/purchase"

describe("vatNapLai — tiền thuế đã lưu → mức % của POS", () => {
  it("khớp một mức (lệch ≤ 1đ làm tròn) → chọn mức đó", () => {
    expect(vatNapLai(30000, 300000)).toEqual({ rate: 10, coDinh: null })
    expect(vatNapLai(24000, 300000)).toEqual({ rate: 8, coDinh: null })
    expect(vatNapLai(15001, 300000)).toEqual({ rate: 5, coDinh: null })
  })
  it("không khớp mức nào (số gõ tay theo HĐ NCC) → GIỮ NGUYÊN số tiền", () => {
    expect(vatNapLai(12345, 300000)).toEqual({ rate: 0, coDinh: 12345 })
  })
  it("không thuế / rỗng → 0%", () => {
    expect(vatNapLai(0, 300000)).toEqual({ rate: 0, coDinh: null })
    expect(vatNapLai(null, 300000)).toEqual({ rate: 0, coDinh: null })
  })
  it("tiền thuế: số giữ theo phiếu thắng mức %", () => {
    expect(tienVatPos(300000, 10, null)).toBe(30000)
    expect(tienVatPos(300000, 10, 12345)).toBe(12345)
  })
})

describe("tổng tiền có thuế", () => {
  const L = [{ qty: 2, price: 150000, discount: { value: 0, unit: "vnd" as const } }]
  it("phiếu nhập: cần trả NCC = sau giảm + thuế giữ theo phiếu", () => {
    expect(purchaseTotals({ lines: L, vatRate: 0, vatCoDinh: 12345 })).toMatchObject({ vat: 12345, dueToSupplier: 312345 })
  })
  it("phiếu trả NCC: NCC cần hoàn = tiền hàng + thuế − chi phí trả hàng (như complete_supplier_return)", () => {
    expect(supplierReturnTotals({ lines: L, fee: { value: 10000, unit: "vnd" }, vatRate: 10 })).toMatchObject({
      vat: 30000, dueFromSupplier: 320000,
    })
  })
})

describe("nối dây", () => {
  const doc = (p: string) => readFileSync(p, "utf8")
  it("hai màn POS nạp vat / vat_override và chọn lại mức (vatNapLai)", () => {
    for (const f of ["src/components/pos/purchase-screen.tsx", "src/components/pos/supplier-return-screen.tsx"]) {
      const s = doc(f)
      expect(s, f).toMatch(/discount, vat, vat_override, notes, status/)
      expect(s, f).toMatch(/vatNapLai\(r\.vat_override \?\? r\.vat, nen\)/)
    }
  })
  it("phiếu trả NCC gửi thuế qua vat_override (không còn vat: 0 cứng)", () => {
    expect(doc("src/components/pos/supplier-return-screen.tsx")).not.toMatch(/vat: 0,/)
    const save = doc("src/lib/pos/save.ts")
    const tra = save.slice(save.indexOf("export async function savePosSupplierReturn"))
    expect(tra).toMatch(/vat_override: o\.vat > 0 \? o\.vat : null/)
  })
})
