import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ghepChungTu, tongNoNcc, type DongNoNcc } from "@/lib/payables/so-no-ncc"

/**
 * Chủ nhà 05/10/2026: "Vào xem chi tiết nhà cung cấp hiển thị công nợ chưa đúng (công nợ tính theo phiếu nhập)".
 * Sổ nợ NCC = `payables` (mỗi phiếu nhập hoàn thành một dòng; phiếu trả NCC một dòng ÂM; nợ đầu kỳ / lập tay).
 */
const dong = (p: Partial<DongNoNcc> & { id: string; amount: number; paid: number; status: string }): DongNoNcc => ({
  due_date: null, created_at: "2026-09-20T08:00:00Z", invoice_number: null, opening_balance: false, notes: null, ...p,
})

describe("tongNoNcc — còn phải trả NCC", () => {
  it("phiếu nhập 300.000 đã trả 100.000, trả NCC −50.000, khoản đã trả xong bỏ qua → 150.000", () => {
    expect(
      tongNoNcc([
        { amount: 300000, paid: 100000, status: "partial" },
        { amount: -50000, paid: 0, status: "open" },
        { amount: 200000, paid: 200000, status: "paid" },
      ])
    ).toBe(150000)
  })
  it("KHÔNG kẹp dòng âm về 0 — NCC hoàn lại nhiều hơn nợ thì tổng âm (NCC còn nợ lại mình)", () => {
    expect(tongNoNcc([{ amount: 100000, paid: 0, status: "open" }, { amount: -250000, paid: 0, status: "open" }])).toBe(-150000)
  })
})

describe("ghepChungTu — mỗi dòng nợ trỏ về chứng từ sinh ra nó", () => {
  const rows = ghepChungTu(
    [
      dong({ id: "p1", amount: 300000, paid: 0, status: "open", invoice_number: "HD1" }),
      dong({ id: "p2", amount: -50000, paid: 0, status: "open" }),
      dong({ id: "p3", amount: 80000, paid: 0, status: "open", opening_balance: true }),
      dong({ id: "p4", amount: 10000, paid: 0, status: "open", invoice_number: "TAY-1" }),
    ],
    [{ id: "pi1", payable_id: "p1", receipt_code: "PN-1" }],
    [{ id: "sr1", payable_credit_id: "p2", return_code: "TN-1" }]
  )
  it("phiếu nhập → mã PN, mở phiếu nhập", () => {
    expect(rows[0]).toMatchObject({ loai: "phieu-nhap", ma: "PN-1", href: "/purchasing/receipts/pi1", conLai: 300000 })
  })
  it("phiếu trả NCC → mã TN, mở phiếu trả, còn lại âm", () => {
    expect(rows[1]).toMatchObject({ loai: "tra-ncc", ma: "TN-1", href: "/purchase-returns/sr1", conLai: -50000 })
  })
  it("nợ đầu kỳ / lập tay → mở chính khoản nợ", () => {
    expect(rows[2]).toMatchObject({ loai: "dau-ky", href: "/payables/p3" })
    expect(rows[3]).toMatchObject({ loai: "lap-tay", ma: "TAY-1", href: "/payables/p4" })
  })
})

describe("các nơi tính nợ NCC dùng cùng luật", () => {
  const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
  it("loadSupplierDebt (POS nhập / trả NCC) không còn kẹp Math.max(0, …)", () => {
    const s = doc("src/lib/pos/load.ts")
    const fn = s.slice(s.indexOf("export async function loadSupplierDebt"), s.indexOf("LÔ HÀNG"))
    expect(fn).not.toMatch(/Math\.max\(0/)
    expect(fn).toMatch(/tongNoNcc\(/)
  })
  it("màn chi tiết NCC đọc sổ payables, không còn ô công nợ = 0 cứng", () => {
    const s = doc("src/app/(dashboard)/suppliers/[id]/page.tsx")
    expect(s).toMatch(/docSoNoNcc\(supabase, id\)/)
    expect(s).not.toMatch(/setUnpaidCount\(0\)/)
  })
  it("Công nợ theo NCC: bấm NCC mở tab Công nợ của NCC (màn danh sách không đọc ?supplier=)", () => {
    expect(doc("src/app/(dashboard)/payables/by-supplier/page.tsx")).toMatch(/\/suppliers\/\$\{row\.supplierId\}\?tab=debt/)
  })
})
