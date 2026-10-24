/**
 * TẮT JIT Ở VAI ĐĂNG NHẬP — chủ nhà 24/10/2026 gửi bảng pg_stat_statements: danh sách Hoá đơn bán ~3 giây/câu. Tái hiện
 * trên sổ thử 40.000 HĐ với đúng câu PostgREST sinh ra: JIT bật 4.245 ms, tắt 11 ms. Mig 251 đặt ở vai giả lập
 * `authenticated` (PostgREST phải áp); mig 252 đặt thêm ở vai đăng nhập `authenticator` + `anon` — Postgres tự áp.
 * SQL thật: scripts/sql/thu-252-tat-jit-vai-dang-nhap.sql.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/252_tat_jit_vai_dang_nhap.sql")

describe("mig 252 — tắt JIT ở vai đăng nhập authenticator + anon", () => {
  it("VÌ SAO trích chủ nhà + số đo tái hiện; đúng hai vai; có đường bật lại", () => {
    expect(MIG).toContain("VÌ SAO — chủ nhà 24/10/2026 gửi bảng pg_stat_statements")
    expect(MIG).toContain("JIT bật 4.245 ms  —  JIT tắt 11 ms")
    expect(MIG).toContain("FOREACH v IN ARRAY ARRAY['authenticator', 'anon'] LOOP")
    expect(MIG).toContain("EXECUTE format('ALTER ROLE %I SET jit = off', v);")
    expect(MIG).not.toMatch(/ALTER\s+(ROLE\s+(authenticated|postgres|service_role)|DATABASE|SYSTEM)\b/i)
    expect(MIG).toContain("-- ⚠ Muốn bật lại: ALTER ROLE authenticator RESET jit; ALTER ROLE anon RESET jit; NOTIFY pgrst, 'reload config';")
  })

  it("Supabase không cho đổi / sổ không có vai thì không làm hỏng tệp; PostgREST đọc lại cài đặt; kết bằng SELECT tóm tắt", () => {
    expect(MIG).toContain("WHEN insufficient_privilege THEN")
    expect(MIG).toContain("WHEN undefined_object THEN")
    expect(MIG).toContain("NOTIFY pgrst, 'reload config';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
  })

  it("khám sổ có dòng 91; schema gộp có mig 252; luật ghi ở CLAUDE.md", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 91, 'Mig 252 (Tắt JIT ở vai đăng nhập authenticator + anon")
    expect(read("supabase/schema_full.sql")).toContain("ALTER ROLE %I SET jit = off")
    expect(read("CLAUDE.md")).toContain("**Mig 252 tắt thêm ở vai đăng nhập")
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
const BO_THU = chayBoThu("scripts/sql/thu-252-tat-jit-vai-dang-nhap.sql")
describe.skipIf(!BO_THU)("mig 252 trên Postgres thử", () => {
  it("4/4 bước đạt (authenticator + anon jit=off đúng một lần, cài đặt khác và vai khác không đụng)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("5|5|0")
  })
})
