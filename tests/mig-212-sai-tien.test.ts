/** Quét luồng 28/09/2026 — nhóm sai tiền 1, 2, 3, 6, 7 (mig 212). */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const m = readFileSync("supabase/migrations/212_sua_sai_tien_cong_no_phieu_thu.sql", "utf8")

describe("mig 212", () => {
  it("1. trạng thái công nợ: 'paid' chỉ khi khớp số; trả dư là 'open'", () => {
    expect(m).toMatch(/ELSIF abs\(v_p - COALESCE\(NEW\.amount, 0\)\) < 0\.01 THEN\s+NEW\.status := 'paid';\s+ELSIF v_p > NEW\.amount THEN[^;]*;?[\s\S]*?NEW\.status := 'open';/)
  })
  it("2. huỷ phiếu thu không kẹp paid về 0", () => {
    expect(m).toContain("ELSE\\s+GREATEST\\(0,")
    expect(m).toContain("'COALESCE(rc.paid, 0) - l.amount /* (mig 212)")
  })
  it("3. phiếu thu: dòng > 0 và số đồng chẵn", () => {
    expect(m).toContain("rl.amount > 0 AND rl.amount = round(rl.amount)")
    expect(m).toContain("IF v_use <> round(v_use) THEN")
  })
  it("6. phiếu trả cùng khách với hoá đơn; 7. hàng đổi chỉ của phiếu chưa bám HĐ", () => {
    expect(m).toContain("INVOICE_CUSTOMER_MISMATCH")
    expect(m).toMatch(/BEFORE INSERT OR UPDATE OF invoice_id, customer_id ON public\.returns/)
    expect(m).toContain("AND r.invoice_id IS NULL /* (mig 212)")
  })
  it("màn lập phiếu thu chỉ liệt kê khoản còn phải thu", () => {
    const s = readFileSync("src/app/(dashboard)/finance/cash-receipts/new/page.tsx", "utf8")
    expect(s.match(/filter\(\(r\) => outstandingOf\(r\) > 0\)/g)?.length).toBe(2)
    expect(readFileSync("scripts/sql/kham-so-that.sql", "utf8")).toContain("Mig 212")
  })
})
