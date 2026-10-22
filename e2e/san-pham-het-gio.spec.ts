import { test, expect, type Locator, type Page, type Route } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 22/10/2026 (ảnh màn Sản phẩm trên điện thoại): "Không tải được danh sách sản phẩm — AbortError: Fetch is
 *   aborted". Bộ hẹn giờ 10 giây của app cắt câu danh sách. Nay: câu đọc hết giờ tự thử lại một lần; vẫn hết giờ thì báo
 *   tiếng Việt + nút Thử lại; quay lại app (chuyển app / mở khoá màn) thì tự tải lại nếu lần trước hỏng.
 *   Máy chủ "không trả lời" dựng bằng cách giữ yêu cầu lại (không chuyển tiếp); đồng hồ giả để khỏi chờ 20 giây thật.
 */
/** Màn có hai bố cục (máy tính / điện thoại), một cái ẩn bằng CSS — chỉ nhìn cái đang hiện. */
const hien = (l: Locator) => l.filter({ visible: true })
const CAU = "Mạng chậm hoặc máy chủ đang bận: Máy chủ chưa trả lời sau 10 giây (đã thử 2 lần). Kiểm tra mạng rồi thử lại."

/** Giữ câu DANH SÁCH sản phẩm (có nhúng bảng giá) khi `treo`; câu đếm / chip NCC đi bình thường. */
async function chanDanhSach(page: Page) {
  const tt = { treo: true, soLan: 0 }
  await page.route(/:54321\/rest\/v1\/products\?/, async (route: Route) => {
    const sel = new URL(route.request().url()).searchParams.get("select") ?? ""
    if (!sel.includes("price_lists")) return route.continue()
    tt.soLan++
    if (tt.treo) return // không trả lời — để bộ hẹn giờ của app tự cắt
    return route.continue()
  })
  return tt
}

async function choHetGio(page: Page, tt: { soLan: number }) {
  // Hai nhịp (20 dòng đầu + phần còn lại) chạy song song, mỗi nhịp: hết giờ → thử lại đúng một lần.
  await expect.poll(() => tt.soLan).toBe(2)
  await page.clock.fastForward("00:10")
  await expect.poll(() => tt.soLan, { message: "câu đọc hết giờ phải thử lại một lần" }).toBe(4)
  await page.clock.fastForward("00:10")
  await expect(hien(page.getByText("Không tải được danh sách sản phẩm"))).toBeVisible()
  await expect(hien(page.getByText(CAU))).toBeVisible()
  await expect(page.getByText(/AbortError|Fetch is aborted/), "không ném tên lớp lỗi tiếng Anh vào mặt người dùng").toHaveCount(0)
  // Không thử lần ba.
  await page.clock.fastForward("00:30")
  expect(tt.soLan).toBe(4)
  // Ô trống: mời THỬ LẠI, không mời "thêm sản phẩm đầu tiên" — danh mục chỉ là chưa tải được.
  const rong = page.getByRole("heading", { name: "Không tải được dữ liệu" }).filter({ visible: true }).locator("xpath=..")
  await expect(rong.getByRole("button", { name: "Thử lại" })).toBeVisible()
  await expect(rong.getByRole("button", { name: "Thêm sản phẩm" })).toHaveCount(0)
}

test("máy tính: máy chủ không trả lời → tự thử lại một lần → báo tiếng Việt; bấm Thử lại là tải được", async ({ page }) => {
  await page.clock.install()
  await dangNhap(page)
  const tt = await chanDanhSach(page)
  await page.goto("/products")
  await choHetGio(page, tt)

  tt.treo = false
  await hien(page.getByRole("button", { name: "Thử lại" })).first().click()
  await expect(hien(page.getByText("Sữa hộp")).first()).toBeVisible()
  await expect(hien(page.getByText("Không tải được danh sách sản phẩm"))).toHaveCount(0)
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("lần trước hỏng, chuyển app rồi quay lại → tự tải lại, không phải bấm gì", async ({ page }) => {
    await page.clock.install()
    await dangNhap(page)
    const tt = await chanDanhSach(page)
    await page.goto("/products")
    await choHetGio(page, tt)

    tt.treo = false
    const dat = (v: "hidden" | "visible") =>
      page.evaluate((trangThai) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => trangThai })
        document.dispatchEvent(new Event("visibilitychange"))
      }, v)
    await dat("hidden")
    await page.clock.fastForward("00:05")
    await dat("visible")
    await expect(hien(page.getByText("Sữa hộp")).first()).toBeVisible()
    await expect(hien(page.getByText("Không tải được danh sách sản phẩm"))).toHaveCount(0)
  })

  test("app nằm nền thì KHÔNG cắt câu đang chờ; mở lại mới đếm 10 giây", async ({ page }) => {
    await page.clock.install()
    await dangNhap(page)
    const tt = await chanDanhSach(page)
    await page.goto("/products")
    await expect.poll(() => tt.soLan).toBe(2)
    const dat = (v: "hidden" | "visible") =>
      page.evaluate((trangThai) => {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => trangThai })
        document.dispatchEvent(new Event("visibilitychange"))
      }, v)
    await dat("hidden")
    await page.clock.fastForward("01:00")
    expect(tt.soLan, "đang ẩn mà vẫn đếm giờ → cắt rồi thử lại").toBe(2)
    await dat("visible")
    await page.clock.fastForward("00:09")
    expect(tt.soLan, "vừa mở lại đã cắt — phải đếm đủ 10 giây từ lúc hiện lại").toBe(2)
    await page.clock.fastForward("00:02")
    await expect.poll(() => tt.soLan).toBe(4)
  })
})
