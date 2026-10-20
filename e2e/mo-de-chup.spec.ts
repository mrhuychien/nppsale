import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 20/10/2026: "Màn điểm bán cần cập nhật, khi bấm vào mở để chụp -> mở ra chi tiết khách hàng ở phần chụp ảnh
 *   luôn (hiện tại đang phải cuộn chuột xuống mới thấy)". Nút "Mở để chụp" đi tới `/customers/<id>#anh-diem-ban`; chi tiết
 *   khách vẽ sau khi tải nên trang tự cuộn tới khối ảnh khi khối đã có. Mở khách bình thường thì vẫn ở đầu trang.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const KHACH = "00000000-0000-4000-8000-0000000000c1"
/** Mép trên của khối ảnh so với đầu khung nhìn (px). */
const mepTren = (page: Page) => page.evaluate(() => document.getElementById("anh-diem-ban")?.getBoundingClientRect().top ?? null)

test("Mở để chụp → chi tiết khách mở thẳng ở khối Ảnh điểm bán, nút Chụp ảnh thấy ngay không phải cuộn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers/missing-photos")
  const nut = page.getByRole("link", { name: "Mở để chụp" }).and(page.locator(`[href="/customers/${KHACH}#anh-diem-ban"]`))
  await expect(nut).toBeVisible()
  await nut.click()
  await expect(page).toHaveURL(new RegExp(`/customers/${KHACH}#anh-diem-ban$`))
  const khoi = page.locator("#anh-diem-ban")
  await expect(khoi.getByText("Ảnh điểm bán", { exact: true })).toBeInViewport()
  // Mép trên khối nằm ở phần đầu màn (dưới thanh đầu trang), không phải lấp ló ở đáy.
  await expect.poll(() => mepTren(page)).toBeLessThan(200)
  // Ô "Chụp ảnh 1/3" (nhãn của ô chọn ảnh) thấy ngay — bấm là chụp.
  await expect(khoi.getByText(/^Chụp ảnh \d\/\d$/)).toBeInViewport()
})

test("mở khách bình thường (không có neo) → vẫn ở đầu trang, không bị kéo xuống khối ảnh", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/customers/${KHACH}`)
  await expect(page.locator("#anh-diem-ban")).toBeAttached()
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await mepTren(page)).toBeGreaterThan(400)
})
