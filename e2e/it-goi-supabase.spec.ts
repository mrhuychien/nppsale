import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 27/09/2026: log Supabase vượt gói miễn phí (1,45 / 1 GB) — gần hết là log API, mỗi
 *   lượt app hỏi Supabase một dòng. Log thật (1.000 dòng / 1 giờ) cho thấy hồ sơ đọc 3–4 lần mỗi
 *   lần mở app, chuông thông báo đọc lại mỗi trang, bảng quyền đọc lại mỗi lần tải. Bài này chốt
 *   "ngân sách" lượt gọi để không ai vô tình đưa các lượt trùng trở lại.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const dem = (ds: { method: string; path: string; query?: string }[], f: (x: { method: string; path: string; query?: string }) => boolean) => ds.filter(f).length

test("mở app rồi đi qua 3 trang: không đọc trùng hồ sơ / thông báo / quyền", async ({ page }) => {
  await dangNhap(page) // đã ở /orders — lần tải đầu của phiên
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1500)
  const truoc = (await nhatKy()).length
  // Đi tiếp bằng liên kết trong app (không tải lại trang).
  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Kho" }).click()
  await page.waitForURL(/\/inventory/)
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
  expect(dem(sau, (x) => x.path === "/rest/v1/users" && (x.query || "").includes("price_edit_max_increase_pct")), "hồ sơ đọc đúng 1 lần mỗi lần tải").toBe(1)
  expect(dem(sau, (x) => x.path === "/rest/v1/notifications" && x.method === "GET"), "thông báo 1 lần mỗi lần tải").toBeLessThanOrEqual(1)
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
