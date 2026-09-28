import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026 (màn Đơn hàng của /sell): "bỏ bớt các thông báo gây rối" (khối "Có mặt hàng
 *   vượt phần còn đặt được…" + chữ đỏ ở từng dòng) và "Cố định top header khi kéo xuống để luôn
 *   bấm được thêm hàng".
 */
test.use({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true })

test("giỏ vượt tồn: không còn cảnh báo gây rối; cuộn xuống vẫn bấm được Thêm hàng", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("npp.sell.chon-nhieu", "1"))
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Thêm Mì tôm", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)

  // Sữa tồn 1.000 hộp — đặt 5.000 là vượt.
  const sl = page.getByTestId("dong-gio").filter({ hasText: "Sữa hộp" }).getByLabel("Số lượng")
  await sl.fill("5000")
  await sl.blur()
  await expect(sl).toHaveValue("5000")
  await expect(page.getByText(/vượt phần còn đặt được/i)).toHaveCount(0)

  // Cuộn xuống cuối: đầu màn ghim, "Thêm hàng" vẫn trong màn hình.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.scrollY), "trang không cuộn được — bài không thử gì").toBeGreaterThan(50)
  const nut = page.getByRole("button", { name: "Thêm hàng" })
  const box = await nut.boundingBox()
  expect(box && box.y >= 0 && box.y < 80, `Thêm hàng ở y=${box?.y}`).toBe(true)
  await nut.click()
  await expect(page).toHaveURL(/\/sell$/)
})
