import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * ⚠ GỐC LỖI P1 (chủ nhà báo 23/09/2026): sửa hóa đơn báo "Hóa đơn đã có tiền
 *   thu nên chưa lập lại được (LOCKED_HAS_PAYMENT)" dù chưa thu đồng nào —
 *   câu dò `do-hoa-don-khoa-tien-thu.sql` trên máy thật ra 0 dòng, tức máy
 *   chủ KHÔNG khoá. Màn sửa hóa đơn cũ đọc `cash_receipts(… method …)`, mà
 *   bảng này không có cột `method` → câu đọc hỏng 42703 → màn coi "không đọc
 *   được phiếu thu" là "có tiền thu" và khoá nút.
 *
 * Chốt: mọi chỗ ghép `cash_receipts(…)` / `cash_receipt_lines(…)` trong src
 *   chỉ dùng cột có thật trong migration.
 */
const MIG = "supabase/migrations"
const sql = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(join(MIG, f), "utf8")).join("\n")

function cotCua(bang: string): Set<string> {
  const cot = new Set<string>()
  const tao = new RegExp(`CREATE TABLE IF NOT EXISTS (?:public\\.)?${bang} \\(([\\s\\S]*?)\\n\\);`).exec(sql)
  if (tao) for (const d of tao[1].split("\n")) { const m = /^\s+([a-z_]+)\s+[a-z]/.exec(d); if (m && !/^(unique|primary|check|constraint|foreign)$/i.test(m[1])) cot.add(m[1]) }
  const re = new RegExp(`ALTER TABLE (?:public\\.)?${bang}\\b([\\s\\S]*?);`, "g")
  for (const m of Array.from(sql.matchAll(re))) for (const c of Array.from(m[1].matchAll(/ADD COLUMN IF NOT EXISTS ([a-z_]+)/g))) cot.add(c[1])
  return cot
}

function tepSrc(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tepSrc(join(d, e.name)) : /\.(tsx?|mjs)$/.test(e.name) ? [join(d, e.name)] : [])
}

describe("phiếu thu: chỉ đọc cột có thật", () => {
  const CR = cotCua("cash_receipts")

  it("máy đọc cột tự kiểm", () => {
    expect(CR.has("receipt_code")).toBe(true)
    expect(CR.has("status")).toBe(true)
    expect(CR.has("void_reason")).toBe(true)
    expect(CR.has("method")).toBe(false)
  })

  it("mọi phần ghép cash_receipts(…) trong src dùng cột có thật", () => {
    const sai: string[] = []
    for (const f of tepSrc("src")) {
      const s = readFileSync(f, "utf8")
      for (const m of Array.from(s.matchAll(/:\s*cash_receipts(?:!\w+)?\(([^()]*)\)/g))) {
        for (const c of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
          const ten = c.includes(":") ? c.split(":")[1].trim() : c
          if (!CR.has(ten)) sai.push(`${f}: ${ten}`)
        }
      }
    }
    expect(sai).toEqual([])
  })
})
