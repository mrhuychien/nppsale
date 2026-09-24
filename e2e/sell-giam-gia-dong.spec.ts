import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Fix ngược cả về phần làm đơn hàng trên sell mobile
 *   -> Bỏ VAT từng dòng. thêm giảm giá từng dòng theo %, giá trị."
 *
 * Mẫu: Sữa hộp 20.000/hộp.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

type Gio = { cart: Array<{ unit: string; qty: number; price: number; vatRate: number; discount?: { value: number; unit: string } }> }
const docGio = async (page: import("@playwright/test").Page): Promise<Gio> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("npp.sell.cart.v1") || '{"cart":[]}'))

test("/sell: giảm giá dòng theo % và theo đồng, không còn ô VAT từng dòng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)

  // Mở sheet sửa dòng.
  await page.getByTestId("dong-gio").getByRole("button", { name: /Sữa hộp/ }).first().click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByLabel("Giảm giá dòng", { exact: true })).toBeVisible()
  await expect(sheet.getByText("Thuế VAT", { exact: true }), "ô thuế từng dòng vẫn còn").toHaveCount(0)
  await sheet.getByRole("button", { name: "Tăng" }).click()

  // Giảm 10% trên 2 × 20.000.
  await sheet.getByRole("button", { name: "Giảm dòng theo %" }).click()
  await sheet.getByLabel("Giảm giá dòng", { exact: true }).fill("10")
  await expect(sheet.getByText(/Giảm 4\.000đ? · còn 18\.000đ?\/hộp/)).toBeVisible()

  // Lật sang đồng: số tiền giữ nguyên (4.000), rồi gõ 5.000.
  await sheet.getByRole("button", { name: "Giảm dòng theo đồng" }).click()
  await expect(sheet.getByLabel("Giảm giá dòng", { exact: true })).toHaveValue("4.000")
  await sheet.getByLabel("Giảm giá dòng", { exact: true }).fill("5000")
  await sheet.getByRole("button", { name: /^Cập nhật/ }).click()

  // Giỏ: nhãn giảm, giá sau giảm (35.000 / 2 = 17.500), không nhãn VAT dòng.
  const dong = page.getByTestId("dong-gio")
  await expect(dong.getByText(/^Giảm 5\.000đ?$/)).toBeVisible()
  await expect(dong.getByText(/^17\.500đ? \/ hộp$/)).toBeVisible()
  await expect(page.getByText(/^VAT \d+%$/)).toHaveCount(0)

  // Thuế đặt MỘT lần cho cả đơn.
  await page.getByRole("button", { name: /Tổng tiền/ }).click()
  const vat = page.getByRole("group", { name: "Thuế VAT cả đơn" })
  await expect(vat).toBeVisible()
  await vat.getByRole("button", { name: "10%" }).click()
  await expect.poll(async () => (await docGio(page)).cart[0].vatRate).toBe(0.1)

  const g = (await docGio(page)).cart[0]
  expect(g).toMatchObject({ unit: "hộp", qty: 2, price: 20000, discount: { value: 5000, unit: "vnd" } })
})

/** ⚠ CHỦ NHÀ 24/09/2026: "Màn sell mobile, làm đơn chưa có giảm giá tổng đơn". */
test("/sell: giảm giá cả đơn theo đồng và %, tổng tiền trừ theo", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)
  const tong = page.getByRole("button", { name: /Tổng tiền/ })
  await expect(tong).toContainText("20.000")

  const o = page.getByLabel("Giảm giá đơn", { exact: true })
  await o.fill("5000")
  await expect(tong, "gõ giảm đơn mà tổng không trừ").toContainText("15.000")
  await tong.click()
  await expect(page.getByText(/^−5\.000đ?$/).first()).toBeVisible()
  // Chi tiết thanh toán phủ màn (2b) — đóng lại mới chạm được thẻ giảm đơn.
  await page.getByRole("button", { name: "Đóng chi tiết thanh toán" }).click()

  // Lật sang %: số tiền giữ nguyên (25%), rồi gõ 10% → 2.000.
  await page.getByRole("button", { name: "Giảm đơn theo %" }).click()
  await expect(o).toHaveValue("25")
  await o.fill("10")
  await expect(tong).toContainText("18.000")
  expect((await docGio(page) as unknown as { docDiscount?: unknown }).docDiscount).toEqual({ value: 10, unit: "pct" })
})
