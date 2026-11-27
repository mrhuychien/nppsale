/**
 * ĐIỂM BÁN CẦN CẬP NHẬT THEO NHÂN VIÊN — chủ nhà 27/11/2026: "Phần bán hàng > Điểm bán cần cập nhật thêm lọc theo nhân viên
 * bán hàng để xem nhân viên bán hàng nào còn bao nhiêu điểm chưa cập nhật".
 * Luật: `src/lib/customers/diem-ban-theo-nv.ts`; máy chủ: mig 264 (`p_nv` + `khach_thieu_anh_theo_nv`), bộ thử SQL
 * `scripts/sql/thu-264-diem-ban-theo-nv.sql`; bấm thật: e2e/diem-ban-theo-nv.spec.ts.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import {
  CHUA_PHAN_CONG, bangDemNv, duongDanVoiNv, luaChonNhanVien, nvTuDuongDan, soTheoTab, type DemNv,
} from "@/lib/customers/diem-ban-theo-nv"
import { docDemTheoNv, docTrangChoDuyet, docTrangThieuAnh } from "@/app/(dashboard)/customers/missing-photos/rpc-thieu-anh"

const ROOT = resolve(__dirname, "..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf-8")
const MIG = read("supabase/migrations/264_diem_ban_thieu_anh_theo_nv.sql")
const PAGE = read("src/app/(dashboard)/customers/missing-photos/page.tsx")
const dem = (s: string, tu: string) => s.split(tu).length - 1

const d = (thieu: number, chuaAnh: number, chuaViTri: number, choDuyet: number): DemNv => ({ thieu, chuaAnh, chuaViTri, choDuyet })

describe("bảng đếm theo NV + lựa chọn của ô Nhân viên", () => {
  it("dòng thô của máy chủ → bảng theo mã NV; nv_id NULL = Chưa phân công; số dạng chuỗi đổi thành số", () => {
    const m = bangDemNv([
      { nv_id: "nv-a", so_thieu: "3", so_chua_anh: 1, so_chua_vi_tri: "3", so_cho_duyet: 4 },
      { nv_id: null, so_thieu: 2, so_chua_anh: "2", so_chua_vi_tri: 1, so_cho_duyet: "1" },
    ])
    expect(m.get("nv-a")).toEqual(d(3, 1, 3, 4))
    expect(m.get(CHUA_PHAN_CONG)).toEqual(d(2, 2, 1, 1))
    expect(CHUA_PHAN_CONG).toBe("_none")
  })
  it("số theo tab đang xem", () => {
    const x = d(5, 2, 4, 1)
    expect([soTheoTab(x, "all"), soTheoTab(x, "no_photo"), soTheoTab(x, "no_gps"), soTheoTab(x, "approval")]).toEqual([5, 2, 4, 1])
    expect(soTheoTab(undefined, "all")).toBe(0)
  })
  it("Chưa phân công đứng đầu; rồi NV xếp NHIỀU trước, bằng nhau theo tên; NVBH đang làm đã xong hiện 0; người đã nghỉ còn khách ghi rõ", () => {
    const dem = new Map<string, DemNv>([
      ["a", d(3, 1, 3, 4)],
      ["b", d(7, 0, 7, 0)],
      ["chu", d(1, 1, 0, 0)], // chủ NPP đứng tên một điểm bán — vẫn hiện
      ["nghi", d(2, 2, 0, 0)], // NV đã nghỉ mà khách chưa giao lại
      [CHUA_PHAN_CONG, d(4, 4, 4, 0)],
    ])
    const nguoi = [
      { id: "a", full_name: "Lê Thị Sáu", role: "sales", is_active: true },
      { id: "b", full_name: "Trần Văn Bảy", role: "sales", is_active: true },
      { id: "c", full_name: "An Văn Xong", role: "sales", is_active: true }, // đã cập nhật hết
      { id: "chu", full_name: "Chủ NPP", role: "owner", is_active: true },
      { id: "nghi", full_name: "Đỗ Văn Nghỉ", role: "sales", is_active: false },
      { id: "kho", full_name: "Thủ Kho", role: "warehouse", is_active: true }, // không phụ trách ai — không hiện
      { id: "cu", full_name: "NV Cũ Xong", role: "sales", is_active: false }, // đã nghỉ, không còn khách — không hiện
    ]
    const all = luaChonNhanVien(dem, nguoi, "all")
    expect(all.map((o) => o.nhan)).toEqual([
      "Chưa phân công · 4",
      "Trần Văn Bảy · 7",
      "Lê Thị Sáu · 3",
      "Đỗ Văn Nghỉ (đã nghỉ) · 2",
      "Chủ NPP · 1",
      "An Văn Xong · 0",
    ])
    expect(all[0].id).toBe(CHUA_PHAN_CONG)
    // Số theo tab đang xem — tab Chờ duyệt xếp lại theo số chờ duyệt.
    expect(luaChonNhanVien(dem, nguoi, "approval").map((o) => o.nhan).slice(0, 3)).toEqual([
      "Chưa phân công · 0", "Lê Thị Sáu · 4", "An Văn Xong · 0",
    ])
  })
  it("mã NV có trong bảng đếm mà sổ người không có (đọc thiếu) vẫn hiện, không mất số", () => {
    expect(luaChonNhanVien(new Map([["x", d(2, 0, 2, 0)]]), [], "all").map((o) => o.nhan)).toEqual([
      "Chưa phân công · 0", "Nhân viên không rõ tên · 2",
    ])
  })
  it("người đang lọc ghi trên đường dẫn ?nv= (giữ tham số khác) — lùi từ hồ sơ khách về vẫn giữ", () => {
    expect(nvTuDuongDan("?nv=abc&x=1")).toBe("abc")
    expect(nvTuDuongDan("?nv=")).toBeNull()
    expect(nvTuDuongDan("")).toBeNull()
    expect(duongDanVoiNv("https://npp.sale/customers/missing-photos?x=1", "nv-1")).toBe("/customers/missing-photos?x=1&nv=nv-1")
    expect(duongDanVoiNv("https://npp.sale/customers/missing-photos?nv=nv-1&x=1", null)).toBe("/customers/missing-photos?x=1")
  })
})

type Loi = { message?: string; code?: string } | null
function khachGia(tra: (fn: string) => { data: unknown; error: Loi }) {
  const goi: Array<{ fn: string; args: Record<string, unknown>; opts?: { get?: boolean } }> = []
  return {
    goi,
    sb: {
      rpc: async (fn: string, args: Record<string, unknown>, opts?: { get?: boolean }) => {
        goi.push({ fn, args, opts })
        return tra(fn)
      },
    },
  }
}

describe("đọc qua RPC mig 264", () => {
  it("lọc NV thì gửi p_nv; KHÔNG lọc thì câu y như bản mig 253 (sổ chưa chạy 264 vẫn chạy)", async () => {
    const { sb, goi } = khachGia(() => ({ data: [], error: null }))
    await docTrangThieuAnh(sb, "all", 0)
    await docTrangThieuAnh(sb, "no_gps", 50, 50, "nv-a")
    await docTrangChoDuyet(sb, 0, 1, CHUA_PHAN_CONG)
    await docTrangChoDuyet(sb, 0)
    expect(goi.map((g) => g.args)).toEqual([
      { p_tab: "all", p_offset: 0, p_limit: 50 },
      { p_tab: "no_gps", p_offset: 50, p_limit: 50, p_nv: "nv-a" },
      { p_offset: 0, p_limit: 1, p_nv: "_none" },
      { p_offset: 0, p_limit: 50 },
    ])
  })
  it("docDemTheoNv: gọi khach_thieu_anh_theo_nv bằng GET (hàm chỉ đọc); sổ chưa có hàm → null (ẩn ô); lỗi khác → ném", async () => {
    const ok = khachGia(() => ({ data: [{ nv_id: "a", so_thieu: 2, so_chua_anh: 1, so_chua_vi_tri: 2, so_cho_duyet: 0 }], error: null }))
    const m = await docDemTheoNv(ok.sb)
    expect(ok.goi).toEqual([{ fn: "khach_thieu_anh_theo_nv", args: {}, opts: { get: true } }])
    expect(m?.get("a")).toEqual(d(2, 1, 2, 0))
    const chua = khachGia(() => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.khach_thieu_anh_theo_nv" } }))
    expect(await docDemTheoNv(chua.sb)).toBeNull()
    const hong = khachGia(() => ({ data: null, error: { code: "42501", message: "permission denied" } }))
    await expect(docDemTheoNv(hong.sb)).rejects.toMatchObject({ code: "42501" })
  })
})

describe("màn Điểm bán cần cập nhật", () => {
  it("NVBH không có ô lọc NV (RLS chỉ còn khách mình), không đọc số theo NV, ?nv= dán vào cũng bỏ qua", () => {
    expect(PAGE).toContain('const laNvbh = user?.role === "sales"')
    expect(PAGE).toContain("if (!user?.org_id || laNvbh) return")
    expect(PAGE).toContain("const nvDangLoc: LocNv = laNvbh ? null : nv")
    expect(PAGE).toContain("const coLocNv = !laNvbh && rpc === true && demNv !== null")
  })
  it("mọi câu đọc danh sách / số trên tab / Tải thêm mang người đang lọc", () => {
    expect(dem(PAGE, "nvLoc)")).toBeGreaterThanOrEqual(5)
    expect(PAGE).toContain("docTrangThieuAnh(supabase, tab, rows.length, TRANG_THIEU_ANH, nvDangLoc)")
    expect(PAGE).toContain("docTrangChoDuyet(supabase, choDuyetRpc.length, TRANG_THIEU_ANH, nvDangLoc)")
    // Lượt tải cũ (đổi người / tab giữa chừng) không đè lượt mới.
    expect(dem(PAGE, "if (!conHieuLuc()) return")).toBe(3)
  })
  it("ô Nhân viên: Tất cả + lựa chọn kèm số theo tab đang xem; sổ chưa chạy 264 thì bỏ lọc cũ trên đường dẫn", () => {
    expect(PAGE).toContain('<SelectItem value="all">Tất cả nhân viên</SelectItem>')
    expect(PAGE).toContain("luaChonNhanVien(demNv, nguoiNv, tab)")
    expect(PAGE).toContain("if (!dem) chonNvRef.current(null)")
  })
})

describe("mig 264", () => {
  it("VÌ SAO trích chủ nhà 27/11/2026; DROP bản cũ trước (không để hai hàm trùng tên → PGRST203); p_nv mặc định NULL", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 27/11/2026: "Phần bán hàng > Điểm bán cần cập nhật thêm lọc theo nhân viên')
    expect(MIG.indexOf("DROP FUNCTION IF EXISTS public.khach_thieu_anh(text, integer, integer);"))
      .toBeLessThan(MIG.indexOf("CREATE OR REPLACE FUNCTION public.khach_thieu_anh("))
    expect(MIG.indexOf("DROP FUNCTION IF EXISTS public.khach_cho_duyet_anh(integer, integer);"))
      .toBeLessThan(MIG.indexOf("CREATE OR REPLACE FUNCTION public.khach_cho_duyet_anh("))
    expect(dem(MIG, "p_nv text DEFAULT NULL")).toBe(2)
    expect(MIG.match(/^SECURITY INVOKER$/gm)).toHaveLength(3)
    expect(MIG).not.toContain("SECURITY DEFINER")
  })
  it("NV CHÍNH ĐANG LÀM ở cả ba hàm (role primary + status active) — cùng nghĩa bộ lọc Nhân viên của danh sách khách", () => {
    expect(dem(MIG, "ca.role = 'primary' AND ca.status = 'active'")).toBe(5)
    expect(read("src/lib/customers/loc-nhan-vien.ts")).toContain('export const CHUA_PHAN_CONG = "_none"')
    expect(dem(MIG, "p_nv = '_none'")).toBe(2)
  })
  it("kết bằng NOTIFY + SELECT; khám sổ dòng 103; schema gộp; RPC giả ở e2e", () => {
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 103, 'Mig 264 (Điểm bán cần cập nhật: lọc + đếm theo nhân viên)'")
    expect(read("supabase/schema_full.sql")).toContain("CREATE OR REPLACE FUNCTION public.khach_thieu_anh_theo_nv()")
    expect(read("e2e/fixture.mjs")).toContain("khach_thieu_anh_theo_nv: (_p, { db, user }) =>")
  })
})

const KET_NOI = ["-h", process.env.PG_THU_HOST || "/tmp/pgtest", "-p", process.env.PG_THU_PORT || "55432", "-U", "postgres",
  "-d", process.env.PG_THU_DB || "npp_tong"]
/** CHỈ bỏ qua khi máy không có Postgres thử — bộ thử ném lỗi (migration hỏng) phải ĐỎ, không lặng lẽ bỏ qua. */
function coPgThu(): boolean {
  try {
    execFileSync("psql", [...KET_NOI, "-At", "-c", "select 1"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 })
    return true
  } catch {
    return false
  }
}
function chayBoThu(tep: string): { ok: boolean; out: string } {
  try {
    const out = execFileSync("psql", [...KET_NOI, "-q", "-At", "-f", resolve(ROOT, tep)], {
      encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 300000,
      env: { ...process.env, PGOPTIONS: "-c session_preload_libraries=safeupdate" },
    })
    return { ok: true, out }
  } catch (e) {
    const x = e as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: `${x.stdout ?? ""}\n${x.stderr ?? x.message ?? ""}` }
  }
}
const PG_THU = coPgThu()
const BO_THU = PG_THU ? chayBoThu("scripts/sql/thu-264-diem-ban-theo-nv.sql") : null
describe.skipIf(!PG_THU)("mig 264 trên Postgres thử", () => {
  it("12/12 dòng đạt (đếm theo NV = danh sách lọc cùng NV ở 4 tab, NV phụ / đã thôi / hai NV chính, chưa phân công, RLS NVBH)", () => {
    expect(BO_THU!.ok, `bộ thử chạy hỏng (migration ném lỗi?):\n${BO_THU!.out}`).toBe(true)
    const dong = BO_THU!.out.trim().split("\n")
    expect(dong.at(-1), BO_THU!.out).toBe("13|13|0")
  })
})
