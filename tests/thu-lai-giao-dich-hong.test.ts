/**
 * GIAO DỊCH HỎNG (Postgres 25P02) — chủ nhà 29/10/2026 (Báo cáo nhân viên): "đọc dòng phiếu nhập hàng trả: current
 * transaction is aborted, commands ignored until end of transaction block". Câu đọc không gây ra lỗi này — kết nối phía
 * máy chủ hỏng từ trước; giao dịch 25P02 bị huỷ trọn nên gửi lại an toàn. Bấm thật: e2e/bao-cao-nv-25p02.spec.ts.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { PostgrestClient } from "@supabase/postgrest-js"
import {
  MA_GIAO_DICH_HONG, SO_LAN_GUI_LAI_GIAO_DICH_HONG, guiLaiDuoc, laCauPostgrest, laGiaoDichHong, thuLaiKhiGiaoDichHong,
} from "@/lib/supabase/thu-lai-giao-dich-hong"
import { fetchCoHetGio } from "@/lib/supabase/fetch-het-gio"
import { errorMessage } from "@/lib/errors"

const doc = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf-8")
const CAU_25P02 = "current transaction is aborted, commands ignored until end of transaction block"
const hong = () =>
  new Response(JSON.stringify({ code: "25P02", details: null, hint: null, message: CAU_25P02 }), {
    status: 500, headers: { "content-type": "application/json" },
  })
const loiKhac = (code: string, status = 500) =>
  new Response(JSON.stringify({ code, details: null, hint: null, message: `lỗi ${code}` }), {
    status, headers: { "content-type": "application/json" },
  })
const ok = (body: unknown = [{ id: 1 }]) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "content-range": "0-0/1" } })

/** fetch giả trả lần lượt theo danh sách; ghi lại mọi lượt gọi. */
function fetchTheo(...dap: Array<() => Response>) {
  const goi: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    goi.push({ input, init })
    const f = dap[Math.min(goi.length - 1, dap.length - 1)]
    return f()
  })
  return { fn, goi }
}
const SEL = "https://x.supabase.co/rest/v1/stock_entry_lines?select=entry_id&entry_id=in.(a,b)"

afterEach(() => vi.unstubAllGlobals())

describe("thuLaiKhiGiaoDichHong — câu PostgREST trả 25P02 thì gửi lại", () => {
  it("lần đầu 25P02, lần hai được → trả kết quả lần hai; gọi đúng hai lần", async () => {
    const f = fetchTheo(hong, ok)
    const res = await thuLaiKhiGiaoDichHong(f.fn)(SEL, { method: "GET" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 1 }])
    expect(f.fn).toHaveBeenCalledTimes(2)
  })
  it("hai lần 25P02 liền (vài kết nối hỏng cùng lúc) → lần ba được", async () => {
    const f = fetchTheo(hong, hong, ok)
    const res = await thuLaiKhiGiaoDichHong(f.fn)(SEL)
    expect(res.status).toBe(200)
    expect(f.fn).toHaveBeenCalledTimes(3)
  })
  it(`gửi lại tối đa ${SO_LAN_GUI_LAI_GIAO_DICH_HONG} lần; vẫn 25P02 thì trả nguyên câu lỗi (thư viện đọc được)`, async () => {
    expect(SO_LAN_GUI_LAI_GIAO_DICH_HONG).toBe(2)
    const f = fetchTheo(hong)
    const res = await thuLaiKhiGiaoDichHong(f.fn)(SEL)
    expect(f.fn).toHaveBeenCalledTimes(1 + SO_LAN_GUI_LAI_GIAO_DICH_HONG)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: MA_GIAO_DICH_HONG, message: CAU_25P02 })
  })
  it("RPC / câu ghi cũng gửi lại, đúng thân cũ — giao dịch 25P02 bị huỷ trọn, chưa ghi gì", async () => {
    const f = fetchTheo(hong, ok)
    const body = JSON.stringify({ p_tu: "2026-09-01" })
    const res = await thuLaiKhiGiaoDichHong(f.fn)("https://x.supabase.co/rest/v1/rpc/bao_cao_ban", { method: "POST", body })
    expect(res.status).toBe(200)
    expect(f.goi.map((g) => g.init?.body)).toEqual([body, body])
  })
  it("lỗi khác (hết giờ 57014, RLS 42501, 400/404) KHÔNG gửi lại; thân lỗi vẫn nguyên cho thư viện", async () => {
    for (const [code, status] of [["57014", 500], ["42501", 403], ["PGRST116", 406], ["22P02", 400]] as const) {
      const f = fetchTheo(() => loiKhac(code, status), ok)
      const res = await thuLaiKhiGiaoDichHong(f.fn)(SEL)
      expect(f.fn).toHaveBeenCalledTimes(1)
      expect(res.status).toBe(status)
      expect(await res.json()).toMatchObject({ code })
    }
  })
  it("500 không phải JSON (cổng API) không gửi lại", async () => {
    const f = fetchTheo(() => new Response("<html>bad gateway</html>", { status: 502 }), ok)
    const res = await thuLaiKhiGiaoDichHong(f.fn)(SEL)
    expect([res.status, f.fn.mock.calls.length]).toEqual([502, 1])
  })
  it("ngoài PostgREST (đăng nhập, kho tệp) không gửi lại — 25P02 ở đó không mang nghĩa 'giao dịch của câu này đã huỷ'", async () => {
    for (const url of ["https://x.supabase.co/auth/v1/token?grant_type=password", "https://x.supabase.co/storage/v1/object/customer-photos/a.jpg"]) {
      const f = fetchTheo(hong, ok)
      await thuLaiKhiGiaoDichHong(f.fn)(url, { method: "POST", body: "{}" })
      expect(f.fn).toHaveBeenCalledTimes(1)
    }
  })
  it("thân không gửi lại được (Blob, luồng) hoặc đầu vào là Request → không gửi lại", async () => {
    for (const init of [{ method: "POST", body: new Blob(["x"]) }, { method: "POST", body: new ReadableStream() }] as RequestInit[]) {
      const f = fetchTheo(hong, ok)
      await thuLaiKhiGiaoDichHong(f.fn)(SEL, init)
      expect(f.fn).toHaveBeenCalledTimes(1)
    }
    const f = fetchTheo(hong, ok)
    await thuLaiKhiGiaoDichHong(f.fn)(new Request(SEL))
    expect(f.fn).toHaveBeenCalledTimes(1)
  })
  it("nơi gọi đã huỷ (signal) → không gửi lại, trả nguyên lỗi", async () => {
    const ctl = new AbortController()
    ctl.abort()
    const f = fetchTheo(hong, ok)
    const res = await thuLaiKhiGiaoDichHong(f.fn)(SEL, { signal: ctl.signal })
    expect([res.status, f.fn.mock.calls.length]).toEqual([500, 1])
  })
})

describe("các hàm nhận diện", () => {
  it("laCauPostgrest / guiLaiDuoc / laGiaoDichHong", async () => {
    expect(laCauPostgrest(SEL)).toBe(true)
    expect(laCauPostgrest(new URL("http://127.0.0.1:54321/rest/v1/rpc/x"))).toBe(true)
    expect(laCauPostgrest("https://x.supabase.co/auth/v1/user")).toBe(false)
    expect(guiLaiDuoc(SEL)).toBe(true)
    expect(guiLaiDuoc(SEL, { body: "{}" })).toBe(true)
    expect(guiLaiDuoc(SEL, { body: new Blob(["x"]) })).toBe(false)
    expect(await laGiaoDichHong(hong())).toBe(true)
    expect(await laGiaoDichHong(loiKhac("57014"))).toBe(false)
    expect(await laGiaoDichHong(ok())).toBe(false)
  })
})

describe("nối vào app", () => {
  it("fetchCoHetGio (client trình duyệt) gửi lại câu 25P02", async () => {
    const f = fetchTheo(hong, ok)
    vi.stubGlobal("fetch", f.fn)
    const res = await fetchCoHetGio("https://x.supabase.co/rest/v1/products?select=id")
    expect(res.status).toBe(200)
    expect(f.fn).toHaveBeenCalledTimes(2)
  })
  it("qua postgrest-js thật: câu đọc 25P02 một lần → nơi gọi nhận dữ liệu, không thấy lỗi", async () => {
    const f = fetchTheo(hong, () => ok([{ entry_id: "e1", product_id: "p1" }]))
    vi.stubGlobal("fetch", f.fn)
    const db = new PostgrestClient("https://x.supabase.co/rest/v1", { fetch: fetchCoHetGio })
    const { data, error } = await db.from("stock_entry_lines").select("entry_id, product_id").in("entry_id", ["e1"])
    expect(error).toBeNull()
    expect(data).toEqual([{ entry_id: "e1", product_id: "p1" }])
    expect(f.fn).toHaveBeenCalledTimes(2)
  })
  it("client máy chủ + admin cùng luật; client trình duyệt qua fetchCoHetGio", () => {
    expect(doc("src/lib/supabase/fetch-het-gio.ts")).toContain("export const fetchCoHetGio: HamFetch = thuLaiKhiGiaoDichHong(fetchHetGioMotCau)")
    expect(doc("src/lib/supabase/client.ts")).toContain("fetch: fetchCoHetGio,")
    for (const t of ["src/lib/supabase/server.ts", "src/lib/supabase/admin.ts"]) {
      expect(doc(t)).toContain("global: { fetch: thuLaiKhiGiaoDichHong((input, init) => fetch(input, init)) },")
    }
  })
})

describe("errorMessage: gửi lại vẫn 25P02 thì nói tiếng Việt, kèm nguyên văn", () => {
  it("lỗi PostgREST có mã 25P02", () => {
    const m = errorMessage({ code: "25P02", message: CAU_25P02 })
    expect(m).toMatch(/^Máy chủ dữ liệu vừa trục trặc một kết nối/)
    expect(m).toContain("số liệu không sai")
    expect(m).toContain(`${CAU_25P02} (mã 25P02)`)
  })
  it("đã bị gói thành lỗi của bước đọc (như ảnh chủ nhà) — nhận bằng nội dung", () => {
    const m = errorMessage(new Error(`đọc dòng phiếu nhập hàng trả: ${CAU_25P02}`))
    expect(m).toMatch(/^Máy chủ dữ liệu vừa trục trặc một kết nối/)
    expect(m).toContain(`đọc dòng phiếu nhập hàng trả: ${CAU_25P02}`)
  })
  it("CLAUDE.md ghi luật", () => {
    expect(doc("CLAUDE.md")).toMatch(/25P02/)
    expect(doc("CLAUDE.md")).toMatch(/thuLaiKhiGiaoDichHong/)
  })
})
