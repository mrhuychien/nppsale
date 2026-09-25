import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * ⚠ LỖI THẬT (23/09/2026): màn POS Trả hàng đọc `returns.return_code` khi cột CHƯA CÓ
 *   → câu đọc hỏng 42703, mở lại phiếu trả đã lưu là màn không tải được.
 * ⚠ TỪ MIG 193 CỘT ĐÃ CÓ (chủ nhà 25/09/2026: "Phiếu trả có đánh số TH-"), nhưng mã
 *   nguồn hay lên trước migration. Luật: số phiếu chỉ đọc RIÊNG qua `docMaPhieuTra`
 *   (`src/lib/returns/ma-phieu.ts`) — không câu đọc chính nào của bảng `returns` đòi
 *   `return_code`, để sổ chưa chạy 193 thì chỉ mất số, màn vẫn chạy.
 */
const GOC = resolve(__dirname, "..")
const tep = (d: string): string[] =>
  readdirSync(resolve(GOC, d), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tep(join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(d, e.name)] : []
  )
const CHO_PHEP = join("src", "lib", "returns", "ma-phieu.ts")

describe("số phiếu trả TH- đọc riêng", () => {
  it("chỉ docMaPhieuTra đọc return_code của bảng returns", () => {
    const vp: string[] = []
    for (const f of tep("src")) {
      if (f === CHO_PHEP) continue
      const s = readFileSync(resolve(GOC, f), "utf-8")
      for (const m of Array.from(s.matchAll(/\.from\("returns"\)\s*\.select\(\s*(["`])([^"`]*)\1/g))) {
        if (/\breturn_code\b/.test(m[2].replace(/\([^)]*\)/g, ""))) vp.push(f)
      }
    }
    expect(vp).toEqual([])
    expect(readFileSync(resolve(GOC, CHO_PHEP), "utf-8")).toContain('.select("id, return_code")')
  })

  it("mig 193 thêm cột + trigger đánh số khi lập, số dạng TH-0001", () => {
    const mig = readFileSync(resolve(GOC, "supabase/migrations/193_ma_phieu_tra_th.sql"), "utf-8")
    expect(mig).toMatch(/ALTER TABLE public\.returns\s+ADD COLUMN IF NOT EXISTS return_seq\s+int,\s+ADD COLUMN IF NOT EXISTS return_code text/)
    expect(mig).toContain("SELECT 'TH-' || lpad(COALESCE(p_seq, 0)::text, 4, '0')")
    expect(mig).toContain("BEFORE INSERT ON public.returns")
    expect(mig).toContain("pg_advisory_xact_lock(hashtext('returns:' || NEW.org_id::text))")
    expect(mig).toContain("REVOKE EXECUTE ON FUNCTION public._danh_so_phieu_tra() FROM PUBLIC, anon, authenticated;")
    expect(mig).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_returns_org_seq")
  })
})
