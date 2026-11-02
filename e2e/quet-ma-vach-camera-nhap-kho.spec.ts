import { test, expect } from "@playwright/test"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dangNhap } from "./helpers"
import { CAMERA_GIA, bangCode128, cameraDaTat, theoDoiCamera } from "./camera-trang"
import { modulCode128B, sinhVideoMaVach } from "./camera-gia.mjs"

/**
 * ⚠ CHỦ NHÀ 02/11/2026 ("…mã vạch chưa quét được") — sửa xong camera đọc được thật, ~8 khung mỗi giây. Nhập kho thêm một
 *   DÒNG mỗi lần bộ quét báo mã, không tự lọc trùng: giơ mã một giây là tám dòng. Bộ quét chung nay chỉ báo lại CÙNG mã
 *   sau 1,5 giây (`shouldAcceptScan`). Tem Code128 mang SKU "SUA1" (nhập kho tra mã vạch hoặc SKU) — đồng thời kiểm bản
 *   vá Code128 của ZXing chạy thật trên trình duyệt.
 */
const VIDEO = sinhVideoMaVach(join(tmpdir(), "npp-cam-c128-SUA1-720x1280-45-v1.y4m"), {
  w: 720, h: 1280, modul: modulCode128B("SUA1", bangCode128()), tiLe: 0.45, sigma: 0.9,
})

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  permissions: ["camera"],
  launchOptions: { args: [...CAMERA_GIA, `--use-file-for-fake-video-capture=${VIDEO}`] },
})

test("nhập kho điện thoại: giơ tem trước camera → MỘT dòng Sữa hộp mỗi 1,5 giây, không phải mỗi khung một dòng", async ({ page }) => {
  await theoDoiCamera(page)
  await dangNhap(page)
  await page.goto("/inventory/stock-in")
  const man = page.getByTestId("nhap-kho-mobile")
  await expect(man).toBeVisible()
  // Ghi mốc giờ (đồng hồ của trang) lúc mỗi dòng xuất hiện — đo bằng vòng hỏi lại của Playwright thì trễ cả nửa giây.
  await page.evaluate(() => {
    const w = window as unknown as { __mocDong: number[] }
    w.__mocDong = []
    const dem = () => document.querySelectorAll('[data-testid="nk-m-dong"]').length
    let truoc = dem()
    new MutationObserver(() => {
      const n = dem()
      for (let i = truoc; i < n; i++) w.__mocDong.push(performance.now())
      truoc = Math.max(truoc, n)
    }).observe(document.body, { childList: true, subtree: true })
  })
  await man.getByRole("button", { name: "Quét mã" }).click()
  const hop = page.getByRole("dialog", { name: "Quét mã vạch" })
  await expect(hop).toBeVisible()
  await expect(man.getByTestId("nk-m-dong").first()).toContainText("Sữa hộp", { timeout: 10_000 })
  await page.waitForTimeout(2500) // mã vẫn trong khung, camera vẫn đọc ~8 khung / giây
  await hop.getByRole("button", { name: "Đóng" }).click()
  await expect(hop).toHaveCount(0)
  await expect.poll(() => cameraDaTat(page)).toBe(true)
  const moc = await page.evaluate(() => (window as unknown as { __mocDong: number[] }).__mocDong)
  // Không có cửa lọc trùng: dòng thứ hai tới sau ~0,12 giây, 2,5 giây là ~20 dòng. Có cửa (1,5 giây tính ở lúc ĐỌC):
  // mốc VẼ dòng lệch nhau vài trăm ms (lần vẽ đầu nặng hơn) — ngưỡng 0,9 giây vẫn tách bạch hai trường hợp.
  expect(moc.filter((t) => t - moc[0] < 900), "trong 0,9 giây sau lần đọc đầu chỉ được một dòng").toHaveLength(1)
  expect(moc.length).toBeLessThanOrEqual(3)
  for (let i = 1; i < moc.length; i++) expect(moc[i] - moc[i - 1]).toBeGreaterThanOrEqual(900)
})
