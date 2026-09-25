import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "rà soát lại toàn bộ cho tao tại sao doanh số nhân viên lại lệch
 *   so với công nợ nhân viên". Mig 194 — kịch bản chạy thật trên Postgres ghi ở khối VÌ SAO;
 *   chốt ở đây giữ các chỗ đã vá khỏi bị viết ngược lại.
 */
const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = doc("supabase/migrations/194_nguoi_dung_ten_cong_no_khop_doanh_so.sql")
const than = (ten: string) => {
  const i = MIG.indexOf(`FUNCTION public.${ten}(`)
  return MIG.slice(i, MIG.indexOf("$$;", i) > 0 && ten.startsWith("receivables") ? MIG.indexOf("$$;", i) : MIG.indexOf("$fn$;", i))
}

describe("mig 194 — người đứng tên công nợ = người của doanh số", () => {
  it("tính lại công nợ HĐ đồng bộ luôn người + khách", () => {
    const f = than("_wf2b_recompute_receivable")
    const upd = f.slice(f.indexOf("UPDATE receivables"), f.indexOf("WHERE id = v_id"))
    expect(upd).toContain("sales_user_id = v.sales_user_id")
    expect(upd).toContain("customer_id = v.customer_id")
  })
  it("phiếu trả gắn HĐ theo người HĐ; HĐ đổi người thì nợ + phiếu trả đổi theo", () => {
    expect(MIG).toMatch(/SELECT si\.sales_user_id FROM sales_invoices si WHERE si\.id = p_invoice\),\s+p_hien_tai,/)
    expect(MIG).toContain("BEFORE INSERT OR UPDATE OF sales_user_id, invoice_id, order_id, customer_id ON public.returns")
    expect(MIG).toContain("AFTER UPDATE OF sales_user_id ON public.sales_invoices")
    expect(MIG).toContain("AFTER UPDATE OF sales_user_id ON public.returns")
    expect(MIG).toContain("RETURN_SELLER_FOLLOWS_INVOICE")
  })
  it("Công nợ theo NV không kẹp 0, không bỏ dòng chưa gán NV", () => {
    const f = than("receivables_by_rep")
    expect(f).not.toContain("GREATEST(0, COALESCE(rc.amount")
    expect(f).not.toContain("rc.sales_user_id IS NOT NULL")
    expect(f).toContain("(Chưa gán nhân viên)")
    expect(than("receivables_summary")).not.toContain("GREATEST(0, COALESCE(amount")
  })
  it("hàm nội bộ bị thu quyền; kết thúc bằng NOTIFY + SELECT", () => {
    for (const f of ["_nguoi_cua_phieu_tra(uuid, uuid, uuid, uuid, uuid)", "_phieu_tra_theo_nguoi_hoa_don()",
      "_phieu_tra_doi_nguoi_cong_no()", "_hoa_don_doi_nguoi()", "_wf2b_recompute_receivable(uuid)"]) {
      expect(MIG).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`)
    }
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(doc("scripts/sql/kham-so-that.sql")).toContain("Mig 194")
  })
})
