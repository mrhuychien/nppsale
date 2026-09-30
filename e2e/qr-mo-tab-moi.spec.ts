import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: "bấm vào Mã qr từng nhân viên thêm phần ấn vào link -> mở trình duyệt theo
 *   link nhân viên đó để vào xem ở tab khác" · "mở luôn cửa sổ ẩn danh được k … để k mất phiên đăng
 *   nhập" (trang không tự mở ẩn danh được → chép link + chỉ phím tắt).
 */
const LINK = "http://127.0.0.1:3000/qr-login?t=abcdefabcdefabcdefabcdef"

test("hộp mã QR: link mở tab mới + chép link để mở ẩn danh", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.route("**/api/admin/users/*/qr", (r) =>
    r.fulfill({ json: { token: "abcdefabcdefabcdefabcdef", loginUrl: LINK, issuedAt: "2026-09-30T00:00:00Z" } })
  )
  await dangNhap(page)
  await page.goto("/settings/users")
  await page.getByRole("button", { name: "Mã QR đăng nhập" }).first().click()
  const link = page.getByTestId("qr-link-mo")
  await expect(link).toHaveAttribute("href", LINK)
  await expect(link).toHaveAttribute("target", "_blank")
  await expect(page.getByRole("link", { name: /Mở tab mới/ })).toHaveAttribute("target", "_blank")

  await page.getByTestId("qr-chep-an-danh").click()
  await expect(page.getByTestId("qr-huong-dan-an-danh")).toContainText("Ctrl + Shift + N")
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINK)
})
