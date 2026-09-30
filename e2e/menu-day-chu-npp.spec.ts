import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/* Chủ nhà 30/09/2026: menu đáy điện thoại của NPP — Trang chủ · Đơn hàng · Bán hàng · Nhập hàng · Nhân viên. */
test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })

test("menu đáy của Chủ NPP trên điện thoại", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" })
  await expect(nav.getByRole("link")).toHaveText(["Trang chủ", "Đơn hàng", "Bán hàng", "Nhập hàng", "Nhân viên"])
  await nav.getByRole("link", { name: "Nhập hàng" }).click()
  await expect(page).toHaveURL(/\/purchasing\/receipts$/)
  await expect(nav.getByRole("link", { name: "Nhập hàng" })).toHaveAttribute("aria-current", "page")
  await nav.getByRole("link", { name: "Nhân viên" }).click()
  await expect(page).toHaveURL(/\/settings\/users$/)
  await nav.getByRole("link", { name: "Trang chủ" }).click()
  await expect(page).toHaveURL(/\/home$/)
})

/* Chủ nhà 30/09/2026: "Các trang danh sách khi NPP truy cập mobile phải có menu 3 gạch". */
for (const url of ["/orders", "/sales-invoices", "/customers", "/returns"]) {
  test(`☰ ở đầu trang xanh ${url} mở menu chính`, async ({ page }) => {
    await dangNhap(page)
    await page.goto(url)
    await page.getByTestId("mo-menu").click()
    const menu = page.getByRole("dialog")
    await expect(menu).toBeVisible()
    await expect(menu.getByRole("link", { name: "Phiếu nhập hàng" })).toBeVisible()
  })
}

test("trang danh sách có nút lùi (Người dùng, Trả hàng NCC) vẫn là ☰ trên app bar", async ({ page }) => {
  await dangNhap(page)
  for (const url of ["/settings/users", "/purchase-returns"]) {
    await page.goto(url)
    const bar = page.locator("header").first()
    await expect(bar.getByRole("button", { name: "Mở menu" })).toBeVisible()
    await expect(bar.getByRole("button", { name: "Quay lại" })).toHaveCount(0)
  }
  await page.getByRole("button", { name: "Mở menu" }).first().click()
  await expect(page.getByRole("dialog")).toBeVisible()
})
