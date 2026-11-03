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
/* Chủ nhà 03/11/2026: "cột số lượng bán tổng hợp số lượng và ghi 'đơn vị' ko cần diễn giải chi tiết ở phần tổng hợp".
   HD-DVT-2 của "NV Thử Tổng SL": 2 thùng sữa (= 48 hộp) + 6 chai nước; trả 1 chai → dòng nhân viên: SL bán 54, Đơn vị
   "đơn vị", SL trả 1 (bản cũ: "48 hộp · 6 chai", "1 chai"). Chi tiết mở ra vẫn theo từng đơn vị tính. */
const SP_NUOC = "00000000-0000-4000-8000-0000000000df"
const NV2 = "00000000-0000-4000-8000-0000000000bd"
const HD2 = "hd-dvt-2"
const TR2 = "tr-dvt-2"

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

  await them("products", [{
    id: SP_NUOC, org_id: ORG, sku: "DVT2", name: "Nước thử ĐVT", base_unit: "chai", sell_price: 10000, status: "active", primary_supplier_id: null,
    units: [], price_lists: [{ id: "pl-dvt-c", product_id: SP_NUOC, unit_name: "chai", group_id: null, price: 10000 }],
  }])
  await them("users", [{ id: NV2, org_id: ORG, full_name: "NV Thử Tổng SL", role: "sales", is_active: true, created_at: "2026-09-01T00:00:00Z" }])
  await them("sales_invoices", [{
    id: HD2, org_id: ORG, invoice_code: "HD-DVT-2", order_id: null, customer_id: KHACH, status: "posted",
    subtotal: 960000, vat: 0, total: 960000, payment_terms: "COD", due_date: "2026-09-26", invoice_date: "2026-09-26",
    created_at: "2026-09-26T04:00:00Z", sales_user_id: NV2, posted_by: OWNER,
  }])
  await them("sales_invoice_lines", [
    { id: "sil-dvt2-t", invoice_id: HD2, product_id: SP, quantity: 2, unit_name: "thùng", conversion_factor: 24, unit_price: 450000, line_discount: 0, vat_rate: 0, line_total: 900000, is_exchange: false, sort_order: 0, order_line_id: null },
    { id: "sil-dvt2-c", invoice_id: HD2, product_id: SP_NUOC, quantity: 6, unit_name: "chai", conversion_factor: 1, unit_price: 10000, line_discount: 0, vat_rate: 0, line_total: 60000, is_exchange: false, sort_order: 1, order_line_id: null },
  ])
  await them("returns", [{
    id: TR2, org_id: ORG, customer_id: KHACH, invoice_id: HD2, credit_note_amount: 10000, created_at: "2026-09-27T05:00:00Z",
    revenue_date: "2026-09-27", sales_user_id: NV2, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed",
  }])
  await them("return_lines", [{ id: "rl-dvt2-c", return_id: TR2, product_id: SP_NUOC, unit_name: "chai", quantity: 1, unit_price: 10000, line_total: 10000, is_exchange: false }])
})
test.afterAll(async () => {
  await xoa("return_lines", "return_id", TR2)
  await xoa("returns", "id", TR2)
  await xoa("sales_invoice_lines", "invoice_id", HD2)
  await xoa("sales_invoices", "id", HD2)
  await xoa("users", "id", NV2)
  await xoa("products", "id", SP_NUOC)
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

test("Hàng bán theo nhân viên › phần tổng hợp: SL bán / SL trả là MỘT số, cột Đơn vị ghi 'đơn vị' (cả dòng tổng)", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/employees")
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: "Hàng bán theo nhân viên", exact: true }).click()

  // Ô: 0 nút mở · 1 Người bán · 2 SL bán · 3 Đơn vị · … · 9 SL trả.
  const dong = page.locator("tbody tr", { hasText: "NV Thử Tổng SL" }).first()
  await expect(dong.locator("td").nth(2)).toHaveText("54") // 48 hộp + 6 chai — không diễn giải "48 hộp · 6 chai"
  await expect(dong.locator("td").nth(3)).toHaveText("đơn vị")
  await expect(dong.locator("td").nth(9)).toHaveText("1")
  await expect(dong).not.toContainText("hộp")
  await expect(dong).not.toContainText("chai")

  // Dòng tổng cũng một số + "đơn vị".
  const tong = page.locator("tr", { hasText: "SL người bán:" }).last()
  await expect(tong.locator("td").nth(3)).toHaveText("đơn vị")
  await expect(tong.locator("td").nth(2)).toHaveText(/^[\d.]+$/)

  // Mở ra: chi tiết vẫn theo từng đơn vị tính của dòng.
  await dong.click()
  const ct = page.getByTestId("nv-hang-ban-chi-tiet")
  await expect(ct.locator("tr", { hasText: "thùng" }).locator("td").nth(3)).toHaveText("2")
  await expect(ct.locator("tr", { hasText: "Nước thử ĐVT" }).locator("td").nth(2)).toHaveText("chai")
  await expect(ct.locator("tr", { hasText: "Nước thử ĐVT" }).locator("td").nth(3)).toHaveText("6")
})
