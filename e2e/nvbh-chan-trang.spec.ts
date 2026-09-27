import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/** ⚠ CHỦ NHÀ 27/09/2026: "Màn mobile của NVBH, phần chân trang, nút Công nợ thay bằng Báo cáo tổng hợp". */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("NVBH: chân trang có Báo cáo (mở Bán hàng), không còn Công nợ; sáng ở mọi màn báo cáo", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/home")
    const nav = page.getByRole("navigation", { name: "Điều hướng chính" })
    await expect(nav.getByRole("link", { name: "Công nợ" })).toHaveCount(0)
    const bc = nav.getByRole("link", { name: "Báo cáo" })
    await expect(bc).toHaveAttribute("href", "/bao-cao/ban-hang")
    await bc.click()
    await expect(page).toHaveURL(/\/bao-cao\/ban-hang/)
    await expect(nav.getByRole("link", { name: "Báo cáo" })).toHaveAttribute("aria-current", "page")
    await page.goto("/bao-cao/cuoi-ngay")
    await expect(nav.getByRole("link", { name: "Báo cáo" })).toHaveAttribute("aria-current", "page")
  } finally {
    await doiVai("owner")
  }
})
