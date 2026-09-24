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
  // ⚠ Đổi đơn vị thì số đã gõ ĐI THEO — không nằm ẩn ở "gói" rồi lén vào đơn.
  await expect(page.getByLabel("Số lượng Mì tôm", { exact: true })).toHaveValue("2")
  await page.getByLabel("Số lượng Mì tôm", { exact: true }).fill("3")

  // Chưa bấm xác nhận thì giỏ chưa có gì — chạm thẻ không đi thẳng vào đơn.
  expect((await docGio(page)).cart).toHaveLength(0)
  await expect(page).toHaveURL(/\/sell$/)

  // 5 × 20.000 + 3 × 140.000 = 520.000 (hai mặt hàng)
  const nut = page.getByRole("button", { name: /Vào đơn/ })
  await expect(nut).toContainText("2")
  await expect(nut).toContainText("520.000")
  await nut.click()
  await expect(page).toHaveURL(/\/sell\/cart/)

  const gio = (await docGio(page)).cart.map((l) => `${l.unit}:${l.qty}:${l.price}`).sort()
  expect(gio).toEqual(["hộp:5:20000", "thùng:3:140000"])
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

/** Vượt số còn bán được: cảnh báo theo SỐ LƯỢNG, không chỉ khi hết hàng. */
test("/sell: chọn nhiều quá số còn bán được thì cảnh báo, vẫn thêm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Chọn nhiều sản phẩm" }).click()
  const the = page.locator('[role="button"]', { hasText: "Sữa hộp" })
  await the.getByRole("button", { name: "thùng", exact: true }).click()
  await page.getByLabel("Số lượng Sữa hộp", { exact: true }).fill("50") // 1.200 hộp > 1.000 tồn
  await page.getByRole("button", { name: /Vào đơn/ }).click()
  await expect(page.getByText(/vượt số còn bán được/).first()).toBeVisible()
  await expect(page).toHaveURL(/\/sell\/cart/)
})

/** "Sản phẩm nào được chọn thì tô màu cho dễ nhìn" (chủ nhà, 23/09/2026). */
test("/sell: thẻ có số lượng > 0 được tô màu, về 0 thì bỏ tô", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Chọn nhiều sản phẩm" }).click()
  const theSua = page.locator('[role="button"]', { hasText: "Sữa hộp" })
  const theMi = page.locator('[role="button"]', { hasText: "Mì tôm" })
  await expect(theSua).not.toHaveAttribute("data-chon")
  await page.getByLabel("Số lượng Sữa hộp", { exact: true }).fill("2")
  await expect(theSua).toHaveAttribute("data-chon", "")
  await expect(theMi).not.toHaveAttribute("data-chon")
  // Tô màu thật trên màn — nền khác thẻ chưa chọn.
  const nen = (l: typeof theSua) => l.evaluate((e) => getComputedStyle(e).backgroundColor)
  expect(await nen(theSua)).not.toBe(await nen(theMi))
  await page.getByRole("button", { name: "Bớt Số lượng Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Bớt Số lượng Sữa hộp", exact: true }).click()
  await expect(theSua).not.toHaveAttribute("data-chon")
})

type PhieuTra = { returnLines: Array<{ productId: string; unit: string; qty: number; price: number; isExchange: boolean }> }
const docTra = async (page: import("@playwright/test").Page): Promise<PhieuTra> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("npp.sell.cart.v1") || '{"returnLines":[]}'))

/** Màn Chọn hàng trả cũng chọn nhiều được — số vào PHIẾU TRẢ, không vào giỏ bán. */
test("/sell?mode=return: chọn nhiều mặt hàng trả rồi vào phiếu trả", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell?mode=return")
  await expect(page.getByRole("heading", { name: "Chọn hàng trả" })).toBeVisible()
  await page.getByRole("button", { name: "Chọn nhiều sản phẩm" }).click()

  await page.getByLabel("Số lượng Sữa hộp", { exact: true }).fill("3")
  const theMi = page.locator('[role="button"]', { hasText: "Mì tôm" })
  await theMi.getByText("Mì tôm").click()
  await expect(page.getByLabel("Số lượng Mì tôm", { exact: true })).toHaveValue("1")
  await expect(theMi).toHaveAttribute("data-chon", "")
  // Chưa xác nhận thì phiếu trả chưa có gì, và màn không nhảy đi.
  expect((await docTra(page)).returnLines ?? []).toHaveLength(0)
  await expect(page).toHaveURL(/mode=return/)

  const nut = page.getByRole("button", { name: /Vào phiếu trả/ })
  await expect(nut).toContainText("2")
  await expect(nut).toContainText("65.000") // 3 × 20.000 + 1 × 5.000
  await nut.click()
  await expect(page).toHaveURL(/\/sell\/returns/)

  const s = await docTra(page)
  expect(s.returnLines.map((l) => `${l.unit}:${l.qty}:${l.price}:${l.isExchange}`).sort())
    .toEqual(["gói:1:5000:false", "hộp:3:20000:false"])
  expect((s as unknown as { cart: unknown[] }).cart ?? [], "hàng trả lọt vào giỏ bán").toHaveLength(0)
})

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "đã bấm nút chọn nhiều sản phẩm thì phải luôn lưu
 *   trạng thái đến khi người dùng tự tắt. Hiện tại vào đơn xong quay lại lại mất".
 */
test("/sell: chế độ chọn nhiều GIỮ qua lần vào đơn rồi quay lại, tới khi tự tắt", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  const cong = page.getByRole("button", { name: "Chọn nhiều sản phẩm" })
  await cong.click()
  await page.getByLabel("Số lượng Sữa hộp", { exact: true }).fill("5")
  await page.getByRole("button", { name: /Vào đơn/ }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)

  // Quay lại chọn hàng: chế độ vẫn bật, số vừa gõ đã vào đơn nên ô hiện số trong giỏ.
  await page.goto("/sell")
  await expect(cong).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveValue("5")
  // Chưa gõ gì mới mà đơn có hàng: nút lớn đi thẳng tới đơn.
  await page.getByRole("button", { name: /Xem đơn/ }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)

  // Tải lại cả trang vẫn nhớ.
  await page.goto("/sell")
  await page.reload()
  await expect(cong).toHaveAttribute("aria-pressed", "true")

  // Người dùng TỰ TẮT thì mới tắt — và tắt thì nhớ là tắt.
  await page.getByRole("button", { name: "Tắt chọn nhiều" }).click()
  await expect(cong).toHaveAttribute("aria-pressed", "false")
  await page.reload()
  await expect(cong).toHaveAttribute("aria-pressed", "false")
})

test("/sell: công tắc đặt hàng và hàng trả nhớ RIÊNG", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  const cong = page.getByRole("button", { name: "Chọn nhiều sản phẩm" })
  await cong.click()
  await expect(cong).toHaveAttribute("aria-pressed", "true")
  await page.goto("/sell?mode=return")
  await expect(cong, "bật ở đặt hàng mà hàng trả cũng bật theo").toHaveAttribute("aria-pressed", "false")
  await page.goto("/sell")
  await expect(cong).toHaveAttribute("aria-pressed", "true")
})
