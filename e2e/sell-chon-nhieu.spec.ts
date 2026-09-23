import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ YÊU CẦU 23/09/2026 — "Làm đơn hàng trên mobile (kênh /sell), khi chọn
 *   sản phẩm thêm nút cho chọn nhiều sản phẩm 1 lúc rồi mới sang đơn hàng.
 *   Ở chế độ chọn nhiều có thêm ô số lượng để gõ số lượng luôn."
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

type Gio = { cart: Array<{ productId: string; unit: string; qty: number; price: number }> }
const docGio = async (page: import("@playwright/test").Page): Promise<Gio> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("npp.sell.cart.v1") || '{"cart":[]}'))

test("/sell: chọn nhiều mặt hàng, gõ số lượng, rồi mới sang đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Chọn nhiều sản phẩm" }).click()

  // Sữa: gõ 5 hộp. Mì: chạm thẻ hai lần (+1 mỗi lần), rồi đổi sang thùng gõ 3.
  await page.getByLabel("Số lượng Sữa hộp", { exact: true }).fill("5")
  const theMi = page.locator('[role="button"]', { hasText: "Mì tôm" })
  await theMi.getByText("Mì tôm").click()
  await theMi.getByText("Mì tôm").click()
  await expect(page.getByLabel("Số lượng Mì tôm", { exact: true })).toHaveValue("2")
  await theMi.getByRole("button", { name: "thùng", exact: true }).click()
  await page.getByLabel("Số lượng Mì tôm", { exact: true }).fill("3")

  // Chưa bấm xác nhận thì giỏ chưa có gì — chạm thẻ không đi thẳng vào đơn.
  expect((await docGio(page)).cart).toHaveLength(0)
  await expect(page).toHaveURL(/\/sell$/)

  // 5 × 20.000 + 2 × 5.000 + 3 × 140.000 = 530.000
  const nut = page.getByRole("button", { name: /Vào đơn/ })
  await expect(nut).toContainText("3")
  await expect(nut).toContainText("530.000")
  await nut.click()
  await expect(page).toHaveURL(/\/sell\/cart/)

  const gio = (await docGio(page)).cart.map((l) => `${l.unit}:${l.qty}:${l.price}`).sort()
  expect(gio).toEqual(["gói:2:5000", "hộp:5:20000", "thùng:3:140000"])
})

test("/sell: ô số lượng hiện số đang có trong giỏ, và gõ là ĐẶT chứ không cộng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  // Chạm thường một lần: Sữa 1 hộp vào giỏ, màn chuyển sang giỏ.
  await page.locator('[role="button"]', { hasText: "Sữa hộp" }).getByText("Sữa hộp").click()
  await expect(page).toHaveURL(/\/sell\/cart/)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Chọn nhiều sản phẩm" }).click()
  const o = page.getByLabel("Số lượng Sữa hộp", { exact: true })
  await expect(o, "ô không hiện số đang có trong giỏ").toHaveValue("1")
  await o.fill("4")
  await page.getByRole("button", { name: /Vào đơn/ }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)
  const sua = (await docGio(page)).cart.filter((l) => l.unit === "hộp" && l.price === 20000)
  expect(sua.map((l) => l.qty), "cộng dồn thành 5 thay vì đặt 4").toEqual([4])
})
