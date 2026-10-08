import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ ĐỌC HỎNG THÌ NÓI RA, KHÔNG DỰNG FORM / BẢNG TRỐNG (rà truy vấn không kiểm lỗi, 08/10/2026 — cổng CI "Truy vấn
 *   database phải kiểm lỗi"). Ba màn từng vẽ đúng hình dạng của dữ liệu thật khi đọc hỏng:
 *   - Sửa phiếu nhập: dòng hàng đọc hỏng → form KHÔNG dòng nào; thêm một dòng rồi Lưu là đè cả phiếu.
 *   - Cài đặt người dùng: NCC được gán đọc hỏng → ô NCC trống; bấm Lưu là XOÁ hết NCC đã gán.
 *   - Đề xuất đặt hàng: đọc hỏng → "Không có mặt hàng nào cần đặt — mọi đơn đều đủ tồn".
 *   - Đăng nhập: hồ sơ đọc hỏng → bỏ qua phép kiểm "tài khoản đã khoá".
 */
const hong = (page: Page, mau: RegExp) =>
  page.route(mau, (r) =>
    r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "mất kết nối giả" }) })
  )

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("sửa phiếu nhập: dòng hàng đọc hỏng thì báo + Thử lại, KHÔNG dựng form", async ({ page }) => {
    await dangNhap(page)
    await hong(page, /\/rest\/v1\/purchase_invoice_lines\?/)
    await page.goto("/purchasing/receipts/pi2/edit")
    const hop = page.getByTestId("hop-loi-tai")
    await expect(hop).toContainText("Không tải được phiếu nhập để sửa")
    await expect(hop).toContainText("mất kết nối giả")
    await expect(page.getByTestId("buoc-phieu"), "không được dựng form khi chưa đọc được dòng hàng").toHaveCount(0)
    await expect(page.getByRole("button", { name: /Lưu/ })).toHaveCount(0)
    /* Mạng về thì Thử lại là vào form như thường. */
    await page.unroute(/\/rest\/v1\/purchase_invoice_lines\?/)
    await hop.getByRole("button", { name: "Thử lại" }).click()
    await expect(page.getByTestId("buoc-phieu")).toBeVisible()
    await expect(page.getByTestId("hop-loi-tai")).toHaveCount(0)
  })
})

test("cài đặt người dùng: NCC được gán đọc hỏng thì báo, KHÔNG hiện form (Lưu sẽ xoá hết NCC đã gán)", async ({ page }) => {
  const NV = "00000000-0000-4000-8000-0000000000c9"
  await fetch(`${FAKE}/rest/v1/users`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{
      id: NV, org_id: "00000000-0000-4000-8000-0000000000a1", full_name: "NV Thử Đọc Hỏng", role: "sales",
      phone: "0977000222", is_active: true, created_at: "2026-09-24T00:00:00Z", allow_price_edit: false, price_edit_max_increase_pct: 0,
    }]),
  })
  try {
    await dangNhap(page)
    await hong(page, /\/rest\/v1\/user_suppliers\?/)
    await page.goto(`/settings/users/${NV}`)
    const hop = page.getByTestId("hop-loi-tai")
    await expect(hop).toContainText("Không tải được thông tin người dùng")
    await expect(page.getByText("Không tìm thấy người dùng")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Lưu/ })).toHaveCount(0)
  } finally {
    await fetch(`${FAKE}/rest/v1/users?id=eq.${NV}`, { method: "DELETE" })
  }
})

test("đề xuất đặt hàng: tồn kho đọc hỏng thì báo, KHÔNG nói 'không có mặt hàng nào cần đặt'", async ({ page }) => {
  await dangNhap(page)
  await hong(page, /\/rest\/v1\/batches\?/)
  await page.goto("/purchasing/reorder")
  await expect(page.getByTestId("hop-loi-tai")).toContainText("Không tải được dữ liệu đề xuất đặt hàng")
  await expect(page.getByText("Không có mặt hàng nào cần đặt")).toHaveCount(0)
})

test("đăng nhập: hồ sơ đọc hỏng thì chặn và báo, không vào app", async ({ page }) => {
  await hong(page, /\/rest\/v1\/users\?select=is_active/)
  await page.goto("/login")
  await page.fill("#identifier", "chu@npp.test")
  await page.fill("#password", "matkhau-e2e")
  await page.click('button[type="submit"]')
  await expect(page.getByText(/Chưa kiểm tra được tài khoản/)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})
