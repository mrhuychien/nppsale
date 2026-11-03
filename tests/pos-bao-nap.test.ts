import { describe, it, expect, vi, afterEach, beforeEach } from "vitest"
import { dungBaoNap, baoNapPos, datLaiBaoNap } from "@/lib/pos/bao-nap"
import { duongGon, luotMangTu, xoaLuotMang, type LuotMang } from "@/lib/supabase/do-mang"
import { ghiThoiGian, HetGioError } from "@/lib/supabase/fetch-het-gio"

/**
 * CHỦ NHÀ 03/11/2026: "em rà soát kỹ phần load đơn vào pos vẫn có hiện tượng chậm hoặc báo lỗi quá 10s".
 * Máy đo không tái hiện được — mỗi lần POS nạp xong một chứng từ, gửi tóm tắt (câu nào chờ bao lâu) về nhật ký máy chủ.
 */

const L = (p: string, bd: number, ms: number, tt: LuotMang["tt"] = 200, m = "GET"): LuotMang => ({ p, m, bd, ms, tt })

describe("bản tóm tắt nạp POS", () => {
  it("màn ĐẦU của trang: tính từ lúc mở trang, kèm thời gian mở trang; 6 câu lâu nhất trước", () => {
    const luot = [
      L("/rest/v1/sales_orders", 1400, 120), L("/rest/v1/rpc/get_invoiceable_lines", 1395, 10450, "het", "GET"),
      L("/rest/v1/returns", 1407, 130), L("/rest/v1/sales_invoices", 1408, 126), L("/rest/v1/products", 2100, 2500),
      L("/rest/v1/customers", 2099, 2400), L("/rest/v1/users", 1418, 122), L("/rest/v1/rpc/ton_ban_theo_hang", 1427, 463),
    ]
    const b = dungBaoNap({ man: "xuat-hang", batDau: 0, xong: 12000, tuMoTrang: true, dong: 25, luot, trang: { ttfb: 180, dcl: 420 } })
    expect(b).toMatchObject({ man: "xuat-hang", ms: 12000, tuMoTrang: true, dong: 25, soCau: 8, trang: { ttfb: 180, dcl: 420 }, loi: null })
    expect(b.cham).toHaveLength(6)
    expect(b.cham[0]).toEqual({ p: "/rest/v1/rpc/get_invoiceable_lines", m: "GET", ms: 10450, tt: "het" })
    expect(b.cham.map((c) => c.ms)).toEqual([...b.cham.map((c) => c.ms)].sort((a, c) => c - a))
  })

  it("màn SAU (mở thêm tab trong POS): tính từ lúc mở màn, chỉ các câu từ lúc ấy; không kèm thời gian mở trang", () => {
    const luot = [L("/rest/v1/sales_orders", 100, 50), L("/rest/v1/rpc/get_invoiceable_lines", 60_010, 300)]
    const b = dungBaoNap({ man: "sua-don", batDau: 60_000, xong: 60_900, tuMoTrang: false, luot, trang: { ttfb: 1, dcl: 2 } })
    expect(b.ms).toBe(900)
    expect(b.soCau).toBe(1)
    expect(b.trang).toBeNull()
  })

  it("lỗi cắt ở 300 ký tự", () => {
    const b = dungBaoNap({ man: "sua-hd", batDau: 0, xong: 10, tuMoTrang: true, loi: "x".repeat(1000), luot: [] })
    expect(b.loi).toHaveLength(300)
  })
})

describe("sổ thời gian câu hỏi (fetch của app)", () => {
  beforeEach(() => {
    xoaLuotMang()
    vi.stubGlobal("window", {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    xoaLuotMang()
  })

  it("ghi đường dẫn BỎ THAM SỐ, cách gọi, mã HTTP; câu trả lời đi nguyên vẹn", async () => {
    const res = new Response("[]", { status: 200 })
    const f = ghiThoiGian(async () => res)
    expect(await f("https://x.supabase.co/rest/v1/sales_orders?select=id&id=eq.o-1&phone=0911", { method: "GET" })).toBe(res)
    const [l] = luotMangTu(0)
    expect(l).toMatchObject({ p: "/rest/v1/sales_orders", m: "GET", tt: 200 })
    expect(JSON.stringify(l)).not.toContain("0911")
  })

  it("hết 10 giây → 'het', lỗi mạng khác → 'loi'; lỗi ném lại y nguyên", async () => {
    const het = new HetGioError(2)
    await expect(ghiThoiGian(async () => { throw het })("https://x/rest/v1/rpc/get_invoiceable_lines?p_order_id=o", {})).rejects.toBe(het)
    const mat = new TypeError("Failed to fetch")
    await expect(ghiThoiGian(async () => { throw mat })("https://x/rest/v1/returns", { method: "POST" })).rejects.toBe(mat)
    expect(luotMangTu(0).map((l) => [l.p, l.m, l.tt])).toEqual([
      ["/rest/v1/rpc/get_invoiceable_lines", "GET", "het"],
      ["/rest/v1/returns", "POST", "loi"],
    ])
  })

  it("máy chủ (không có window) thì không ghi gì", async () => {
    vi.unstubAllGlobals()
    await ghiThoiGian(async () => new Response(null, { status: 204 }))("https://x/rest/v1/a")
    expect(luotMangTu(0)).toEqual([])
  })

  it("duongGon: chuỗi / URL / Request", () => {
    expect(duongGon("https://x/rest/v1/a?b=1")).toBe("/rest/v1/a")
    expect(duongGon(new URL("https://x/rest/v1/rpc/f?p=2"))).toBe("/rest/v1/rpc/f")
    expect(duongGon(new Request("https://x/auth/v1/token?grant_type=refresh_token"))).toBe("/auth/v1/token")
  })
})

describe("gửi bản tóm tắt", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    datLaiBaoNap()
    xoaLuotMang()
  })

  it("sendBeacon tới /api/do-nap; lần đầu tính từ mở trang, lần sau từ lúc mở màn", async () => {
    const gui: Array<{ url: string; than: unknown }> = []
    vi.stubGlobal("window", {})
    vi.stubGlobal("navigator", {
      sendBeacon: (url: string, blob: Blob) => {
        void blob.text().then((t) => gui.push({ url, than: JSON.parse(t) }))
        return true
      },
    })
    vi.stubGlobal("performance", { now: () => 2500, getEntriesByType: () => [{ responseStart: 150, domContentLoadedEventEnd: 400 }] })
    baoNapPos("xuat-hang", 0, { dong: 3 })
    baoNapPos("sua-don", 2000, { loi: "Máy chủ chưa trả lời sau 10 giây" })
    await new Promise((r) => setTimeout(r, 0))
    expect(gui.map((g) => g.url)).toEqual(["/api/do-nap", "/api/do-nap"])
    expect(gui[0].than).toMatchObject({ man: "xuat-hang", tuMoTrang: true, ms: 2500, dong: 3, trang: { ttfb: 150, dcl: 400 } })
    expect(gui[1].than).toMatchObject({ man: "sua-don", tuMoTrang: false, ms: 500, loi: "Máy chủ chưa trả lời sau 10 giây", trang: null })
  })

  it("không có sendBeacon → fetch keepalive; mọi lỗi nuốt, không ném ra màn", () => {
    const fetchGia = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("window", {})
    vi.stubGlobal("navigator", {})
    vi.stubGlobal("fetch", fetchGia)
    vi.stubGlobal("performance", { now: () => 10, getEntriesByType: () => [] })
    expect(() => baoNapPos("sua-hd", 0, {})).not.toThrow()
    expect(fetchGia).toHaveBeenCalledWith("/api/do-nap", expect.objectContaining({ method: "POST", keepalive: true }))
    vi.stubGlobal("performance", { now: () => { throw new Error("hỏng") } })
    expect(() => baoNapPos("sua-hd", 0, {})).not.toThrow()
  })
})
