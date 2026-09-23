import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

/**
 * ⚠ LỖI THẬT (23/09/2026): mig 174 dùng thẻ đô-la `$vá$` (có chữ có dấu).
 *   psql hiểu, nhưng trình soạn SQL của Supabase KHÔNG nhận là mở khối —
 *   nó tách câu ở `;` bên trong `DO`, và chủ nhà chạy ra
 *   `42P01: relation "v_n" does not exist`. Chốt: thẻ đô-la chỉ được chữ
 *   ASCII, ở mọi migration và script SQL giao cho chủ nhà chạy.
 */
describe("thẻ đô-la chỉ dùng chữ ASCII", () => {
  for (const dir of ["supabase/migrations", "scripts/sql"]) {
    it(dir, () => {
      const goc = resolve(__dirname, "..", dir)
      const vp: string[] = []
      for (const f of readdirSync(goc).filter((x) => x.endsWith(".sql"))) {
        const s = readFileSync(resolve(goc, f), "utf-8")
        for (const m of Array.from(s.matchAll(/\$([^$\s;]*)\$/g))) {
          if (/[^\x00-\x7F]/.test(m[1])) vp.push(`${f}: $${m[1]}$`)
        }
      }
      expect(vp).toEqual([])
    })
  }
})
