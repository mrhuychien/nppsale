/**
 * SỬA HOÁ ĐƠN GIỮ HỆ SỐ QUY ĐỔI CỦA TỜ CŨ — chủ nhà 16/10/2026: "đổi hệ số quy đổi trong danh mục (vd thùng 24 → 20) rồi
 * Sửa một hoá đơn cũ, thì tờ mới lấy hệ số mới chứ không giữ số cũ" (mig 247).
 * Lỗi gốc: mig 174 cho `post_invoice` tự tra hệ số theo danh mục (đúng cho HĐ mới) mà Sửa HĐ cũng đi qua `post_invoice` →
 * tờ sửa lấy hệ số danh mục lúc sửa: huỷ tờ cũ trả 48 lon về kho, tờ mới chỉ xuất 40.
 * SQL thật: scripts/sql/thu-247-sua-hd-giu-he-so.sql (kho trước / sau Sửa HĐ, số đã xuất của dòng đơn, đổi đơn vị, HĐ mới).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { hamDangChay } from "./helpers/sql-ham-dang-chay"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/247_sua_hd_giu_he_so_to_cu.sql")

describe("mig 247 — Sửa HĐ giữ hệ số tờ cũ", () => {
  it("VÌ SAO trích lời chủ nhà; hàm nội bộ chặn mọi vai; NOTIFY + câu tóm tắt", () => {
    expect(MIG).toContain('chủ nhà 16/10/2026: "sửa nốt … đổi hệ số quy đổi trong danh mục (vd thùng 24 → 20) rồi Sửa một hoá đơn cũ')
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public._chuan_he_so_dong_hoa_don(jsonb, uuid) FROM PUBLIC, anon, authenticated;")
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG).toMatch(/AS dong_sua_hd_lech_he_so_truoc_day;\s*$/)
  })
  it("thứ tự tra: đơn vị cơ sở = 1 → hệ số CHỤP trên tờ cũ (đúng mặt hàng + đơn vị) → danh mục → số gửi lên (đơn vị đã gỡ)", () => {
    const h = Array.from(hamDangChay().entries()).find(([k]) => k.startsWith("public._chuan_he_so_dong_hoa_don(") && k.includes(","))?.[1]
    expect(h?.file).toBe("247_sua_hd_giu_he_so_to_cu.sql")
    expect(h!.than).toMatch(/WHEN ord\.l->>'unit_name' = p\.base_unit THEN 1::numeric\s+WHEN cu\.he_so IS NOT NULL THEN cu\.he_so\s+WHEN pu\.conversion IS NOT NULL THEN pu\.conversion::numeric/)
    expect(h!.than).toMatch(/sil\.invoice_id = p_hd_cu\s+AND sil\.product_id = p\.id\s+AND sil\.unit_name = ord\.l->>'unit_name'/)
  })
  it("tờ cũ đi qua cờ phiên do reissue_invoice đặt rồi gỡ — post_invoice không đọc reissue_of của tải trọng để lấy hệ số", () => {
    expect(MIG).toContain("v_lines := public._chuan_he_so_dong_hoa_don(v_lines, NULLIF(current_setting(''npp.he_so_tu_hd'', true), '''')::uuid);")
    expect(MIG).toContain("PERFORM set_config(''npp.he_so_tu_hd'', p_invoice_id::text, true);")
    expect(MIG).toContain("PERFORM set_config(''npp.he_so_tu_hd'', '''', true);")
    // Vá chuỗi bản đang chạy, đúng một chỗ mỗi hàm — không chép lại thân hàm (bài học mig 149).
    expect(MIG.match(/IF v_n <> 1 THEN/g)).toHaveLength(2)
  })
  it("khám sổ có dòng 86; luật ghi ở CLAUDE.md", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 86, 'Mig 247 (Sửa HĐ giữ hệ số quy đổi của tờ cũ)'")
    expect(read("CLAUDE.md")).toContain("**Sửa HĐ giữ hệ số của tờ cũ** (chủ nhà 16/10/2026, mig 247")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(__dirname, "..", tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-247-sua-hd-giu-he-so.sql")
describe.skipIf(!BO_THU)("mig 247 trên Postgres thử", () => {
  it("10/10 dòng đạt (Sửa HĐ giữ 24 dù danh mục 20, kho không lệch, đổi đơn vị tra danh mục, HĐ mới theo danh mục)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("10|10|0")
  })
})
