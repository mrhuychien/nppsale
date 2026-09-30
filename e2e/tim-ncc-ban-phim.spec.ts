import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/*
 * Chủ nhà 30/09/2026: "Màn nhập hàng NCC trên điện thoại: khi tìm ncc phần danh sách tìm tụt xuống dưới
 * bàn phím". Giả bàn phím mở: visualViewport chỉ còn 400px (phần dưới là bàn phím).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const CON_THAY = 400

async function giaBanPhim(page: Page) {
  await page.addInitScript((h) => {
    const et = new EventTarget() as EventTarget & { height: number; width: number; offsetTop: number; offsetLeft: number; scale: number }
    Object.assign(et, { height: h, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1 })
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => et })
  }, CON_THAY)
}

test("nhập hàng NCC: ngăn chọn NCC nằm trên bàn phím", async ({ page }) => {
  await giaBanPhim(page)
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  await page.getByTestId("chon-ncc").click()
  const ngan = page.getByTestId("chon-ncc-sheet")
  await expect(ngan.getByRole("button", { name: /Vinamilk/ })).toBeVisible()
  // Chờ ngăn trượt vào xong rồi mới đo.
  await expect.poll(async () => { const b = (await ngan.boundingBox())!; return b.y + b.height }).toBeLessThanOrEqual(CON_THAY + 1)
  await ngan.getByRole("button", { name: /Vinamilk/ }).click()
  await expect(page.getByTestId("chon-ncc")).toContainText("Vinamilk")
})

test("nhập kho: danh sách tìm NCC xổ ra vẫn trong phần màn còn thấy", async ({ page }) => {
  await giaBanPhim(page)
  await dangNhap(page)
  await page.goto("/inventory/stock-in")
  await page.locator("#stockin-supplier-m").click()
  const xo = page.getByTestId("search-select-xo").filter({ visible: true })
  await expect(xo).toBeVisible()
  await expect.poll(async () => { const b = (await xo.boundingBox())!; return b.y + b.height }).toBeLessThanOrEqual(CON_THAY + 1)
})
