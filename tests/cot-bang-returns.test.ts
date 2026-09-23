import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * ⚠ LỖI THẬT (23/09/2026): màn POS Trả hàng đọc `returns.return_code` —
 *   cột KHÔNG CÓ (chỉ `supplier_returns` có). Mở lại phiếu trả đã lưu là
 *   câu đọc hỏng 42703. Chốt: không câu `.from("returns").select(...)` nào
 *   trong src đòi `return_code`; và đúng là không migration nào thêm cột ấy
 *   vào `returns` (nếu sau này thêm, chốt thứ hai nhắc gỡ chốt này).
 */
const GOC = resolve(__dirname, "..")
const tep = (d: string): string[] =>
  readdirSync(resolve(GOC, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tep(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(d, e.name)] : []
  )

describe("returns không có return_code", () => {
  it("không câu đọc bảng returns nào đòi return_code", () => {
    const vp: string[] = []
    for (const f of tep("src")) {
      const s = readFileSync(resolve(GOC, f), "utf-8")
      for (const m of Array.from(s.matchAll(/\.from\("returns"\)\s*\.select\(\s*(["`])([^"`]*)\1/g))) {
        if (/\breturn_code\b/.test(m[2].replace(/\([^)]*\)/g, ""))) vp.push(f)
      }
    }
    expect(vp).toEqual([])
  })
  it("không migration nào thêm return_code vào returns", () => {
    const mig = readdirSync(resolve(GOC, "supabase/migrations")).map((f) =>
      readFileSync(resolve(GOC, "supabase/migrations", f), "utf-8")
    ).join("\n")
    expect(/ALTER TABLE (public\.)?returns\b[^;]*return_code/i.test(mig)).toBe(false)
  })
})
