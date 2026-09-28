/** Quét luồng 28/09/2026 — khoá ghi thẳng từ trình duyệt (mig 214). Chạy thật: scripts/sql/quet/*.sql. */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const m = readFileSync("supabase/migrations/214_khoa_ghi_thang_tien_phieu_tra.sql", "utf8")

describe("mig 214", () => {
  it("chỉ chặn vai trình duyệt — RPC (vai chủ sở hữu) đi qua", () => {
    expect(m).toContain("SELECT current_user IN ('authenticated', 'anon')")
    expect(m.match(/IF NOT public\._la_trinh_duyet\(\) THEN\s+RETURN COALESCE\(NEW, OLD\);/g)?.length).toBe(5)
  })
  it("công nợ: màn chỉ thêm / sửa số / xoá nợ đầu kỳ chưa thu; paid không ai sửa thẳng", () => {
    expect(m).toMatch(/IF NEW\.paid IS DISTINCT FROM OLD\.paid/)
    expect(m).toMatch(/NEW\.amount IS DISTINCT FROM OLD\.amount AND NOT COALESCE\(OLD\.opening_balance, false\)/)
    expect(m).toMatch(/IF NOT COALESCE\(OLD\.opening_balance, false\) OR COALESCE\(OLD\.paid, 0\) <> 0 THEN/)
  })
  it("tiền thu: chỉ xác nhận; phiếu thu chỉ chờ → đã nhận", () => {
    expect(m).toContain("ARRAY['verified_by', 'verified_at']")
    expect(m).toContain("OLD.status = 'pending' AND NEW.status = 'received'")
  })
  it("phiếu trả: lập ở Nháp, trạng thái chỉ qua RPC, dòng chỉ sửa khi Nháp, thành tiền máy chủ tính", () => {
    expect(m).toContain("IF NEW.status IS DISTINCT FROM 'draft' THEN")
    expect(m).toMatch(/IF NEW\.status IS DISTINCT FROM OLD\.status THEN\s+RAISE EXCEPTION 'PHIEU_TRA_KHOA/)
    expect(m).toContain("NEW.line_total := round(COALESCE(NEW.quantity, 0) * COALESCE(NEW.unit_price, 0) * (1 + COALESCE(NEW.vat_rate, 0)));")
  })
  it("invoiced_qty và dòng hoá đơn thuộc đơn", () => {
    expect(m).toContain("DON_KHOA: số đã xuất chỉ đổi khi lập / huỷ hóa đơn")
    expect(m).toContain("BAD_LINE: dòng hóa đơn không thuộc đơn này hoặc sai sản phẩm")
    expect(readFileSync("scripts/sql/kham-so-that.sql", "utf8")).toContain("Mig 214")
  })
})
