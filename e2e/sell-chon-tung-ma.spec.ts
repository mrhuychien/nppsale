import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "thêm 1 nút icon option chọn từng mã, trên đầu cạnh Bảng
 *   giá chung. Lưu ý khi người dùng chọn thì người dùng phải tắt đi mới tắt chứ
 *   k tự tắt (lưu trạng thái)".
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test("chọn từng mã: thêm một mã là sang đơn; trạng thái giữ tới khi tự tắt", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  const nut = page.getByTestId("chon-tung-ma")
  await expect(nut).toHaveAttribute("aria-pressed", "false") // mặc định: chọn nhiều

  await nut.click()
  await expect(nut).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await expect(page, "chọn từng mã mà không sang đơn").toHaveURL(/\/sell\/cart/)

  // Quay lại — và cả tải lại trang — vẫn đang chọn từng mã (không tự tắt).
  await page.goto("/sell")
  await expect(nut).toHaveAttribute("aria-pressed", "true")
  await page.reload()
  await expect(nut).toHaveAttribute("aria-pressed", "true")

  // Mã đã có trong đơn: + chỉ tăng số lượng, không nhảy màn.
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveText("2")

  // Tự tắt → về chọn nhiều: thêm mã mới vẫn ở lại màn.
  await nut.click()
  await expect(nut).toHaveAttribute("aria-pressed", "false")
  await page.getByRole("button", { name: "Thêm Mì tôm", exact: true }).click()
  await expect(page).toHaveURL(/\/sell$/)
  await page.reload()
  await expect(nut).toHaveAttribute("aria-pressed", "false")
})
