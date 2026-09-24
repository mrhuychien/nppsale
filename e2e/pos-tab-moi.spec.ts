import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/09/2026: "Xem nhanh Đơn hàng → Bấm sửa đơn ko ra pos" và "Mỗi
 *   khi mở pos bật tab mới đi". Máy tính: lối vào POS mở TAB MỚI thẳng tới
 *   màn POS; tab cũ đứng nguyên chỗ.
 */
test("xem nhanh đơn → Sửa đơn mở POS sửa đơn ở tab mới, tab cũ đứng yên", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await page.getByText("DH-0001").first().click()
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByText("Sửa đơn", { exact: true }).first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/don-hang\/o-e2e-1\/sua/)
  await expect(page, "tab cũ bị chuyển trang").toHaveURL(/\/orders/)
})

test("menu Bán hàng mở POS lập đơn ở tab mới", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/orders")
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Tạo đơn mới" }).first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/don-hang\/moi/)
  await expect(page).toHaveURL(/\/orders/)
})

/** Điện thoại: không đụng — `/sell` như cũ, cùng tab. */
test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("menu Bán hàng vẫn vào /sell cùng tab", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/home")
    await page.getByRole("link", { name: /Bán hàng/ }).first().click()
    await expect(page).toHaveURL(/\/sell/)
  })
})

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Bấm tạo phiếu nhập hàng/trả hàng ncc từ danh sách ko ra
 *   pos ? … tạo phiếu nhập hàng / trả hàng ncc trên desktop trên pos hết".
 */
test("danh sách phiếu nhập hàng: Tạo phiếu mở POS nhập hàng ở tab mới", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts")
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Tạo phiếu" }).first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/nhap-hang\/moi/)
  await expect(page).toHaveURL(/\/purchasing\/receipts$/)
})

test("danh sách trả hàng NCC: tạo phiếu mở POS trả NCC ở tab mới", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/purchase-returns")
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.locator('a[href="/purchase-returns/new"]').first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/tra-ncc\/moi/)
})

test("mở thẳng màn tạo cũ trên máy tính → chuyển sang POS", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  await expect(page).toHaveURL(/\/pos\/nhap-hang\/moi/)
  await page.goto("/purchase-returns/new")
  await expect(page).toHaveURL(/\/pos\/tra-ncc\/moi/)
})
