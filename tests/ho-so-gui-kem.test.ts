import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { COT_GIAM_GIA, COT_HO_SO, gopHoSo, hoSoGuiKemDung } from "@/lib/auth/ho-so"
import type { User } from "@/types"

/**
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm". Đo bản build production (điện thoại 4G, CPU x4): mỗi
 *   lần tải cứng, trang chờ một vòng mạng đọc hồ sơ rồi mới hỏi dữ liệu; Đơn hàng của NVBH hỏi danh sách hai
 *   lần. Nay máy chủ (layout) đọc hồ sơ, gửi kèm trang; trình duyệt dùng ngay nếu đúng người.
 */

const hs = (o: Partial<User> = {}): User =>
  ({ id: "u1", org_id: "o1", full_name: "A", role: "sales", phone: null, is_active: true, created_at: "2026-01-01", ...o }) as User

describe("hoSoGuiKemDung — chỉ dùng hồ sơ gửi kèm khi đúng người", () => {
  it("đúng người, sự kiện phiên đầu → dùng", () => {
    expect(hoSoGuiKemDung(hs(), "u1", "INITIAL_SESSION")?.id).toBe("u1")
    expect(hoSoGuiKemDung(hs(), "u1", "SIGNED_IN")?.id).toBe("u1")
  })
  it("người khác (đăng nhập lại trong cùng tab) → KHÔNG dùng: hồ sơ của A gán cho B là lộ quyền", () => {
    expect(hoSoGuiKemDung(hs(), "u2", "INITIAL_SESSION")).toBeNull()
  })
  it("vừa đổi thông tin (USER_UPDATED) → đọc lại, bản gửi kèm đã cũ", () => {
    expect(hoSoGuiKemDung(hs(), "u1", "USER_UPDATED")).toBeNull()
  })
  it("không có bản gửi kèm → không dùng", () => {
    expect(hoSoGuiKemDung(null, "u1", "INITIAL_SESSION")).toBeNull()
    expect(hoSoGuiKemDung(undefined, "u1", "INITIAL_SESSION")).toBeNull()
  })
})

describe("gopHoSo — ghép câu chính + câu quyền giảm giá", () => {
  it("đủ hai câu → gộp", () => {
    const r = gopHoSo({ data: hs(), error: null }, { data: { allow_discount: true, discount_max_type: "pct", discount_max_value: 5 }, error: null })
    expect(r).toMatchObject({ id: "u1", allow_discount: true, discount_max_type: "pct", discount_max_value: 5 })
  })
  it("câu giảm giá hỏng (sổ chưa chạy mig 185) → vẫn có hồ sơ, quyền giảm giá để mặc định", () => {
    const r = gopHoSo({ data: hs(), error: null }, { data: null, error: { message: "42703" } })
    expect(r?.id).toBe("u1")
    expect(r?.allow_discount).toBeUndefined()
  })
  it("câu chính hỏng / không có dòng → không có hồ sơ (trình duyệt tự đọc lại)", () => {
    expect(gopHoSo({ data: null, error: { message: "x" } }, { data: { allow_discount: true }, error: null })).toBeNull()
    expect(gopHoSo({ data: null, error: null }, { data: null, error: null })).toBeNull()
  })
})

/* ---- máy chủ đọc hồ sơ: hai câu song song, kiểm lỗi ---- */
const giaLap = vi.hoisted(() => ({ session: null as null | { user: { id: string } }, cau: [] as string[], mo: 0, maxMo: 0, loiChinh: false }))
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    auth: { getSession: async () => ({ data: { session: giaLap.session }, error: null }) },
    from: (bang: string) => ({
      select: (cot: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            giaLap.cau.push(`${bang}:${cot}`)
            giaLap.mo++
            giaLap.maxMo = Math.max(giaLap.maxMo, giaLap.mo)
            await new Promise((r) => setTimeout(r, 5))
            giaLap.mo--
            if (cot === COT_HO_SO) return giaLap.loiChinh ? { data: null, error: { message: "hỏng" } } : { data: hs({ id: "u1", role: "owner" }), error: null }
            return { data: { allow_discount: true }, error: null }
          },
        }),
      }),
    }),
  }),
}))

describe("layHoSoMayChu", () => {
  beforeEach(() => {
    giaLap.session = null
    giaLap.cau = []
    giaLap.mo = 0
    giaLap.maxMo = 0
    giaLap.loiChinh = false
  })
  it("chưa đăng nhập → null, không hỏi gì", async () => {
    const { layHoSoMayChu } = await import("@/lib/auth/ho-so-may-chu")
    expect(await layHoSoMayChu()).toBeNull()
    expect(giaLap.cau).toEqual([])
  })
  it("đã đăng nhập → hai câu users chạy CÙNG LÚC, gộp thành một hồ sơ", async () => {
    giaLap.session = { user: { id: "u1" } }
    const { layHoSoMayChu } = await import("@/lib/auth/ho-so-may-chu")
    const r = await layHoSoMayChu()
    expect(r).toMatchObject({ uid: "u1", hoSo: { id: "u1", role: "owner", allow_discount: true } })
    expect(giaLap.cau.sort()).toEqual([`users:${COT_GIAM_GIA}`, `users:${COT_HO_SO}`].sort())
    expect(giaLap.maxMo, "nối đuôi là thêm một vòng mỗi lần dựng trang").toBe(2)
  })
  it("đọc hồ sơ hỏng → vẫn có phiên (không đá về /login), hồ sơ null để trình duyệt đọc lại", async () => {
    giaLap.session = { user: { id: "u1" } }
    giaLap.loiChinh = true
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const { layHoSoMayChu } = await import("@/lib/auth/ho-so-may-chu")
    expect(await layHoSoMayChu()).toEqual({ uid: "u1", hoSo: null })
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})

describe("nối dây: layout gửi kèm, AuthProvider dùng trước khi đọc mạng", () => {
  const auth = readFileSync("src/hooks/use-auth.tsx", "utf8")
  it("AuthProvider hỏi hồ sơ gửi kèm TRƯỚC, chỉ đọc mạng khi không dùng được", () => {
    const h = auth.slice(auth.indexOf("onAuthStateChange((event, session)"))
    const iKem = h.indexOf("hoSoGuiKemDung(guiKem.current, au.id, event)")
    const iDoc = h.indexOf("fetchProfile(au.id)")
    expect(iKem).toBeGreaterThan(0)
    expect(iDoc).toBeGreaterThan(iKem)
    expect(h.slice(iKem, iDoc)).toMatch(/if \(sanCo\) apDungHoSo\(sanCo\)\s*else/)
  })
  it("hồ sơ gửi kèm cũng qua chốt tài khoản bị khoá (một chỗ cho cả hai đường)", () => {
    const f = auth.slice(auth.indexOf("function apDungHoSo"), auth.indexOf("onAuthStateChange((event, session)"))
    expect(f).toContain("profile.is_active === false")
    expect(f).toContain("signOut()")
  })
  it("đăng xuất thì bỏ bản gửi kèm — người đăng nhập sau không dùng nhầm", () => {
    const h = auth.slice(auth.indexOf("} else {\n        hoSoCua = null"))
    expect(h.slice(0, 200)).toContain("guiKem.current = null")
  })
  for (const tep of ["src/app/(dashboard)/layout.tsx", "src/app/pos/layout.tsx"]) {
    it(`${tep} đọc hồ sơ ở máy chủ và gửi kèm (NapHoSo)`, () => {
      const s = readFileSync(tep, "utf8")
      expect(s).toContain("await layHoSoMayChu()")
      expect(s).toMatch(/<NapHoSo hoSo=\{phien(\?)?\.hoSo/)
    })
  }
})
