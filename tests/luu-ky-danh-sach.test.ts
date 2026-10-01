/**
 * Chủ nhà 01/10/2026: "Làm thêm phần trong các danh sách lưu bộ lọc Thời gian cho user".
 * Bấm thật: e2e/luu-ky-danh-sach.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { docKyDaLuu, khoaLuuKy } from "@/hooks/use-luu-ky"

function tep(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) tep(p, out)
    else if (f.endsWith(".tsx")) out.push(p)
  }
  return out
}
const HOOK = readFileSync("src/hooks/use-luu-ky.ts", "utf8")

describe("lưu bộ lọc Thời gian theo tài khoản", () => {
  it("khoá lưu theo danh sách + tài khoản", () => {
    expect(khoaLuuKy("don-hang", "u1")).toBe("npp.loc-ky.don-hang.u1")
    expect(khoaLuuKy("don-hang", "u1")).not.toBe(khoaLuuKy("don-hang", "u2"))
    expect(khoaLuuKy("don-hang", "u1")).not.toBe(khoaLuuKy("phieu-thu", "u1"))
  })
  it("giá trị lưu rác / bản cũ → dùng mặc định", () => {
    for (const k of ["today", "week", "month", "all"]) expect(docKyDaLuu(k)).toBe(k)
    expect(docKyDaLuu("custom")).toBeNull()
    expect(docKyDaLuu("")).toBeNull()
    expect(docKyDaLuu(null)).toBeNull()
  })
  it("đọc trong effect (không lỗi hydrate), chưa có tài khoản thì không đọc / ghi", () => {
    expect(HOOK).toMatch(/useEffect\(\(\) => \{\s*if \(!uid\) return/)
    expect(HOOK).toContain("if (!uid) return\n      try {\n        window.localStorage.setItem")
  })
  it("MỌI danh sách có ô chọn kỳ đều nhớ kỳ — chọn kỳ là lưu", () => {
    const co = tep("src/app").map((p) => ({ p, s: readFileSync(p, "utf8") })).filter((x) => x.s.includes("<PeriodSelect"))
    expect(co.length).toBeGreaterThanOrEqual(7)
    const khoa = new Set<string>()
    for (const { p, s } of co) {
      const m = s.match(/useLuuKy\("([\w-]+)"/)
      expect(m, p).not.toBeNull()
      expect(khoa.has(m![1]), `${p}: trùng khoá ${m![1]}`).toBe(false)
      khoa.add(m![1])
      // Mỗi ô chọn kỳ phải đi qua hàm lưu.
      for (const o of s.match(/<PeriodSelect[\s\S]*?\/>/g) ?? []) {
        expect(o, p).toMatch(/onChange=\{\(k\) => \{[^}]*(luuKy\(k\)|setPeriod\(k\))/)
      }
      if (s.includes("const [period, setPeriod]")) expect(s, p).toContain("= useLuuKy(")
    }
  })
})
