/**
 * ĐIỂM BÁN CẦN CẬP NHẬT ĐỌC QUA RPC CÓ PHÂN TRANG (mig 253) — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm".
 * Màn /customers/missing-photos (nút "Cập nhật ảnh điểm bán" trên trang chủ NVBH) kéo CẢ sổ khách (≈570 KB với 3.000
 * khách) + cả bảng ảnh về rồi lọc trên máy, vẽ hết — đo điện thoại 4G: 5,9 giây. Nay máy chủ lọc + đếm ảnh + phân trang
 * (`khach_thieu_anh` / `khach_cho_duyet_anh`, SECURITY INVOKER — RLS tự lọc), máy chỉ nhận trang 50 dòng kèm tổng số;
 * sổ chưa chạy mig 253 (PostgREST báo PGRST202) → lùi về cách cũ. SQL thật: scripts/sql/thu-253-khach-thieu-anh.sql.
 * E2E: e2e/khach-thieu-anh.spec.ts (RPC giả ở e2e/fixture.mjs; tắt RPC giả qua POST /__tat_rpc của e2e/fake-supabase.mjs).
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import {
  TAB_THIEU, TRANG_THIEU_ANH, chuaCoRpc, docTrangChoDuyet, docTrangThieuAnh, ghepTrang,
} from "@/app/(dashboard)/customers/missing-photos/rpc-thieu-anh"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const MIG = read("supabase/migrations/253_khach_thieu_anh_rpc.sql")
const PAGE = read("src/app/(dashboard)/customers/missing-photos/page.tsx")
const dem = (s: string, tu: string) => s.split(tu).length - 1

type Loi = { message?: string; code?: string } | null
type Tra = { data: unknown; error: Loi }
/** Client giả: ghi lại từng lượt gọi RPC, trả theo hàm `tra`. */
function khachGia(tra: (fn: string, args: Record<string, unknown>) => Tra) {
  const goi: Array<{ fn: string; args: Record<string, unknown> }> = []
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      goi.push({ fn, args })
      return tra(fn, args)
    },
  }
  return { sb, goi }
}

describe("docTrangThieuAnh / docTrangChoDuyet — gọi RPC đúng tham số, đổi dòng thô về dòng màn", () => {
  it("gửi khach_thieu_anh(p_tab, p_offset, p_limit = 50); số về dạng chuỗi đổi thành số; tổng lấy từ total_count", async () => {
    const { sb, goi } = khachGia(() => ({
      data: [
        { id: "a", store_name: "A", address: null, phone: "0911", gps_lat: "20.85", gps_lng: null, photo_count: "0", total_count: "123" },
        { id: "b", store_name: "B", address: "2 Trần Phú", gps_lat: 21, gps_lng: 106, photo_count: 2, total_count: 123 },
      ],
      error: null,
    }))
    const kq = await docTrangThieuAnh(sb, "no_gps", 50)
    expect(TRANG_THIEU_ANH).toBe(50)
    expect(TAB_THIEU).toEqual(["all", "no_photo", "no_gps"])
    expect(goi).toEqual([{ fn: "khach_thieu_anh", args: { p_tab: "no_gps", p_offset: 50, p_limit: 50 } }])
    expect(kq.tong).toBe(123)
    expect(kq.rows).toEqual([
      { id: "a", store_name: "A", address: null, phone: "0911", gps_lat: 20.85, gps_lng: null, photoCount: 0, daDuyet: false, soYeuCau: 0 },
      { id: "b", store_name: "B", address: "2 Trần Phú", phone: null, gps_lat: 21, gps_lng: 106, photoCount: 2, daDuyet: false, soYeuCau: 0 },
    ])
  })

  it("tab khác chỉ hỏi tổng: p_limit 1 đi nguyên; trang rỗng ở offset 0 → tổng 0, ở offset > 0 → null (nơi gọi giữ số cũ)", async () => {
    const { sb, goi } = khachGia(() => ({ data: [], error: null }))
    expect(await docTrangThieuAnh(sb, "no_photo", 0, 1)).toEqual({ rows: [], tong: 0 })
    expect(await docTrangThieuAnh(sb, "all", 50)).toEqual({ rows: [], tong: null })
    expect(goi.map((g) => g.args.p_limit)).toEqual([1, 50])
  })

  it("docTrangChoDuyet gửi khach_cho_duyet_anh(p_offset, p_limit) — không có p_tab; da_duyet / so_yeu_cau về daDuyet / soYeuCau", async () => {
    const { sb, goi } = khachGia(() => ({
      data: [
        { id: "f", store_name: "F", photo_count: 1, da_duyet: true, so_yeu_cau: "1", total_count: 4 },
        { id: "b", store_name: "B", photo_count: 2, da_duyet: false, so_yeu_cau: 0, total_count: 4 },
      ],
      error: null,
    }))
    const kq = await docTrangChoDuyet(sb, 0)
    expect(goi).toEqual([{ fn: "khach_cho_duyet_anh", args: { p_offset: 0, p_limit: 50 } }])
    expect(kq.tong).toBe(4)
    expect(kq.rows.map((r) => [r.id, r.daDuyet, r.soYeuCau])).toEqual([["f", true, 1], ["b", false, 0]])
  })

  it("máy chủ báo lỗi → ném Error mang code (màn hiện lỗi, không lùi về cách cũ); data null → trang rỗng", async () => {
    const { sb } = khachGia(() => ({ data: null, error: { code: "42501", message: "permission denied for function khach_thieu_anh" } }))
    await expect(docTrangThieuAnh(sb, "all", 0)).rejects.toMatchObject({ code: "42501", message: "permission denied for function khach_thieu_anh" })
    const { sb: sb2 } = khachGia(() => ({ data: null, error: null }))
    expect(await docTrangChoDuyet(sb2, 0)).toEqual({ rows: [], tong: 0 })
  })
})

describe("chuaCoRpc — chỉ nhận 'sổ chưa có hàm' (lùi về cách cũ), không nuốt lỗi khác", () => {
  it("PGRST202 / 'Could not find the function' / 42883 'does not exist' / 404 → true", () => {
    expect(chuaCoRpc({ code: "PGRST202", message: "Could not find the function public.khach_thieu_anh(p_limit, p_offset, p_tab) in the schema cache" })).toBe(true)
    expect(chuaCoRpc(Object.assign(new Error("Could not find the function public.khach_cho_duyet_anh"), { code: undefined }))).toBe(true)
    expect(chuaCoRpc({ code: "42883", message: "function public.khach_thieu_anh(text, integer, integer) does not exist" })).toBe(true)
    expect(chuaCoRpc({ message: "Lỗi 404" })).toBe(true)
  })

  it("quyền, mạng, mã PostgREST khác, số dính liền, rỗng → false", () => {
    expect(chuaCoRpc({ code: "42501", message: "permission denied for function khach_thieu_anh" })).toBe(false)
    expect(chuaCoRpc(new Error("Failed to fetch"))).toBe(false)
    expect(chuaCoRpc({ code: "PGRST204", message: "Column not found" })).toBe(false)
    expect(chuaCoRpc({ message: "HTTP 4040" })).toBe(false)
    expect(chuaCoRpc(null)).toBe(false)
    expect(chuaCoRpc(undefined)).toBe(false)
  })
})

describe("ghepTrang — nối trang không lặp id (ranh giới trang dịch khi ai đó vừa chụp xong)", () => {
  it("giữ dòng cũ, chỉ thêm id chưa có, đúng thứ tự, không sửa mảng vào", () => {
    const cu = [{ id: "a", n: 1 }, { id: "b", n: 2 }]
    const moi = [{ id: "b", n: 9 }, { id: "c", n: 3 }]
    expect(ghepTrang(cu, moi)).toEqual([{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "c", n: 3 }])
    expect(ghepTrang([], moi)).toEqual(moi)
    expect(ghepTrang(cu, [])).toEqual(cu)
    expect(cu).toHaveLength(2)
  })
})

describe("page.tsx — đường RPC trước, lùi về cách cũ CHỈ khi sổ chưa có hàm", () => {
  it("tải qua taiRpc; lỗi 'chưa có hàm' lần đầu → taiCachCu; lỗi khác → báo lỗi", () => {
    expect(PAGE).toMatch(/await taiRpc\(t\)\s+cheDo\.current = "rpc"\s+setRpc\(true\)/)
    expect(PAGE).toMatch(
      /if \(cheDo\.current === null && chuaCoRpc\(err\)\) \{\s+cheDo\.current = "cu"\s+setRpc\(false\)\s+await taiCachCu\(\)\s+\} else \{\s+setError\(errorMessage\(err\)\)/
    )
  })

  it("trang đầu của tab đang xem 50 dòng; tab khác chỉ hỏi tổng (p_limit 1); người duyệt hỏi thêm Chờ duyệt 1 dòng", () => {
    expect(PAGE).toContain("docTrangThieuAnh(supabase, t, 0),")
    expect(PAGE).toContain("...khac.map((k) => docTrangThieuAnh(supabase, k, 0, 1)),")
    expect(PAGE).toContain("canApprove ? docTrangChoDuyet(supabase, 0, 1) : Promise.resolve(null),")
    expect(PAGE).toContain(
      "const [kq, ...dem] = await Promise.all([docTrangChoDuyet(supabase, 0), ...TAB_THIEU.map((k) => docTrangThieuAnh(supabase, k, 0, 1))])"
    )
    expect(PAGE).toContain("useEffect(() => { load(tab) }, [load, tab])")
    expect(PAGE).toMatch(/const demTab = \(t: Tab\): number \| undefined =>\s+rpc\s+\? tong\[t\]/)
  })

  it("Tải thêm: chỉ ở đường RPC khi tổng > đã hiện; nối trang từ offset = số dòng đang có, qua ghepTrang", () => {
    expect(PAGE).toContain("const conThem = rpc === true && (tong[tab] ?? 0) > shown.length")
    expect(PAGE).toContain("docTrangThieuAnh(supabase, tab, rows.length)")
    expect(PAGE).toContain("docTrangChoDuyet(supabase, choDuyetRpc.length)")
    expect(dem(PAGE, "ghepTrang(cu, kq.rows)")).toBe(2)
    expect(PAGE).toContain("{!loading && conThem && (")
    expect(PAGE).toContain("Tải thêm ${Math.min(50, (tong[tab] ?? 0) - shown.length)} điểm bán")
  })

  it("đường cũ còn nguyên (sổ chưa chạy mig 253): đọc đủ sổ khách + bảng ảnh một lần, đổi tab lọc trên máy không hỏi lại", () => {
    expect(PAGE).toContain('docKhachDangBan<Omit<Row, "photoCount">>(supabase, "id, store_name, address, phone, gps_lat, gps_lng", null)')
    expect(PAGE).toContain("demAnhTheoKhach(supabase, null)")
    expect(dem(PAGE, "docKhachDangBan<")).toBe(1)
    expect(PAGE).toContain('if (cheDo.current === "cu") return')
  })
})

describe("mig 253 — hai RPC lọc + đếm + phân trang trên máy chủ, RLS tự lọc", () => {
  it("VÌ SAO trích chủ nhà 23/10/2026 + số đo; SECURITY INVOKER (không definer), authenticated gọi được", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm"')
    expect(MIG).toContain("đo điện thoại 4G: 5,9 giây")
    expect(dem(MIG, "CREATE OR REPLACE FUNCTION public.khach_thieu_anh(")).toBe(1)
    expect(dem(MIG, "CREATE OR REPLACE FUNCTION public.khach_cho_duyet_anh(")).toBe(1)
    expect(MIG.match(/^SECURITY INVOKER$/gm)).toHaveLength(2)
    expect(MIG).not.toContain("SECURITY DEFINER")
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.khach_thieu_anh(text, integer, integer) TO authenticated;")
    expect(MIG).toContain("GRANT EXECUTE ON FUNCTION public.khach_cho_duyet_anh(integer, integer) TO authenticated;")
  })

  it("luật lọc như màn cũ: khách active; all = thiếu ảnh HOẶC thiếu vị trí; chờ duyệt = có yêu cầu chờ, hoặc chưa duyệt mà đã có ảnh / vị trí", () => {
    expect(dem(MIG, "WHERE c.status = 'active'")).toBe(2)
    /* Gọi đích danh `kh.` — tên trần trùng tham số OUT (chốt tests/rpc-out-param-ambiguous.test.ts). */
    expect(MIG).toMatch(
      /WHEN 'no_photo' THEN kh\.photo_count = 0\s+WHEN 'no_gps'\s+THEN kh\.gps_lat IS NULL OR kh\.gps_lng IS NULL\s+ELSE kh\.photo_count = 0 OR kh\.gps_lat IS NULL OR kh\.gps_lng IS NULL/
    )
    expect(MIG).toMatch(/WHERE kh\.so_yeu_cau > 0\s+OR \(NOT kh\.da_duyet AND \(kh\.photo_count > 0 OR \(kh\.gps_lat IS NOT NULL AND kh\.gps_lng IS NOT NULL\)\)\)/)
    expect(MIG).toContain("WHERE r.customer_id = c.id AND r.status = 'pending')::integer AS so_yeu_cau")
    expect(MIG).toContain("(c.photo_approved_at IS NOT NULL) AS da_duyet")
  })

  it("phân trang: sắp theo tên + id, OFFSET không âm, LIMIT 1..200, total_count = count(*) OVER ()", () => {
    expect(dem(MIG, "ORDER BY l.store_name, l.id")).toBe(2)
    expect(dem(MIG, "OFFSET greatest(coalesce(p_offset, 0), 0)")).toBe(2)
    expect(dem(MIG, "LIMIT least(greatest(coalesce(p_limit, 50), 1), 200);")).toBe(2)
    expect(dem(MIG, "count(*) OVER () AS total_count")).toBe(2)
  })

  it("kết bằng NOTIFY + SELECT tóm tắt; khám sổ dòng 92; schema gộp; RPC giả + nút tắt RPC ở e2e; luật ở CLAUDE.md", () => {
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 92, 'Mig 253 (RPC khach_thieu_anh / khach_cho_duyet_anh")
    const SCHEMA = read("supabase/schema_full.sql")
    expect(SCHEMA).toContain("CREATE OR REPLACE FUNCTION public.khach_thieu_anh(")
    expect(SCHEMA).toContain("CREATE OR REPLACE FUNCTION public.khach_cho_duyet_anh(")
    const FIX = read("e2e/fixture.mjs")
    expect(FIX).toContain("khach_thieu_anh: ({ p_tab, p_offset, p_limit }, { db, user }) =>")
    expect(FIX).toContain("khach_cho_duyet_anh: ({ p_offset, p_limit }, { db, user }) =>")
    const FAKE = read("e2e/fake-supabase.mjs")
    expect(FAKE).toContain('if (url.pathname === "/__tat_rpc") {')
    expect(FAKE).toContain('if (rpcTat.has(fn)) {')
    expect(FAKE).toContain('code: "PGRST202"')
    expect(read("CLAUDE.md")).toContain("`khach_thieu_anh`")
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
const BO_THU = chayBoThu("scripts/sql/thu-253-khach-thieu-anh.sql")
describe.skipIf(!BO_THU)("mig 253 trên Postgres thử", () => {
  it("9/9 bước đạt (lọc ba tab, phân trang không lặp không sót, chờ duyệt, NVBH chỉ khách mình, INVOKER + quyền gọi)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("9|9|0")
  })
})
