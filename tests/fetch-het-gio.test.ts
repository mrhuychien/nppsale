/**
 * BỘ HẸN GIỜ fetch CỦA SUPABASE — chủ nhà 22/10/2026 (ảnh màn Sản phẩm trên điện thoại): "Không tải được danh sách sản
 * phẩm — AbortError: Fetch is aborted". Chính bộ hẹn giờ 10 giây cắt câu: đếm cả lúc app nằm nền, câu đọc hết giờ là
 * hỏng luôn, đè mất `signal` của nơi gọi. Bấm thật: e2e/san-pham-het-gio.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PostgrestClient } from "@supabase/postgrest-js"
import {
  DAN_CAU_GHI, HET_GIO_MS, HetGioError, LOI_HET_GIO, cauHetGio, fetchCoHetGio, laHetGio,
} from "@/lib/supabase/fetch-het-gio"
import { errorMessage } from "@/lib/errors"
import { isAbortError, selectResilient } from "@/lib/supabase/resilient"

/** fetch giả: mỗi lượt treo tới khi bị huỷ, hoặc trả lời khi gọi `traLoi()`. */
function fetchGia() {
  const luot: Array<{ init?: RequestInit; traLoi: (r?: Response) => void }> = []
  const fn = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const sig = init?.signal
      const huy = () => reject(sig?.reason instanceof Error ? sig.reason : new DOMException("Fetch is aborted", "AbortError"))
      if (sig?.aborted) return huy()
      sig?.addEventListener("abort", huy, { once: true })
      luot.push({ init, traLoi: (r) => resolve(r ?? new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) })
    })
  )
  return { fn, luot }
}

/** Trang giả: `visibilityState` đổi được + phát `visibilitychange`. */
function trangGia() {
  const et = new EventTarget()
  const t = {
    visibilityState: "visible" as "visible" | "hidden",
    addEventListener: et.addEventListener.bind(et),
    removeEventListener: et.removeEventListener.bind(et),
    dat(v: "visible" | "hidden") {
      t.visibilityState = v
      et.dispatchEvent(new Event("visibilitychange"))
    },
  }
  return t
}

let f: ReturnType<typeof fetchGia>
let trang: ReturnType<typeof trangGia>
beforeEach(() => {
  vi.useFakeTimers()
  f = fetchGia()
  trang = trangGia()
  vi.stubGlobal("fetch", f.fn)
  vi.stubGlobal("document", trang)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const xong = async (p: Promise<unknown>) => p.then((v) => ({ ok: v }), (e) => ({ loi: e as Error }))

describe("fetchCoHetGio", () => {
  it("trả lời kịp: trả đúng Response, không còn hẹn giờ / tai nghe nào treo lại", async () => {
    const p = fetchCoHetGio("https://x/rest/v1/products")
    f.luot[0].traLoi()
    const r = (await xong(p)) as { ok?: Response }
    expect(r.ok?.status).toBe(200)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("câu ĐỌC hết giờ lần đầu thì thử lại MỘT lần; lần hai trả lời → dùng được", async () => {
    const p = xong(fetchCoHetGio("https://x/rest/v1/products", { method: "GET" }))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS)
    expect(f.fn).toHaveBeenCalledTimes(2)
    f.luot[1].traLoi()
    expect(((await p) as { ok?: Response }).ok?.status).toBe(200)
  })

  it("câu ĐỌC hết giờ cả hai lần → lỗi hết giờ (tên AbortError, câu chữ riêng), không thử lần ba", async () => {
    const p = xong(fetchCoHetGio("https://x/rest/v1/products"))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS)
    await vi.advanceTimersByTimeAsync(HET_GIO_MS)
    const r = (await p) as { loi?: Error }
    expect(r.loi).toBeInstanceOf(HetGioError)
    expect(r.loi?.name).toBe("AbortError")
    expect(r.loi?.message).toBe(`${LOI_HET_GIO} sau 10 giây (đã thử 2 lần)`)
    expect(f.fn).toHaveBeenCalledTimes(2)
  })

  it("câu GHI hết giờ → KHÔNG thử lại (có thể đã ghi) và dặn tải lại kiểm tra", async () => {
    const p = xong(fetchCoHetGio("https://x/rest/v1/rpc/create_order_with_lines", { method: "POST", body: "{}" }))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS * 3)
    const r = (await p) as { loi?: Error }
    expect(f.fn).toHaveBeenCalledTimes(1)
    expect(laHetGio(r.loi)).toBe(true)
    expect(r.loi?.message).toContain(DAN_CAU_GHI)
  })

  it("app nằm nền (trang ẩn) thì KHÔNG đếm; hiện lại mới đếm đủ 10 giây từ đầu", async () => {
    trang.visibilityState = "hidden"
    const p = xong(fetchCoHetGio("https://x/rest/v1/products"))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS * 6)
    expect(f.fn).toHaveBeenCalledTimes(1) // vẫn chờ, chưa bị cắt
    trang.dat("visible")
    await vi.advanceTimersByTimeAsync(HET_GIO_MS - 100)
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.luot[0].traLoi()
    expect(((await p) as { ok?: Response }).ok?.status).toBe(200)
  })

  it("đang chờ mà chuyển app: dừng đếm lúc ẩn, quay lại đếm lại từ đầu (không cắt ngay lúc mở lại)", async () => {
    const p = xong(fetchCoHetGio("https://x/rest/v1/products"))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS - 1000)
    trang.dat("hidden")
    await vi.advanceTimersByTimeAsync(HET_GIO_MS * 10)
    trang.dat("visible")
    await vi.advanceTimersByTimeAsync(HET_GIO_MS - 100)
    expect(f.fn).toHaveBeenCalledTimes(1)
    f.luot[0].traLoi()
    expect(((await p) as { ok?: Response }).ok?.status).toBe(200)
  })

  it("nơi gọi tự huỷ (`.abortSignal()`) → huỷ thật, ngay, không thử lại, không phải lỗi hết giờ", async () => {
    const ctl = new AbortController()
    const p = xong(fetchCoHetGio("https://x/rest/v1/products", { signal: ctl.signal }))
    ctl.abort()
    const r = (await p) as { loi?: Error }
    expect(r.loi?.name).toBe("AbortError")
    expect(laHetGio(r.loi)).toBe(false)
    expect(f.fn).toHaveBeenCalledTimes(1)
    // Đã huỷ từ trước khi gọi cũng vậy.
    const ctl2 = new AbortController()
    ctl2.abort()
    const r2 = (await xong(fetchCoHetGio("https://x/rest/v1/products", { signal: ctl2.signal }))) as { loi?: Error }
    expect(r2.loi?.name).toBe("AbortError")
    expect(f.fn).toHaveBeenCalledTimes(2)
  })
})

describe("qua thư viện PostgREST thật", () => {
  it("hết giờ: thư viện KHÔNG tự thử thêm (đúng 2 lượt mạng), câu lỗi → tiếng Việt, không kèm stack / AbortError", async () => {
    const sb = new PostgrestClient("https://x/rest/v1", { fetch: fetchCoHetGio })
    const p = sb.from("products").select("id")
    const kq = xong(Promise.resolve(p))
    await vi.advanceTimersByTimeAsync(HET_GIO_MS)
    await vi.advanceTimersByTimeAsync(HET_GIO_MS)
    await vi.advanceTimersByTimeAsync(30_000) // thời gian chờ các lượt thử của thư viện (1–2–4 giây) nếu nó còn thử
    const r = (await kq) as { ok?: { error: { message: string } | null } }
    expect(f.fn).toHaveBeenCalledTimes(2)
    expect(r.ok?.error?.message).toBe(`AbortError: ${LOI_HET_GIO} sau 10 giây (đã thử 2 lần)`)
    const cau = errorMessage(r.ok?.error)
    expect(cau).toBe(`Mạng chậm hoặc máy chủ đang bận: ${LOI_HET_GIO} sau 10 giây (đã thử 2 lần). Kiểm tra mạng rồi thử lại.`)
    expect(cau).not.toMatch(/AbortError|at |Request was aborted/)
  })

  it("selectResilient: câu lỗi tiếng Việt; lỗi hết giờ KHÔNG bị coi là 'huỷ' (trang không được lặng lẽ bỏ qua)", async () => {
    const sb = new PostgrestClient("https://x/rest/v1", { fetch: fetchCoHetGio })
    const p = selectResilient<{ id: string }>((sel) => sb.from("products").select(sel), "id", "*")
    await vi.advanceTimersByTimeAsync(HET_GIO_MS * 2)
    const r = await p
    expect(r.aborted).toBeFalsy()
    expect(r.error).toBe(cauHetGio(`AbortError: ${LOI_HET_GIO} sau 10 giây (đã thử 2 lần)`))
    expect(isAbortError(new HetGioError(2))).toBe(false)
    expect(isAbortError(new DOMException("Fetch is aborted", "AbortError"))).toBe(true)
  })
})

describe("client.ts dùng bộ hẹn giờ mới", () => {
  it("createBrowserClient nhận global.fetch = fetchCoHetGio (không còn bản cũ đè signal)", async () => {
    const { readFileSync } = await import("node:fs")
    const s = readFileSync("src/lib/supabase/client.ts", "utf-8")
    expect(s).toContain("fetch: fetchCoHetGio,")
    expect(s).not.toContain("fetchWithTimeout")
  })
})
