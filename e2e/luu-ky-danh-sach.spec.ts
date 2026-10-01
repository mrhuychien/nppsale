import { test, expect } from "@playwright/test"
import { dangNhap, chonKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 01/10/2026: "Làm thêm phần trong các danh sách lưu bộ lọc Thời gian cho user".
 *   Chọn kỳ → tải lại vẫn kỳ đó; nhớ theo TÀI KHOẢN (người khác cùng máy không bị đổi theo).
 */
const oKy = (page: import("@playwright/test").Page) => page.getByRole("combobox", { name: "Khoảng thời gian" }).first()

test("đơn hàng: chọn 'Tất cả', tải lại vẫn 'Tất cả'; tài khoản khác vẫn mặc định Tháng này", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await expect(oKy(page)).toContainText("Tháng này")
  await chonKy(page, "Tất cả")
  await expect(page.getByText("DH-0003").first()).toBeVisible()
  await page.reload()
  await expect(oKy(page)).toContainText("Tất cả")
  await expect(page.getByText("DH-0003").first(), "đơn năm ngoái vẫn hiện — kỳ đã nhớ thật sự lọc").toBeVisible()
  // Khoá lưu có mã tài khoản: đổi sang tài khoản khác → không áp.
  const khoa = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("npp.loc-ky.don-hang.")))
  expect(khoa).toHaveLength(1)
  await page.evaluate((k) => {
    localStorage.setItem(k.replace(/[^.]+$/, "nguoi-khac"), localStorage.getItem(k)!)
    localStorage.removeItem(k)
  }, khoa[0])
  await page.reload()
  await expect(oKy(page)).toContainText("Tháng này")
  await expect(page.getByText("DH-0003")).toHaveCount(0)
})

test("chi phí (lọc bằng hai ô ngày): chọn 'Hôm nay', tải lại vẫn 'Hôm nay'", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/finance/expenses")
  await expect(oKy(page)).toContainText("Tháng này")
  await chonKy(page, "Hôm nay")
  await page.reload()
  await expect(oKy(page)).toContainText("Hôm nay")
})

test("phiếu thu — điện thoại: bấm đổi kỳ ở đầu xanh, tải lại vẫn kỳ đó", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await dangNhap(page)
  await page.goto("/finance/cash-receipts")
  const vien = page.getByTestId("ds-doi-ky").filter({ visible: true })
  await expect(vien).toHaveText("Tháng này")
  await vien.click()
  await expect(vien).toHaveText("Tất cả")
  await page.reload()
  await expect(page.getByTestId("ds-doi-ky").filter({ visible: true })).toHaveText("Tất cả")
  await ctx.close()
})
