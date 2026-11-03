/**
 * MIG 260 — quyền xem khách tính một lần (chủ nhà 03/11/2026: "làm cả 2"). Chính sách `customer_select` tốn ở ba chỗ:
 * vế dò cột created_by trong information_schema (~1,5 ms lập kế hoạch ở MỌI câu đụng bảng khách), `user_sells_to_customer(id)`
 * gọi cho từng khách NVBH không phụ trách, và chính sách phân công xét `customer_org_id()` trước vế "của chính tôi".
 * Sổ thử cỡ thật: sổ khách màn bán của NVBH 35,9 → 1,6 ms, tra một khách 3,3–3,7 → 0,55–0,7 ms. AI THẤY GÌ GIỮ NGUYÊN:
 * scripts/sql/thu-260-rls-khach-tinh-mot-lan.sql so tập khách + phân công của từng người trước / sau (0 lệch).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/260_rls_khach_tinh_mot_lan.sql")
const HAM = MIG.slice(MIG.indexOf("CREATE OR REPLACE FUNCTION public.khach_toi_da_ban()"), MIG.indexOf("COMMENT ON FUNCTION public.khach_toi_da_ban()"))

describe("mig 260 — quyền xem khách: tập tính một lần, vá trên bản đang chạy", () => {
  it("VÌ SAO trích chủ nhà + ba chỗ tốn + số đo; nói rõ ai thấy gì giữ nguyên", () => {
    expect(MIG).toContain('chủ nhà: "làm cả 2"')
    expect(MIG).toContain("information_schema.columns")
    expect(MIG).toContain("`user_sells_to_customer(id)` (mig 154) gọi cho TỪNG khách NVBH không phụ trách")
    expect(MIG).toContain("sổ khách màn bán của NVBH 35,9 → 1,6 ms")
    expect(MIG).toContain("AI THẤY GÌ GIỮ NGUYÊN")
  })

  it("khach_toi_da_ban(): cùng luật user_sells_to_customer — đơn đứng tên tôi, MỌI trạng thái, bỏ qua RLS (definer)", () => {
    expect(HAM).toMatch(/LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER\s+SET search_path = public/)
    expect(HAM).toContain("WHERE so.sales_user_id = auth.uid()")
    expect(HAM).toContain("AND so.customer_id IS NOT NULL")
    expect(HAM).not.toMatch(/status/)
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.khach_toi_da_ban() FROM PUBLIC, anon;")
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.khach_toi_da_ban() TO authenticated;")
  })

  it("vá BẢN ĐANG CHẠY (pg_get_expr → ALTER POLICY), không DROP / CREATE lại chính sách, không gỡ hàm cũ", () => {
    expect(MIG).toContain("SELECT pg_get_expr(p.polqual, p.polrelid) INTO v")
    expect(MIG).toContain("EXECUTE format('ALTER POLICY customer_select ON public.customers USING (%s)', v);")
    expect(MIG).not.toMatch(/\b(DROP|CREATE) POLICY\b/)
    expect(MIG).not.toMatch(/DROP FUNCTION/)
    // Thay đúng một vế, theo dạng pg_get_expr in ra (chạy lại tệp / bọc lại của mig 250 không đổi gì thêm).
    expect(MIG).toContain("v := replace(v, 'user_sells_to_customer(id)', '(id IN ( SELECT khach_toi_da_ban() AS khach_toi_da_ban))');")
    // Cắt vế information_schema theo cặp ngoặc (bỏ qua ngoặc trong chuỗi), giữ "created_by = tôi"; cắt hỏng thì để nguyên.
    expect(MIG).toContain("i := position('information_schema.columns' IN v);")
    expect(MIG).toContain("IF ch = chr(39) THEN")
    expect(MIG).toContain("IF d <> 0 OR position('information_schema.columns' IN substr(v, k, j - k + 1)) = 0 THEN")
    expect(MIG).toContain("v := substr(v, 1, k - 1) || substr(v, j + 6);")
  })

  it("phân công: chỉ đảo hai vế OR khi đúng bản mong đợi — vế 'của chính tôi' trước; khác thì giữ nguyên", () => {
    expect(MIG).toContain("v_cu   constant text := '((customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id)) OR (user_id = ( SELECT auth.uid() AS uid)))';")
    expect(MIG).toContain("v_moi  constant text := '((user_id = ( SELECT auth.uid() AS uid)) OR (customer_org_id(customer_id) = ( SELECT user_org_id() AS user_org_id)))';")
    expect(MIG).toContain("RAISE WARNING '--- 260 ⚠ \"View assignments in org\" khác bản mong đợi — giữ nguyên")
  })

  it("luật §3: thẻ dollar ASCII, NOTIFY, SELECT tóm tắt; khám sổ dòng 99; schema gộp có mig 260; CLAUDE.md có luật", () => {
    for (const m of Array.from(MIG.matchAll(/\$([A-Za-z0-9_À-ỹ]*)\$/g))) expect(m[1], m[0]).toMatch(/^[a-z0-9_]*$/)
    const n = MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';")
    expect(n).toBeGreaterThan(0)
    expect(MIG.slice(n)).toMatch(/\nSELECT /)
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 99, 'Mig 260 (Quyền xem khách tính một lần")
    expect(read("supabase/schema_full.sql")).toContain("-- QUYỀN XEM KHÁCH: BỎ PHẦN TÍNH TỪNG DÒNG / TỪNG CÂU KHÔNG CẦN")
    expect(read("CLAUDE.md")).toContain("**Chính sách RLS: không tra `information_schema` / catalog")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(ROOT, tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-260-rls-khach-tinh-mot-lan.sql")
describe.skipIf(!BO_THU)("mig 260 trên Postgres thử", () => {
  it("9/9 bước đạt: bản cũ đúng luật, TỪNG người thấy y hệt khách + phân công, chính sách / hàm / quyền đúng, nhanh hơn", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("10|10|0")
  })
})
