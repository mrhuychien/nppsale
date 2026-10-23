import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, HOM_NAY_E2E } from "./helpers"

/**
 * ⚠ CHUÔNG THÔNG BÁO: hộp danh sách tải LƯỜI ở lần bấm đầu (chủ nhà 23/10/2026 "load trang chậm lắm" — giảm JS khung của
 *   mọi trang). Số chưa đọc vẫn có ngay khi mở trang; bấm MỘT lần là mở hộp — không bắt người dùng bấm lần hai vì lần đầu
 *   chỉ để tải.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const TB = "00000000-0000-4000-8000-00000000f0b1"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeEach(async () => {
  await api("notifications", "POST", [{
    id: TB, org_id: ORG, user_id: OWNER, type: "order_completed", title: "Đơn DH-E2E-TB đã xuất hoá đơn",
    body: "Bấm để xem", link_url: "/customers", is_read: false, created_at: new Date(HOM_NAY_E2E).toISOString(),
  }])
})
test.afterEach(async () => {
  await api(`notifications?id=eq.${TB}`, "DELETE")
})

test("bấm chuông một lần là mở hộp; bấm thông báo → đi tới liên kết, hết chưa đọc; Xem tất cả", async ({ page }) => {
  await dangNhap(page)
  const chuong = page.getByRole("banner").getByRole("button", { name: /^Thông báo/ })
  await expect(chuong).toHaveAccessibleName("Thông báo, 1 chưa đọc")

  await chuong.click()
  const hop = page.getByRole("dialog")
  await expect(hop.getByText("1 chưa đọc")).toBeVisible()
  await hop.getByRole("button", { name: /Đơn DH-E2E-TB đã xuất hoá đơn/ }).click()
  // `next dev` biên dịch màn lần đầu có khi quá 15 giây — chờ lâu hơn (bản build thật chuyển ngay).
  await expect(page).toHaveURL(/\/customers$/, { timeout: 90_000 })
  await expect(chuong).toHaveAccessibleName("Thông báo")

  await chuong.click()
  await expect(page.getByRole("dialog").getByText("Đã đọc hết")).toBeVisible()
  await page.getByRole("dialog").getByRole("button", { name: "Xem tất cả thông báo" }).click()
  await expect(page).toHaveURL(/\/notifications$/, { timeout: 90_000 })
})
