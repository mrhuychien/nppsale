import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fakePostgrest, nRows } from "./helpers/fake-postgrest"

/**
 * ⚠ ĐỢT 4 TỐC ĐỘ (chủ nhà 23/10/2026 "tốc độ load trang chậm lắm" → 24/10/2026 "lần lượt hoàn thành toàn bộ"): POS / màn bán
 *   hàng mở là kéo cả sổ khách ≈570 KB về dù khách hầu như không đổi trong ngày. Mig 254: số phiên sổ khách `phien_khach`
 *   CÙNG DÒNG với số phiên hàng (mig 209) — máy hỏi MỘT câu; khớp khoá (số phiên khách + người + vai) thì dùng lại sổ khách
 *   trong bản lưu, như đã làm với hàng. Dính tới việc NVBH thấy khách nào nên mọi chốt chạy mã thật trên Supabase giả.
 *   SQL thật: scripts/sql/thu-254-phien-khach-ban.sql. E2E: e2e/nho-danh-muc-pos.spec.ts.
 */
const nho = vi.hoisted(() => ({
  ban: null as null | Record<string, unknown>,
  ghi: [] as Array<{ data: { products: unknown[]; customers: unknown[] }; khoa: unknown; khach: unknown }>,
}))
vi.mock("@/lib/offline/ref-cache", () => ({
  getCachedOrderRefData: async () => nho.ban,
  cacheOrderRefData: async (data: { products: unknown[]; customers: unknown[] }, khoa: unknown, khach: unknown) => {
    nho.ghi.push({ data, khoa, khach })
  },
}))

import { docPhienDanhMucDu, dungLaiKhach, loadSellRefData, peekCachedSellRefData, type SellRefData } from "@/lib/sell/ref-data"
import { kiemPhienDanhMucShared, loadSellRefDataShared, resetSellRefData } from "@/lib/sell/ref-store"

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const CHU = { uid: "u-chu", vai: "owner" }
const NV = { uid: "u-nv", vai: "sales" }
const KH_LUU = [{ id: "kh-luu", status: "active", store_name: "Tạp hoá (bản lưu)" }]
const SP_LUU = [{ id: "sp-luu", status: "active", name: "Bia (bản lưu)" }]

/** Sổ giả: `phienKhach === null` = sổ chưa chạy mig 254 (dòng không có cột). */
function bang(phien = 7, phienKhach: number | null = 3) {
  return {
    customers: nRows(3, () => ({ status: "active", store_name: "Tạp hoá" })),
    products: nRows(4, () => ({ status: "active", name: "Mì gói" })),
    batches: [],
    danh_muc_ban_phien: [phienKhach === null ? { id: 1, phien } : { id: 1, phien, phien_khach: phienKhach }],
    user_suppliers: [],
  }
}
const khoaSp = { phien: 7, uid: CHU.uid, vai: CHU.vai, ncc: "*" }
const banLuu = (khach: Record<string, unknown> | null, khoa: Record<string, unknown> = khoaSp) => ({
  customers: KH_LUU, products: SP_LUU, stockByProduct: {}, cachedAt: "2026-10-24T00:00:00Z", ...khoa, ...(khach ? { khach } : {}),
})
const daHoi = (calls: Array<{ table: string }>, t: string) => calls.some((c) => c.table === t)

beforeEach(() => {
  nho.ban = null
  nho.ghi = []
  vi.stubGlobal("navigator", { onLine: true })
  resetSellRefData()
})
afterEach(() => vi.unstubAllGlobals())

describe("dungLaiKhach — khớp ĐỦ mới dùng lại sổ khách", () => {
  const khoa = { phien: 3, uid: "u", vai: "owner" }
  const ban = { customers: [{}], products: [], stockByProduct: {}, cachedAt: "x", khach: khoa }
  it("khớp đủ → dùng lại", () => expect(dungLaiKhach(ban, khoa)).toBe(true))
  it.each([
    ["số phiên khách đã tăng (khách / nhóm / phân công / quyền xem đổi)", { phien: 4 }],
    ["người khác trên cùng máy", { uid: "v" }],
    ["đổi vai", { vai: "sales" }],
  ])("%s → tải lại", (_, doi) => expect(dungLaiKhach(ban, { ...khoa, ...doi })).toBe(false))
  it("bản lưu chưa có khoá khách / không biết khoá / sổ khách rỗng / không có bản lưu → tải lại", () => {
    expect(dungLaiKhach({ ...ban, khach: undefined }, khoa)).toBe(false)
    expect(dungLaiKhach(ban, null)).toBe(false)
    expect(dungLaiKhach({ ...ban, customers: [] }, khoa)).toBe(false)
    expect(dungLaiKhach(null, khoa)).toBe(false)
  })
})

describe("docPhienDanhMucDu — MỘT câu hai số; sổ chưa chạy 254 thì lùi về chỉ số hàng", () => {
  it("có cả hai cột → cả hai số, một câu", async () => {
    const { client, calls } = fakePostgrest(bang(7, 3))
    expect(await docPhienDanhMucDu(client)).toEqual({ phien: 7, phienKhach: 3 })
    expect(calls.filter((c) => c.table === "danh_muc_ban_phien")).toHaveLength(1)
  })
  it("dòng không có phien_khach (sổ chưa chạy 254) → số khách null, số hàng vẫn có", async () => {
    const { client } = fakePostgrest(bang(7, null))
    expect(await docPhienDanhMucDu(client)).toEqual({ phien: 7, phienKhach: null })
  })
  it("câu hai cột bị từ chối (thiếu cột → 400) → hỏi lại chỉ cột phien", async () => {
    const goi: string[] = []
    const client = {
      from: () => ({
        select: (c: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              goi.push(c)
              return c.includes("phien_khach")
                ? { data: null, error: { message: 'column danh_muc_ban_phien.phien_khach does not exist' } }
                : { data: { phien: 9 }, error: null }
            },
          }),
        }),
      }),
    }
    expect(await docPhienDanhMucDu(client)).toEqual({ phien: 9, phienKhach: null })
    expect(goi).toEqual(["phien, phien_khach", "phien"])
  })
  it("đọc hỏng / mất mạng → không biết cả hai", async () => {
    const { client } = fakePostgrest(bang(7, 3), { failOn: (c) => c.table === "danh_muc_ban_phien" })
    expect(await docPhienDanhMucDu(client)).toEqual({ phien: null, phienKhach: null })
    vi.stubGlobal("navigator", { onLine: false })
    expect(await docPhienDanhMucDu(client)).toEqual({ phien: null, phienKhach: null })
  })
})

describe("loadSellRefData — sổ khách dùng lại bản lưu khi khớp khoá; tồn kho luôn mới", () => {
  it("khớp khoá khách → KHÔNG hỏi bảng customers, khách lấy từ bản lưu, bản lưu ghi lại kèm khoá khách", async () => {
    nho.ban = banLuu({ phien: 3, uid: CHU.uid, vai: CHU.vai })
    const { client, calls } = fakePostgrest(bang(7, 3))
    const r = await loadSellRefData(client, CHU)
    expect(daHoi(calls, "customers")).toBe(false)
    expect(r.khachNho).toBe(true)
    expect(r.customers).toEqual(KH_LUU)
    expect(r.phienKhach).toBe(3)
    expect(daHoi(calls, "batches"), "tồn kho vẫn đọc mới").toBe(true)
    expect(nho.ghi.at(-1)?.khach).toEqual({ phien: 3, uid: CHU.uid, vai: CHU.vai })
    expect(nho.ghi.at(-1)?.data.customers).toEqual(KH_LUU)
  })

  it("số phiên khách tăng → tải lại sổ khách (hàng vẫn dùng bản lưu), bản lưu mang số khách MỚI", async () => {
    nho.ban = banLuu({ phien: 2, uid: CHU.uid, vai: CHU.vai })
    const { client, calls } = fakePostgrest(bang(7, 3))
    const r = await loadSellRefData(client, CHU)
    expect(daHoi(calls, "customers")).toBe(true)
    expect(r.khachNho).toBe(false)
    expect(r.customers).toHaveLength(3)
    expect(daHoi(calls, "products"), "hàng chưa đổi → vẫn bản lưu").toBe(false)
    expect(r.sanPhamNho).toBe(true)
    expect(nho.ghi.at(-1)?.khach).toEqual({ phien: 3, uid: CHU.uid, vai: CHU.vai })
  })

  it("hàng đổi mà khách chưa đổi → chỉ tải lại hàng", async () => {
    nho.ban = banLuu({ phien: 3, uid: CHU.uid, vai: CHU.vai }, { ...khoaSp, phien: 6 })
    const { client, calls } = fakePostgrest(bang(7, 3))
    const r = await loadSellRefData(client, CHU)
    expect(daHoi(calls, "products")).toBe(true)
    expect(daHoi(calls, "customers")).toBe(false)
    expect(r.khachNho).toBe(true)
    expect(r.sanPhamNho).toBe(false)
  })

  it("người khác / vai khác → tải lại sổ khách", async () => {
    nho.ban = banLuu({ phien: 3, uid: "u-khac", vai: CHU.vai })
    const a = fakePostgrest(bang(7, 3))
    expect((await loadSellRefData(a.client, CHU)).khachNho).toBe(false)
    nho.ban = banLuu({ phien: 3, uid: NV.uid, vai: "owner" })
    const b = fakePostgrest(bang(7, 3))
    expect((await loadSellRefData(b.client, NV)).khachNho).toBe(false)
    expect(daHoi(b.calls, "customers")).toBe(true)
  })

  it("sổ chưa chạy 254 (không có phien_khach) → tải khách như cũ, bản lưu KHÔNG mang khoá khách (hàng vẫn có khoá)", async () => {
    nho.ban = banLuu({ phien: 3, uid: CHU.uid, vai: CHU.vai })
    const { client, calls } = fakePostgrest(bang(7, null))
    const r = await loadSellRefData(client, CHU)
    expect(daHoi(calls, "customers")).toBe(true)
    expect(r.khachNho).toBe(false)
    expect(r.phienKhach).toBeNull()
    expect(nho.ghi.at(-1)?.khach ?? null).toBeNull()
    expect(nho.ghi.at(-1)?.khoa).toEqual(khoaSp)
  })

  it("không biết người → tải đủ, bản lưu không mang khoá khách", async () => {
    nho.ban = banLuu({ phien: 3, uid: CHU.uid, vai: CHU.vai })
    const { client, calls } = fakePostgrest(bang(7, 3))
    const r = await loadSellRefData(client, null)
    expect(daHoi(calls, "customers")).toBe(true)
    expect(r.khachNho).toBe(false)
    expect(nho.ghi.at(-1)?.khach ?? null).toBeNull()
  })

  it("đọc sổ khách hỏng → có cảnh báo, bản lưu không mang khoá khách (lần sau tải lại)", async () => {
    const { client } = fakePostgrest(bang(7, 3), { failOn: (c) => c.table === "customers" })
    const r = await loadSellRefData(client, CHU)
    expect(r.warnings.some((w) => w.includes("Không tải được danh mục"))).toBe(true)
    expect(r.khachNho).toBe(false)
    expect(nho.ghi.at(-1)?.khach ?? null).toBeNull()
  })

  it("POS màn NCC (khach: false): không hỏi khách, bản lưu giữ khách cũ KÈM khoá khách cũ", async () => {
    nho.ban = banLuu({ phien: 3, uid: CHU.uid, vai: CHU.vai })
    const { client, calls } = fakePostgrest(bang(7, 3))
    const r = await loadSellRefData(client, CHU, { khach: false })
    expect(daHoi(calls, "customers")).toBe(false)
    expect(r.customers).toEqual([])
    expect(r.khachNho).toBe(false)
    expect(nho.ghi.at(-1)?.data.customers).toEqual(KH_LUU)
    expect(nho.ghi.at(-1)?.khach).toEqual({ phien: 3, uid: CHU.uid, vai: CHU.vai })
  })

  /**
   * ⚠ SỐ PHIÊN ĐỌC TRƯỚC SỔ KHÁCH (cùng luật với sản phẩm). Song song mà câu khách về trước, phân công đổi chen giữa, thì
   *   bản cũ mang số MỚI — lần sau khớp khoá, NVBH dùng mãi sổ khách thiếu khách vừa được giao.
   */
  it("câu khách CHỜ số phiên về rồi mới đi; tồn kho không chờ", async () => {
    const { client, calls } = fakePostgrest(bang(7, 3))
    let tha!: () => void
    const giu = new Promise<void>((r) => (tha = r))
    const boc = {
      ...client,
      from(t: string) {
        const q = (client as { from: (t: string) => Record<string, unknown> }).from(t)
        if (t !== "danh_muc_ban_phien") return q
        const goc = q.maybeSingle as () => PromiseLike<unknown>
        q.maybeSingle = () => ({ then: (ok: (v: unknown) => unknown, loi?: (e: unknown) => unknown) => giu.then(() => goc.call(q)).then(ok, loi) })
        return q
      },
    }
    const dang = loadSellRefData(boc, CHU)
    await new Promise((r) => setTimeout(r, 20))
    expect(daHoi(calls, "batches")).toBe(true)
    expect(daHoi(calls, "customers")).toBe(false)
    tha()
    const r = await dang
    expect(daHoi(calls, "customers")).toBe(true)
    expect(r.customers).toHaveLength(3)
    expect(nho.ghi.at(-1)?.khach).toEqual({ phien: 3, uid: CHU.uid, vai: CHU.vai })
  })
})

describe("bản trong RAM / trên máy mang số phiên khách — quay lại app thì so cả hai số", () => {
  const du = (phien: number | null, phienKhach: number | null): SellRefData =>
    ({ customers: [], products: [], stockByProduct: {}, source: "server", warnings: [], phien, phienKhach })

  it("peekCachedSellRefData: số phiên khách ghi cùng bản lưu", async () => {
    nho.ban = banLuu({ phien: 3, uid: CHU.uid, vai: CHU.vai })
    expect((await peekCachedSellRefData(CHU.uid))?.phienKhach).toBe(3)
    nho.ban = banLuu(null)
    expect((await peekCachedSellRefData(CHU.uid))?.phienKhach).toBeNull()
    expect(await peekCachedSellRefData("u-khac"), "bản của người khác không hiện").toBeNull()
  })

  it("khách đổi (hàng chưa) → đã đổi; cả hai chưa → chưa; không biết số hàng → không biết; không biết số khách → xét hàng; cách cũ (chỉ số) vẫn chạy", async () => {
    await loadSellRefDataShared(async () => du(7, 3))
    expect(await kiemPhienDanhMucShared(async () => ({ phien: 7, phienKhach: 4 }))).toBe(true)
    expect(await kiemPhienDanhMucShared(async () => ({ phien: 7, phienKhach: 3 }))).toBe(false)
    expect(await kiemPhienDanhMucShared(async () => ({ phien: 8, phienKhach: 3 }))).toBe(true)
    expect(await kiemPhienDanhMucShared(async () => ({ phien: null, phienKhach: 3 }))).toBeNull()
    expect(await kiemPhienDanhMucShared(async () => ({ phien: 7, phienKhach: null }))).toBe(false)
    expect(await kiemPhienDanhMucShared(async () => 7)).toBe(false)
    expect(await kiemPhienDanhMucShared(async () => 8)).toBe(true)
  })

  it("bản đang giữ không có số khách (sổ chưa chạy 254) → chỉ xét số hàng", async () => {
    await loadSellRefDataShared(async () => du(7, null))
    expect(await kiemPhienDanhMucShared(async () => ({ phien: 7, phienKhach: 5 }))).toBe(false)
    expect(await kiemPhienDanhMucShared(async () => ({ phien: 8, phienKhach: 5 }))).toBe(true)
  })
})

describe("mig 254 — số phiên sổ khách cùng dòng với số phiên hàng", () => {
  const MIG = read("supabase/migrations/254_phien_khach_ban.sql")
  it("VÌ SAO; cột phien_khach + luc_khach; trigger mức câu lệnh trên 5 bảng (không sales_orders); hàm trigger khoá gọi thẳng; NOTIFY + SELECT", () => {
    expect(MIG).toContain('VÌ SAO — chủ nhà 23/10/2026 "tốc độ load trang chậm lắm"')
    expect(MIG).toContain("ALTER TABLE public.danh_muc_ban_phien ADD COLUMN IF NOT EXISTS phien_khach bigint NOT NULL DEFAULT 1;")
    expect(MIG).toContain("ALTER TABLE public.danh_muc_ban_phien ADD COLUMN IF NOT EXISTS luc_khach timestamptz NOT NULL DEFAULT now();")
    expect(MIG).toContain(
      "FOREACH b IN ARRAY ARRAY['customers', 'customer_groups', 'customer_assignments', 'user_permission_overrides', 'role_permissions'] LOOP"
    )
    expect(MIG).toMatch(/FOR EACH STATEMENT EXECUTE FUNCTION public\._tang_phien_khach_ban\(\)/)
    expect(MIG).toContain("UPDATE public.danh_muc_ban_phien SET phien_khach = phien_khach + 1, luc_khach = now() WHERE id = 1;")
    expect(MIG).toContain("REVOKE EXECUTE ON FUNCTION public._tang_phien_khach_ban() FROM PUBLIC, anon, authenticated;")
    expect(MIG).not.toMatch(/'sales_orders'/)
    expect(MIG).toContain("NOTIFY pgrst, 'reload schema';")
    expect(MIG.slice(MIG.lastIndexOf("NOTIFY pgrst, 'reload schema';"))).toMatch(/\nSELECT /)
  })
  it("khám sổ dòng 93; schema gộp; sổ giả e2e có phien_khach + trigger giả; màn /sell hỏi cả hai số; luật ở CLAUDE.md", () => {
    expect(read("scripts/sql/kham-so-that.sql")).toContain("SELECT 93, 'Mig 254 (Số phiên sổ khách bán hàng")
    expect(read("supabase/schema_full.sql")).toContain("ADD COLUMN IF NOT EXISTS phien_khach bigint")
    expect(read("e2e/fixture.mjs")).toContain("danh_muc_ban_phien: [{ id: 1, phien: 1, phien_khach: 1,")
    const FAKE = read("e2e/fake-supabase.mjs")
    expect(FAKE).toContain('if (KHACH_BANG.has(table) && (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE")) tangPhienKhach()')
    expect(FAKE).toContain("if (dauKhach() !== truoc) tangPhienKhach()")
    expect(read("src/hooks/use-sell-data.tsx")).toMatch(/kiemPhienDanhMucShared\(\(\) => docPhienDanhMucDu\(sb\)\)/)
    expect(read("CLAUDE.md")).toContain("`phien_khach`")
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
const BO_THU = chayBoThu("scripts/sql/thu-254-phien-khach-ban.sql")
describe.skipIf(!BO_THU)("mig 254 trên Postgres thử", () => {
  it("12/12 bước đạt (mỗi câu ghi khách / nhóm / phân công / quyền +1, hàng không đụng, idempotent, authenticated chỉ đọc)", () => {
    const dong = BO_THU!.trim().split("\n")
    expect(dong.filter((d) => d.includes("|SAI|")), BO_THU!).toEqual([])
    expect(dong.at(-1)).toBe("12|12|0")
  })
})
