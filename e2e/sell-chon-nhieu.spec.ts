import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026:
 *   · "bỏ dấu + ở từng dòng, thay vì bấm vào dấu cộng khó bấm thì người dùng bấm
 *     vào dòng, tác dụng giống bấm vào dấu +" — "Dấu + lúc đầu chứ ko phải dấu +
 *     trong +- sản phẩm".
 *   · "Đảo ngược: chế độ chọn từng sản phẩm một là mặc định, chế độ chọn nhiều
 *     sản phẩm là option" — giữ tới khi người dùng tự tắt; bán và trả riêng.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const the = (page: import("@playwright/test").Page, ten: string) =>
  page.getByTestId("the-san-pham").filter({ hasText: ten })

test("mặc định chọn từng mã: bấm vào DÒNG là thêm và sang đơn; không còn nút + lúc đầu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "false")
  const sua = the(page, "Sữa hộp")
  await expect(sua.getByRole("button", { name: /^(Thêm|Tăng) Sữa hộp$/ }), "vẫn còn nút + lúc đầu").toHaveCount(0)
  // Bấm vào tên hàng (giữa dòng) — không phải nút nào.
  await sua.getByText("Sữa hộp", { exact: true }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)
})

test("bấm nút đơn vị trên dòng chỉ đổi đơn vị, không thêm hàng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  const mi = the(page, "Mì tôm")
  const thung = mi.getByRole("button", { name: "thùng", exact: true })
  await thung.click()
  // Chờ màn xử lý xong cú bấm (đơn vị đã đổi) rồi mới kết luận — kiểm ngay là
  // qua trước cả khi màn kịp nhảy đi.
  await expect(thung).toHaveAttribute("aria-pressed", "true")
  await mi.getByRole("button", { name: "gói", exact: true }).click()
  await expect(mi.getByRole("button", { name: "gói", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page).toHaveURL(/\/sell$/)
  await expect(mi).not.toHaveAttribute("data-chon")
  const gio = await page.evaluate(() => JSON.parse(localStorage.getItem("npp.sell.cart.v1") || '{"cart":[]}'))
  expect(gio.cart ?? [], "bấm đơn vị mà hàng vào giỏ").toHaveLength(0)
})

test("chọn nhiều (tuỳ chọn): bấm dòng ở lại màn; bộ − số + còn; giữ tới khi tự tắt", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  const nut = page.getByTestId("chon-nhieu")
  await nut.click()
  await expect(nut).toHaveAttribute("aria-pressed", "true")
  const sua = the(page, "Sữa hộp")
  await sua.getByText("Sữa hộp", { exact: true }).click()
  await expect(page).toHaveURL(/\/sell$/)
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveText("1")
  await sua.getByText("Sữa hộp", { exact: true }).click() // bấm dòng lần nữa = +1
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveText("2")
  await page.getByRole("button", { name: "Tăng Sữa hộp", exact: true }).click() // + trong bộ = +1, không +2
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveText("3")
  await page.getByRole("button", { name: "Bớt Sữa hộp", exact: true }).click()
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveText("2")

  await page.reload()
  await expect(nut).toHaveAttribute("aria-pressed", "true")
  await nut.click()
  await expect(nut).toHaveAttribute("aria-pressed", "false")
  await page.reload()
  await expect(nut).toHaveAttribute("aria-pressed", "false")
})

test("chọn hàng trả: mặc định chọn từng mã — bấm dòng là về phiếu trả; công tắc riêng với màn bán", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell?mode=return")
  const nut = page.getByTestId("chon-nhieu")
  await expect(nut).toHaveAttribute("aria-pressed", "false")
  await the(page, "Sữa hộp").getByText("Sữa hộp", { exact: true }).click()
  await expect(page, "chọn từng mã mà không về phiếu trả").not.toHaveURL(/\/sell\?mode=return/)

  await page.goto("/sell?mode=return")
  await nut.click()
  await expect(nut).toHaveAttribute("aria-pressed", "true")
  await page.goto("/sell")
  await expect(nut).toHaveAttribute("aria-pressed", "false") // màn bán không bị bật theo
})
