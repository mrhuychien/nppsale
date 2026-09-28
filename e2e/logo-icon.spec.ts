import { test, expect } from "@playwright/test"

/** Chủ nhà 28/09/2026: "thay logo này vào, cả icon khi tạo icon ngoài màn hình". */
test("chưa đăng nhập vẫn lấy được icon; trang có link icon + apple-touch-icon; logo mới trên màn đăng nhập", async ({ page, request }) => {
  for (const u of ["/icons/logo.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/apple-touch-icon.png", "/manifest.webmanifest"]) {
    const r = await request.get(u)
    expect(r.status(), u).toBe(200)
  }
  await page.goto("/login")
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /apple-touch-icon\.png/)
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute("href", /\/icons\/logo\.svg/)
  await expect(page.getByRole("img", { name: "npp.sale" }).locator("visible=true")).toHaveCount(1)
})
