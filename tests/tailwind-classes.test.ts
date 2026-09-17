import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(__dirname, "..")

/** Thang `spacing` mặc định của Tailwind 3 — chú ý: KHÔNG có 13, 15, 17… */
const DEFAULT_SPACING = new Set([
  "0", "px", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "5", "6", "7", "8",
  "9", "10", "11", "12", "14", "16", "20", "24", "28", "32", "36", "40", "44",
  "48", "52", "56", "60", "64", "72", "80", "96",
])

function customSpacing(): Set<string> {
  const cfg = readFileSync(resolve(ROOT, "tailwind.config.ts"), "utf-8")
  const i = cfg.indexOf("spacing: {")
  if (i < 0) return new Set()
  const block = cfg.slice(i, cfg.indexOf("}", i))
  return new Set(Array.from(block.matchAll(/"?([a-zA-Z0-9-]+)"?\s*:/g)).map((m) => m[1]))
}

function tsxFiles(dir = resolve(ROOT, "src"), acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) tsxFiles(p, acc)
    else if (e.name.endsWith(".tsx") && statSync(p).isFile()) acc.push(p)
  }
  return acc
}

const PREFIXES = [
  "h", "w", "p", "px", "py", "pt", "pb", "pl", "pr",
  "m", "mx", "my", "mt", "mb", "ml", "mr",
  "gap", "gap-x", "gap-y", "top", "bottom", "left", "right", "size",
  "space-x", "space-y", "min-h", "min-w", "max-h", "max-w",
  "inset", "inset-x", "inset-y",
]

describe("Không lớp Tailwind nào rỗng ruột", () => {
  /**
   * ⚠ LỚP KHÔNG CÓ TRONG THANG THÌ TAILWIND SINH RA ĐÚNG KHÔNG GÌ CẢ —
   * không cảnh báo, không lỗi build, không có gì trong CSS. Nó chỉ lộ ra
   * khi ai đó nhìn kỹ và thấy nút cao sai.
   *
   * Ca thật: `h-13` (13 KHÔNG có trong thang mặc định: …12, 14, 16…) được
   * dùng cho NÚT HÀNH ĐỘNG CHÍNH của cả luồng bán hàng — "Đặt hàng",
   * "Lưu tạm", "Xong · về đơn hàng", "Tạo đơn tiếp". Chiều cao nút thực ra
   * do `py-3.5` giữ hộ suốt nhiều tháng; đổi cỡ chữ hay bỏ padding là nút
   * co lại mà không ai biết nhìn vào đâu.
   */
  it("mọi lớp khoảng cách dùng trong src đều có trong thang", () => {
    const allowed = new Set(Array.from(DEFAULT_SPACING).concat(Array.from(customSpacing())))
    const re = new RegExp(`\\b(?:${PREFIXES.join("|")})-(\\d+(?:\\.\\d+)?)\\b`, "g")
    const offenders: string[] = []
    for (const f of tsxFiles()) {
      const src = readFileSync(f, "utf-8")
      for (const m of Array.from(src.matchAll(re))) {
        if (!allowed.has(m[1])) {
          offenders.push(`${f.slice(ROOT.length + 1)}: ${m[0]}`)
        }
      }
    }
    expect(Array.from(new Set(offenders))).toEqual([])
  })

  /** `13` phải nằm trong thang vì luồng bán hàng đang dựa vào nó. */
  it("thang có khai 13 cho nút hành động chính", () => {
    expect(customSpacing().has("13")).toBe(true)
  })
})
