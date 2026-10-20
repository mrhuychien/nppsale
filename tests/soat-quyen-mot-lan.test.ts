/**
 * SOÁT QUYỀN TÍNH MỘT LẦN MỖI CÂU — chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác" (sau mig 249,
 * tìm số hoá đơn chậm). Khoá tìm các danh sách khác đã lưu sẵn; phần chậm còn lại là chính sách RLS gọi lại
 * `user_org_id()` / `user_role()` / `auth.uid()` cho TỪNG dòng. Mig 250 bọc chúng trong `(SELECT …)` — Postgres tính một
 * lần mỗi câu. Đo: NVBH đếm công nợ 1,42 giây → 8 ms.
 * SQL thật: scripts/sql/thu-250-soat-quyen-tinh-mot-lan.sql (7 người × mọi bảng: thấy gì / ghi được gì, y hệt trước).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, join } from "node:path"
import { THU_MUC_MIGRATION } from "./helpers/sql-ham-dang-chay"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/250_soat_quyen_tinh_mot_lan.sql")

/** Bỏ chú thích `-- …` của SQL (chữ trong chú thích không phải lệnh). */
const boChuThich = (s: string) => s.split("\n").map((d) => d.replace(/--.*$/, "")).join("\n")

/** Lời gọi hàm quyền CHƯA bọc `(SELECT …)` trong một đoạn SQL. */
function goiThang(sql: string): string[] {
  const conLai = boChuThich(sql)
    .replace(/\(\s*SELECT\s+(public\.)?user_has_permission\([^;]*?\)\s*(AS\s+\w+\s*)?\)/gi, "")
    .replace(/\(\s*SELECT\s+(auth\.uid|(public\.)?user_org_id|(public\.)?user_role)\(\)\s*(AS\s+\w+\s*)?\)/gi, "")
  return Array.from(conLai.matchAll(/\b(auth\.uid|user_org_id|user_role)\(\)/gi)).map((m) => m[0])
}

describe("mig 250 — soát quyền tính một lần mỗi câu", () => {
  it("VÌ SAO trích lời chủ nhà; hai hàm nội bộ chặn mọi vai; NOTIFY + câu tóm tắt", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 20/10/2026: "làm tương tự cho tìm kiếm các danh sách khác"')
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public._rls_tinh_mot_lan(text) FROM PUBLIC, anon, authenticated;")
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public._rls_tinh_mot_lan_ap() FROM PUBLIC, anon, authenticated;")
    const n = MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';")
    expect(n).toBeGreaterThan(0)
    expect(MIG.slice(n)).toMatch(/\nSELECT /)
  })

  it("bọc ĐÚNG DẠNG pg_get_expr in ra (chạy lại không ghi lại), gỡ lớp cũ TRƯỚC khi bọc", () => {
    const ham = MIG.slice(MIG.indexOf("CREATE OR REPLACE FUNCTION public._rls_tinh_mot_lan(p text)"), MIG.indexOf("$fn$;"))
    for (const d of ["'( SELECT auth.uid() AS uid)'", "'( SELECT \\1user_org_id() AS user_org_id)'", "'( SELECT \\1user_role() AS user_role)'",
      "'( SELECT \\1 AS user_has_permission)'"]) expect(ham, d).toContain(d)
    expect(ham.indexOf("-- Gỡ")).toBeGreaterThan(0)
    expect(ham.indexOf("-- Gỡ")).toBeLessThan(ham.indexOf("-- Bọc"))
    // Hàm theo dòng không bị đụng.
    expect(ham).not.toMatch(/customer_org_id|user_sells_to_customer/)
  })

  it("chỉ chính sách của schema public (storage giữ nguyên); ALTER POLICY giữ cả USING lẫn WITH CHECK", () => {
    expect(MIG).toContain("WHERE c.relnamespace = 'public'::regnamespace")
    expect(MIG).toContain("format(' USING (%s)', v_q)")
    expect(MIG).toContain("format(' WITH CHECK (%s)', v_c)")
  })

  it("migration SAU 250 thêm / sửa chính sách thì phải bọc sẵn, hoặc gọi _rls_tinh_mot_lan_ap() cuối tệp", () => {
    const sau = readdirSync(THU_MUC_MIGRATION).filter((f) => /^\d{3}_.*\.sql$/.test(f) && Number(f.slice(0, 3)) > 250)
    for (const f of sau) {
      const src = readFileSync(join(THU_MUC_MIGRATION, f), "utf-8")
      if (/_rls_tinh_mot_lan_ap\(\)/.test(boChuThich(src))) continue
      const chinhSach = Array.from(boChuThich(src).matchAll(/(CREATE|ALTER)\s+POLICY[\s\S]*?;/gi)).map((m) => m[0])
      expect(chinhSach.flatMap(goiThang), f).toEqual([])
    }
  })

  it("máy dò lời gọi thẳng: bắt được dạng thường, bỏ qua dạng đã bọc", () => {
    expect(goiThang("USING (org_id = user_org_id() AND sales_user_id = auth.uid())")).toEqual(["user_org_id()", "auth.uid()"])
    expect(goiThang("USING (org_id = (SELECT user_org_id()) AND (SELECT user_role()) = 'sales')")).toEqual([])
    expect(goiThang("USING (sales_user_id = ( SELECT auth.uid() AS uid))")).toEqual([])
    expect(goiThang("USING ((SELECT user_has_permission((SELECT auth.uid()), 'customer.view_all')))")).toEqual([])
    expect(goiThang("-- user_role() trong chú thích\nUSING (true)")).toEqual([])
  })

  it("khám sổ có dòng 89; dòng 1 nhận cả dạng bọc của auth.uid(); luật ghi ở CLAUDE.md", () => {
    const kham = read("scripts/sql/kham-so-that.sql")
    expect(kham).toContain("SELECT 89, 'Mig 250 (Soát quyền tính một lần mỗi câu")
    expect(kham).toContain("(sales_user_id = ( SELECT auth.uid() AS uid)))' in qual) > 0")
    expect(read("CLAUDE.md")).toContain("**Chính sách RLS: bọc hàm quyền trong `(SELECT …)`**")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-250-soat-quyen-tinh-mot-lan.sql")
describe.skipIf(!BO_THU)("mig 250 trên Postgres thử", () => {
  it("9/9 bước đạt (thấy gì / ghi được gì y hệt trước cho 7 người × mọi bảng, chạy lại vô hại, kế hoạch dùng initplan)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("10|10|0")
  })
})
