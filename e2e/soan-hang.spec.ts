import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "soạn đơn hàng, Cho phép gộp nhiều đơn hàng vào -> lượng
 *   hàng tổng cần xuất … chọn bằng nhiều cách, từ danh sách, từ tìm kiếm mã đơn,
 *   khách hàng..."
 * Mẫu: DH-0001 = 50 hộp Sữa (Phiếu tạm); DH-0002 = 14 thùng Mì (1 thùng = 30 gói).
 */
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const dongSP = (page: Page, ten: string) => page.getByTestId("dong-soan-hang").filter({ hasText: ten })

test.beforeAll(async () => {
  await api("sales_order_lines?id=eq.sol2", "PATCH", { conversion_factor: 30 })
})
test.afterAll(async () => {
  await api("sales_order_lines?id=eq.sol2", "PATCH", { conversion_factor: null })
})

test("từ danh sách: chọn nhiều đơn → Soạn hàng → tổng theo đơn vị cơ sở + cách lấy hàng, in được", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  await page.getByRole("checkbox", { name: "Chọn DH-0001" }).first().check()
  await page.getByRole("checkbox", { name: "Chọn DH-0002" }).first().check()
  await page.getByTestId("nut-soan-hang").locator("visible=true").first().click()
  await expect(page).toHaveURL(/\/orders\/soan-hang\?ids=o-e2e-1,o-e2e-2/)

  await expect(page.getByTestId("don-da-chon")).toContainText("DH-0001")
  await expect(page.getByTestId("don-da-chon")).toContainText("DH-0002")
  await expect(dongSP(page, "Sữa hộp")).toContainText("50 hộp")
  await expect(dongSP(page, "Sữa hộp")).toContainText("2 thùng 2 hộp")
  await expect(dongSP(page, "Mì tôm")).toContainText("420 gói")
  await expect(dongSP(page, "Mì tôm")).toContainText("14 thùng")
  await expect(dongSP(page, "Mì tôm")).toContainText("DH-0002 · Tạp hoá Cô Ba: 14 thùng")

  // Tờ in: đủ mặt hàng, ghi rõ gộp những đơn nào.
  const to = page.getByTestId("to-in-soan-hang")
  await expect(to).toContainText("PHIẾU SOẠN HÀNG")
  await expect(to).toContainText("DH-0001")
  await expect(to).toContainText("420 gói")
  await expect(page.getByRole("button", { name: /In phiếu soạn hàng/ })).toBeEnabled()

  // Bỏ một đơn → tổng tính lại, đường dẫn đi theo.
  await page.getByRole("button", { name: "Bỏ DH-0002" }).click()
  await expect(dongSP(page, "Mì tôm")).toHaveCount(0)
  await expect(page).toHaveURL(/ids=o-e2e-1$/)
})

test("tìm theo mã đơn và theo tên khách; mặc định chỉ đơn còn phải xuất", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders/soan-hang")
  const o = page.getByLabel("Tìm đơn để gộp")
  await o.fill("DH-0001")
  await page.getByTestId("ket-qua-don").filter({ hasText: "DH-0001" }).click()
  await expect(page.getByTestId("don-da-chon")).toContainText("DH-0001")
  await expect(dongSP(page, "Sữa hộp")).toContainText("50 hộp")

  // Theo tên khách: DH-0002 đã Hoàn thành → mặc định không hiện; bật "cả đơn khác" thì hiện.
  await o.fill("Cô Ba")
  await expect(page.getByTestId("ket-qua-don").filter({ hasText: "DH-0001" })).toBeVisible()
  await expect(page.getByTestId("ket-qua-don").filter({ hasText: "DH-0002" })).toHaveCount(0)
  await page.getByText("Tìm cả đơn đã xong / đã huỷ").click()
  await page.getByTestId("ket-qua-don").filter({ hasText: "DH-0002" }).click()
  await expect(dongSP(page, "Mì tôm")).toContainText("420 gói")
})
