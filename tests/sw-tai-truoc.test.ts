import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import vm from "node:vm"

/**
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm". Service worker bắt mọi lần mở trang; chưa bật tải trước
 *   điều hướng (navigation preload) thì trình duyệt phải đánh thức SW xong mới gửi yêu cầu trang. Nay bật lúc
 *   SW kích hoạt và dùng `event.preloadResponse` — không có thì tự tải như cũ; mất mạng vẫn trả bản đã lưu.
 *   Chạy chính tệp public/sw.js trong hộp cát với `self` / `caches` / `fetch` giả.
 */
type Nghe = (e: unknown) => void

function napSw() {
  const nghe: Record<string, Nghe> = {}
  const enable = vi.fn(async () => {})
  const luu = new Map<string, Response>()
  const caches = {
    keys: async () => [] as string[],
    delete: async () => true,
    match: async (req: Request | string) => luu.get(typeof req === "string" ? req : req.url),
    open: async () => ({
      put: async (req: Request, res: Response) => void luu.set(req.url, res),
      keys: async () => Array.from(luu.keys()).map((u) => new Request(u)),
    }),
  }
  const fetchGia = vi.fn(async () => new Response("<p>mạng</p>", { status: 200 }))
  const self = {
    addEventListener: (t: string, f: Nghe) => void (nghe[t] = f),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: { navigationPreload: { enable } },
    location: { origin: "https://npp.test" },
  }
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, fetch: fetchGia, Response, Request, URL, Promise, console })
  return { nghe, enable, fetchGia, luu }
}

async function kichHoat(sw: ReturnType<typeof napSw>) {
  let cho: Promise<unknown> = Promise.resolve()
  sw.nghe.activate({ waitUntil: (p: Promise<unknown>) => void (cho = p) })
  await cho
}

function dieuHuong(sw: ReturnType<typeof napSw>, url: string, preloadResponse: unknown) {
  let tra: Promise<Response> | null = null
  sw.nghe.fetch({ request: { method: "GET", url, mode: "navigate" }, preloadResponse, respondWith: (p: Promise<Response>) => void (tra = p) })
  return tra as Promise<Response> | null
}

describe("service worker — tải trước điều hướng", () => {
  it("kích hoạt là bật navigation preload", async () => {
    const sw = napSw()
    await kichHoat(sw)
    expect(sw.enable).toHaveBeenCalledTimes(1)
  })

  it("có bản tải trước → dùng luôn, KHÔNG gửi yêu cầu thứ hai", async () => {
    const sw = napSw()
    const res = await dieuHuong(sw, "https://npp.test/orders", Promise.resolve(new Response("<p>tải trước</p>", { status: 200 })))
    expect(await res!.text()).toBe("<p>tải trước</p>")
    expect(sw.fetchGia, "tải trước rồi mà còn fetch là hai lượt cho một trang").not.toHaveBeenCalled()
  })

  it("trình duyệt không tải trước (undefined) → tự tải như cũ", async () => {
    const sw = napSw()
    const res = await dieuHuong(sw, "https://npp.test/orders", Promise.resolve(undefined))
    expect(await res!.text()).toBe("<p>mạng</p>")
    expect(sw.fetchGia).toHaveBeenCalledTimes(1)
  })

  it("mất mạng (tải trước hỏng) → trả bản trang đã lưu", async () => {
    const sw = napSw()
    sw.luu.set("https://npp.test/orders", new Response("<p>bản đã lưu</p>", { status: 200 }))
    const res = await dieuHuong(sw, "https://npp.test/orders", Promise.reject(new TypeError("Failed to fetch")))
    expect(await res!.text()).toBe("<p>bản đã lưu</p>")
  })

  it("trang tải được thì vẫn lưu lại cho lúc mất mạng", async () => {
    const sw = napSw()
    const res = await dieuHuong(sw, "https://npp.test/customers", Promise.resolve(new Response("<p>khách</p>", { status: 200 })))
    await res
    await new Promise((r) => setTimeout(r, 0))
    expect(sw.luu.has("https://npp.test/customers")).toBe(true)
  })

  it("/login, /api không qua SW (để trình duyệt tự dùng bản tải trước)", () => {
    const sw = napSw()
    expect(dieuHuong(sw, "https://npp.test/login", Promise.resolve(undefined))).toBeNull()
    expect(dieuHuong(sw, "https://npp.test/api/x", Promise.resolve(undefined))).toBeNull()
  })
})
