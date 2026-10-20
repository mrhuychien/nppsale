/**
 * TÌM SỐ HOÁ ĐƠN NHANH — chủ nhà 20/10/2026: "Kiểm tra giúp tao sao tìm kiếm số hóa đơn trong danh sách hóa đơn chậm thế ?"
 * Gốc: khoá tìm `tim_kd` của 9 bảng chứng từ là CỘT TÍNH (mig 205). Dưới RLS máy chủ không đi chỉ mục được (`ilike` không
 * LEAKPROOF) nên quét cả bảng và tính lại khoá cho TỪNG dòng ở mọi câu — đo 40.000 hoá đơn: ~43 giây một câu. Mig 249: cột
 * thật do trigger ghi (~1 giây), trình duyệt gửi y như cũ.
 * SQL thật: scripts/sql/thu-249-luu-khoa-tim-chung-tu.sql (dựng lại trạng thái production hôm nay, chạy migration hai lần).
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve, join } from "node:path"
import { hamDangChay, THU_MUC_MIGRATION } from "./helpers/sql-ham-dang-chay"
import { BANG_TIM_KD_TINH } from "@/lib/search/list-search"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/249_luu_khoa_tim_chung_tu.sql")

/** Bảng → cột khoá trong khối `VALUES ('bang', ARRAY['cot', …])` của một migration. */
function bangCot(src: string, dau: string): Record<string, string[]> {
  const khoi = src.slice(src.indexOf(dau))
  const het = khoi.indexOf(") x(bang, cot)")
  const out: Record<string, string[]> = {}
  for (const m of Array.from(khoi.slice(0, het).matchAll(/\('(\w+)',\s+ARRAY\[([^\]]*)\]\)/g))) {
    out[m[1]] = Array.from(m[2].matchAll(/'(\w+)'/g)).map((x) => x[1])
  }
  return out
}

describe("mig 249 — khoá tìm chứng từ lưu sẵn", () => {
  it("VÌ SAO trích lời chủ nhà; hàm trigger chặn mọi vai; NOTIFY + câu tóm tắt", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 20/10/2026: "Kiểm tra giúp tao sao tìm kiếm số hóa đơn trong danh sách hóa đơn')
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public._trg_tim_kd() FROM PUBLIC, anon, authenticated;")
    const n = MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';")
    expect(n).toBeGreaterThan(0)
    expect(MIG.slice(n)).toMatch(/\nSELECT /)
  })

  it("đúng 9 bảng trình duyệt tìm bằng tim_kd, cột khoá y như mig 205 (lệch là khoá cũ / mới không khớp)", () => {
    const moi = bangCot(MIG, "FOR r IN SELECT * FROM (VALUES")
    const cu = bangCot(read("supabase/migrations/205_tim_kiem_chung.sql"), "FOR r IN SELECT * FROM (VALUES\n    ('sales_orders'")
    expect(Object.keys(moi).sort()).toEqual(Array.from(BANG_TIM_KD_TINH).sort())
    expect(moi).toEqual(cu)
    // Bảng mọi câu soát quyền đều đọc làm SAU CÙNG — khoá bảng giữ tới hết tệp.
    expect(Object.keys(moi).at(-1)).toBe("users")
  })

  it("điền cột bằng generated rồi DROP EXPRESSION — không một câu UPDATE nào trên bảng chứng từ", () => {
    expect(MIG).toContain("ADD COLUMN tim_kd text GENERATED ALWAYS AS (%s) STORED")
    expect(MIG).toContain("ALTER COLUMN tim_kd DROP EXPRESSION IF EXISTS")
    const lenh = MIG.split("\n").filter((d) => !d.trim().startsWith("--")).join("\n")
    // Cả câu dựng động: `format('UPDATE public.%I SET …', r.bang)`.
    expect(lenh).not.toMatch(/\bUPDATE\s+(?:public\.)?(?:\w+|%I)\s+SET\b/i)
    expect(lenh).not.toMatch(/DISABLE\s+TRIGGER/i)
  })

  it("bỏ hàm cột tính + chỉ mục biểu thức của mig 205", () => {
    expect(MIG).toContain("DROP FUNCTION IF EXISTS public.tim_kd(public.%I)")
    expect(MIG).toContain("DROP INDEX IF EXISTS public.%I', 'idx_' || r.bang || '_tim_kd_trgm'")
  })

  it("trigger trg_zzzz_tim_kd xếp SAU mọi trigger BEFORE của 9 bảng (Postgres chạy theo thứ tự tên)", () => {
    expect(MIG).toContain("CREATE TRIGGER trg_zzzz_tim_kd BEFORE INSERT OR UPDATE ON public.%I ")
    const bang = new Set(Object.keys(bangCot(MIG, "FOR r IN SELECT * FROM (VALUES")))
    const ten: string[] = []
    for (const f of readdirSync(THU_MUC_MIGRATION).filter((x) => x.endsWith(".sql"))) {
      const src = readFileSync(join(THU_MUC_MIGRATION, f), "utf-8")
      for (const m of Array.from(src.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+BEFORE\s+[\w\s,]+?\s+ON\s+(?:public\.)?(\w+)/gi))) {
        if (bang.has(m[2]) && m[1] !== "trg_zzzz_tim_kd") ten.push(m[1])
      }
    }
    expect(ten).toContain("trg_sales_orders_assign_code")
    expect(ten).toContain("trg_danh_so_phieu_tra")
    expect(ten.filter((t) => t >= "trg_zzzz_tim_kd")).toEqual([])
  })

  it("_trg_tim_kd đang chạy là bản mig 249: sửa mà cột nguồn không đổi thì khỏi tính lại; ghi thẳng tim_kd thì tính đè", () => {
    const h = hamDangChay().get("public._trg_tim_kd()")
    expect(h?.file).toBe("249_luu_khoa_tim_chung_tu.sql")
    expect(h!.than).toContain("v_doi := NEW.tim_kd IS DISTINCT FROM OLD.tim_kd;")
    expect(h!.than).toContain("IF NOT v_doi AND (v_row->TG_ARGV[i]) IS DISTINCT FROM (v_cu->TG_ARGV[i]) THEN")
    expect(h!.than).toMatch(/IF v_doi THEN\s+NEW\.tim_kd := public\.khoa_tim_ds\(VARIADIC v_gt\);/)
  })

  it("khám sổ có dòng 88; dòng 44 (mig 205) nhận cột thật là đã vá", () => {
    const kham = read("scripts/sql/kham-so-that.sql")
    expect(kham).toContain("SELECT 88, 'Mig 249 (Khoá tìm chứng từ lưu sẵn")
    const d44 = kham.slice(kham.indexOf("SELECT 44, 'Mig 205"), kham.indexOf("SELECT 45, "))
    expect(d44.match(/table_name = 'sales_orders' AND column_name = 'tim_kd'/g)).toHaveLength(2)
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
const BO_THU = chayBoThu("scripts/sql/thu-249-luu-khoa-tim-chung-tu.sql")
describe.skipIf(!BO_THU)("mig 249 trên Postgres thử", () => {
  it("18/18 bước đạt (điền khoá không UPDATE, trigger sau trigger đặt mã, ghi lại nguyên dòng được, RLS vẫn chặn, chạy lại vô hại)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("19|19|0")
  })
})
