import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Phiếu trả gắn một đơn chưa xuất hóa đơn -> phiếu trả hoàn thành phải
 *   gắn với 1 hóa đơn đã xuất chứ ko gắn với đơn hàng" · "Phiếu trả đã cấn trừ ở phiếu thu theo
 *   cách cũ -> rà lại" · "Phiếu trả cũ ở trạng thái approved -> rà lại".
 *   Kịch bản chạy thật trên Postgres (mig 200): phiếu theo đơn 1 HĐ tự gắn HĐ và trừ nợ; đơn
 *   không còn HĐ ghi sổ → chặn; phiếu cấn ở phiếu thu không trừ vào HĐ, huỷ cấn thì trừ lại.
 *   Đột biến: bỏ trigger → "không tự gắn HĐ"; bỏ điều kiện → "vẫn trừ hai lần".
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = doc("supabase/migrations/200_phieu_tra_hoan_thanh_gan_hd.sql")

describe("mig 200 — phiếu trả hoàn thành gắn hóa đơn đã xuất", () => {
  it("hoàn thành phiếu theo đơn: 1 HĐ → tự gắn; 0 / nhiều HĐ → chặn", () => {
    expect(MIG).toContain("BEFORE INSERT OR UPDATE OF status ON public.returns")
    expect(MIG).toMatch(/IF v_n = 0 THEN\s+RAISE EXCEPTION 'RETURN_NEEDS_INVOICE/)
    expect(MIG).toMatch(/ELSIF v_n > 1 THEN\s+RAISE EXCEPTION 'RETURN_NEEDS_INVOICE/)
    expect(MIG).toContain("NEW.invoice_id := v_hd;")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._phieu_tra_hoan_thanh_gan_hd() FROM PUBLIC, anon, authenticated;")
  })
  it("phiếu đã cấn ở phiếu thu kiểu cũ không trừ vào HĐ nữa; đổi cấn trừ → HĐ tính lại", () => {
    const f = MIG.slice(MIG.indexOf("FUNCTION public._wf2b_recompute_receivable("), MIG.indexOf("$fn$;", MIG.indexOf("FUNCTION public._wf2b_recompute_receivable(")))
    expect(f).toContain("AND r.applied_receipt_id IS NULL;")
    expect(f).toContain("sales_user_id = v.sales_user_id") // giữ luật mig 194
    expect(f).not.toMatch(/GREATEST\(0/) // giữ luật công nợ âm mig 186
    expect(MIG).toContain("AFTER UPDATE OF applied_receipt_id ON public.returns")
  })
  it("script quét dùng cùng công thức và liệt kê hai nhóm mới; khám sổ có dòng 39", () => {
    const k = doc("scripts/sql/kiem-phieu-tra.sql")
    expect(k).toContain("AND r.applied_receipt_id IS NULL")
    expect(k).toContain("Phiếu hoàn thành theo ĐƠN, chưa gắn HĐ")
    expect(k).toContain("Phiếu cấn ở phiếu thu kiểu cũ")
    expect(doc("scripts/sql/kham-so-that.sql")).toContain("Mig 200")
  })
  it("không còn trạng thái approved: CHECK chỉ nhận bốn trạng thái (câu tóm tắt đếm lại)", () => {
    expect(MIG).toContain("status NOT IN ('draft', 'submitted', 'completed', 'cancelled')")
  })
})
