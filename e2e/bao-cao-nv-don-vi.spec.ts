import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 09/10/2026: "sửa tiếp báo cáo /reports/employees — Mối quan tâm: Hàng bán theo nhân viên, Xem chi tiết từng
 *   nhân viên: Thêm cột bảng giá (theo đơn vị), giá bán (theo đơn vị), SL thực bán (sl bán - sl trả)".
 *   HD-DVT-1 của "NV Thử ĐVT": 2 thùng × 470.000 (bảng giá thùng 450.000 — KHÔNG phải 24 × 20.000) + 10 hộp × 21.000
 *   (bảng giá hộp 20.000). Trả 4 hộp × 21.000. → thùng: thực bán 2; hộp: thực bán 6; cộng quy hộp 58 − 4 = 54.
 *   Dữ liệu RIÊNG của spec này.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const SP = "00000000-0000-4000-8000-0000000000de"
const NV = "00000000-0000-4000-8000-0000000000bc"
const HD = "hd-dvt-1"
const TR = "tr-dvt-1"

const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

test.beforeAll(async () => {
  await them("products", [{
    id: SP, org_id: ORG, sku: "DVT1", name: "Sữa thử ĐVT", base_unit: "hộp", sell_price: 20000, status: "active", primary_supplier_id: null,
    units: [{ unit_name: "thùng", conversion: 24 }],
    price_lists: [
      { id: "pl-dvt-t", product_id: SP, unit_name: "thùng", group_id: null, price: 450000 },
      { id: "pl-dvt-h", product_id: SP, unit_name: "hộp", group_id: null, price: 20000 },
    ],
  }])
  await them("users", [{ id: NV, org_id: ORG, full_name: "NV Thử ĐVT", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await them("sales_invoices", [{
    id: HD, org_id: ORG, invoice_code: "HD-DVT-1", order_id: null, customer_id: KHACH, status: "posted",
    subtotal: 1150000, vat: 0, total: 1150000, payment_terms: "COD", due_date: "2026-09-26", invoice_date: "2026-09-26",
    created_at: "2026-09-26T03:00:00Z", sales_user_id: NV, posted_by: OWNER,
  }])
  await them("sales_invoice_lines", [
    { id: "sil-dvt-t", invoice_id: HD, product_id: SP, quantity: 2, unit_name: "thùng", conversion_factor: 24, unit_price: 470000, line_discount: 0, vat_rate: 0, line_total: 940000, is_exchange: false, sort_order: 0, order_line_id: null },
    { id: "sil-dvt-h", invoice_id: HD, product_id: SP, quantity: 10, unit_name: "hộp", conversion_factor: 1, unit_price: 21000, line_discount: 0, vat_rate: 0, line_total: 210000, is_exchange: false, sort_order: 1, order_line_id: null },
  ])
  await them("returns", [{
    id: TR, org_id: ORG, customer_id: KHACH, invoice_id: HD, credit_note_amount: 84000, created_at: "2026-09-27T04:00:00Z",
    revenue_date: "2026-09-27", sales_user_id: NV, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed",
  }])
  await them("return_lines", [{ id: "rl-dvt-h", return_id: TR, product_id: SP, unit_name: "hộp", quantity: 4, unit_price: 21000, line_total: 84000, is_exchange: false }])
})
test.afterAll(async () => {
  await xoa("return_lines", "return_id", TR)
  await xoa("returns", "id", TR)
  await xoa("sales_invoice_lines", "invoice_id", HD)
  await xoa("sales_invoices", "id", HD)
  await xoa("users", "id", NV)
  await xoa("products", "id", SP)
})

test("Hàng bán theo nhân viên › chi tiết: bảng giá / giá bán theo ĐÚNG đơn vị, SL thực bán = bán − trả", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/employees")
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: "Hàng bán theo nhân viên", exact: true }).click()
  await page.locator("tr", { hasText: "NV Thử ĐVT" }).first().click()

  const ct = page.getByTestId("nv-hang-ban-chi-tiet")
  for (const c of ["Bảng giá (theo ĐVT)", "Giá bán (theo ĐVT)", "SL thực bán"]) await expect(ct.locator("th", { hasText: c })).toBeVisible()

  // Thùng: so với giá THÙNG 450.000 (không phải 24 × 20.000 = 480.000), bán 470.000, chênh +40.000, thực bán 2.
  const thung = ct.locator("tr", { hasText: "thùng" })
  await expect(thung).toContainText("450.000")
  await expect(thung).toContainText("470.000")
  await expect(thung).toContainText("+40.000")
  await expect(thung).not.toContainText("480.000")
  await expect(thung.locator("td").nth(12)).toHaveText("2")

  // Hộp: bảng giá 20.000, bán 21.000, trả 4 → thực bán 6.
  const hop = ct.locator("tr").filter({ hasText: "21.000" }).filter({ hasNotText: "thùng" }).filter({ hasNotText: "Cộng" })
  await expect(hop).toContainText("20.000")
  await expect(hop.locator("td").nth(9)).toHaveText("4")
  await expect(hop.locator("td").nth(12)).toHaveText("6")

  // Cộng quy về hộp: 2 × 24 + 10 = 58 bán, 4 trả, 54 thực bán.
  const cong = ct.locator("tr", { hasText: "Cộng" })
  await expect(cong).toContainText("quy về hộp")
  await expect(cong.locator("td").nth(3)).toHaveText("58")
  await expect(cong.locator("td").nth(12)).toHaveText("54")
})
