import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 09/10/2026: "check báo cáo /reports/employees hàng bán theo nhân viên, bộ lọc thương hiệu thay bằng NCC".
 *   Lọc NCC → tiền cấp nhân viên ở MỌI tab = PHẦN phân bổ của chứng từ cho các dòng của NCC ấy (cùng luật Báo cáo tổng
 *   hợp, `phanTienQuaLoc`).
 *   HĐ-LOC-1 của "NV Lọc NCC": dòng A 800.000 (NCC A) + dòng B 200.000 (NCC B), giảm cả đơn 100.000, VAT 90.000
 *   → total 990.000. Lọc NCC A: doanh thu 792.000, giảm giá đơn 80.000. Bản cũ: tab Bán hàng vẫn 990.000 (cả hoá
 *   đơn), tab Hàng bán theo nhân viên giảm giá đơn 100.000 (của cả hoá đơn).
 *   Dòng dữ liệu RIÊNG của spec này.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const NCC_A = "00000000-0000-4000-8000-0000000000e7"
const NCC_B = "00000000-0000-4000-8000-0000000000e8"
const SP_A = "00000000-0000-4000-8000-0000000000d7"
const SP_B = "00000000-0000-4000-8000-0000000000d8"
const NV = "00000000-0000-4000-8000-0000000000b9"
const HD = "hd-loc-ncc-1"

const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

test.beforeAll(async () => {
  await them("suppliers", [
    { id: NCC_A, org_id: ORG, code: "NCCA", name: "NCC Thử Lọc A", status: "active", is_active: true },
    { id: NCC_B, org_id: ORG, code: "NCCB", name: "NCC Thử Lọc B", status: "active", is_active: true },
  ])
  await them("products", [
    {
      id: SP_A, org_id: ORG, sku: "LOCA", name: "Hàng lọc A", base_unit: "hộp", sell_price: 100000, status: "active",
      primary_supplier_id: NCC_A, units: [], price_lists: [{ id: "pl-loc-a", product_id: SP_A, unit_name: "hộp", group_id: null, price: 100000 }],
    },
    {
      id: SP_B, org_id: ORG, sku: "LOCB", name: "Hàng lọc B", base_unit: "hộp", sell_price: 50000, status: "active",
      primary_supplier_id: NCC_B, units: [], price_lists: [{ id: "pl-loc-b", product_id: SP_B, unit_name: "hộp", group_id: null, price: 50000 }],
    },
  ])
  await them("users", [{ id: NV, org_id: ORG, full_name: "NV Lọc NCC", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await them("sales_invoices", [{
    id: HD, org_id: ORG, invoice_code: "HD-LOC-1", order_id: "o-loc-ncc-1", customer_id: KHACH, status: "posted",
    subtotal: 900000, vat: 90000, total: 990000, payment_terms: "COD", due_date: "2026-09-30", invoice_date: "2026-09-25",
    created_at: "2026-09-25T08:00:00Z", sales_user_id: NV, posted_by: OWNER,
  }])
  await them("sales_invoice_lines", [
    { id: "sil-loc-a", invoice_id: HD, product_id: SP_A, quantity: 8, unit_name: "hộp", conversion_factor: 1, unit_price: 100000, line_discount: 0, vat_rate: 0.1, line_total: 800000, is_exchange: false, sort_order: 0, order_line_id: null },
    { id: "sil-loc-b", invoice_id: HD, product_id: SP_B, quantity: 4, unit_name: "hộp", conversion_factor: 1, unit_price: 50000, line_discount: 0, vat_rate: 0.1, line_total: 200000, is_exchange: false, sort_order: 1, order_line_id: null },
  ])
})
test.afterAll(async () => {
  await xoa("sales_invoice_lines", "invoice_id", HD)
  await xoa("sales_invoices", "id", HD)
  await xoa("users", "id", NV)
  for (const id of [SP_A, SP_B]) await xoa("products", "id", id)
  for (const id of [NCC_A, NCC_B]) await xoa("suppliers", "id", id)
})

const dongNv = (page: Page) => page.locator("tr", { hasText: "NV Lọc NCC" })

async function chonTab(page: Page, ten: string) {
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: ten, exact: true }).click()
}

test("lọc NCC: ô lọc NCC thay Thương hiệu; tiền mọi tab là phần của hàng NCC ấy", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/employees")
  await expect(page.getByText("Thương hiệu (chọn nhiều)")).toHaveCount(0)

  /* Không lọc: nguyên tiền hoá đơn (khớp công nợ). */
  await expect(dongNv(page)).toContainText("990.000")

  /* Lọc NCC A. */
  await page.getByRole("button", { name: "Tất cả NCC" }).click()
  await page.getByRole("button", { name: /NCC Thử Lọc A/ }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("heading", { name: "Báo cáo nhân viên" }).click()

  /* Tab Bán hàng: 792.000 (phần của dòng A), không còn 990.000 của cả hoá đơn. */
  await expect(dongNv(page)).toContainText("792.000")
  await expect(dongNv(page)).not.toContainText("990.000")

  /* Tab Hàng bán theo nhân viên: doanh thu 792.000, giảm giá đơn là phần của A (80.000), không phải 100.000. */
  await chonTab(page, "Hàng bán theo nhân viên")
  await expect(dongNv(page)).toContainText("792.000")
  await expect(dongNv(page)).toContainText("-80.000")
  await expect(dongNv(page)).not.toContainText("-100.000")

  /* Tab Lợi nhuận: doanh thu thuần cũng là phần của A. */
  await chonTab(page, "Lợi nhuận")
  await expect(dongNv(page)).toContainText("792.000")
  await expect(dongNv(page)).not.toContainText("990.000")
})
