import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 12/10/2026: "Thêm cột tổng chênh lệch = chênh lệch thuần - giảm giá đơn" và "chênh thuần = chênh bán +
 *   chênh trả" (chênh trả âm là phần NPP đã trả cho nhân viên, giờ thu hồi). HD-TC-1 của "NV Tổng Chênh": 3 thùng ×
 *   460.000 (bảng giá thùng 450.000) → chênh bán +30.000; tiền hàng 1.380.000, hoá đơn còn 1.360.000 → giảm giá đơn
 *   20.000. Khách trả 1 thùng, phiếu trả ghi 440.000 → chênh trả −10.000 → chênh thuần +20.000, tổng chênh lệch 0.
 *   Dữ liệu RIÊNG của spec này. Logic: tests/tong-chenh-lech.test.ts.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const SP = "00000000-0000-4000-8000-0000000000d7"
const NV = "00000000-0000-4000-8000-0000000000b6"
const HD = "hd-tc-1"
const TR = "tr-tc-1"

const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeAll(async () => {
  await api("products", "POST", [{
    id: SP, org_id: ORG, sku: "TC1", name: "Sữa thử tổng chênh", base_unit: "hộp", sell_price: 20000, status: "active", primary_supplier_id: null,
    units: [{ unit_name: "thùng", conversion: 24 }],
    price_lists: [{ id: "pl-tc-t", product_id: SP, unit_name: "thùng", group_id: null, price: 450000 }],
  }])
  await api("users", "POST", [{ id: NV, org_id: ORG, full_name: "NV Tổng Chênh", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await api("sales_invoices", "POST", [{
    id: HD, org_id: ORG, invoice_code: "HD-TC-1", order_id: null, customer_id: KHACH, status: "posted",
    subtotal: 1360000, vat: 0, total: 1360000, payment_terms: "COD", due_date: "2026-09-25", invoice_date: "2026-09-25",
    created_at: "2026-09-25T03:00:00Z", sales_user_id: NV, posted_by: OWNER,
  }])
  await api("sales_invoice_lines", "POST", [{
    id: "sil-tc-1", invoice_id: HD, product_id: SP, quantity: 3, unit_name: "thùng", conversion_factor: 24, unit_price: 460000,
    line_discount: 0, vat_rate: 0, line_total: 1380000, is_exchange: false, sort_order: 0, order_line_id: null,
  }])
  await api("returns", "POST", [{
    id: TR, org_id: ORG, customer_id: KHACH, invoice_id: HD, credit_note_amount: 440000, created_at: "2026-09-26T04:00:00Z",
    revenue_date: "2026-09-26", sales_user_id: NV, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed",
  }])
  await api("return_lines", "POST", [{ id: "rl-tc-1", return_id: TR, product_id: SP, unit_name: "thùng", quantity: 1, unit_price: 440000, line_total: 440000, is_exchange: false }])
})
test.afterAll(async () => {
  await api(`return_lines?return_id=eq.${TR}`, "DELETE")
  await api(`returns?id=eq.${TR}`, "DELETE")
  await api(`sales_invoice_lines?invoice_id=eq.${HD}`, "DELETE")
  await api(`sales_invoices?id=eq.${HD}`, "DELETE")
  await api(`users?id=eq.${NV}`, "DELETE")
  await api(`products?id=eq.${SP}`, "DELETE")
})

test("Hàng bán theo nhân viên: chênh thuần = bán (+30.000) + trả (−10.000); tổng chênh lệch = thuần − giảm giá đơn (20.000) = 0", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/employees")
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: "Hàng bán theo nhân viên", exact: true }).click()
  await expect(page.locator("th", { hasText: "Tổng chênh lệch" }).first()).toBeVisible()

  const dong = page.locator("tr", { hasText: "NV Tổng Chênh" }).first()
  // Ô theo TÊN cột (bảng có ô đầu mở chi tiết — đếm cột tay dễ lệch).
  const tieuDe = (await dong.locator("xpath=ancestor::table[1]").locator("thead th").allInnerTexts()).map((t) => t.trim().toLowerCase())
  const o = (ten: string) => dong.locator("td").nth(tieuDe.indexOf(ten.toLowerCase()))
  expect(tieuDe.indexOf("tổng chênh lệch")).toBe(tieuDe.indexOf("chênh lệch thuần") + 1)
  await expect(o("Chênh lệch bán")).toHaveText("+30.000đ")
  await expect(o("Giảm giá đơn")).toHaveText("-20.000đ")
  await expect(o("Chênh lệch trả")).toHaveText("−10.000đ")
  await expect(o("Chênh lệch thuần")).toHaveText("+20.000đ")
  await expect(o("Tổng chênh lệch")).toHaveText("0")
})
