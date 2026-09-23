import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * ⚠ CHỐT QUÉT: Ô NHẬP TIỀN PHẢI CHIA KHỐI 3 SỐ (chủ nhà yêu cầu 23/09/2026:
 *   "Các hiển thị số tiền thêm dấu . tách khối 3 số VD 9.000.000").
 *   Đợt rà có 54 ô tiền là `type="number"` — hiện 9000000 trần. Chốt này
 *   bắt ô thứ 55: một ô số trần mà giá trị mang tên tiền.
 */
const TIEN = /(price|amount|cost|salary|allowance|credit_limit|credit_note|subtotal|\btotal\b|debt|deduction|fixedAmount|collect|threshold|revenue|_max\b|tier\.(min|max)|siVal|adjVal)/i
const KHONG_PHAI_TIEN = /(pct|percent|rate|qty|quantity|days|conversion|weight|stock|sort|priority|year|rating|vat)/i

export function quetOTien(tep: string, s: string): string[] {
  const out: string[] = []
  const re = /<(Input|input)\b[^>]*?type="number"[^>]*?\/?>/g
  for (const m of Array.from(s.matchAll(re))) {
    const the = m[0]
    const v = /value=\{([^}]*)\}/.exec(the)?.[1] ?? ""
    if (TIEN.test(v) && !KHONG_PHAI_TIEN.test(v)) {
      out.push(`${tep}:${s.slice(0, m.index).split("\n").length} value={${v}}`)
    }
  }
  return out
}

const GOC = resolve(__dirname, "..")
const tsx = (d: string): string[] =>
  readdirSync(resolve(GOC, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsx(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []
  )

describe("máy quét tự kiểm", () => {
  it("bắt ô tiền số trần", () => {
    expect(quetOTien("a.tsx", `<Input type="number" value={form.amount} onChange={x} />`)).toHaveLength(1)
    expect(quetOTien("a.tsx", `<Input\n  type="number"\n  value={line.unit_price}\n/>`)).toHaveLength(1)
  })
  it("không bắt số lượng, phần trăm", () => {
    expect(quetOTien("a.tsx", `<Input type="number" value={line.quantity} />`)).toEqual([])
    expect(quetOTien("a.tsx", `<Input type="number" value={rules.price_edit_max_increase_pct} />`)).toEqual([])
  })
})

describe("không còn ô tiền số trần", () => {
  it("src/app và src/components", () => {
    const vp = [...tsx("src/app"), ...tsx("src/components")].flatMap((f) =>
      quetOTien(f, readFileSync(resolve(GOC, f), "utf-8"))
    )
    expect(vp).toEqual([])
  })
})
