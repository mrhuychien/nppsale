import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(p, "utf8")
const code = (s: string) => s.replace(/^\s*--.*$/gm, "")

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Xem lại mẫu in hoá đơn từ pos. Mất hàng đổi trả."
 *   Đo trên Postgres thật: xuất hóa đơn kèm hàng trả thêm tại chỗ thì phiếu trả
 *   dựng sẵn `invoice_id` nên câu gắn của `post_invoice` (`WHERE ret.invoice_id
 *   IS NULL`) bỏ qua nó — phiếu kẹt 'draft', công nợ không trừ, bản in mất khối
 *   hàng đổi / trả.
 */
describe("mig 189 — hàng đổi / trả thêm lúc xuất hóa đơn", () => {
  const C = code(read("supabase/migrations/189_hang_tra_luc_xuat_hoa_don.sql"))
  const fn = C.slice(C.indexOf("CREATE OR REPLACE FUNCTION public._pending_return_for"), C.indexOf("COMMENT ON FUNCTION"))

  it("phiếu mới dựng CHƯA gắn hóa đơn — để post_invoice gắn và đẩy submitted", () => {
    expect(fn).toMatch(/VALUES \(o\.org_id, o\.id, o\.customer_id, auth\.uid\(\), NULL, 'draft', 'damaged'\)/)
    expect(fn).not.toMatch(/auth\.uid\(\), p_invoice_id, 'draft'/)
  })

  it("chỉ dùng lại phiếu chưa gắn hoặc gắn đúng hóa đơn này", () => {
    expect(fn).toContain("AND (r.invoice_id IS NULL OR r.invoice_id = p_invoice_id)")
  })

  it("chữa phiếu đã kẹt rồi tính lại công nợ theo hóa đơn", () => {
    expect(C).toMatch(/SET status = 'submitted', credit_with_invoice = true/)
    expect(C).toContain("AND ret.created_at = si.created_at")
    expect(C).toContain("AND si.status = 'posted'")
    expect(C).toContain("PERFORM public._wf2b_recompute_receivable(r.invoice_id);")
  })

  it("REVOKE, NOTIFY + SELECT, có dòng khám sổ", () => {
    expect(C).toContain("REVOKE ALL ON FUNCTION public._pending_return_for(uuid, uuid) FROM PUBLIC, anon, authenticated;")
    expect(C).toContain("NOTIFY pgrst, 'reload schema';")
    expect(read("scripts/sql/kham-so-that.sql")).toContain("Mig 189")
  })
})

describe("bản in hóa đơn POS là nguyên mẫu hóa đơn thường", () => {
  it("/in/hoa-don dùng đúng trang in hóa đơn", () => {
    expect(read("src/app/in/hoa-don/[id]/page.tsx")).toContain(
      'export { default } from "@/app/(dashboard)/sales-invoices/[id]/print/page"'
    )
  })
})
