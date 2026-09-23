import { test, expect } from "@playwright/test"
import { dangNhap, chonKy } from "./helpers"

/**
 * ⚠ YÊU CẦU 23/09/2026: "Thêm phần thống kê này vào các danh sách Đơn hàng
 *   / Hóa đơn / trả hàng... (trên desktop và mobile)" — "Tổng tiền hàng
 *   503.410.450đ · 285 đơn hàng". Tổng là của CẢ BỘ LỌC, không phải trang.
 */
const khoi = (page: import("@playwright/test").Page, nhan: string) =>
  page.locator("div", { has: page.getByText(nhan, { exact: true }) }).last()

test("đơn hàng — máy tính: 'Tất cả' ra cả đơn năm ngoái; đơn huỷ không vào tổng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  // ⚠ LỖI CŨ: viên thuốc "Tháng này" của điện thoại lọc ngầm cả máy tính —
  //   đơn DH-0003 (06/2025) không bao giờ hiện trên máy tính.
  await expect(page.getByText("DH-0003").first()).toBeVisible()
  const k = khoi(page, "Tổng tiền hàng")
  // DH-0004 (huỷ, 9.000.000) đếm vào 4 đơn nhưng KHÔNG vào tổng.
  await expect(k).toContainText("4 đơn hàng")
  await expect(k).toContainText("8.000.000")
})

test("đơn hàng — máy tính: mặc định 'Tháng này', đơn năm ngoái ẩn", async ({ page }) => {
  // ⚠ YÊU CẦU 23/09/2026: "Các danh sách có bộ lọc thời gian: Mặc định để tháng này".
  await dangNhap(page)
  await page.goto("/orders")
  await expect(page.getByRole("combobox", { name: "Khoảng thời gian" }).first()).toContainText("Tháng này")
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  await expect(page.getByText("DH-0003")).toHaveCount(0)
  await expect(khoi(page, "Tổng tiền hàng")).toContainText("2 đơn hàng")
})

test("đơn hàng — điện thoại: khối tóm tắt theo viên thuốc", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await dangNhap(page)
  await page.goto("/orders")
  // Mặc định "Tháng này": hai đơn tháng này.
  await expect(page.getByText("2 đơn hàng").locator("visible=true")).toHaveCount(1)
  await expect(page.getByText("3.000.000đ").locator("visible=true").first()).toBeVisible()
  await ctx.close()
})

test("trả hàng: tổng khoản có của CẢ bộ lọc (60 phiếu), không phải trang 50 dòng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const k = khoi(page, "Tổng tiền trả hàng")
  await expect(k).toContainText("60 phiếu trả")
  await expect(k, "cộng trang đang hiện thay vì cả bộ lọc").toContainText("600.000")
})

test("phiếu nhập: phiếu huỷ không vào tổng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts")
  const k = khoi(page, "Tổng tiền phiếu nhập")
  await expect(k).toContainText("3 phiếu nhập")
  await expect(k).toContainText("1.000.000")
})
