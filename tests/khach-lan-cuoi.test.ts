import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { docLanCuoi, tachLanCuoi } from "@/lib/customers/lan-cuoi"

/** ⚠ Chủ nhà 27/09/2026: "kiểm tra sao danh sách khách hàng load lâu vậy?" */
describe("đơn / lần ghé gần nhất của một trang khách — một lượt (mig 204)", () => {
  it("tách dòng RPC; khách chưa có đơn / chưa ghé thì không có mục", () => {
    const r = tachLanCuoi([
      { customer_id: "a", order_code: "DH1", order_date: "2026-09-20", order_total: "150000", visit_date: null, check_in_at: null, visit_result: null, visit_user_name: null },
      { customer_id: "b", order_code: null, order_date: null, order_total: null, visit_date: "2026-09-21", check_in_at: null, visit_result: "no_order", visit_user_name: "Hiền" },
    ])
    expect(r.don).toEqual({ a: { order_code: "DH1", order_date: "2026-09-20", total: 150000 } })
    expect(r.ghe).toEqual({ b: { visit_date: "2026-09-21", check_in_at: null, result: "no_order", sales_user_name: "Hiền" } })
  })
  it("sổ chưa chạy mig 204 → null, không lỗi (màn về cách đọc cũ); lỗi khác thì báo", async () => {
    const thieu = await docLanCuoi(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.khach_lan_cuoi" } }), ["a"])
    expect(thieu).toEqual({ ket: null, loi: null })
    const hong = await docLanCuoi(async () => ({ data: null, error: { code: "57014", message: "timeout" } }), ["a"])
    expect(hong).toEqual({ ket: null, loi: "timeout" })
    let goi = 0
    await docLanCuoi(async (fn, args) => (goi++, expect(fn).toBe("khach_lan_cuoi"), expect(args).toEqual({ p_ids: ["a", "b"] }), { data: [], error: null }), ["a", "b"])
    expect(goi).toBe(1)
  })
  it("màn khách hàng gọi RPC trước, cách cũ chỉ là đường lùi; mig 204 đúng luật", () => {
    const man = readFileSync(resolve(__dirname, "../src/app/(dashboard)/customers/page.tsx"), "utf-8")
    expect(man).toContain("docLanCuoi((fn, args) => supabase.rpc(fn, args), ids)")
    expect(man).toContain("if (r.ket || r.loi) return r")
    const mig = readFileSync(resolve(__dirname, "../supabase/migrations/204_khach_lan_cuoi.sql"), "utf-8")
    expect(mig).toContain("SECURITY INVOKER")
    expect(mig).toContain("LIMIT 1")
    expect(mig).toContain("NOTIFY pgrst, 'reload schema';")
    expect(readFileSync(resolve(__dirname, "../scripts/sql/kham-so-that.sql"), "utf-8")).toContain("khach_lan_cuoi(uuid[])")
  })
})
