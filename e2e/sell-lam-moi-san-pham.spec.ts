import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026: "Trên màn sell mobile NVBH khi sản phẩm cập nhật thì bao lâu mới xuất
 *   hiện" (trước đây tới 30 phút) → "Làm đi, thêm nút làm mới sản phẩm". Mig 209: số phiên danh
 *   mục tăng khi sản phẩm / giá / đơn vị đổi; máy hỏi số đó khi mở màn / quay lại app (quá 2 phút).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const SUA = "00000000-0000-4000-8000-0000000000d1"
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const doiTen = async (ten: string, phien: number) => {
  await api(`products?id=eq.${SUA}`, "PATCH", { name: ten })
  await api("danh_muc_ban_phien?id=eq.1", "PATCH", { phien })
}

test.afterEach(async () => {
  await doiTen("Sữa hộp", 1)
})

test("nút Làm mới sản phẩm: tải lại danh mục ngay, báo giờ cập nhật", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await expect(page.getByText("Sữa hộp").first()).toBeVisible()
  await doiTen("Sữa hộp MỚI", 2)
  await page.getByRole("button", { name: "Làm mới sản phẩm" }).click()
  await expect(page.getByText("Sữa hộp MỚI").first()).toBeVisible()
  await expect(page.getByText("Đã cập nhật sản phẩm", { exact: true })).toBeVisible()
})

test("quay lại app sau hơn 2 phút: số phiên đổi → tải lại; không đổi → chỉ làm mới tồn", async ({ page }) => {
  await page.clock.install()
  await dangNhap(page)
  await page.goto("/sell")
  await expect(page.getByText("Sữa hộp").first()).toBeVisible()
  await page.waitForLoadState("networkidle")

  const quayLai = async () => {
    await page.clock.fastForward("03:00")
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))
    await page.waitForTimeout(1500)
  }

  // Không đổi gì: hỏi tồn + số phiên, KHÔNG tải lại sản phẩm.
  let t = (await nhatKy()).length
  await quayLai()
  let ds = (await nhatKy()).slice(t)
  expect(ds.filter((x) => x.path === "/rest/v1/danh_muc_ban_phien").length, "hỏi số phiên").toBe(1)
  expect(ds.filter((x) => x.path === "/rest/v1/products").length, "không tải lại sản phẩm").toBe(0)

  // Đổi sản phẩm (số phiên tăng) → tải lại, tên mới hiện.
  await doiTen("Sữa hộp ĐÃ SỬA", 2)
  t = (await nhatKy()).length
  await quayLai()
  await expect(page.getByText("Sữa hộp ĐÃ SỬA").first()).toBeVisible()
  ds = (await nhatKy()).slice(t)
  expect(ds.filter((x) => x.path === "/rest/v1/products").length, "tải lại sản phẩm").toBeGreaterThan(0)
})
