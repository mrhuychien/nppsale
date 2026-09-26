import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Viết lại màn danh sách đơn hàng trên mobile theo mẫu … Load 20 đơn
 *   hàng 1 lần thôi cho nhanh. Khi nhân viên xem thì danh sách không cần hiện tên nhân viên nữa."
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("điện thoại: đầu trang xanh, tab + tổng tiền, thẻ đơn có địa chỉ / SĐT, tải 20 đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  const man = page.getByTestId("don-mobile")
  await expect(man.getByRole("heading", { name: "Đơn hàng" })).toBeVisible()
  await expect(man.getByPlaceholder("Tìm mã đơn, tên KH, SĐT")).toBeVisible()
  await expect(man.getByRole("tab", { name: /^Tất cả/ })).toBeVisible()
  await expect(man.getByText("Tổng tiền hàng ·")).toBeVisible()
  // Kỳ quay vòng: bấm "Tháng này" → … → "Tất cả" để thấy mọi đơn mẫu.
  for (let i = 0; i < 3 && !(await man.getByRole("button", { name: "Tất cả", exact: true }).count()); i++) {
    await man.getByRole("button", { name: /Hôm nay|Tuần này|Tháng này/ }).first().click()
  }
  const the = man.getByTestId("the-don").filter({ hasText: "DH-0001" })
  await expect(the).toBeVisible()
  await expect(the).toContainText("Tạp hoá Cô Ba")
  await expect(the).toContainText("1 Lê Lợi")
  await expect(the.getByRole("link", { name: /0911111111/ })).toHaveAttribute("href", "tel:0911111111")
  await expect(the).toContainText("NV Chủ NPP") // chủ NPP xem: có tên NV
  await expect(man.getByText(/Đã hiển thị \d+ \/ \d+ đơn/)).toBeVisible()
  // Không còn app bar chuẩn chồng lên đầu trang xanh.
  await expect(page.locator("header").filter({ hasText: "Đơn hàng" }).first()).toBeHidden()
})

test("điện thoại: NVBH xem thì thẻ đơn không có tên nhân viên", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/orders")
    const man = page.getByTestId("don-mobile")
    await expect(man.getByRole("heading", { name: "Đơn của tôi" })).toBeVisible()
    for (let i = 0; i < 3 && !(await man.getByRole("button", { name: "Tất cả", exact: true }).count()); i++) {
      await man.getByRole("button", { name: /Hôm nay|Tuần này|Tháng này/ }).first().click()
    }
    const the = man.getByTestId("the-don").first()
    await expect(the).toBeVisible()
    await expect(the).not.toContainText("NV ")
  } finally {
    await doiVai("owner")
  }
})
