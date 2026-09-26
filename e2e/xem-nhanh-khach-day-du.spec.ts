import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Phần xem nhanh Đơn hàng/Hóa đơn/Phiếu trả từ Danh sách,
 *   Khách hàng hiển thị đầy đủ thông tin địa chỉ và số điện thoại luôn".
 *   Bản trước: tuyến ĐÈ số điện thoại, địa chỉ chỉ có số nhà (hoặc không có),
 *   danh sách phiếu trả không có ngăn xem nhanh.
 */
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const DAY_DU = {
  store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi",
  ward: "Phường Bến Nghé", district: "Quận 1", province: "TP Hồ Chí Minh", route_code: "T1",
}
const DIA_CHI = "1 Lê Lợi, Phường Bến Nghé, Quận 1, TP Hồ Chí Minh"

const vaBang = (bang: string, customer: unknown) =>
  fetch(`${FAKE}/rest/v1/${bang}?customer_id=eq.${KHACH}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ customer }),
  })

async function kiemNgan(page: Page) {
  const khach = page.getByRole("dialog").getByTestId("xem-nhanh-khach")
  await expect(khach).toContainText("0911111111")
  await expect(khach).toContainText(DIA_CHI)
}

test("xem nhanh đơn / hóa đơn / phiếu trả hiện đủ SĐT và địa chỉ của khách", async ({ page }) => {
  await vaBang("sales_orders", DAY_DU)
  await vaBang("sales_invoices", DAY_DU)
  await vaBang("returns", DAY_DU)
  try {
    await dangNhap(page)

    await page.goto("/orders")
    await chonKy(page, "Tất cả")
    await page.getByText("Tạp hoá Cô Ba").locator("visible=true").first().click()
    await kiemNgan(page)
    await page.keyboard.press("Escape")

    await page.goto("/sales-invoices")
    await page.getByRole("row").filter({ hasText: "HD-E2E-1" }).first().getByText("Tạp hoá Cô Ba").first().click()
    await kiemNgan(page)
    await page.keyboard.press("Escape")

    await page.goto("/returns")
    await page.getByText("Tạp hoá Cô Ba").first().click()
    await kiemNgan(page)
    /* Ngăn phiếu trả dẫn sang chi tiết ở tab mới — không mất danh sách. */
    await expect(page.getByRole("dialog").getByRole("link", { name: "Chi tiết" })).toHaveAttribute("href", /^\/returns\/r-e2e-/)
    await expect(page).toHaveURL(/\/returns$/)
  } finally {
    await vaBang("sales_orders", { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi", route_code: null })
    await vaBang("sales_invoices", { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" })
    await vaBang("returns", { store_name: "Tạp hoá Cô Ba" })
  }
})
