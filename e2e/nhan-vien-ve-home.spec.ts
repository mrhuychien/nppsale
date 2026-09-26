import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Khi đăng nhập vào hoặc gõ địa chỉ không nppsale.vercel.app → với nhân
 *   viên đang tự chuyển vào trang dashboard. Sửa lại nhân viên tự chuyển về trang home".
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("nhân viên: đăng nhập và gõ địa chỉ gốc đều về Trang chủ", async ({ page }) => {
  await doiVai("sales")
  try {
    await page.goto("/login")
    await page.fill("#identifier", "chu@npp.test")
    await page.fill("#password", "matkhau-e2e")
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/home$/)
    await page.goto("/")
    await expect(page).toHaveURL(/\/home$/)
    await page.goto("/login") // đã đăng nhập → về gốc → Trang chủ
    await expect(page).toHaveURL(/\/home$/)
  } finally {
    await doiVai("owner")
  }
})

test("chủ NPP: gõ địa chỉ gốc vẫn vào Tổng quan", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/")
  await expect(page).toHaveURL(/\/dashboard$/)
})

test("nhân viên mở thẳng /dashboard → về Trang chủ, không quay vòng chuyển trang", async ({ page }) => {
  await dangNhap(page)
  const loi: string[] = []
  page.on("pageerror", (e) => loi.push(e.message))
  await doiVai("sales")
  try {
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/home$/)
    await page.waitForTimeout(3000)
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByTestId("man-loi")).toHaveCount(0)
    expect(loi.filter((m) => m.includes("replaceState"))).toEqual([])
  } finally {
    await doiVai("owner")
  }
})
