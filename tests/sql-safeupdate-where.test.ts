import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hamDangChay, cauThieuWhere } from "./helpers/sql-ham-dang-chay"

/**
 * UPDATE / DELETE TRONG HÀM PHẢI CÓ WHERE.
 *
 * ⚠ CHỦ NHÀ BÁO 08/10/2026: "Sửa phiếu nhập NCC báo lỗi này? UPDATE requires a WHERE clause".
 * Supabase nạp tiện ích `safeupdate` cho mọi lượt gọi qua API: câu UPDATE / DELETE không có WHERE bị từ chối ngay lúc
 * phân tích — kể cả câu nằm trong hàm SECURITY DEFINER, kể cả trên bảng tạm. `sua_phieu_nhap` (mig 235) có một câu
 * `UPDATE _pn_moi SET base = …` trần → mọi lần lưu sửa phiếu nhập đã hoàn thành đều nổ.
 *
 * ⚠ CHẠY THỬ BẰNG psql KHÔNG THẤY: vai postgres không nạp safeupdate, câu SQL hợp lệ hoàn toàn — chỉ lộ trên máy chủ
 * thật. Nên tệp này quét MỌI hàm đang chạy, hai lớp:
 *   1. theo tệp migration (luôn chạy, kể cả CI) — bản cuối cùng của từng hàm, mọi kiểu thẻ dollar;
 *   2. theo `pg_proc` của Postgres thử khi có — bắt cả hàm mà migration vá bằng `EXECUTE` (lớp 1 không thấy).
 * ⚠ WHERE trong truy vấn con không tính — safeupdate chỉ nhìn WHERE của chính câu UPDATE / DELETE.
 */

const HOST = process.env.PG_THU_HOST || "/tmp/pgtest"
const PORT = process.env.PG_THU_PORT || "55432"
const DB = process.env.PG_THU_DB || "npp_tong"

const thieu = (sql: string) => cauThieuWhere(sql).map((c) => c.cau)

describe("bộ quét nhận ra câu UPDATE / DELETE không WHERE", () => {
  it("bắt câu trần, câu chỉ có WHERE trong truy vấn con, câu UPDATE … FROM không WHERE", () => {
    expect(thieu("UPDATE _pn_moi SET base = quantity * cf, cost = 1;")).toHaveLength(1)
    expect(thieu("UPDATE t SET a = (SELECT max(b) FROM u WHERE u.id = 1);")).toHaveLength(1)
    expect(thieu("UPDATE b SET q = s.q FROM s;")).toHaveLength(1)
    expect(thieu("DELETE FROM t;")).toHaveLength(1)
    expect(thieu("UPDATE t SET a = 1")).toHaveLength(1) // câu cuối của hàm sql không có dấu ;
  })

  it("bắt câu sửa / xoá nằm trong WITH … AS (…) — safeupdate soi cả CTE", () => {
    expect(thieu("WITH d AS (DELETE FROM t RETURNING id) SELECT count(*) FROM d;")).toHaveLength(1)
    expect(thieu("WITH u AS (UPDATE t SET a = 1 RETURNING id) SELECT 1;")).toHaveLength(1)
  })

  it("câu có WHERE thì qua — kể cả WHERE true và WHERE sau CTE gom", () => {
    expect(thieu("UPDATE t SET a = 1 WHERE id = p_id;")).toEqual([])
    expect(thieu("UPDATE t SET a = 1 WHERE true;")).toEqual([])
    expect(thieu("DELETE FROM t USING u WHERE t.id = u.id;")).toEqual([])
    expect(
      thieu("WITH g AS (SELECT batch_id, SUM(q) AS q FROM l GROUP BY batch_id) UPDATE b SET q = b.q + g.q FROM g WHERE b.id = g.batch_id;")
    ).toEqual([])
    expect(thieu("UPDATE _pn_moi SET base = quantity * cf\n  WHERE quantity > 0 AND cf > 0;")).toEqual([])
  })

  it("không kêu oan: khoá dòng, ON CONFLICT, TG_OP, chú thích, chuỗi, SQL động", () => {
    expect(thieu("SELECT * INTO v FROM t WHERE id = x FOR UPDATE;")).toEqual([])
    expect(thieu("PERFORM 1 FROM batches b JOIN c ON c.id = b.id FOR UPDATE OF b;")).toEqual([])
    expect(thieu("SELECT 1 FROM t FOR NO KEY UPDATE;")).toEqual([])
    expect(thieu("INSERT INTO t (id, a) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET a = EXCLUDED.a;")).toEqual([])
    expect(thieu("IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN RETURN NEW; END IF;")).toEqual([])
    expect(thieu("-- UPDATE t SET a = 1;\n/* DELETE FROM t; */ SELECT 1;")).toEqual([])
    expect(thieu("RAISE NOTICE 'UPDATE t SET a = 1; DELETE FROM t;';")).toEqual([])
    expect(thieu("EXECUTE $q$UPDATE t SET a = 1$q$;")).toEqual([])
    expect(thieu("v := E'it\\'s; UPDATE t SET a = 1;';")).toEqual([])
  })
})

describe("bản đang chạy của từng hàm (theo tệp migration)", () => {
  it("bản sau thay bản trước theo đúng chữ ký kiểu; DROP FUNCTION gỡ khỏi danh sách", () => {
    const dir = mkdtempSync(join(tmpdir(), "mig-"))
    try {
      writeFileSync(
        join(dir, "001_a.sql"),
        [
          "CREATE OR REPLACE FUNCTION public.f(p uuid) RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN UPDATE t SET a = 1; END $fn$;",
          "CREATE FUNCTION g(p int) RETURNS void LANGUAGE sql AS $$ DELETE FROM t $$;",
          "CREATE FUNCTION g(p int[]) RETURNS void LANGUAGE sql AS $$ DELETE FROM t $$;",
          "CREATE FUNCTION k(int[], double precision) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
          "-- CREATE OR REPLACE FUNCTION public.h(x text) RETURNS void AS $$ UPDATE t SET a = 1 $$;",
        ].join("\n")
      )
      writeFileSync(
        join(dir, "002_b.sql"),
        [
          "CREATE OR REPLACE FUNCTION f(p_khac UUID, OUT ket integer) LANGUAGE plpgsql AS $chk$ BEGIN UPDATE t SET a = 1 WHERE true; END $chk$;",
          "DROP FUNCTION IF EXISTS public.g(integer);",
          "CREATE OR REPLACE FUNCTION public.k(p_a integer[], p_b float8 DEFAULT 0) RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;",
        ].join("\n")
      )
      const ham = hamDangChay(dir)
      expect(Array.from(ham.keys()).sort()).toEqual(["public.f(UUID)", "public.g(INTEGER[])", "public.k(INTEGER[],DOUBLE PRECISION)"])
      expect(ham.get("public.f(UUID)")!.file).toBe("002_b.sql")
      expect(ham.get("public.k(INTEGER[],DOUBLE PRECISION)")!.than.trim()).toBe("SELECT 2")
      expect(cauThieuWhere(ham.get("public.f(UUID)")!.than)).toEqual([])
      expect(cauThieuWhere(ham.get("public.g(INTEGER[])")!.than)).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  const HAM = hamDangChay()

  /** ⚠ Không cắt ra được thân hàm thì chốt dưới xanh vì rỗng, không vì đúng. */
  it("đọc được thân hàm bọc bằng mọi kiểu thẻ dollar ($$, $fn$…)", () => {
    expect(HAM.size, "không cắt ra thân hàm nào — phép quét hỏng").toBeGreaterThan(150)
    const sua = HAM.get("public.sua_phieu_nhap(UUID,JSONB,JSONB)")
    expect(sua?.file, "bản đang chạy của sua_phieu_nhap phải là bản đã vá").toBe("236_sua_phieu_nhap_safeupdate.sql")
    expect(HAM.get("public.cancel_supplier_return(UUID,TEXT)")?.file).toBe("235_sua_phieu_nhap_da_ban.sql")
  })

  it("không hàm nào có UPDATE / DELETE thiếu WHERE", () => {
    const bad: string[] = []
    HAM.forEach((h, key) => {
      for (const c of cauThieuWhere(h.than)) bad.push(`${h.file} · ${key}: ${c.cau.slice(0, 140)}`)
    })
    expect(
      bad,
      'Supabase (safeupdate) từ chối các câu này khi gọi qua API — "UPDATE/DELETE requires a WHERE clause". ' +
        "Thêm WHERE đúng nghĩa (hoặc WHERE true nếu thật sự sửa cả bảng tạm):\n  " +
        bad.join("\n  ")
    ).toEqual([])
  })
})

/** Thân hàm đang chạy trên Postgres thử (`pg_proc.prosrc`); không có Postgres thử (máy CI) → null, bỏ qua. */
function prosrcTrenDbThu(): Map<string, string> | null {
  try {
    const out = execFileSync(
      "psql",
      [
        "-h", HOST, "-p", PORT, "-U", "postgres", "-d", DB, "-At", "-v", "ON_ERROR_STOP=1",
        "-F", "\x1f", "-R", "\x1e",
        "-c",
        "SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')', p.prosrc " +
          "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang " +
          "WHERE n.nspname = 'public' AND l.lanname IN ('plpgsql', 'sql')",
      ],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
    )
    const ds = new Map<string, string>()
    for (const r of out.split("\x1e")) {
      const [ten, src] = r.split("\x1f")
      if (ten && src !== undefined) ds.set(ten.trim(), src)
    }
    return ds.size > 0 ? ds : null
  } catch {
    return null
  }
}

const DB_THU = prosrcTrenDbThu()

describe.skipIf(!DB_THU)("bản đang chạy trên Postgres thử (pg_proc) — bắt cả hàm vá bằng EXECUTE", () => {
  it("không hàm nào có UPDATE / DELETE thiếu WHERE", () => {
    const bad: string[] = []
    DB_THU!.forEach((src, ten) => {
      for (const c of cauThieuWhere(src)) bad.push(`${ten}: ${c.cau.slice(0, 140)}`)
    })
    expect(
      bad,
      `Trên ${DB} — chưa chạy migration mới nhất, hoặc có câu UPDATE / DELETE không WHERE (Supabase sẽ từ chối):\n  ` +
        bad.join("\n  ")
    ).toEqual([])
  })
})
