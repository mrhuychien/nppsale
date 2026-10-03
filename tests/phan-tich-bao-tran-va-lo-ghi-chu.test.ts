import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchReturnCosts, docTheoLoNho, GHI_CHU_MOI_LO } from "../src/lib/analytics/sales"
import { ID_MOI_LO } from "../src/lib/supabase/aggregate"

/**
 * HAI LỖI SỬA 03/10/2026.
 *
 * 1. Sáu màn Phân tích gọi `fetchRevenueInvoices` / `fetchReturnsRows` (bản trả mảng
 *    trần, chạm trần 20.000 dòng chỉ `console.warn`) và `setTruncated` chỉ soi danh
 *    mục — số THIẾU vẽ như số đủ, dải "Số liệu chưa đầy đủ" không bao giờ hiện. Nay
 *    gọi bản `…Du` và đưa MỌI cờ (hóa đơn, phiếu trả, giá vốn của cả hai kỳ) vào
 *    `setTruncated`.
 * 2. `fetchReturnCosts` khớp phiếu nhập theo CÂU ghi chú "Nhập lại từ phiếu trả <id>"
 *    với lô 150 câu → ~15 KB URL. Nay lô `GHI_CHU_MOI_LO` (50).
 */

const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")

const A = "src/app/(dashboard)/analytics"
const MAN: Array<[string, string[]]> = [
  ["business/overview", ["cogsRes.truncated", "prevCogsRes.truncated"]],
  ["business/cost-profit", ["cogsRes.truncated", "prevCogsRes.truncated"]],
  ["customers/overview", []],
  ["customers/categories", []],
  ["products/overview", []],
  ["products/categories", []],
]

describe("màn Phân tích: chạm trần thì NÓI RA", () => {
  it.each(MAN)("%s", (ten, them) => {
    const S = code(read(`${A}/${ten}/page.tsx`))
    expect(S).not.toMatch(/\bfetch(RevenueInvoices|ReturnsRows|ReturnsValue|AllOrders)\(/)
    expect(S).toContain("fetchRevenueInvoicesDu(supabase, orgId, range)")
    expect(S).toContain("fetchRevenueInvoicesDu(supabase, orgId, prev)")
    expect(S).toContain("fetchReturnsRowsDu(supabase, orgId, range)")
    expect(S).toContain("fetchReturnsRowsDu(supabase, orgId, prev)")
    const i = S.indexOf("setTruncated(")
    const khoi = S.slice(i, S.indexOf("\n      )", i) + 8)
    for (const co of ["invRes.truncated", "prevInvRes.truncated", "retRes.truncated", "prevRetRes.truncated", ...them]) {
      expect(khoi, `${ten}: setTruncated thiếu ${co}`).toContain(co)
    }
    expect(S).toMatch(/\{truncated && <CanhBaoThieuDong \/>\}/)
  })

  it("bản cũ nuốt cờ đã bỏ khỏi lib", () => {
    const S = code(read("src/lib/analytics/sales.ts"))
    expect(S).not.toMatch(/export async function fetch(RevenueInvoices|ReturnsRows|ReturnsValue|AllOrders)\(/)
  })
})

/* ───── PostgREST giả tối giản: lọc eq / in, ghi lại cỡ mỗi `.in(...)` ───── */
type Row = Record<string, unknown>
function gia(bang: Record<string, Row[]>) {
  const nhatKy: Array<{ bang: string; cot: string; lo: string[] }> = []
  const client = {
    from(t: string) {
      const eq: Array<[string, unknown]> = []
      const inn: Array<[string, unknown[]]> = []
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (eq.push([c, v]), b),
        in: (c: string, v: string[]) => (inn.push([c, v]), nhatKy.push({ bang: t, cot: c, lo: v }), b),
        order: () => b,
        range: () => b,
        then(ok: (v: unknown) => unknown) {
          const rows = (bang[t] ?? []).filter(
            (r) => eq.every(([c, v]) => r[c] === v) && inn.every(([c, v]) => v.includes(r[c]))
          )
          return Promise.resolve({ data: rows, error: null, count: rows.length }).then(ok)
        },
      }
      return b
    },
  }
  return { client: client as unknown as SupabaseClient, nhatKy }
}

describe("fetchReturnCosts: lô ghi chú nhỏ, đọc đủ", () => {
  const N = 400
  const ids = Array.from({ length: N }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
  const entries: Row[] = ids.map((id, i) => ({
    id: `e${i}`,
    type: "import",
    status: "posted",
    notes: i % 7 === 0 ? `Nhập lại từ phiếu trả ${id} (đã đảo)` : `Nhập lại từ phiếu trả ${id}`,
  }))
  const lines: Row[] = entries.map((e, i) => ({
    entry_id: e.id, product_id: `p${i % 3}`, quantity: 2, qty_in_base_uom: 2 + (i % 2), conversion_factor_snapshot: 1, unit_cost: 1000,
  }))

  it("mỗi `.in(\"notes\")` ≤ GHI_CHU_MOI_LO câu, URL vài KB; đủ mọi phiếu", async () => {
    const { client, nhatKy } = gia({ stock_entries: entries, stock_entry_lines: lines })
    const out = await fetchReturnCosts(client, ids)
    const loNotes = nhatKy.filter((k) => k.cot === "notes")
    expect(loNotes.length).toBe(Math.ceil(N / GHI_CHU_MOI_LO))
    for (const k of loNotes) {
      expect(k.lo.length).toBeLessThanOrEqual(GHI_CHU_MOI_LO)
      // Cỡ phần `in.(…)` trên URL — giữ dưới ~6 KB như một lô 150 uuid.
      expect(encodeURIComponent(k.lo.map((x) => `"${x}"`).join(",")).length).toBeLessThan(6000)
    }
    /* Phiếu "(đã đảo)" không khớp; còn lại đủ cả. */
    const khop = ids.filter((_, i) => i % 7 !== 0)
    expect(out.size).toBe(khop.length)
    let tong = 0
    out.forEach((v) => (tong += v.total))
    const mong = entries.reduce((s, _e, i) => (i % 7 === 0 ? s : s + (2 + (i % 2)) * 1000), 0)
    expect(tong).toBe(mong)
    /* Dòng phiếu nhập vẫn theo lô uuid thường. */
    for (const k of nhatKy.filter((x) => x.cot === "entry_id")) expect(k.lo.length).toBeLessThanOrEqual(ID_MOI_LO)
  })

  it("docTheoLoNho giữ thứ tự, bỏ trùng, ném khi lô hỏng", async () => {
    const { client } = gia({ t: Array.from({ length: 120 }, (_, i) => ({ id: `x${i}` })) })
    const keys = Array.from({ length: 120 }, (_, i) => `x${i}`)
    const r = await docTheoLoNho<Row>(keys.concat(keys.slice(0, 5)), 25, (lo) => client.from("t").select("id").in("id", lo) as never, "đọc t")
    expect(r.map((x) => x.id)).toEqual(keys)
    const hong = {
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "URL quá dài" }, count: null }) }) }),
    } as unknown as SupabaseClient
    await expect(
      docTheoLoNho(["a"], 25, (lo) => hong.from("t").select("id").in("id", lo) as never, "đọc t")
    ).rejects.toThrow(/URL quá dài/)
  })
})
