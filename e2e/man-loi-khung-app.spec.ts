import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: /dashboard trên điện thoại trắng trơn "Application error: a
 *   client-side exception has occurred". Lỗi ở khung app (ngoài `(dashboard)/error.tsx`) nay
 *   phải ra màn lỗi có câu lỗi + nút Tải lại, và được báo về `/api/client-error`.
 */
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiTen = (full_name: unknown) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ full_name }) })

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test("khung app ném lỗi → màn lỗi có câu lỗi, báo về máy chủ — không màn trắng", async ({ page }) => {
  await dangNhap(page)
  // Dữ liệu hỏng ở khung app: `full_name` là SỐ → Header gọi `.split` thì ném TypeError.
  await doiTen(12345)
  // Playwright không đọc được thân của sendBeacon → tắt đi để đi nhánh fetch dự phòng.
  await page.addInitScript(() => { Object.defineProperty(navigator, "sendBeacon", { value: () => false }) })
  try {
    const bao = page.waitForRequest((r) => r.url().endsWith("/api/client-error") && r.method() === "POST")
    await page.goto("/dashboard")
    await expect(page.getByTestId("man-loi")).toBeVisible()
    await expect(page.getByTestId("man-loi")).toContainText("split")
    await expect(page.getByRole("button", { name: "Tải lại trang" })).toBeVisible()
    await expect(page.getByText("Application error")).toHaveCount(0)
    const req = await bao
    expect(JSON.parse(req.postData() ?? "{}")).toMatchObject({ noi: "app/error", duongDan: "/dashboard" })
  } finally {
    await doiTen("Chủ NPP")
  }
})
