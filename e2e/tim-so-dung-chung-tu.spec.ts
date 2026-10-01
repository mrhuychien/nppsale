import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 01/10/2026: "Tìm kiếm ở Đơn hàng, Trả hàng, Hóa đơn: tìm kiếm số theo đúng tài liệu: Đơn hàng ->
 *   chỉ tìm số đơn hàng. Trả hàng -> tìm đúng số phiếu trả, hóa đơn tìm đúng theo số hóa đơn."
 *   Dữ liệu giả: HD-E2E-1 lập từ đơn DH-0002; khách "Tạp hoá Cô Ba" SĐT 0911111111.
 */
const tong = (page: Page) =>
  page.locator("div", { has: page.getByText("Tổng tiền hàng", { exact: true }) }).locator("visible=true").last()

test("hoá đơn: gõ SĐT khách / số đơn không ra hoá đơn; gõ số HĐ thì ra", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices")
  await chonKy(page, "Tất cả")
  await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
  const o = page.getByPlaceholder("Tìm số hóa đơn, tên khách…").locator("visible=true").first()
  // SĐT khách (0911111111 — chủ HD-E2E-1) cũng không còn ra hoá đơn: số chỉ tìm số HĐ.
  await o.fill("0911111111")
  await expect(page.getByText("HD-E2E-1")).toHaveCount(0)
  await o.fill("DH-0002")
  await expect(page.getByText("HD-E2E-1")).toHaveCount(0)
  await o.fill("HD-E2E-1")
  await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
  await expect(page.getByText("HD-E2E-2")).toHaveCount(0)
})

test("đơn hàng: gõ SĐT khách không ra đơn (chỉ số đơn); gõ tên khách vẫn ra", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  const o = page.getByPlaceholder("Tìm số đơn hàng, tên khách…").locator("visible=true").first()
  await o.fill("0911111111")
  await expect(tong(page)).toContainText("0 đơn hàng")
  await o.fill("0002")
  await expect(tong(page)).toContainText("1 đơn hàng")
  await expect(page.getByText("DH-0002").first()).toBeVisible()
  await o.fill("co ba")
  await expect(tong(page)).toContainText("4 đơn hàng")
})
