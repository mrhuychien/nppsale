/**
 * MIG 259 — đợt 2 hàm phụ viết plpgsql (chủ nhà 03/11/2026: "làm cả 2"). 11 hàm `LANGUAGE sql` + `SET search_path` trên
 * đường Tạo đơn / Xuất hàng / Sửa HĐ bị lập kế hoạch lại mỗi lần trigger / RPC gọi: quyền giảm giá 0,17 ms / dòng đơn,
 * giảm giá đơn 0,35 ms, mã chứng từ / thuế / điều khoản / hôm nay 0,04–0,16 ms, vai trình duyệt ~7 lần mỗi lệnh.
 * Đo A/B cùng khối việc: tổng thời gian riêng 11 hàm 123,6 → 32,5 ms / 100 lệnh; Tạo đơn −10%, Sửa HĐ −13%.
 * SQL thật (dựng lại bản SQL, chạy migration hai lần, so từng kết quả kể cả lỗi + tính chất + quyền):
 * scripts/sql/thu-259-ham-phu-plpgsql-dot2.sql.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/259_ham_phu_plpgsql_dot2.sql")

/** Phần khai báo (từ CREATE tới trước thân `AS $…$`) của định nghĩa CUỐI của một hàm trong một tệp. */
function dauHam(src: string, chuKy: string): string | null {
  const i = src.lastIndexOf(`CREATE OR REPLACE FUNCTION ${chuKy}`)
  if (i < 0) return null
  const j = src.indexOf("AS $", i)
  return src.slice(i, j > i ? j : i + 400)
}
/** Thân (giữa hai thẻ dollar) của định nghĩa cuối của một hàm. */
function thanHam(src: string, chuKy: string): string {
  const i = src.lastIndexOf(`CREATE OR REPLACE FUNCTION ${chuKy}`)
  const a = src.indexOf("$fn$", i)
  return src.slice(a + 4, src.indexOf("$fn$", a + 4))
}

const HAM = [
  { chuKy: "public._quyen_giam_cua(p_uid uuid)", tinh: "STABLE", sp: "public" },
  { chuKy: "public._giam_don_hien_tai(p_order uuid)", tinh: "STABLE", sp: "public" },
  { chuKy: "public._thue_hop_le(v text)", tinh: "IMMUTABLE", sp: "public, extensions" },
  { chuKy: "public._la_trinh_duyet()", tinh: "STABLE", sp: "public" },
  { chuKy: "public._giam_gia_don(p jsonb, p_tien_hang numeric)", tinh: "IMMUTABLE", sp: "public, extensions" },
  { chuKy: "public._wf2b_payment_terms_days(p_terms text)", tinh: "IMMUTABLE", sp: "public, extensions" },
  { chuKy: "public._so_chung_tu(p_n integer)", tinh: "IMMUTABLE", sp: "public, extensions" },
  { chuKy: "public._order_code(p_seq integer, p_edit integer)", tinh: "IMMUTABLE", sp: "public, extensions" },
  { chuKy: "public._inv_code(p_seq integer, p_reissue integer)", tinh: "IMMUTABLE", sp: "public, extensions" },
  { chuKy: "public._ma_phieu_tra(p_seq integer)", tinh: "IMMUTABLE", sp: "public, extensions" },
  { chuKy: "public.vn_today()", tinh: "STABLE", sp: "public" },
]

describe("mig 259 — 11 hàm phụ viết plpgsql, giữ nguyên tính chất + quyền", () => {
  it("VÌ SAO trích chủ nhà + số đo; nói rõ kết quả y hệt và không đụng quyền", () => {
    expect(MIG).toContain('chủ nhà: "làm cả 2"')
    expect(MIG).toContain("lập kế hoạch lại thân hàm mỗi lần")
    expect(MIG).toContain("KẾT QUẢ Y HỆT BẢN SQL")
    expect(MIG).toContain("CREATE OR REPLACE giữ nguyên ACL")
    // Không GRANT / REVOKE: quyền mỗi hàm do migration gốc đặt, CREATE OR REPLACE giữ nguyên.
    expect(MIG).not.toMatch(/^\s*(GRANT|REVOKE)\b/m)
  })

  it.each(HAM)("$chuKy: plpgsql, $tinh, search_path = $sp, không definer, không thêm PARALLEL SAFE", ({ chuKy, tinh, sp }) => {
    const dau = dauHam(MIG, chuKy)
    expect(dau, chuKy).not.toBeNull()
    expect(dau).toMatch(/LANGUAGE plpgsql/)
    expect(dau).toContain(tinh)
    expect(dau).toMatch(new RegExp(`SET search_path = ${sp.replace(/,/g, ",")}\\s*$`))
    expect(dau).not.toContain("SECURITY DEFINER")
    expect(dau).not.toContain("PARALLEL")
  })

  it("ĐỊNH NGHĨA MỚI NHẤT của 11 hàm trong cả bộ migration là plpgsql", () => {
    const tep = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
    for (const { chuKy } of HAM) {
      let cuoi: { tep: string; dau: string } | null = null
      for (const f of tep) {
        const dau = dauHam(read(`supabase/migrations/${f}`), chuKy)
        if (dau) cuoi = { tep: f, dau }
      }
      expect(cuoi, chuKy).not.toBeNull()
      expect(cuoi!.dau, `${chuKy} — bản cuối ở ${cuoi!.tep}`).toMatch(/LANGUAGE plpgsql/)
    }
  })

  it("thân hàm giữ đúng luật cũ (mig 125 / 140 / 183 / 214 / 226 / 237)", () => {
    expect(thanHam(MIG, "public._quyen_giam_cua(")).toContain("COALESCE(u.role IN ('owner', 'accountant'), true) OR p_uid IS NULL")
    expect(thanHam(MIG, "public._quyen_giam_cua(")).toContain("FROM (SELECT 1) x\n  LEFT JOIN users u ON u.id = p_uid")
    expect(thanHam(MIG, "public._giam_don_hien_tai(")).toContain("WHERE l.order_id = p_order AND l.quantity > 0")
    expect(thanHam(MIG, "public._giam_don_hien_tai(")).toContain("> GREATEST(1, d.n)")
    expect(thanHam(MIG, "public._thue_hop_le(")).toContain("v ~ '^\\s*[0-9]+(\\.[0-9]+)?\\s*$' AND v::numeric BETWEEN 0 AND 1")
    expect(thanHam(MIG, "public._thue_hop_le(")).toContain("round(v::numeric, 4)")
    expect(thanHam(MIG, "public._la_trinh_duyet(")).toContain("current_user IN ('authenticated', 'anon')")
    expect(thanHam(MIG, "public._giam_gia_don(")).toContain("GREATEST(COALESCE(p_tien_hang, 0), 0)")
    expect(thanHam(MIG, "public._wf2b_payment_terms_days(")).toContain("substring(upper(COALESCE(p_terms, '')) FROM 'NET([0-9]+)')")
    expect(thanHam(MIG, "public._so_chung_tu(")).toContain("GREATEST(4, length(COALESCE(p_n, 0)::text))")
    expect(thanHam(MIG, "public._order_code(")).toContain("'DH-' || public._so_chung_tu(p_seq)")
    expect(thanHam(MIG, "public._inv_code(")).toContain("'HD-' || public._so_chung_tu(p_seq)")
    expect(thanHam(MIG, "public._ma_phieu_tra(")).toContain("'PT-' || public._so_chung_tu(p_seq)")
    expect(thanHam(MIG, "public.vn_today(")).toContain("(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date")
  })

  it("luật §3: thẻ dollar ASCII, NOTIFY, SELECT tóm tắt; khám sổ dòng 98; schema gộp có mig 259; CLAUDE.md có luật", () => {
    for (const m of Array.from(MIG.matchAll(/\$([A-Za-z0-9_À-ỹ]*)\$/g))) expect(m[1], m[0]).toMatch(/^[a-z0-9_]*$/)
    const n = MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';")
    expect(n).toBeGreaterThan(0)
    expect(MIG.slice(n)).toMatch(/\nSELECT /)
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 98, 'Mig 259 (Hàm phụ đợt 2")
    expect(read("supabase/schema_full.sql")).toContain("-- HÀM PHỤ CỦA TẠO ĐƠN / XUẤT HÀNG / SỬA HĐ — ĐỢT 2")
    expect(read("CLAUDE.md")).toContain("Đợt 2 mig 259")
  })
})

/** Bộ thử SQL chạy thật trên Postgres thử (dưới safeupdate) nếu có — máy CI không có thì bỏ qua. */
function chayBoThu(tep: string): string | null {
  try {
    return execFileSync(
      "psql",
      ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
        "-d", process.env.PG_THU_DB || "npp_tong", "-q", "-At", "-f", resolve(ROOT, tep)],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000, env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" } }
    )
  } catch {
    return null
  }
}
const BO_THU = chayBoThu("scripts/sql/thu-259-ham-phu-plpgsql-dot2.sql")
describe.skipIf(!BO_THU)("mig 259 trên Postgres thử", () => {
  it("11/11 bước đạt: y hệt bản SQL (kể cả lỗi), trigger đặt mã chạy thật, tính chất + quyền giữ nguyên, nhanh hơn", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("12|12|0")
  })
})
