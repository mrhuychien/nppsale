/**
 * MIG 258 — hàm phụ của Xuất hàng + khoá tìm viết lại bằng plpgsql. Chủ nhà 03/11/2026 gửi bảng khám máy chủ sau khi khách
 * NPP báo "Loát chậm quá" · "Mất 3 phút": Xuất hàng TB 1.294 ms. Đo trên sổ thử cỡ thật: các hàm `LANGUAGE sql` có
 * `SET search_path` bị lập kế hoạch lại MỖI lần trigger / RPC gọi — khoá tìm 1,45 ms / lần (lại gọi khoa_tim hai lần mỗi giá
 * trị), số đã xuất của dòng đơn 0,45 ms / dòng HĐ, chuẩn hệ số 1,7 ms / lần Xuất hàng.
 * SQL thật (dựng lại bản SQL, chạy migration hai lần, so từng kết quả + đo): scripts/sql/thu-258-ham-phu-plpgsql.sql.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/258_ham_phu_plpgsql.sql")

/** Phần khai báo (từ CREATE tới trước thân `AS $…$`) của định nghĩa CUỐI của một hàm trong một tệp. */
function dauHam(src: string, chuKy: string): string | null {
  const i = src.lastIndexOf(`CREATE OR REPLACE FUNCTION ${chuKy}`)
  if (i < 0) return null
  const j = src.indexOf("AS $", i)
  return src.slice(i, j > i ? j : i + 400)
}

const HAM = [
  { chuKy: "public.khong_dau(p text)", tinh: "IMMUTABLE", songSong: true },
  { chuKy: "public.khoa_tim(p text)", tinh: "IMMUTABLE", songSong: true },
  { chuKy: "public.khoa_tim_ds(VARIADIC p text[])", tinh: "IMMUTABLE", songSong: true },
  { chuKy: "public._da_xuat_cua_dong_don(p_order_line_id uuid)", tinh: "STABLE", songSong: false },
  { chuKy: "public._chuan_he_so_dong_hoa_don(p_lines jsonb, p_hd_cu uuid)", tinh: "STABLE", songSong: false },
]

describe("mig 258 — năm hàm phụ viết plpgsql, giữ nguyên tính chất", () => {
  it("VÌ SAO trích chủ nhà + số đo; nói rõ kết quả y hệt và luật cho hàm phụ mới", () => {
    expect(MIG).toContain("VÌ SAO — chủ nhà 03/11/2026 gửi bảng khám máy chủ")
    expect(MIG).toContain('"Loát chậm quá" · "Mất 3 phút"')
    expect(MIG).toContain("1.294 ms / 460 lần")
    expect(MIG).toContain("thân hàm bị LẬP KẾ HOẠCH LẠI ở MỖI lần gọi")
    expect(MIG).toContain("KẾT QUẢ Y HỆT BẢN SQL")
    expect(MIG).toContain("Hàm phụ mới gọi từ trigger / plpgsql: viết plpgsql, ĐỪNG `LANGUAGE sql` + `SET search_path`")
  })

  it.each(HAM)("$chuKy: plpgsql, $tinh, search_path = public, không SECURITY DEFINER", ({ chuKy, tinh, songSong }) => {
    const dau = dauHam(MIG, chuKy)
    expect(dau, chuKy).not.toBeNull()
    expect(dau).toMatch(/LANGUAGE plpgsql/)
    expect(dau).not.toMatch(/LANGUAGE sql/)
    expect(dau).toContain(tinh)
    expect(dau).toContain("SET search_path = public")
    expect(dau).not.toContain("SECURITY DEFINER")
    if (songSong) expect(dau).toContain("PARALLEL SAFE")
  })

  it("ĐỊNH NGHĨA MỚI NHẤT của năm hàm trong cả bộ migration là plpgsql — migration sau đừng viết lại thành SQL", () => {
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

  it("khoá tìm giữ đủ các bước của viValueKey (cùng luật mig 205) và tính MỖI giá trị MỘT lần", () => {
    expect(MIG).toContain("regexp_split_to_array(public.khong_dau(p), '[^a-z0-9]+')")
    expect(MIG).toContain("regexp_replace(x, '(^|[a-z])0+(?=[0-9])', '\\1', 'g')")
    expect(MIG).toContain("CASE WHEN cardinality(tu) > 1 THEN ' ' || lien ELSE '' END")
    expect(MIG).toContain("CASE WHEN lien0 <> lien THEN ' ' || lien0 ELSE '' END")
    expect(MIG).toContain("replace(replace(normalize(COALESCE(p, ''), NFC), 'đ', 'd'), 'Đ', 'D')")
    expect(MIG).toContain("'[\\s\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+'")
    const ds = MIG.slice(MIG.indexOf("CREATE OR REPLACE FUNCTION public.khoa_tim_ds"), MIG.indexOf("GRANT EXECUTE ON FUNCTION public.khoa_tim_ds"))
    expect(ds.match(/public\.khoa_tim\(/g)).toHaveLength(1)
    expect(ds).not.toContain("LATERAL")
    // Trình duyệt: cùng ký tự ngắt từ, cùng phép bỏ số 0 — đổi một bên phải đổi cả hai.
    expect(read("src/lib/search.ts")).toContain("const NGAT_TU = /[^a-z0-9]+/")
    expect(read("src/lib/search.ts")).toContain('tu.replace(/(^|[a-z])0+(?=[0-9])/g, "$1")')
  })

  it("số đã xuất: chỉ tờ ghi sổ, hệ số 0 coi là 1, quy về đơn vị dòng đơn — đúng câu của mig 179", () => {
    const h = MIG.slice(MIG.indexOf("CREATE OR REPLACE FUNCTION public._da_xuat_cua_dong_don"))
    expect(h).toContain("sum(sil.quantity * COALESCE(NULLIF(sil.conversion_factor, 0), 1))")
    expect(h).toContain("/ COALESCE(NULLIF(max(sol.conversion_factor), 0), 1)")
    expect(h).toContain("JOIN sales_invoices si ON si.id = sil.invoice_id AND si.status = 'posted'")
  })

  it("chuẩn hệ số: thứ tự luật cơ sở → tờ cũ → danh mục → số gửi lên; dòng lạ giữ nguyên; tra theo chỉ mục", () => {
    const h = MIG.slice(MIG.indexOf("CREATE OR REPLACE FUNCTION public._chuan_he_so_dong_hoa_don"))
    const luat = h.slice(h.indexOf("CASE"), h.indexOf("END));"))
    const vi = ["WHEN v_dv = v_base THEN 1::numeric", "WHEN v_cu IS NOT NULL THEN v_cu", "WHEN v_qd IS NOT NULL THEN v_qd",
      "ELSE COALESCE((l->>'conversion_factor')::numeric, 1)"].map((s) => luat.indexOf(s))
    expect(vi.every((x) => x >= 0), luat).toBe(true)
    expect([...vi].sort((a, b) => a - b)).toEqual(vi)
    expect(h).toContain("jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS e(l, i) ORDER BY e.i")
    expect(h).toContain("kq := kq || jsonb_build_array(l);")
    expect(h).toContain("AND sil.conversion_factor > 0")
  })

  it("quyền như cũ: khoá tìm cho authenticated; hai hàm nội bộ của Xuất hàng thu khỏi trình duyệt (luật mig 166)", () => {
    for (const f of ["khong_dau(text)", "khoa_tim(text)", "khoa_tim_ds(text[])"]) {
      expect(MIG).toContain(`GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`)
    }
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public._da_xuat_cua_dong_don(uuid) FROM PUBLIC, anon, authenticated;")
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public._chuan_he_so_dong_hoa_don(jsonb, uuid) FROM PUBLIC, anon, authenticated;")
    expect(MIG).not.toMatch(/GRANT[^;]*_(da_xuat_cua_dong_don|chuan_he_so_dong_hoa_don)/)
  })

  it("luật §3: thẻ dollar ASCII, NOTIFY, SELECT tóm tắt; khám sổ dòng 97; schema gộp có mig 258; CLAUDE.md có luật", () => {
    // Thẻ dollar (bỏ qua chỗ giữ của format(): %1$I) — chữ có dấu là sai luật.
    for (const m of Array.from(MIG.matchAll(/\$([A-Za-z0-9_À-ỹ]*)\$/g))) expect(m[1], m[0]).toMatch(/^[a-z0-9_]*$/)
    const n = MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';")
    expect(n).toBeGreaterThan(0)
    expect(MIG.slice(n)).toMatch(/\nSELECT /)
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 97, 'Mig 258 (Hàm phụ của Xuất hàng + khoá tìm viết plpgsql")
    expect(read("supabase/schema_full.sql")).toContain("-- HÀM PHỤ CỦA XUẤT HÀNG + KHOÁ TÌM: VIẾT LẠI BẰNG PLPGSQL")
    expect(read("CLAUDE.md")).toContain("**Hàm phụ gọi từ trigger / plpgsql viết plpgsql**")
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
const BO_THU = chayBoThu("scripts/sql/thu-258-ham-phu-plpgsql.sql")
describe.skipIf(!BO_THU)("mig 258 trên Postgres thử", () => {
  it("13/13 bước đạt: y hệt bản SQL (khoá tìm, số đã xuất, chuẩn hệ số, lỗi báo ra), trigger dùng hàm mới, quyền, nhanh hơn", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("14|14|0")
  })
})
