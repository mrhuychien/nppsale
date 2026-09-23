import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { NGUONG_O_TIM } from "../src/components/ui/select"

/**
 * ⚠ CHỐT QUÉT: MỌI DANH SÁCH THẢ XUỐNG DÀI PHẢI CÓ Ô TÌM (chủ nhà yêu cầu
 *   23/09/2026: "Rà soát các droplist đều phải kèm ô tìm kiếm").
 *
 *   `<Select>` dùng chung (src/components/ui/select.tsx) tự có ô tìm khi
 *   từ `NGUONG_O_TIM` lựa chọn — chốt e2e/select-co-o-tim.spec.ts bấm thật.
 *   Chỗ còn hở là `<select>` GỐC của trình duyệt: không thêm ô tìm được.
 *   Luật: `<select>` gốc chỉ còn cho danh sách NGẮN — hoặc liệt kê tay
 *   dưới ngưỡng, hoặc `.map` trên một bộ trong DANH SÁCH CHO PHÉP dưới đây
 *   (bộ cố định, ngắn). Danh sách động (khách, NV, lô, phiếu…) → CompactSelect.
 */
const BO_NGAN = new Set([
  "RETURN_ZONES", // 2 kho nhận
  "LY_DO",        // trả NCC: 4 lý do (màn phiếu trả khách đã sang CompactSelect)
  "units",        // đơn vị của một mặt hàng: 1–3
  "l.units",
  "options",      // SubHeaderSelect: kho (2) — nơi gọi truyền
])

/** Bỏ chú thích — chữ "`<select>`" trong một lời giải thích không phải ô chọn. */
const boChuThich = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "")

export function quetSelectGoc(tep: string, goc: string): string[] {
  const s = boChuThich(goc)
  const out: string[] = []
  for (const m of Array.from(s.matchAll(/<select[\s>]/g))) {
    const cuoi = s.indexOf("</select>", m.index)
    const than = s.slice(m.index, cuoi < 0 ? undefined : cuoi)
    const dong = s.slice(0, m.index).split("\n").length
    const map = /\{\s*(?:\(\s*([\w.]+)\s*\?\?\s*\[\]\s*\)|([\w.]+(?:\([^)]*\))?))\s*(?:\.filter\([^)]*\))?\s*\.map\(/.exec(than)
    if (map) {
      const bo = map[1] ?? map[2]
      if (!BO_NGAN.has(bo)) out.push(`${tep}:${dong} .map trên "${bo}" — dùng CompactSelect`)
      continue
    }
    const soOption = (than.match(/<option\b/g) ?? []).length
    if (soOption >= NGUONG_O_TIM) out.push(`${tep}:${dong} ${soOption} lựa chọn — dùng CompactSelect`)
  }
  return out
}

const GOC = resolve(__dirname, "..")
const tsx = (d: string): string[] =>
  readdirSync(resolve(GOC, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsx(join(d, e.name)) : e.name.endsWith(".tsx") ? [join(d, e.name)] : []
  )

describe("máy quét tự kiểm", () => {
  it("bắt danh sách động và danh sách tĩnh dài", () => {
    expect(quetSelectGoc("a.tsx", `<select value={x}>{customers.map((c) => <option key={c.id}/>)}</select>`)).toHaveLength(1)
    expect(quetSelectGoc("a.tsx", `<select>{(l.lots ?? []).map((lo) => <option/>)}</select>`)).toHaveLength(1)
    expect(quetSelectGoc("a.tsx", `<select>${"<option>a</option>".repeat(6)}</select>`)).toHaveLength(1)
  })
  it("cho qua bộ ngắn và danh sách tĩnh ngắn", () => {
    expect(quetSelectGoc("a.tsx", `<select>{RETURN_ZONES.map((z) => <option/>)}</select>`)).toEqual([])
    expect(quetSelectGoc("a.tsx", `<select><option>a</option><option>b</option></select>`)).toEqual([])
    expect(quetSelectGoc("a.tsx", `<selectedThing />`)).toEqual([])
  })
})

describe("không còn select gốc cho danh sách dài / động", () => {
  it("src/app và src/components", () => {
    const vp = [...tsx("src/app"), ...tsx("src/components")].flatMap((f) =>
      quetSelectGoc(f, readFileSync(resolve(GOC, f), "utf-8"))
    )
    expect(vp).toEqual([])
  })
})
