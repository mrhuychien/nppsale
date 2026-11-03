import { describe, it, expect, vi, afterEach } from "vitest"

/**
 * `/api/do-nap` — nhận tóm tắt thời gian nạp POS (chủ nhà 03/11/2026: "…load đơn vào pos vẫn có hiện tượng chậm hoặc báo
 * lỗi quá 10s") và ghi một dòng "[pos-nap]" vào nhật ký Vercel. Chỉ người đã đăng nhập; không đọc / ghi sổ.
 */
const st: { user: { id: string } | null } = { user: { id: "u-1" } }
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ auth: { getUser: async () => ({ data: { user: st.user } }) } }),
}))

const goi = (than: string) => new Request("http://x/api/do-nap", { method: "POST", body: than, headers: { "content-type": "application/json" } })

describe("/api/do-nap", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    st.user = { id: "u-1" }
  })

  it("đã đăng nhập: ghi '[pos-nap]' kèm người dùng + bản tóm tắt, trả 204", async () => {
    const { POST } = await import("@/app/api/do-nap/route")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const r = await POST(goi(JSON.stringify({ man: "xuat-hang", ms: 12000, cham: [{ p: "/rest/v1/rpc/get_invoiceable_lines", m: "GET", ms: 10450, tt: "het" }] })))
    expect(r.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe("[pos-nap]")
    expect(JSON.parse(warn.mock.calls[0][1] as string)).toMatchObject({ user: "u-1", man: "xuat-hang", ms: 12000 })
  })

  it("thân gửi khoá 'user' giả cũng không ghi đè người đăng nhập thật", async () => {
    const { POST } = await import("@/app/api/do-nap/route")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect((await POST(goi(JSON.stringify({ man: "sua-hd", user: "nguoi-khac" })))).status).toBe(204)
    expect(JSON.parse(warn.mock.calls[0][1] as string)).toMatchObject({ user: "u-1", man: "sua-hd" })
  })

  it("chưa đăng nhập → 401, không ghi gì", async () => {
    const { POST } = await import("@/app/api/do-nap/route")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    st.user = null
    expect((await POST(goi("{}"))).status).toBe(401)
    expect(warn).not.toHaveBeenCalled()
  })

  it("thân không phải JSON object → 400; thân dài cắt ở 4 KB (JSON vỡ → 400, không ghi rác)", async () => {
    const { POST } = await import("@/app/api/do-nap/route")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect((await POST(goi("khong-phai-json"))).status).toBe(400)
    expect((await POST(goi("[1,2]"))).status).toBe(400)
    expect((await POST(goi(JSON.stringify({ man: "x", rac: "a".repeat(9000) })))).status).toBe(400)
    expect(warn).not.toHaveBeenCalled()
  })
})
