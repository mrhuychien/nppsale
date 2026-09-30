import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/*
 * Chủ nhà 30/09/2026: "Mobile cho NPP: viết lại tất cả các trang danh sách chưa theo phong cách trang
 * Đơn hàng" — đầu trang xanh (☰ · tiêu đề · ô tìm) + thẻ tổng, không còn app bar chuẩn chồng lên.
 */
test.use({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true })

const DS = [
  "/finance/cash-receipts", "/finance/expenses", "/payables", "/purchase-returns",
  "/purchasing/receipts", "/purchasing/invoices", "/inventory/batches",
  "/suppliers", "/promotions", "/commissions/policies", "/invoices", "/receivables", "/settings/users",
]

test("mọi danh sách: đầu trang xanh có ☰ và ô tìm, không có app bar chuẩn", async ({ page }) => {
  await dangNhap(page)
  for (const url of DS) {
    await page.goto(url)
    const dau = page.getByTestId("ds-dau-xanh")
    await expect(dau, url).toBeVisible()
    await expect(dau.getByTestId("mo-menu"), url).toBeVisible()
    await expect(dau.getByRole("searchbox"), url).toBeVisible()
    await expect(page.getByTestId("ds-the-tong"), url).toBeVisible()
    await expect(page.locator("header").filter({ has: page.getByRole("button", { name: "Mở menu" }) }), url).toBeHidden()
  }
})

test("phiếu thu: tìm ở đầu xanh lọc danh sách; nút lọc mở ngăn lọc; ☰ mở menu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/finance/cash-receipts")
  const dau = page.getByTestId("ds-dau-xanh")
  await dau.getByRole("searchbox").fill("zzz-khong-co")
  await expect(page.getByTestId("ds-so-dem")).toHaveText("0")
  await dau.getByRole("searchbox").fill("")
  await page.getByTestId("ds-mo-loc").click()
  await expect(page.getByRole("button", { name: "Xem kết quả" })).toBeVisible()
  await page.getByRole("button", { name: "Xem kết quả" }).click()
  await dau.getByTestId("mo-menu").click()
  await expect(page.getByRole("dialog").getByRole("link", { name: "Phiếu nhập hàng" })).toBeVisible()
})
