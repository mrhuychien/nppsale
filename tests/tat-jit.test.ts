/**
 * TẮT JIT CHO APP — chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác". Sau mig 249 + 250 câu danh sách
 * chạy thật vài chục ms nhưng Postgres ước lượng đắt (soát quyền nhiều tầng) nên mất ~0,9 giây biên dịch JIT mỗi câu;
 * trang chủ 4,9 giây → 25 ms khi tắt. Báo cáo đo 4 lần mỗi kiểu: như cũ. Mig 251: `ALTER ROLE authenticated SET jit = off`.
 * SQL thật: scripts/sql/thu-251-tat-jit.sql.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/251_tat_jit_cho_app.sql")

describe("mig 251 — tắt JIT cho vai authenticated", () => {
  it("VÌ SAO trích lời chủ nhà + số đo; chỉ vai authenticated; có đường bật lại", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác"')
    expect(MIG).toContain("trang chủ (`dashboard_summary`): 4,9 giây → 25 ms")
    expect(MIG).toContain("EXECUTE 'ALTER ROLE authenticated SET jit = off';")
    expect(MIG).not.toMatch(/ALTER\s+(ROLE\s+(anon|authenticator|postgres|service_role)|DATABASE|SYSTEM)\b/i)
    expect(MIG).toContain("-- ⚠ Muốn bật lại: ALTER ROLE authenticated RESET jit; NOTIFY pgrst, 'reload config';")
  })
  it("PostgREST đọc lại cài đặt vai ngay (reload config); Supabase không cho đổi thì không làm hỏng tệp", () => {
    expect(MIG).toContain("NOTIFY pgrst, 'reload config';")
    expect(MIG).toContain("EXCEPTION WHEN insufficient_privilege THEN")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
  })
  it("khám sổ có dòng 90; luật ghi ở CLAUDE.md", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 90, 'Mig 251 (Tắt JIT cho app")
    expect(read("CLAUDE.md")).toContain("**JIT tắt cho vai `authenticated`** (mig 251)")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-251-tat-jit.sql")
describe.skipIf(!BO_THU)("mig 251 trên Postgres thử", () => {
  it("4/4 bước đạt (authenticated jit=off đúng một lần, vai khác không đụng, áp như PostgREST thì hết JIT)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("5|5|0")
  })
})
