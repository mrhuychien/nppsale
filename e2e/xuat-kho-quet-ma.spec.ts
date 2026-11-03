import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/11/2026: "có sửa luôn đi em" — quét mã vạch ở Xuất kho phải ra hàng.
 *   Màn xuất kho đang dùng là Phiếu xuất kho (/inventory/stock-issue): nay có nút quét dùng chung bộ quét (camera + nhập
 *   tay / máy quét USB), tra MÃ VẠCH trước rồi SKU. Màn cũ /inventory/stock-out (chỉ tra SKU) đã chặn từ 22/09/2026.
 *   Chromium e2e không có camera → hộp quét phải NÓI RÕ vì sao rồi sang Nhập tay (bản cũ lặng lẽ nhảy, không nói gì).
 *   Sữa hộp mang mã vạch 8930000000011 (SKU SUA1), Mì tôm SKU MI1 — trong sổ giả.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test("phiếu xuất kho điện thoại: quét mã VẠCH ra đúng hàng; mã đã trên phiếu không thêm dòng; mã lạ báo không thấy", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/stock-issue")
  const nut = page.getByTestId("xk-quet-ma")
  await expect(nut).toBeEnabled() // danh mục đã nạp
  expect((await nut.boundingBox())!.height).toBeGreaterThanOrEqual(36)
  await nut.click()
  const hop = page.getByRole("dialog", { name: "Quét mã vạch" })
  await expect(hop).toBeVisible()
  await expect(hop.getByRole("alert")).toContainText(/camera/i)
  await expect(hop.getByRole("button", { name: "Thử lại camera" })).toBeVisible()

  const o = hop.getByPlaceholder("Quét hoặc nhập mã vạch...")
  const dong = page.getByTestId("xk-dong")
  // Máy quét gửi mã vạch rồi Enter.
  await o.fill("8930000000011")
  await o.press("Enter")
  await expect(dong).toHaveCount(1)
  await expect(dong.first()).toContainText("Sữa hộp")
  await expect(dong.first()).toContainText("SUA1")
  await expect(page.getByText("Đã thêm: Sữa hộp").first()).toBeVisible()

  // Cùng mã lần nữa: không thêm dòng thứ hai.
  await o.fill("8930000000011")
  await o.press("Enter")
  await expect(page.getByText("Đã có trên phiếu").first()).toBeVisible()
  await expect(dong).toHaveCount(1)

  // SKU gõ chữ thường cũng ra.
  await o.fill("mi1")
  await o.press("Enter")
  await expect(dong).toHaveCount(2)
  await expect(dong.nth(1)).toContainText("Mì tôm")

  // Mã không có trong danh mục.
  await o.fill("0000")
  await o.press("Enter")
  await expect(page.getByText("Mã: 0000").first()).toBeVisible()
  await expect(dong).toHaveCount(2)

  await hop.getByRole("button", { name: "Đóng" }).click()
  await expect(hop).toHaveCount(0)
  await expect(dong).toHaveCount(2)
  await expect(page).toHaveURL(/\/inventory\/stock-issue$/)
})
