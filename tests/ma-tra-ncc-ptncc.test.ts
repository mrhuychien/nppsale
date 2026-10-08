import { describe, it, expect } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"
import { docMaCuTraNcc } from "@/lib/purchasing/ma-tra-ncc"

/**
 * PHIẾU TRẢ HÀNG NCC ĐÁNH SỐ PTNCC-xxxx (mig 240) — chủ nhà 08/10/2026: "Đổi đầu PTNCC", chọn "Đánh lại cả phiếu cũ".
 * Bộ thử chạy thật: scripts/sql/thu-240-ma-tra-ncc-ptncc.sql (7/7 dưới safeupdate; đã thử phá: bỏ phần sửa chỗ chép
 * mã cũ → đỏ, đánh số theo id thay vì thứ tự lập → đỏ).
 */
const GOC = resolve(__dirname, "..")
const MIG = readFileSync(resolve(GOC, "supabase/migrations/240_ma_tra_ncc_ptncc.sql"), "utf-8")
const HAM = hamDangChay()

describe("mig 240: số phiếu trả NCC", () => {
  it("mã = PTNCC- + số chạy qua _so_chung_tu (không cắt khi qua 9999)", () => {
    const h = HAM.get("public._ma_tra_ncc(INTEGER)")
    expect(h?.file).toBe("240_ma_tra_ncc_ptncc.sql")
    expect(h!.than).toContain("'PTNCC-' || public._so_chung_tu(p_seq)")
  })

  it("đánh số lúc LẬP và luôn ghi mã theo số — nhánh sinh TH-… của complete_supplier_return không còn chạy tới", () => {
    expect(MIG).toMatch(/CREATE TRIGGER trg_danh_so_tra_ncc\s+BEFORE INSERT OR UPDATE OF return_code, return_seq ON public\.supplier_returns/)
    const t = HAM.get("public._danh_so_tra_ncc()")!
    expect(t.than).toContain("pg_advisory_xact_lock(hashtext('supplier_returns:' || NEW.org_id::text))")
    expect(t.than).toContain("NEW.return_code := public._ma_tra_ncc(NEW.return_seq);")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._danh_so_tra_ncc() FROM PUBLIC, anon, authenticated;")
  })

  it("phiếu cũ đánh lại theo thứ tự lập, giữ mã cũ, sửa số chứng từ công nợ NCC + ghi chú phiếu kho", () => {
    expect(MIG).toContain("row_number() OVER (PARTITION BY s.org_id ORDER BY s.created_at, s.id)")
    expect(MIG).toContain("return_code_cu = COALESCE(s.return_code_cu, s.return_code)")
    expect(MIG).toMatch(/UPDATE payables p\s+SET invoice_number = CASE WHEN p\.invoice_number = s\.return_code_cu THEN s\.return_code/)
    expect(MIG).toMatch(/UPDATE stock_entries e\s+SET notes = replace\(e\.notes, s\.return_code_cu, s\.return_code\)/)
  })
})

/** Mã cũ chỉ đọc RIÊNG — sổ chưa chạy 240 mà câu đọc chính đòi `return_code_cu` là cả màn trắng. */
describe("mã cũ TH-… đọc riêng", () => {
  const tep = (d: string): string[] =>
    readdirSync(resolve(GOC, d), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? tep(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(d, e.name)] : []
    )

  it("chỉ docMaCuTraNcc đọc return_code_cu", () => {
    const vp = tep("src").filter((f) => f !== join("src", "lib", "purchasing", "ma-tra-ncc.ts"))
      .filter((f) => readFileSync(resolve(GOC, f), "utf-8").includes("return_code_cu"))
    expect(vp).toEqual([])
  })

  it("danh sách tìm được theo mã cũ; chi tiết hiện mã cũ", () => {
    const ds = readFileSync(resolve(GOC, "src/app/(dashboard)/purchase-returns/page.tsx"), "utf-8")
    expect(ds).toContain("viMatchAllWords(t, r.return_code, maCu.get(r.id), r.supplier?.name, r.supplier?.code)")
    expect(ds).toContain("docMaCuTraNcc(supabase, res.rows.map((r) => r.id))")
    const ct = readFileSync(resolve(GOC, "src/app/(dashboard)/purchase-returns/[id]/page.tsx"), "utf-8")
    expect(ct).toContain('label="Mã cũ (trên giấy cũ)"')
  })

  it("docMaCuTraNcc: đọc theo lô 200 mã; lỗi (sổ chưa có cột) thì trả rỗng, không ném", async () => {
    const goi: number[] = []
    const sb = (loi: boolean) => ({
      from: () => ({
        select: () => ({
          in: (_c: string, ids: string[]) => {
            goi.push(ids.length)
            return Promise.resolve(loi
              ? { data: null, error: { message: "column return_code_cu does not exist" } }
              : { data: ids.map((id) => ({ id, return_code_cu: id === "r1" ? "TH-250901-080000" : null })), error: null })
          },
        }),
      }),
    })
    const ids = ["r1", ...Array.from({ length: 250 }, (_, i) => `x${i}`)]
    const m = await docMaCuTraNcc(sb(false) as never, ids)
    expect(m.get("r1")).toBe("TH-250901-080000")
    expect(m.size).toBe(1)
    expect(goi).toEqual([200, 51])
    expect((await docMaCuTraNcc(sb(true) as never, ["r1"])).size).toBe(0)
  })
})

/** Chạy thật trên Postgres thử nếu có (máy CI không có → bỏ qua). */
function hoiDbThu(sql: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 }
    ).trim()
  } catch {
    return null
  }
}
const MA_DB = hoiDbThu("SELECT concat_ws('|', public._ma_tra_ncc(12), public._ma_tra_ncc(12345))")

describe.skipIf(!MA_DB)("mã phiếu trả NCC trên Postgres thử", () => {
  it("PTNCC-0012 · PTNCC-12345", () => {
    expect(MA_DB).toBe("PTNCC-0012|PTNCC-12345")
  })
})
