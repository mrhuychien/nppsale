import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"
import { CAMERA_GIA, cameraDaTat, cameraDangChay, theoDoiCamera } from "./camera-trang"

/**
 * ⚠ CHỦ NHÀ 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được".
 *   Bản cũ: đóng hộp quét khi camera ĐANG chạy → hàm dọn gọi `clear()` của html5-qrcode ngay sau `stop()`, thư viện ném
 *   lỗi đồng bộ ("Cannot clear while scan is ongoing") → React đưa lên màn lỗi "Không thể kết nối", mất form đang nhập.
 *   Camera giả MẶC ĐỊNH của Chromium (hình động, không có mã) — hộp mở lâu, người dùng tự đóng.
 */
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  permissions: ["camera"],
  launchOptions: { args: CAMERA_GIA },
})

test("đóng hộp quét khi camera đang chạy: KHÔNG sập trang, form còn nguyên, camera tắt; mở lại được", async ({ page }) => {
  const loi: string[] = []
  page.on("pageerror", (e) => loi.push(String(e)))
  await theoDoiCamera(page)
  await dangNhap(page)
  await page.goto("/products/new")
  await page.locator("#name").fill("Hàng thử camera")
  await page.getByTestId("quet-ma-vach").click()
  const hop = page.getByRole("dialog", { name: "Quét mã vạch sản phẩm" })
  await expect(hop).toBeVisible()
  await expect.poll(() => cameraDangChay(page)).toBeGreaterThanOrEqual(2)
  await expect(hop.getByText("Đang mở camera…")).toHaveCount(0)
  await page.waitForTimeout(500) // vòng quét đang chạy
  await hop.getByRole("button", { name: "Đóng" }).click()
  await expect(hop).toHaveCount(0)
  await expect.poll(() => cameraDaTat(page)).toBe(true)
  await page.waitForTimeout(500)
  await expect(page.getByText("Không thể kết nối")).toHaveCount(0)
  await expect(page.locator("#name")).toHaveValue("Hàng thử camera")
  expect(loi).toEqual([])
  // Mở lại: camera chạy lại, đóng lại vẫn êm.
  await page.getByTestId("quet-ma-vach").click()
  await expect(hop).toBeVisible()
  await expect.poll(() => cameraDangChay(page)).toBeGreaterThanOrEqual(2)
  await hop.getByRole("button", { name: "Đóng" }).click()
  await expect(hop).toHaveCount(0)
  await expect.poll(() => cameraDaTat(page)).toBe(true)
  expect(loi).toEqual([])
})

test("đóng hộp NGAY khi vừa mở (camera chưa kịp chạy): không sập trang, luồng về sau vẫn bị tắt", async ({ page }) => {
  const loi: string[] = []
  page.on("pageerror", (e) => loi.push(String(e)))
  await theoDoiCamera(page)
  await dangNhap(page)
  await page.goto("/products/new")
  await page.getByTestId("quet-ma-vach").click()
  const hop = page.getByRole("dialog", { name: "Quét mã vạch sản phẩm" })
  await hop.getByRole("button", { name: "Đóng" }).click()
  await expect(hop).toHaveCount(0)
  await page.waitForTimeout(1000)
  // Có xin camera thì luồng ấy phải tắt (đèn camera không được sáng mãi sau khi hộp đã đóng).
  const daXin = await page.evaluate(() => (window as unknown as { __luong: MediaStream[] }).__luong.length)
  if (daXin > 0) expect(await cameraDaTat(page)).toBe(true)
  await expect(page.getByText("Không thể kết nối")).toHaveCount(0)
  expect(loi).toEqual([])
})
