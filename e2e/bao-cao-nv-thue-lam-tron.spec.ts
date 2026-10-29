import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 29/10/2026: "tại sao lấy doanh thu thực tế trừ đi bảng giá lại không ra số ở cột chênh lệch bán" — Doanh thu
 *   dòng nhân viên là tiền hoá đơn (gồm VAT, sau giảm giá đơn), chênh tính trước thuế. Chốt: thêm cột "Thuế + làm tròn".
 *   HD-TH-1 của "NV Thuế Thử": 10 hộp × 21.000 (bảng giá 20.000) → Theo bảng giá 200.000, chênh bán +10.000; tiền hàng
 *   210.000, VAT 8% = 16.800 → hoá đơn 226.800. Doanh thu − Theo bảng giá = 26.800 = chênh 10.000 + thuế 16.800.
 *   Dữ liệu RIÊNG của spec này. Logic: tests/thue-lam-tron-nv.test.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const SP = "00000000-0000-4000-8000-0000000000d8"
const NV = "00000000-0000-4000-8000-0000000000b7"
const HD = "hd-th-1"

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeAll(async () => {
  await api("products", "POST", [{
    id: SP, org_id: ORG, sku: "TH1", name: "Sữa thử thuế", base_unit: "hộp", sell_price: 20000, status: "active", primary_supplier_id: null,
    units: [], price_lists: [{ id: "pl-th-h", product_id: SP, unit_name: "hộp", group_id: null, price: 20000 }],
  }])
  await api("users", "POST", [{ id: NV, org_id: ORG, full_name: "NV Thuế Thử", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await api("sales_invoices", "POST", [{
    id: HD, org_id: ORG, invoice_code: "HD-TH-1", order_id: null, customer_id: KHACH, status: "posted",
    subtotal: 210000, vat: 16800, total: 226800, payment_terms: "COD", due_date: "2026-09-20", invoice_date: "2026-09-20",
    created_at: "2026-09-20T03:00:00Z", sales_user_id: NV, posted_by: OWNER,
  }])
  await api("sales_invoice_lines", "POST", [{
    id: "sil-th-1", invoice_id: HD, product_id: SP, quantity: 10, unit_name: "hộp", conversion_factor: 1, unit_price: 21000,
    line_discount: 0, vat_rate: 8, line_total: 210000, is_exchange: false, sort_order: 0, order_line_id: null,
  }])
})
test.afterAll(async () => {
  await api(`sales_invoice_lines?invoice_id=eq.${HD}`, "DELETE")
  await api(`sales_invoices?id=eq.${HD}`, "DELETE")
  await api(`users?id=eq.${NV}`, "DELETE")
  await api(`products?id=eq.${SP}`, "DELETE")
})

test("Hàng bán theo nhân viên: cột Thuế + làm tròn ngay sau Chênh lệch bán; Doanh thu − Theo bảng giá = chênh + thuế", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/employees")
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: "Hàng bán theo nhân viên", exact: true }).click()
  await expect(page.locator("th", { hasText: "Thuế + làm tròn" }).first()).toBeVisible()

  const dong = page.locator("tr", { hasText: "NV Thuế Thử" }).first()
  const tieuDe = (await dong.locator("xpath=ancestor::table[1]").locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase())
  const o = (ten: string) => dong.locator("td").nth(tieuDe.indexOf(ten.toLowerCase()))
  expect(tieuDe.indexOf("thuế + làm tròn")).toBe(tieuDe.indexOf("chênh lệch bán") + 1)
  expect(tieuDe.indexOf("giảm giá đơn")).toBe(tieuDe.indexOf("thuế + làm tròn") + 1)
  await expect(o("Theo bảng giá")).toHaveText("200.000đ")
  await expect(o("Doanh thu")).toHaveText("226.800đ")
  await expect(o("Chênh lệch bán")).toHaveText("+10.000đ")
  await expect(o("Thuế + làm tròn")).toHaveText("+16.800đ")
  await expect(o("Giảm giá đơn")).toHaveText("0")
})
