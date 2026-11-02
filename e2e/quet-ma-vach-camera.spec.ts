import { test, expect } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dangNhap } from "./helpers"
import { CAMERA_GIA, cameraDaTat, rangBuocCamera, theoDoiCamera } from "./camera-trang"
import { modulEan13, sinhVideoMaVach } from "./camera-gia.mjs"

/**
 * ⚠ CHỦ NHÀ 02/11/2026: "phần tạo sản phẩm mới trên điện thoại mã vạch chưa quét được".
 *   Bài cũ (quet-ma-vach-san-pham.spec.ts) đi đường Nhập tay nên camera hỏng vẫn xanh. Bài này cho Chromium CHIẾU khung
 *   hình giống camera điện thoại (e2e/camera-gia.mjs: mã nhỏ giữa khung — cầm ~12 cm, nền bao bì tối, mờ, nhiễu) thay
 *   camera thật. Bản cũ không đọc được mã nào trong 15 giây.
 *   Chromium Linux không có `BarcodeDetector` (bài còn xoá cho chắc) → đi đúng đường ZXing đã vá — đường của iPhone.
 */
const MA = "8934567138161" // EAN-13 hợp lệ, chưa sản phẩm nào trong sổ giả mang
const VIDEO = sinhVideoMaVach(join(tmpdir(), `npp-cam-ean-${MA}-1080x1920-30-v1.y4m`), {
  w: 1080, h: 1920, modul: modulEan13(MA), tiLe: 0.3, sigma: 1.2,
})

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  permissions: ["camera"],
  launchOptions: { args: [...CAMERA_GIA, `--use-file-for-fake-video-capture=${VIDEO}`] },
})

test("/products/new điện thoại: camera đọc mã → ô Mã vạch, hộp tự đóng, camera tắt; xin camera độ phân giải cao", async ({ page }) => {
  const loi: string[] = []
  page.on("pageerror", (e) => loi.push(String(e)))
  await theoDoiCamera(page)
  await dangNhap(page)
  await page.goto("/products/new")
  await expect(page.locator("#barcode")).toHaveValue("")
  await page.getByTestId("quet-ma-vach").click()
  const hop = page.getByRole("dialog", { name: "Quét mã vạch sản phẩm" })
  await expect(hop).toBeVisible()
  await expect(page.locator("#barcode")).toHaveValue(MA, { timeout: 10_000 })
  await expect(hop).toHaveCount(0)
  await expect.poll(() => cameraDaTat(page)).toBe(true)
  // Xin camera sau + khung lớn — để mặc định là 640×480, mã ở 10–15 cm không đủ điểm ảnh để đọc.
  const rb = (await rangBuocCamera(page)) as { video: { facingMode: unknown; width: { ideal: number } } }
  expect(rb.video.facingMode).toEqual({ ideal: "environment" })
  expect(rb.video.width.ideal).toBeGreaterThanOrEqual(1280)
  await expect(page).toHaveURL(/\/products\/new$/)
  await expect(page.getByText("Không thể kết nối")).toHaveCount(0)
  expect(loi).toEqual([])
})

test("khung tạo nhanh sản phẩm trong phiếu nhập (điện thoại): camera đọc mã vào ô Mã vạch của khung, khung vẫn mở", async ({ page }) => {
  await theoDoiCamera(page)
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
  await page.getByTestId("them-san-pham").click()
  const khung = page.getByTestId("tao-nhanh-san-pham")
  await expect(khung).toBeVisible()
  await khung.getByTestId("quet-ma-vach").click()
  const hop = page.getByRole("dialog", { name: "Quét mã vạch sản phẩm" })
  await expect(hop).toBeVisible()
  await expect(khung.locator("#barcode")).toHaveValue(MA, { timeout: 10_000 })
  await expect(hop).toHaveCount(0)
  await expect(khung).toBeVisible()
  await expect.poll(() => cameraDaTat(page)).toBe(true)
  await expect(page).toHaveURL(/\/purchasing\/receipts\/new$/)
})
