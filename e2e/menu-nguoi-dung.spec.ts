import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/** ⚠ CHỦ NHÀ 26/09/2026: "bấm vào icon và tên người dùng phải ra menu người dùng". */
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("NVBH: bấm ảnh đại diện / tên ở trang chủ → menu theo quyền; bấm Phiếu lương đi đúng chỗ", async ({ page }) => {
    await dangNhap(page)
    await doiVai("sales")
    try {
      await page.goto("/home")
      await page.getByTestId("trang-chu-nvbh").getByText(/^Chào /).click() // bấm vào TÊN
      const menu = page.getByTestId("menu-nguoi-dung")
      await expect(menu).toContainText("Chủ NPP")
      await expect(menu).toContainText("NV Bán hàng")
      await expect(menu.getByRole("menuitem", { name: "Phiếu lương của tôi" })).toBeVisible()
      await expect(menu.getByRole("menuitem", { name: "Đăng xuất" })).toBeVisible()
      await expect(menu.getByRole("menuitem", { name: "Tổng quan" })).toHaveCount(0)
      await expect(menu.getByRole("menuitem", { name: "Cài đặt" })).toHaveCount(0)
      await menu.getByRole("menuitem", { name: "Phiếu lương của tôi" }).click()
      await expect(page).toHaveURL(/\/luong-cua-toi$/)
    } finally {
      await doiVai("owner")
    }
  })

  test("đầu trang xanh Đơn hàng / Khách hàng: bấm ảnh đại diện → menu người dùng", async ({ page }) => {
    await dangNhap(page)
    for (const [url, id] of [["/orders", "don-mobile"], ["/customers", "kh-mobile"]] as const) {
      await page.goto(url)
      await page.getByTestId(id).getByRole("button", { name: "Tài khoản" }).click()
      await expect(page.getByTestId("menu-nguoi-dung").getByRole("menuitem", { name: "Đăng xuất" })).toBeVisible()
      await page.keyboard.press("Escape")
    }
  })
})

test("máy tính: bấm ảnh đại diện + tên ở thanh trên → menu có Tổng quan, Cài đặt, Đăng xuất", async ({ page }) => {
  await dangNhap(page)
  await page.getByRole("banner").getByRole("button", { name: "Tài khoản" }).click()
  const menu = page.getByTestId("menu-nguoi-dung")
  for (const m of ["Trang chủ", "Tổng quan", "Cài đặt", "Trợ giúp", "Đăng xuất"]) {
    await expect(menu.getByRole("menuitem", { name: m })).toBeVisible()
  }
  await menu.getByRole("menuitem", { name: "Đăng xuất" }).click()
  await expect(page).toHaveURL(/\/login/)
})
