import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Phần Soạn hàng làm riêng 1 trang bên Kho vận > Soạn hàng >
 *   mở ra chọn danh sách Hoá đơn chứ ko phải đơn hàng. -> tổng hợp lại thành đơn
 *   tổng. Bỏ cái hiện tại trong đơn hàng đi."
 * Mẫu: HD-E2E-1 = 2 thùng Sữa (hệ số 24) + 1 gói Mì (hàng đổi); thêm cho HD-E2E-2
 * 5 hộp Sữa → đơn tổng Sữa = 53 hộp = 2 thùng 5 hộp.
 */
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const SUA = { name: "Sữa hộp", sku: "SUA1", base_unit: "hộp", units: [{ unit_name: "thùng", conversion: 24 }] }
const MI = { name: "Mì tôm", sku: "MI1", base_unit: "gói", units: [{ unit_name: "thùng", conversion: 30 }] }
const dongSP = (page: Page, ten: string) => page.getByTestId("dong-soan-hang").filter({ hasText: ten })

test.beforeAll(async () => {
  await api("sales_invoice_lines?id=eq.sil1", "PATCH", { product: SUA })
  await api("sales_invoice_lines?id=eq.sil2", "PATCH", { product: MI })
  await api("sales_invoice_lines", "POST", [{
    id: "sil-soan", invoice_id: "00000000-0000-4000-8000-0000000000f2", product_id: "00000000-0000-4000-8000-0000000000d1", quantity: 5, unit_name: "hộp",
    conversion_factor: 1, is_exchange: false, product: SUA, sort_order: 0,
  }])
})
test.afterAll(async () => {
  await api("sales_invoice_lines?id=eq.sil-soan", "DELETE", {})
  await api("sales_invoice_lines?id=eq.sil1", "PATCH", { product: { name: "Sữa hộp", sku: "SUA1" } })
  await api("sales_invoice_lines?id=eq.sil2", "PATCH", { product: { name: "Mì tôm", sku: "MI1" } })
})

test("Kho vận › Soạn hàng: chọn hóa đơn → đơn tổng quy về đơn vị cơ sở, in được", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory")
  await page.getByRole("link", { name: "Soạn hàng" }).first().click()
  await expect(page).toHaveURL(/\/inventory\/soan-hang/)

  // Danh sách hóa đơn đã xuất hiện sẵn — bấm chọn.
  await page.getByTestId("ket-qua-hoa-don").filter({ hasText: "HD-E2E-1" }).click()
  await expect(page.getByTestId("hoa-don-da-chon")).toContainText("HD-E2E-1")
  await expect(dongSP(page, "Sữa hộp")).toContainText("48 hộp")
  await expect(dongSP(page, "Mì tôm")).toContainText("có hàng đổi")

  // Tìm theo tên khách, thêm hóa đơn thứ hai → Sữa cộng dồn theo đơn vị cơ sở.
  await page.getByLabel("Tìm hóa đơn để gộp").fill("Cô Ba")
  await page.getByTestId("ket-qua-hoa-don").filter({ hasText: "HD-E2E-2" }).click()
  await expect(dongSP(page, "Sữa hộp")).toContainText("53 hộp")
  await expect(dongSP(page, "Sữa hộp")).toContainText("2 thùng 5 hộp")
  await expect(dongSP(page, "Sữa hộp")).toContainText("HD-E2E-2 · Tạp hoá Cô Ba: 5 hộp")
  await expect(page).toHaveURL(/ids=00000000-0000-4000-8000-0000000000f1,00000000-0000-4000-8000-0000000000f2/)

  const to = page.getByTestId("to-in-soan-hang")
  await expect(to).toContainText("PHIẾU SOẠN HÀNG (ĐƠN TỔNG)")
  await expect(to).toContainText("HD-E2E-1 (Tạp hoá Cô Ba); HD-E2E-2 (Tạp hoá Cô Ba)")
  await expect(to).toContainText("53 hộp")
  await expect(page.getByRole("button", { name: /In đơn tổng/ })).toBeEnabled()

  // Bỏ một hóa đơn → đơn tổng tính lại.
  await page.getByRole("button", { name: "Bỏ HD-E2E-2" }).click()
  await expect(dongSP(page, "Sữa hộp")).toContainText("48 hộp")
})

test("phần Soạn hàng cũ trong Đơn hàng đã bỏ", async ({ page }) => {
  await dangNhap(page)
  await expect(page.getByRole("button", { name: "Soạn hàng" })).toHaveCount(0)
})
