import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/11/2026: "phần load pos trên máy có cách gì xử lý nhận diện từ đầu là đang trên máy tính để load pos luôn ko".
 *   Trình duyệt ghi khổ màn vào cookie `npp_kho`; middleware chuyển thẳng lối POS cũ sang POS (307) trước khi dựng màn cũ.
 *   Đo bản build production (CPU ×4, mạng trễ 80 ms): mở `/sales-invoices/new?order=` 3,0–3,5 s / 18–21 câu → nay như mở thẳng.
 */
const COOKIE = (baseURL: string, value: string) => ({ name: "npp_kho", value, url: baseURL })

test("máy tính: app tự ghi cookie khổ màn; thu cửa sổ hẹp lại thì đổi thành 'hep'", async ({ page, baseURL }) => {
  await dangNhap(page)
  const kho = async () => (await page.context().cookies(baseURL)).find((c) => c.name === "npp_kho")?.value
  await expect.poll(kho).toBe("rong")
  await page.setViewportSize({ width: 800, height: 900 })
  await expect.poll(kho).toBe("hep")
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(kho).toBe("rong")
})

test("máy tính có cookie 'rong' mở thẳng lối POS cũ (dấu trang / chuột giữa): máy chủ trả 307 sang POS, màn cũ KHÔNG dựng", async ({ page, baseURL }) => {
  await dangNhap(page)
  await page.context().addCookies([COOKIE(baseURL!, "rong")])
  const tai: Array<{ url: string; status: number }> = []
  page.on("response", (r) => {
    if (r.request().isNavigationRequest()) tai.push({ url: new URL(r.url()).pathname + new URL(r.url()).search, status: r.status() })
  })
  /* Dòng đơn đi GET (hết giờ được thử lại, không dặn nhầm "có thể đã ghi") + tóm tắt thời gian nạp gửi về /api/do-nap.
     Playwright không đọc được thân sendBeacon → tắt nó, app đi đường dự phòng fetch(keepalive) (kiểm luôn đường ấy). */
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "sendBeacon", { value: undefined, configurable: true })
  })
  const cauDong: string[] = []
  page.on("request", (r) => { if (r.url().includes("/rpc/get_invoiceable_lines")) cauDong.push(r.method()) })
  const baoNap = page.waitForRequest((r) => r.url().endsWith("/api/do-nap") && r.method() === "POST")
  await page.goto("/sales-invoices/new?order=o-e2e-1")
  await expect(page).toHaveURL(/\/pos\/hoa-don\/moi\?order=o-e2e-1$/)
  await expect(page.getByText("Sữa hộp").first()).toBeVisible()
  expect(tai[0]).toEqual({ url: "/sales-invoices/new?order=o-e2e-1", status: 307 })
  expect(tai.filter((t) => t.url.startsWith("/sales-invoices/new") && t.status === 200), "màn cũ không được dựng").toEqual([])
  expect(tai.filter((t) => t.url.startsWith("/pos/hoa-don/moi")).length).toBe(1)
  // `next dev` (StrictMode) chạy effect hai lần → có thể hai câu; bản build chỉ một. Câu nào cũng phải là GET.
  expect(cauDong.length).toBeGreaterThan(0)
  expect(Array.from(new Set(cauDong))).toEqual(["GET"])
  const bao = JSON.parse((await baoNap).postData() ?? "{}")
  expect(bao).toMatchObject({ man: "xuat-hang", tuMoTrang: true, loi: null, dong: 1 })
  expect(bao.soCau).toBeGreaterThan(0)
  expect(bao.cham.some((c: { p: string; m: string }) => c.p === "/rest/v1/rpc/get_invoiceable_lines" && c.m === "GET")).toBe(true)
  expect(JSON.stringify(bao)).not.toContain("o-e2e-1") // không mang tham số / mã đơn vào nhật ký
})

test("câu RSC / fetch của Next KHÔNG bị chuyển (POS vẫn mở tab mới qua PosNewTab); lượt mở trang thì có", async ({ page, baseURL }) => {
  await dangNhap(page)
  await page.context().addCookies([COOKIE(baseURL!, "rong")])
  // Như câu RSC thật của router Next: fetch → Accept "*/*", Sec-Fetch-Dest: empty (Next gỡ header RSC trước middleware).
  const rsc = await page.request.get("/sales-invoices/new?order=o-e2e-1", {
    headers: { RSC: "1", Accept: "*/*", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "cors" }, maxRedirects: 0,
  })
  expect(rsc.status()).not.toBe(307)
  const moTrang = await page.request.get("/sales-invoices/new?order=o-e2e-1", {
    headers: { Accept: "text/html,application/xhtml+xml", "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate" }, maxRedirects: 0,
  })
  expect(moTrang.status()).toBe(307)
  expect(moTrang.headers()["location"]).toMatch(/\/pos\/hoa-don\/moi\?order=o-e2e-1$/)
  // Service worker tự gửi lượt mở trang (không có tải trước điều hướng): Chromium gắn dest "empty" + mode "navigate"
  // (đo bản build 03/11/2026). `next dev` không đăng ký SW nên giả đúng bộ header ấy.
  const quaSW = await page.request.get("/sales-invoices/new?order=o-e2e-1", {
    headers: { Accept: "text/html,application/xhtml+xml", "Sec-Fetch-Dest": "empty", "Sec-Fetch-Mode": "navigate" }, maxRedirects: 0,
  })
  expect(quaSW.status()).toBe(307)
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("cookie 'hep': lối cũ để yên (màn điện thoại), không bị đẩy sang POS", async ({ page, baseURL }) => {
    await dangNhap(page)
    await page.context().addCookies([COOKIE(baseURL!, "hep")])
    const tai: number[] = []
    page.on("response", (r) => { if (r.request().isNavigationRequest()) tai.push(r.status()) })
    await page.goto("/sales-invoices/new?order=o-e2e-1")
    await page.waitForLoadState("domcontentloaded")
    expect(tai[0]).toBe(200)
    await page.waitForTimeout(800)
    await expect(page).toHaveURL(/\/sales-invoices\/new\?order=o-e2e-1$/)
  })
})
