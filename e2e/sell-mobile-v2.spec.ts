import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Làm lại giao diện sell mobile cho nhân viên bán hàng
 *   theo giao diện mới" — bản thiết kế docs/design/sell-mobile-v2.html.
 *
 * 2a Thêm hàng: +/− NGAY TRÊN THẺ, ở lại màn, thanh đáy "N mặt hàng · Xem đơn".
 * 2b Đơn hàng: bộ đếm trên dòng, X xoá dòng, "Tổng tiền" mở chi tiết + VAT cả đơn.
 * 1a/1b Hàng trả: cùng kiểu thẻ, "Tiếp tục" về phiếu trả.
 *
 * Mẫu: Sữa hộp 20.000/hộp (1 thùng = 24 hộp, tồn 1.000 hộp); Mì tôm 5.000/gói.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

type Gio = {
  cart: Array<{ productId: string; unit: string; qty: number; price: number; vatRate: number }>
  returnLines?: Array<{ unit: string; qty: number; price: number; isExchange: boolean }>
}
const docGio = async (page: Page): Promise<Gio> =>
  page.evaluate(() => JSON.parse(localStorage.getItem("npp.sell.cart.v1") || '{"cart":[]}'))
const the = (page: Page, ten: string) => page.getByTestId("the-san-pham").filter({ hasText: ten })

test("2a: + trên thẻ thêm vào đơn, ở lại màn; thẻ thành bộ đếm, thanh đáy đếm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await expect(page.getByRole("heading", { name: "Thêm hàng" })).toBeVisible()
  const xemDon = page.getByRole("button", { name: "Xem đơn" })
  await expect(xemDon, "giỏ trống mà vẫn bấm được Xem đơn").toBeDisabled()

  const sua = the(page, "Sữa hộp")
  await expect(sua).not.toHaveAttribute("data-chon")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await expect(page, "chạm + mà màn nhảy đi").toHaveURL(/\/sell$/)
  await expect(sua).toHaveAttribute("data-chon", "")
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveText("1")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await expect(page.getByLabel("Số lượng Sữa hộp", { exact: true })).toHaveText("2")

  // Mì: đổi sang thùng rồi thêm — dòng theo đúng đơn vị đang chọn.
  await the(page, "Mì tôm").getByRole("button", { name: "thùng", exact: true }).click()
  await page.getByRole("button", { name: "Thêm Mì tôm", exact: true }).click()

  await expect(page.getByText("2 mặt hàng trong đơn")).toBeVisible()
  const g = (await docGio(page)).cart.map((l) => `${l.unit}:${l.qty}:${l.price}`).sort()
  expect(g).toEqual(["hộp:2:20000", "thùng:1:140000"])
  await expect(page.getByText("180.000", { exact: false }).first()).toBeVisible()

  // − về 0 là bỏ dòng, thẻ trở lại nút +.
  await page.getByRole("button", { name: "Bớt Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Bớt Sữa hộp", exact: true }).click()
  await expect(sua).not.toHaveAttribute("data-chon")
  await expect(page.getByText("1 mặt hàng trong đơn")).toBeVisible()

  await xemDon.click()
  await expect(page).toHaveURL(/\/sell\/cart/)
  await expect(page.getByRole("heading", { name: "Đơn hàng" })).toBeVisible()
})

test("2a: luồng tác vụ không có thanh nav dưới, có nút lùi", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await expect(page.getByRole("button", { name: "Quay lại" })).toBeVisible()
  await expect(page.getByRole("navigation").filter({ hasText: "Trang chủ" })).toHaveCount(0)
})

test("2a: vượt số còn bán được thì cảnh báo, vẫn thêm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await the(page, "Sữa hộp").getByRole("button", { name: "thùng", exact: true }).click()
  for (let i = 0; i < 42; i++) await page.getByRole("button", { name: /^(Thêm) Sữa hộp$/ }).first().click()
  await expect(page.getByText(/vượt số còn bán được/).first()).toBeVisible()
  expect((await docGio(page)).cart.find((l) => l.unit === "thùng")?.qty).toBe(42)
})

test("2b: bộ đếm trên dòng, X xoá dòng, − dừng ở 1, VAT cả đơn là nút phân đoạn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Thêm Mì tôm", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)

  const dongSua = page.getByTestId("dong-gio").filter({ hasText: "Sữa hộp" })
  await expect(dongSua.getByRole("button", { name: "Giảm" }), "− ở 1 mà vẫn bấm được").toBeDisabled()
  await dongSua.getByRole("button", { name: "Tăng" }).click()
  await dongSua.getByRole("button", { name: "Tăng" }).click()
  await expect(dongSua.getByLabel("Số lượng")).toHaveValue("3")
  await expect(dongSua).toContainText("60.000")

  await page.getByRole("button", { name: "Xoá Mì tôm" }).click()
  await expect(page.getByTestId("dong-gio")).toHaveCount(1)

  // "Tổng tiền" mở chi tiết thanh toán; thuế chọn thẳng một mức cho cả đơn.
  const tong = page.getByRole("button", { name: /Tổng tiền/ })
  await tong.click()
  await expect(tong).toHaveAttribute("aria-expanded", "true")
  const nhom = page.getByRole("group", { name: "Thuế VAT cả đơn" })
  await nhom.getByRole("button", { name: "8%" }).click()
  await expect.poll(async () => (await docGio(page)).cart[0].vatRate).toBe(0.08)
  await expect(nhom.getByRole("button", { name: "8%" })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Đóng chi tiết thanh toán" }).click()
  await expect(tong).toHaveAttribute("aria-expanded", "false")
})

test("3a: chạm tên dòng mở sheet; sửa số lượng, Cập nhật đóng sheet", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await page.getByTestId("dong-gio").getByRole("button", { name: /Sữa hộp/ }).first().click()
  const sheet = page.getByRole("dialog")
  await expect(sheet).toBeVisible()
  await sheet.getByRole("button", { name: "Tăng" }).click()
  await expect(sheet.getByText("Thành tiền")).toBeVisible()
  await sheet.getByRole("button", { name: /^Cập nhật · 40\.000/ }).click()
  await expect(sheet).toBeHidden()
  expect((await docGio(page)).cart[0].qty).toBe(2)
})

test("1a → 1b: chọn hàng trả trên thẻ, Tiếp tục về phiếu trả; hàng trả không lọt vào giỏ bán", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell?mode=return")
  await expect(page.getByRole("heading", { name: "Chọn hàng trả" })).toBeVisible()
  await page.getByRole("button", { name: "Trả Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Trả Mì tôm", exact: true }).click()
  await expect(page).toHaveURL(/mode=return/)
  await expect(page.getByText("2 mặt hàng · 3 đơn vị")).toBeVisible()
  await expect(page.getByText("−45.000", { exact: false }).first()).toBeVisible()
  await page.getByRole("button", { name: "Tiếp tục" }).click()
  await expect(page).toHaveURL(/\/sell\/returns/)

  const s = await docGio(page)
  expect((s.returnLines ?? []).map((l) => `${l.unit}:${l.qty}:${l.price}:${l.isExchange}`).sort())
    .toEqual(["gói:1:5000:false", "hộp:2:20000:false"])
  expect(s.cart ?? [], "hàng trả lọt vào giỏ bán").toHaveLength(0)

  // 1b: đổi hàng thì dòng không trừ tiền.
  const dong = page.getByTestId("dong-tra-sell").filter({ hasText: "Mì tôm" })
  await dong.getByRole("button", { name: "Đổi hàng" }).click()
  await expect(dong).toContainText("Đổi 1:1, không trừ tiền")
})
