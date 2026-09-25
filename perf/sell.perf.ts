import { test, type Page, type CDPSession } from "@playwright/test"
import { dangNhap } from "../e2e/helpers"

const LAN = 3
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const kq: Record<string, number[]> = {}
const ghi = (k: string, v: number) => (kq[k] ??= []).push(Math.round(v))

async function bop(page: Page): Promise<CDPSession> {
  const c = await page.context().newCDPSession(page)
  await c.send("Network.enable")
  await c.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
  await c.send("Emulation.setCPUThrottlingRate", { rate: 4 })
  return c
}

/** Đếm byte theo loại: JS của app / dữ liệu Supabase / còn lại. */
function demByte(c: CDPSession) {
  const url = new Map<string, string>()
  const b = { js: 0, data: 0, doc: 0, other: 0, supaReq: 0 }
  c.on("Network.requestWillBeSent", (e) => url.set(e.requestId, e.request.url))
  c.on("Network.loadingFinished", (e) => {
    const u = url.get(e.requestId) ?? ""
    const n = e.encodedDataLength
    if (u.includes(":54321/")) { b.data += n; b.supaReq++ }
    else if (u.endsWith(".js") || u.includes("/_next/static/chunks")) b.js += n
    else if (u.includes("_rsc=") || !u.includes("/_next/")) b.doc += n
    else b.other += n
  })
  return b
}

async function inp(page: Page) {
  await page.evaluate(() => {
    ;(window as unknown as { __ev: number[] }).__ev = []
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) (window as unknown as { __ev: number[] }).__ev.push(e.duration)
    }).observe({ type: "event", buffered: false, durationThreshold: 16 } as PerformanceObserverInit)
  })
}
const layInp = (page: Page) => page.evaluate(() => Math.max(0, ...((window as unknown as { __ev: number[] }).__ev ?? [])))

for (let lan = 0; lan < LAN; lan++) {
  test(`lượt ${lan + 1}`, async ({ page }) => {
    await dangNhap(page)
    // Bắt đầu SẠCH: xoá danh mục lưu trên máy (IndexedDB + localStorage) như máy mới.
    await page.evaluate(async () => {
      const dbs = await indexedDB.databases?.() ?? []
      await Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name!); q.onsuccess = q.onerror = q.onblocked = () => r(null) })))
      localStorage.clear()
      localStorage.setItem("npp.sell.chon-nhieu", "1")
    })
    const c = await bop(page)

    // A. Mở /sell lần đầu (máy chưa có danh mục)
    const b = demByte(c)
    let t0 = Date.now()
    await page.goto("/sell", { waitUntil: "commit" })
    const ttfb = Date.now() - t0
    await page.getByTestId("the-san-pham").first().waitFor({ timeout: 120_000 })
    ghi("A. /sell lần đầu: tới thẻ SP đầu (ms)", Date.now() - t0)
    ghi("A. TTFB tài liệu (ms)", ttfb)
    const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0)
    ghi("A. FCP (ms)", fcp)
    await page.waitForLoadState("networkidle")
    ghi("A. JS tải (KB)", b.js / 1024)
    ghi("A. Dữ liệu Supabase (KB)", b.data / 1024)
    ghi("A. Số request Supabase", b.supaReq)
    ghi("A. HTML+RSC (KB)", b.doc / 1024)

    // B. Mở lại /sell (máy đã có danh mục lưu, tải lại trang)
    // ⚠ Đếm bằng sự kiện của Playwright: sau reload phiên CDP không còn nhận sự kiện mạng.
    const b2 = { data: 0 }
    const dem2 = (r: import("@playwright/test").Response) => {
      if (r.url().includes(":54321/")) b2.data += Number(r.headers()["content-length"] ?? 0)
    }
    page.on("response", dem2)
    t0 = Date.now()
    await page.reload({ waitUntil: "commit" })
    await page.getByTestId("the-san-pham").first().waitFor()
    ghi("B. /sell mở lại: tới thẻ SP đầu (ms)", Date.now() - t0)
    // ⚠ KHÔNG dùng networkidle: CPU chậm 4× thì app gọi làm mới SAU cửa sổ 500 ms im lặng.
    await page.waitForTimeout(6000)
    page.off("response", dem2)
    ghi("B. Dữ liệu Supabase khi mở lại (KB)", b2.data / 1024)

    // C. Chạm thẻ (+1) — độ trễ thao tác (INP)
    await inp(page)
    const the = page.getByTestId("the-san-pham")
    for (let i = 0; i < 5; i++) await the.nth(i % 3).locator("p").first().tap()
    await page.waitForTimeout(500)
    ghi("C. Chạm thẻ: INP tệ nhất (ms)", await layInp(page))

    // D. Gõ tìm
    await inp(page)
    const o = page.getByRole("searchbox").or(page.locator('input[type="search"]')).first()
    await o.pressSequentially("so 12", { delay: 120 })
    await page.waitForTimeout(800)
    ghi("D. Gõ tìm: INP tệ nhất (ms)", await layInp(page))
    await o.fill("")

    // E. Chuyển màn /sell → Đơn hàng (Xem đơn)
    await page.waitForTimeout(1500) // cho SellPrefetch chạy
    t0 = Date.now()
    // Đo trong TRANG (performance.now) — không để lệnh chờ của Playwright ăn CPU.
    const xemDon = page.getByRole("button", { name: "Xem đơn" })
    await xemDon.waitFor()
    const ms = await page.evaluate(() => new Promise<number>((res) => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.trim() === "Xem đơn")!
      const t = performance.now()
      const cho = () => {
        const h = Array.from(document.querySelectorAll("h1")).some((x) => x.textContent?.trim() === "Đơn hàng")
        if (location.pathname === "/sell/cart" && h) requestAnimationFrame(() => res(performance.now() - t))
        else requestAnimationFrame(cho)
      }
      b.click(); requestAnimationFrame(cho)
    }))
    ghi("E. Xem đơn → màn Đơn hàng (ms)", ms)
    const ms2 = await page.evaluate(() => new Promise<number>((res) => {
      const t = performance.now()
      const cho = () => (document.querySelector('[data-testid="the-san-pham"]') ? requestAnimationFrame(() => res(performance.now() - t)) : requestAnimationFrame(cho))
      history.back(); requestAnimationFrame(cho)
    }))
    ghi("E. Quay lại → /sell (ms)", ms2)
  })
}

test.afterAll(() => {
  console.log("\n=== KẾT QUẢ (trung vị " + LAN + " lượt) ===")
  for (const [k, v] of Object.entries(kq)) console.log(`${k.padEnd(44)} ${String(med(v)).padStart(7)}   [${v.join(", ")}]`)
})
