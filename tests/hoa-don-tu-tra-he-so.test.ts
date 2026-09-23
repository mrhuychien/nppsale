import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const M174 = read("supabase/migrations/174_hoa_don_tu_tra_he_so.sql")

/**
 * ⚠ MIG 174 VÁ CHUỖI `post_invoice` BẰNG MỘT CÂU NEO. Đã đo trên Postgres
 *   16 (tải trọng "2 thùng hệ số 1" → kho trừ đúng 2 × 6; gỡ vá thì trừ
 *   sai). Chốt ở đây giữ cho câu neo còn đúng một lần trong thân hàm gốc
 *   — một migration sau đổi câu ấy là 174 nổ lúc chạy, không lặng lẽ bỏ qua.
 */
describe("mig 174: xuất hóa đơn tự tra hệ số quy đổi", () => {
  it("câu neo có đúng một lần trong post_invoice của mig 125", () => {
    const s = read("supabase/migrations/125_wf2b_invoice_rpcs.sql")
    const i = s.indexOf("CREATE OR REPLACE FUNCTION public.post_invoice(p jsonb)")
    const than = s.slice(i, s.indexOf("\n$$;", i))
    expect(than.split("v_lines := COALESCE(p->'lines', '[]'::jsonb);").length - 1).toBe(1)
    expect(M174).toContain("v_neo  text := 'v_lines := COALESCE(p->''lines'', ''[]''::jsonb);'")
  })

  it("chuẩn hoá chạy TRƯỚC phiếu xuất (vá ngay sau chỗ đọc v_lines)", () => {
    expect(M174).toMatch(/replace\(v_src, v_neo, v_neo \|\| [\s\S]*_chuan_he_so_dong_hoa_don\(v_lines\)/)
  })

  it("thứ tự tra: đơn vị cơ sở → product_units → số gửi lên", () => {
    const i = M174.indexOf("WHEN ord.l->>'unit_name' = p.base_unit THEN 1")
    const j = M174.indexOf("WHEN pu.conversion IS NOT NULL THEN pu.conversion")
    const k = M174.indexOf("ELSE COALESCE((ord.l->>'conversion_factor')::numeric, 1)")
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
    expect(k).toBeGreaterThan(j)
  })

  it("không chép lại thân hàm, và kiểm các miếng vá cũ còn nguyên", () => {
    expect(M174).not.toMatch(/CREATE OR REPLACE FUNCTION public\.post_invoice/)
    for (const m of ["_apply_return_adds", "reissue_of", "UPDATE returns ret"]) expect(M174).toContain(m)
  })

  it("khám sổ có dòng cho mig 174", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("_chuan_he_so_dong_hoa_don")
  })
})
