/**
 * Chủ nhà 27/09/2026: "mig 182 lỗi … 182: không thấy đúng MỘT chỗ cập nhật công nợ trong
 * assign_doc_seller". Mig 194 viết lại `assign_doc_seller` (dòng nợ + phiếu trả đi theo qua trigger
 * `trg_hoa_don_doi_nguoi`) → chạy lại 182 phải BỎ QUA phần 1, và dòng khám 22 phải coi là xong.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const mig182 = readFileSync("supabase/migrations/182_nguoi_duoc_gan_theo_hoa_don.sql", "utf8")
const mig194 = readFileSync("supabase/migrations/194_nguoi_dung_ten_cong_no_khop_doanh_so.sql", "utf8")
const kham = readFileSync("scripts/sql/kham-so-that.sql", "utf8")

describe("mig 182 chạy lại sau mig 194", () => {
  it("hàm assign_doc_seller của 194 mang dấu trg_hoa_don_doi_nguoi, không còn câu neo của 182", () => {
    const ham = mig194.slice(mig194.indexOf("FUNCTION public.assign_doc_seller"))
    expect(ham).toContain("trg_hoa_don_doi_nguoi")
    expect(ham).not.toContain("UPDATE receivables SET sales_user_id = p_user WHERE invoice_id = p_id;")
  })

  it("phần 1 của 182 bỏ qua khi thấy dấu của 194 — TRƯỚC khi kiểm câu neo", () => {
    const p1 = mig182.slice(mig182.indexOf("DO $patch$"), mig182.indexOf("$patch$;"))
    const iBoQua = p1.search(/ELSIF position\('trg_hoa_don_doi_nguoi' IN v_src\) > 0 THEN\s+RAISE NOTICE/)
    expect(iBoQua).toBeGreaterThan(0)
    expect(iBoQua).toBeLessThan(p1.indexOf("RAISE EXCEPTION"))
  })

  it("dòng khám 22 chấp nhận trigger của 194 thay cho dấu (mig 182) trong assign_doc_seller", () => {
    const dong = kham.slice(kham.indexOf("public.reissue_invoice(uuid, jsonb)"), kham.indexOf("public.reissue_invoice(uuid, jsonb)") + 600)
    expect(dong).toMatch(/OR EXISTS \(SELECT 1 FROM pg_trigger WHERE tgname = 'trg_hoa_don_doi_nguoi'\)/)
  })
})
