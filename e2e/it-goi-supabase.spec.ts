import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 27/09/2026: log Supabase vượt gói miễn phí (1,45 / 1 GB) — gần hết là log API, mỗi
 *   lượt app hỏi Supabase một dòng. Log thật (1.000 dòng / 1 giờ) cho thấy hồ sơ đọc 3–4 lần mỗi
 *   lần mở app, chuông thông báo đọc lại mỗi trang, bảng quyền đọc lại mỗi lần tải. Bài này chốt
 *   "ngân sách" lượt gọi để không ai vô tình đưa các lượt trùng trở lại.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

type Luot = { method: string; path: string; query?: string; client?: string }
const dem = (ds: Luot[], f: (x: Luot) => boolean) => ds.filter(f).length
/** Lượt do TRÌNH DUYỆT gửi (createBrowserClient) — lượt của máy chủ Next (layout) không tính vào vòng mạng của máy người dùng. */
const tuTrinhDuyet = (x: Luot) => (x.client ?? "").includes("createBrowserClient")
const laHoSo = (x: Luot) => x.path === "/rest/v1/users" && (x.query || "").includes("price_edit_max_increase_pct")
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`http://127.0.0.1:54321/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("mở app rồi đi qua 3 trang: không đọc trùng hồ sơ / thông báo / quyền", async ({ page }) => {
  await dangNhap(page) // đã ở /orders — lần tải đầu của phiên
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  const truoc = (await nhatKy()).length
  // Đi tiếp bằng liên kết trong app (không tải lại trang).
  // Menu đáy chủ NPP (30/09/2026): Trang chủ · Đơn hàng · Bán hàng · Nhập hàng · Nhân viên.
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Nhập hàng" }).click()
  await page.waitForURL(/\/purchasing\/receipts/)
  await page.waitForLoadState("networkidle")
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Đơn hàng" }).click()
  await page.waitForURL(/\/orders/)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  const ds = (await nhatKy()).slice(truoc)
  const hoSo = dem(ds, (x) => x.path === "/rest/v1/users" && (x.query || "").includes("price_edit_max_increase_pct"))
  const thongBao = dem(ds, (x) => x.path === "/rest/v1/notifications" && x.method === "GET")
  const quyen = dem(ds, (x) => x.path === "/rest/v1/role_permissions")
  const nhanVien = dem(ds, (x) => x.path === "/rest/v1/users" && (x.query || "").includes("role=in."))
  // Chuyển trang trong app: không đọc lại hồ sơ, thông báo, quyền, danh sách nhân viên.
  expect(hoSo, "hồ sơ").toBe(0)
  expect(thongBao, "thông báo (một nguồn chung cho mọi chuông)").toBe(0)
  expect(quyen, "bảng quyền").toBe(0)
  expect(nhanVien, "danh sách nhân viên bán (nhớ 5 phút)").toBe(0)

  // Tải lại cả trang: bảng quyền lấy từ bộ nhớ phiên, không đọc lại.
  const t2 = (await nhatKy()).length
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  const sau = (await nhatKy()).slice(t2)
  expect(dem(sau, (x) => x.path === "/rest/v1/role_permissions"), "quyền nhớ 5 phút qua lần tải lại").toBe(0)
  /* ⚠ Chủ nhà 23/10/2026 "load trang chậm lắm": hồ sơ do MÁY CHỦ đọc khi dựng trang (một lần, cùng vùng với
     Supabase) và gửi kèm — trình duyệt không đi thêm một vòng mạng trước khi trang hỏi dữ liệu. */
  expect(dem(sau, (x) => laHoSo(x) && !tuTrinhDuyet(x)), "máy chủ đọc hồ sơ đúng 1 lần mỗi lần tải").toBe(1)
  expect(dem(sau, (x) => laHoSo(x) && tuTrinhDuyet(x)), "trình duyệt không đọc lại hồ sơ đã gửi kèm").toBe(0)
  expect(dem(sau, (x) => x.path === "/rest/v1/notifications" && x.method === "GET"), "thông báo 1 lần mỗi lần tải").toBeLessThanOrEqual(1)
  // Vẫn đủ hồ sơ: menu người dùng hiện đúng tên.
  await expect(page.getByText("Chủ NPP").first()).toBeAttached()
})

test("NVBH mở cứng Đơn hàng: danh sách hỏi MỘT lần (không còn lượt đầu chưa biết vai rồi hỏi lại)", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/home")
    await page.waitForLoadState("networkidle")
    const t = (await nhatKy()).length
    await page.goto("/orders")
    await expect(page.getByRole("heading", { name: "Đơn của tôi" }).first()).toBeAttached()
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(1500)
    const ds = (await nhatKy()).slice(t).filter(tuTrinhDuyet)
    /* Đúng câu danh sách của màn Đơn hàng (`id,org_id,order_code…`). Lọc theo "order_code" trơn thì vớ cả câu "5 đơn gần
       đây" của trang chủ: `networkidle` của /home có khi xong TRƯỚC khi trang chủ gửi câu (bản dev) — đếm thành 2. */
    const dsDon = ds.filter((x) => x.path === "/rest/v1/sales_orders" && decodeURIComponent(x.query || "").includes("select=id,org_id,order_code"))
    expect(dsDon.length, "lượt đọc danh sách đơn").toBe(1)
    expect(decodeURIComponent(dsDon[0].query || ""), "lượt duy nhất đã mang luật của NVBH (không lấy đơn huỷ)").toContain("status=neq.cancelled")
    expect(dem(ds, laHoSo), "hồ sơ đã gửi kèm").toBe(0)
  } finally {
    await doiVai("owner")
  }
})

test("POS (tab mới = tải cứng): trình duyệt không đọc hồ sơ, máy chủ gửi kèm", async ({ page }) => {
  await dangNhap(page)
  await page.waitForLoadState("networkidle")
  const t = (await nhatKy()).length
  await page.goto("/pos/don-hang/moi")
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1000)
  const ds = (await nhatKy()).slice(t)
  expect(dem(ds, (x) => laHoSo(x) && tuTrinhDuyet(x)), "trình duyệt đọc hồ sơ").toBe(0)
  expect(dem(ds, (x) => laHoSo(x) && !tuTrinhDuyet(x)), "máy chủ đọc hồ sơ").toBe(1)
  // Danh mục NV bán (cần org_id trong hồ sơ) vẫn được nạp — hồ sơ gửi kèm đã tới tay POS.
  expect(dem(ds, (x) => tuTrinhDuyet(x) && x.path === "/rest/v1/users" && (x.query || "").includes("role=in.")), "danh sách NV bán").toBeGreaterThanOrEqual(1)
})

test("danh sách đơn: chip trạng thái đếm MỘT lượt gom nhóm, không còn 8 lượt HEAD", async ({ page }) => {
  await dangNhap(page)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1000)
  const t = (await nhatKy()).length
  await page.reload()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  const ds = (await nhatKy()).slice(t)
  expect(dem(ds, (x) => x.method === "HEAD" && x.path === "/rest/v1/sales_orders"), "HEAD đếm").toBe(0)
  expect(dem(ds, (x) => x.path === "/rest/v1/sales_orders" && decodeURIComponent(x.query || "").includes("count()")), "một lượt gom nhóm").toBe(1)
})
