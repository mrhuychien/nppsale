import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Nếu có đơn đang làm dở khi vào làm đơn sẽ hiện modal hỏi: Bạn có
 *   đơn hàng đang làm dở. Bạn có muốn tiếp tục? Có / Không. Nếu không -> vào làm đơn trắng,
 *   nếu có -> làm tiếp đơn dở."
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const soDong = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("npp.sell.cart.v1") || '{"cart":[]}').cart || []).length)

test("/sell: đơn dở → hỏi; Có giữ đơn, Không làm đơn trắng; giỏ trống không hỏi", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  const hop = page.getByRole("dialog").filter({ hasText: "Bạn có đơn hàng đang làm dở" })
  await expect(page.getByRole("button", { name: "Thêm Sữa hộp", exact: true })).toBeVisible()
  await expect(hop).toHaveCount(0) // giỏ trống: không hỏi
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await expect.poll(() => soDong(page)).toBe(1)

  // Đi trong luồng (/sell → giỏ) không hỏi lại.
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)
  await expect(hop).toHaveCount(0)

  // Vào lại làm đơn → hỏi. Có → giữ.
  await page.goto("/home")
  await page.goto("/sell")
  await expect(hop).toBeVisible()
  await expect(hop.getByText("Bạn có muốn tiếp tục?")).toBeVisible()
  await hop.getByRole("button", { name: "Có", exact: true }).click()
  await expect(hop).toHaveCount(0)
  expect(await soDong(page)).toBe(1)

  // Vào lại lần nữa → Không → giỏ trắng.
  await page.goto("/home")
  await page.goto("/sell")
  await hop.getByRole("button", { name: "Không", exact: true }).click()
  await expect(hop).toHaveCount(0)
  await expect.poll(() => soDong(page)).toBe(0)
  await page.reload()
  await expect(page.getByRole("button", { name: "Thêm Sữa hộp", exact: true })).toBeVisible()
  await expect(hop).toHaveCount(0)
})
