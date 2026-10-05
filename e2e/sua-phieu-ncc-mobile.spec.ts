import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { SUA, NCC } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 05/10/2026: "Xem lại phần sửa phiếu nhập hàng ncc chưa quay về giống phần tạo phiếu mà dùng form riêng
 *   (trên di động)". Màn SỬA phiếu nhập / phiếu trả NCC nay cùng khung `PhieuNccMobile` với màn TẠO: mở thẳng bước
 *   Phiếu với dòng đã lưu, ô riêng (số HĐ / ngày / kho / lý do) dùng chung `truong-phieu-ncc.tsx`.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

const dong = (id: string, khoa: string, cha: string) => ({
  id, [khoa]: cha, product_id: SUA, unit_name: "hộp", quantity: 12, unit_price: 15000, line_discount: 0,
  vat_rate: 0, conversion_factor: 1, notes: null, sort_order: 0,
})

test.beforeAll(async () => {
  await api("purchase_invoices?id=eq.pi2", "PATCH", { supplier_id: NCC, discount: 0, vat_override: null, notes: null })
  await api("purchase_invoice_lines", "POST", [dong("pil-sua-1", "invoice_id", "pi2")])
  await api("supplier_returns", "POST", [{
    id: "sr-sua-1", org_id: ORG, supplier_id: NCC, return_code: "TN-SUA-1", return_date: "2026-09-25", warehouse_zone: "date",
    reason: "near_expiry", status: "draft", discount: 0, vat_override: null, notes: null, total: 180000,
  }])
  await api("supplier_return_lines", "POST", [dong("srl-sua-1", "return_id", "sr-sua-1")])
})
test.afterAll(async () => {
  await api("purchase_invoice_lines?id=eq.pil-sua-1", "DELETE")
  await api("supplier_return_lines?id=eq.srl-sua-1", "DELETE")
  await api("supplier_returns?id=eq.sr-sua-1", "DELETE")
})

test("sửa phiếu nhập trên điện thoại: cùng khung màn tạo, mở thẳng bước Phiếu, lưu tạm ghi lại phiếu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts/pi2/edit")
  await expect(page.getByTestId("buoc-phieu")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Sửa phiếu nhập hàng" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Vinamilk/ })).toBeVisible()
  await expect(page.getByTestId("dong-phieu-ncc")).toHaveCount(1)
  await expect(page.getByTestId("dong-phieu-ncc")).toContainText("Sữa hộp")
  await expect(page.locator("#pn-so-hd")).toHaveValue("HD2")
  // Form cũ kiểu máy tính không còn.
  await expect(page.getByRole("button", { name: "Lưu & gửi" })).toHaveCount(0)
  // Thêm hàng đi qua đúng màn thêm hàng của phiếu tạo.
  await page.getByRole("button", { name: "Thêm hàng" }).click()
  await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Sửa phiếu nhập" })).toBeVisible()
  await page.getByTestId("the-hang-ncc").filter({ hasText: "Sữa hộp" }).click()
  await expect(page.getByTestId("buoc-phieu")).toBeVisible()
  await page.locator("#pn-so-hd").fill("HD2-SUA")
  await page.getByRole("button", { name: "Lưu tạm" }).click()
  await expect(page).toHaveURL(/\/purchasing\/receipts\/pi2$/)
  const ghi = (await nhatKy()).filter((r) => r.method === "PATCH" && r.path.includes("purchase_invoices")).at(-1)
  expect(JSON.stringify(ghi?.body)).toContain("HD2-SUA")
})

test("sửa phiếu trả NCC trên điện thoại: cùng khung màn tạo, ô ngày / kho / lý do dùng chung", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchase-returns/sr-sua-1/edit")
  await expect(page.getByTestId("buoc-phieu")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Sửa phiếu trả NCC" })).toBeVisible()
  await expect(page.getByTestId("dong-phieu-ncc")).toContainText("Sữa hộp")
  await expect(page.locator("#pr-date")).toHaveValue("2026-09-25")
  await expect(page.getByRole("button", { name: "Gửi phiếu" })).toBeVisible()
})
