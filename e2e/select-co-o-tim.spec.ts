import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ YÊU CẦU 23/09/2026: "Rà soát các droplist đều phải kèm ô tìm kiếm".
 *   Ô tìm nằm trong `SelectContent` dùng chung — chốt bấm một danh sách
 *   thật (loại thông báo, 12 lựa chọn) và một danh sách ngắn (3 lựa chọn).
 */
test("danh sách thả xuống dài có ô tìm, gõ là lọc, chọn được kết quả", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/notifications")
  const nut = page.getByRole("combobox").first()
  await nut.click()
  const oTim = page.getByLabel("Tìm trong danh sách")
  await expect(oTim).toBeVisible()
  const truoc = await page.getByRole("option").count()
  expect(truoc).toBeGreaterThanOrEqual(5)

  // Gõ không dấu vẫn khớp chữ có dấu.
  await oTim.pressSequentially("don")
  await expect(oTim).toHaveValue("don")
  const sau = page.getByRole("option")
  // "Sửa đơn đã xuất", "Hủy đơn", "Đơn trả hoàn thành" — ba nhãn có chữ "đơn".
  await expect(sau).toHaveCount(3)
  const nhan = await sau.first().innerText()
  expect(nhan.toLowerCase()).toContain("đơn")

  // Enter vào lựa chọn đầu, Enter nữa là chọn.
  await oTim.press("Enter")
  await page.keyboard.press("Enter")
  await expect(nut).toContainText(nhan.trim())

  // Mở lại: ô tìm trống, đủ lại các lựa chọn.
  await nut.click()
  await expect(page.getByLabel("Tìm trong danh sách")).toHaveValue("")
  await expect(page.getByRole("option")).toHaveCount(truoc)
  await page.keyboard.press("Escape")

  // Gõ chữ không khớp gì thì nói ra.
  await nut.click()
  await page.getByLabel("Tìm trong danh sách").pressSequentially("zzzz")
  await expect(page.getByText("Không có lựa chọn nào khớp")).toBeVisible()
})

test("danh sách ngắn (3 lựa chọn) không có ô tìm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/notifications")
  await page.getByRole("combobox").nth(1).click()
  await expect(page.getByRole("option")).toHaveCount(3)
  await expect(page.getByLabel("Tìm trong danh sách")).toHaveCount(0)
})

/**
 * ⚠ ANDROID: bàn phím bật lên là cửa sổ đổi kích thước, và Radix đóng
 *   danh sách khi cửa sổ đổi kích thước — ô tìm vô dụng. Chốt: đang gõ ở
 *   ô tìm mà cửa sổ co lại (như bàn phím bật) thì danh sách VẪN MỞ; bấm
 *   ra ngoài thì vẫn đóng như thường.
 */
test("bàn phím điện thoại (cửa sổ co lại) không đóng danh sách đang tìm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/notifications")
  await page.getByRole("combobox").first().click()
  const oTim = page.getByLabel("Tìm trong danh sách")
  await oTim.click()
  await oTim.pressSequentially("đơn")
  await page.setViewportSize({ width: 1440, height: 520 }) // bàn phím chiếm nửa dưới
  await page.waitForTimeout(300)
  await expect(oTim, "cửa sổ co lại mà danh sách đóng mất").toBeVisible()
  await oTim.pressSequentially(" trả")
  await expect(page.getByRole("option")).toHaveCount(1)
  // Bấm ra ngoài: vẫn đóng.
  await page.waitForTimeout(300)
  await page.mouse.click(5, 5)
  await expect(oTim).toHaveCount(0)
})
