import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { ghiTraTienNcc } from "../src/lib/payables/record-payment"
import { ghiPhieuNhapKho, type PhieuNhapKho } from "../src/lib/inventory/post-import"

/**
 * MIG 167 + 168 — TIỀN NCC VÀ NHẬP KHO GHI TRONG MỘT GIAO DỊCH.
 *
 * ⚠ ĐÃ ĐO TRÊN POSTGRES 16 (22/09/2026):
 *
 *   Trả tiền NCC, hai tab cùng mở lúc paid = 0, trả 3tr rồi 2tr:
 *     trước 167:  payables.paid = 2tr, sum(payable_payments) = 5tr → "còn nợ 3tr"
 *     sau 167:    tab 2 CHỜ khoá, paid = 5tr, status = paid
 *
 *   Thủ kho nhập kho có NCC (240.000):
 *     trước 168:  payables INSERT → 42501, bị nuốt, màn báo "Tồn kho đã được cập nhật"
 *     sau 168:    công nợ 240.000 open, lô 48 (2 thùng × 24), cùng một giao dịch
 *   Dòng 2 hỏng: trước — phiếu posted nằm lại; sau — không ghi gì (0 phiếu).
 */

function gia(tra: { data: unknown; error: unknown }) {
  const goi: Array<{ fn: string; args: Record<string, unknown> }> = []
  return {
    goi,
    rpc: (fn: string, args: Record<string, unknown>) => {
      goi.push({ fn, args })
      return Promise.resolve(tra)
    },
  }
}

describe("ghi trả tiền NCC", () => {
  it("gọi đúng RPC, không tự tính số đã trả", async () => {
    const sb = gia({ data: [{ payment_id: "p1", new_paid: "5000000", new_status: "paid" }], error: null })
    const r = await ghiTraTienNcc(sb, { payableId: "x", amount: 2000000, method: "cash", notes: "  " })
    expect(sb.goi).toEqual([
      { fn: "record_payable_payment", args: { p_payable_id: "x", p_amount: 2000000, p_method: "cash", p_notes: null } },
    ])
    expect(r).toEqual({ paymentId: "p1", newPaid: 5000000, newStatus: "paid" })
  })

  it("lỗi máy chủ thì ném, không nuốt", async () => {
    const sb = gia({ data: null, error: { message: "OVERPAY: số tiền vượt quá công nợ còn lại (còn 0)." } })
    await expect(ghiTraTienNcc(sb, { payableId: "x", amount: 1, method: "cash" })).rejects.toMatchObject({
      message: expect.stringContaining("OVERPAY"),
    })
  })

  it("máy chủ im lặng thì cũng ném", async () => {
    const sb = gia({ data: [], error: null })
    await expect(ghiTraTienNcc(sb, { payableId: "x", amount: 1, method: "cash" })).rejects.toThrow()
  })
})

describe("ghi phiếu nhập kho", () => {
  const PHIEU: PhieuNhapKho = {
    entry_code: "IN-1",
    posted_at: "2026-09-22T00:00:00Z",
    supplier_id: "s1",
    payable: { amount: 240000 },
    lines: [
      { product_id: "p1", unit_name: "thùng", qty_tx: 2, conv: 24, base_qty: 48, base_cost: 5000 },
      { product_id: "p2", unit_name: "hộp", qty_tx: 1, conv: 1, base_qty: 1, base_cost: 10 },
    ],
  }

  it("gửi CẢ phiếu một lần", async () => {
    const sb = gia({ data: [{ entry_id: "e1", entry_code: "IN-1", payable_id: "py1", lines_written: 2 }], error: null })
    const r = await ghiPhieuNhapKho(sb, PHIEU)
    expect(sb.goi).toHaveLength(1)
    expect(sb.goi[0]).toEqual({ fn: "post_stock_import", args: { p: PHIEU } })
    expect(r).toEqual({ entryId: "e1", entryCode: "IN-1", payableId: "py1" })
  })

  it("máy chủ ghi thiếu dòng thì ném — đúng lỗi đang vá", async () => {
    const sb = gia({ data: [{ entry_id: "e1", entry_code: "IN-1", payable_id: null, lines_written: 1 }], error: null })
    await expect(ghiPhieuNhapKho(sb, PHIEU)).rejects.toThrow(/1\/2 dòng/)
  })

  it("lỗi máy chủ (vd. FORBIDDEN) thì ném", async () => {
    const sb = gia({ data: null, error: { message: "FORBIDDEN: chỉ chủ NPP hoặc thủ kho được lập phiếu nhập kho." } })
    await expect(ghiPhieuNhapKho(sb, PHIEU)).rejects.toMatchObject({ message: expect.stringContaining("FORBIDDEN") })
  })
})

/**
 * ⚠ KHÔNG CÒN ĐƯỜNG GHI THẲNG. Ba màn này từng ghi tiền / kho bằng
 *   nhiều lệnh rời; quay lại lối ấy là quay lại đúng các lỗi đã đo.
 */
describe("ba màn không còn ghi thẳng bảng tiền / kho", () => {
  const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
  const CAM = /\.from\("(payables|payable_payments|batches|stock_entries|stock_entry_lines)"\)\s*\.(insert|upsert)\(/
  it.each([
    "src/app/(dashboard)/payables/[id]/page.tsx",
    "src/app/(dashboard)/inventory/stock-in/page.tsx",
    "src/components/products/product-import-dialog.tsx",
  ])("%s", (p) => {
    expect(doc(p)).not.toMatch(CAM)
  })
})

describe("nút ghi hoá đơn khớp RLS", () => {
  it("VAI_GHI_HOA_DON = vai của \"Owner/Accountant can manage invoices\"", async () => {
    const { VAI_GHI_HOA_DON } = await import("../src/lib/invoices/roles")
    const { readdirSync } = await import("node:fs")
    const dir = resolve(__dirname, "..", "supabase/migrations")
    const neo = 'CREATE POLICY "Owner/Accountant can manage invoices"'
    const co = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
      .map((f) => readFileSync(resolve(dir, f), "utf-8")).filter((s) => s.includes(neo))
    const s = co[co.length - 1]
    const p = s.slice(s.indexOf(neo), s.indexOf(";", s.indexOf(neo)))
    const vai = Array.from(p.match(/user_role\(\)\s+IN\s*\(([^)]*)\)/)![1].matchAll(/'([a-z]+)'/g), (m) => m[1]).sort()
    expect([...VAI_GHI_HOA_DON].sort()).toEqual(vai)
  })
})
