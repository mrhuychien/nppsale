import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: link QR mở trình duyệt theo tài khoản nhân viên; iPhone có nút mở bằng
 *   Safari / Chrome riêng · "cửa sổ Qr ko có lối thoát, ko đóng ko chuyển được" → hộp cuộn trong màn
 *   hình + nút Đóng.
 */
const LINK = "http://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef"
test.use({
  viewport: { width: 390, height: 664 },
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
})

test("hộp mã QR trên iPhone: link, mở bằng Safari / Chrome, đóng được", async ({ page }) => {
  await page.route("**/api/admin/users/*/qr", (r) =>
    r.fulfill({ json: { token: "abcdefabcdefabcdefabcdef", loginUrl: LINK, issuedAt: "2026-09-30T00:00:00Z" } })
  )
  await dangNhap(page)
  await page.goto("/settings/users")
  // Điện thoại: chạm thẻ nhân viên → ngăn xem nhanh → nút QR (hộp QR mở CHỒNG lên ngăn đó).
  await page.getByText(/SĐT: 0900000000/).first().click()
  await page.getByRole("button", { name: "Mã QR đăng nhập" }).last().click()
  const hop = page.getByRole("dialog").filter({ hasText: "Mã QR đăng nhập" })
  await expect(hop.getByTestId("qr-link-mo")).toHaveAttribute("target", "_blank")
  await expect(hop.getByRole("link", { name: "Mở bằng Safari" })).toHaveAttribute("href", "x-safari-http://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef")
  await expect(hop.getByRole("link", { name: "Mở bằng Chrome" })).toHaveAttribute("href", "googlechrome://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef")
  await expect(hop.getByText("Mở tab mới")).toHaveCount(0)
  // Hộp không tràn khỏi màn hình; nút Đóng cuộn tới được và đóng hộp.
  const box = await hop.boundingBox()
  expect(box!.height).toBeLessThanOrEqual(664)
  await hop.getByTestId("qr-dong").click()
  await expect(hop).toBeHidden()
  // Đóng xong vẫn thao tác được màn (không kẹt lớp phủ).
  await page.getByRole("button", { name: "Mã QR đăng nhập" }).last().click()
  await expect(hop).toBeVisible()
  await hop.getByRole("button", { name: /close|đóng/i }).first().click()
  await expect(hop).toBeHidden()
})
