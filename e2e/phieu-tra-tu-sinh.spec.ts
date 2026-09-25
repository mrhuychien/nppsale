import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026 (mig 191):
 *   "Phiếu trả sinh ra tự động thì chỉ huỷ phiếu ko sửa được (muốn sửa thì sửa từ hoá
 *    đơn) … Phiếu trả do người dùng tạo -> sửa/huỷ được -> mọi thứ cập nhật theo."
 *   "Lưu ý trạng thái Chờ xử lý chỉ có ở phiếu trả tự sinh."
 * r-e2e-5 = phiếu TỰ SINH theo HD-E2E-1 (Chờ xử lý); r-e2e-6 = phiếu TỰ LẬP ở Nháp.
 */
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const HD1 = "00000000-0000-4000-8000-0000000000f1"

test.beforeAll(async () => {
  await api("returns?id=eq.r-e2e-5", "PATCH", {
    credit_with_invoice: true, invoice_id: HD1, order_id: "o-e2e-1",
    invoice: { invoice_code: "HD-E2E-1", invoice_date: "2026-09-20" }, order: { order_code: "DH-E2E-1" },
  })
  await api("returns?id=eq.r-e2e-6", "PATCH", { status: "draft" })
})
test.afterAll(async () => {
  await api("returns?id=eq.r-e2e-5", "PATCH", { credit_with_invoice: false, invoice_id: null, order_id: null, invoice: null, order: null })
  await api("returns?id=eq.r-e2e-6", "PATCH", { status: "submitted" })
})

test("web: phiếu tự sinh chỉ Hoàn thành (nhập kho) — không Huỷ, không Sửa, chỉ đường sửa hóa đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-e2e-5")
  await expect(page.getByText("Tự sinh theo HĐ HD-E2E-1")).toBeVisible()
  await expect(page.getByText(/muốn sửa hay bỏ hàng trả thì sửa hóa đơn/)).toBeVisible()
  await expect(page.getByRole("link", { name: "Mở hóa đơn" })).toHaveAttribute("href", `/sales-invoices/${HD1}`)
  await expect(page.getByRole("button", { name: "Hoàn thành — nhập kho", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Huỷ phiếu/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Sửa$/ })).toHaveCount(0)
})

test("web: phiếu tự lập ở Nháp hoàn thành thẳng (nhập kho + trừ nợ), huỷ và sửa được", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-e2e-6")
  await expect(page.getByRole("button", { name: "Hoàn thành — nhập kho & trừ công nợ" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Huỷ phiếu/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Sửa/ }).first()).toBeVisible()
  await expect(page.getByText(/Tự sinh theo HĐ/)).toHaveCount(0)
})

test("danh sách: phiếu tự sinh có nhãn Theo HĐ, mặc định gồm cả Chờ xử lý và Nháp", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  await expect(page.getByRole("button", { name: "Chờ xử lý", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Nháp", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("Theo HĐ", { exact: true }).first()).toBeVisible()
})

test("POS: mở phiếu tự sinh là chỉ xem, nút Ghi nhận khoá", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-hang/r-e2e-5")
  await expect(page.getByText(/Phiếu trả tự sinh theo hóa đơn — chỉ xem/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Ghi nhận & nhập kho" })).toBeDisabled()
})
