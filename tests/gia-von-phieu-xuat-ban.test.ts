/**
 * GIÁ VỐN KỲ CHỈ TỪ PHIẾU XUẤT BÁN (`fetchCogsForRange` / `fetchPostedStockEntries(…, "export")`, mig 228).
 *
 * Lỗi đội test Báo cáo 04/10/2026 — cùng luật với `finance_pnl` / `bao_cao_so_ban`:
 *   - phiếu "Đảo phiếu trả …" (cancel_return, unit_cost 0) kéo giá vốn bình quân xuống → lãi gộp cao giả;
 *   - phiếu xuất của HĐ ĐÃ HUỶ (kể cả tờ cũ của HĐ đã sửa) vẫn cộng giá vốn dù HĐ không còn doanh thu.
 * CLAUDE.md: "Lãi gộp = doanh thu thuần − (giá vốn − giá vốn hàng trả đã nhập kho)".
 */
import { describe, it, expect } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchCogsForRange, giaVonBinhQuanCoSo } from "../src/lib/analytics/sales"

type Row = Record<string, unknown>

/** Supabase giả: lọc đúng `eq` / `in` như PostgREST để biết hàm hỏi gì. */
function sbGia(bang: Record<string, Row[]>): SupabaseClient {
  return {
    from: (t: string) => {
      const loc: Array<(r: Row) => boolean> = []
      const b: Record<string, unknown> = {}
      for (const m of ["select", "gte", "lte", "order"]) b[m] = () => b
      b.eq = (c: string, v: unknown) => (loc.push((r) => r[c] === v), b)
      b.in = (c: string, v: unknown[]) => (loc.push((r) => v.includes(r[c])), b)
      b.range = (from: number, to: number) => {
        const rows = (bang[t] || []).filter((r) => loc.every((f) => f(r)))
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null, count: rows.length })
      }
      return b
    },
  } as unknown as SupabaseClient
}

const P = "sp-1"
const phieu = (id: string, notes: string | null) => ({
  id, org_id: "org", type: "export", status: "posted", posted_at: "2026-10-01T03:00:00Z", entry_code: id, supplier_id: null, notes,
})
const dong = (entry_id: string, qty: number, unit_cost: number) => ({
  id: `l-${entry_id}`, entry_id, product_id: P, quantity: qty, qty_in_base_uom: qty, conversion_factor_snapshot: 1, unit_cost,
})

const BANG = {
  stock_entries: [
    phieu("xk-ban", "Xuất theo đơn DH-0001"),
    phieu("xk-dao", "Đảo phiếu trả 9c49aaaa-0000-0000-0000-000000000000"),
    phieu("xk-huy", "Xuất theo đơn DH-0002"),
  ],
  stock_entry_lines: [dong("xk-ban", 10, 9000), dong("xk-dao", 2, 0), dong("xk-huy", 3, 9000)],
  sales_invoices: [
    { id: "hd-1", status: "posted", stock_entry_id: "xk-ban" },
    { id: "hd-2", status: "cancelled", stock_entry_id: "xk-huy" },
  ],
}

describe("giá vốn kỳ chỉ từ phiếu xuất bán", () => {
  it("bỏ phiếu 'Đảo phiếu trả' và phiếu xuất của HĐ đã huỷ: giá vốn = 10 × 9.000", async () => {
    const r = await fetchCogsForRange(sbGia(BANG), "org", { from: "2026-10-01", to: "2026-10-01" })
    expect(r.cogs).toBe(90000)
    expect(r.lines.map((l) => l.entry_id)).toEqual(["xk-ban"])
  })

  it("giá vốn bình quân không bị phiếu đảo giá 0 kéo xuống (một lô 9.000)", async () => {
    const r = await fetchCogsForRange(sbGia(BANG), "org", { from: "2026-10-01", to: "2026-10-01" })
    expect(giaVonBinhQuanCoSo(r.lines).get(P)).toBe(9000)
  })
})
