import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 09/10/2026: "rà soát lại phần báo cáo xem các bộ lọc có hoạt động không?" — BÁO CÁO CŨ (/reports/*).
 *   Đồng hồ e2e ghim 30/09/2026 (`HOM_NAY_E2E`): "Tháng này" = 01–30/09, "Tuần này" = 28–30/09, Cuối ngày = 30/09.
 *   Dữ liệu RIÊNG của spec này.
 *
 *   HD-LC-1 (30/09, "Khách Lọc Cũ"): A 8 × 100.000 + B 2 × 100.000, giảm cả đơn 100.000, VAT 90.000 → 990.000.
 *     Lọc NCC A: 792.000; giảm giá 80.000. Phiếu xuất: A 8 × 50.000, B 2 × 30.000.
 *   HD-LC-X (30/09) ĐÃ HUỶ, phiếu xuất A 5 × 50.000 (hàng đã hoàn kho) — không phải giá vốn.
 *   HD-LC-2 (30/09, khách mẫu): B 10 hộp, phiếu xuất 10 × 100.000 — giá vốn của khách KHÁC.
 *   Trả: TR-LC-B1 (B, 110.000 gồm VAT), TR-LC-A1 (A, 110.000) — cùng 30/09.
 *   Kho A: nhập 28/09 +30, xuất 30/09 −8 −5 (HĐ huỷ) +5 hoàn kho, xuất 02/10 −3; tồn hiện tại 20
 *     → tồn cuối 30/09 = 23, tồn đầu 28/09 = 1 (bản cũ: cuối 20 = tồn hiện tại, đầu 0).
 *   ĐH-LC-1 (30/09, nhóm "Nhóm Lọc Cũ"): A 8 (800.000) + B 2 (200.000), tổng 990.000.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH_MAU = "00000000-0000-4000-8000-0000000000c1"
const KH = "00000000-0000-4000-8000-0000000000cb"
const NHOM = "00000000-0000-4000-8000-0000000000fb"
const NCC_A = "00000000-0000-4000-8000-0000000000ec"
const NCC_B = "00000000-0000-4000-8000-0000000000ed"
const SP_A = "00000000-0000-4000-8000-0000000000dc"
const SP_B = "00000000-0000-4000-8000-0000000000dd"
const NGAY = "2026-09-30"

const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

const hd = (id: string, ma: string, kh: string, status: string, subtotal: number, vat: number, total: number, entry: string) => ({
  id, org_id: ORG, invoice_code: ma, order_id: null, customer_id: kh, status, subtotal, vat, total, payment_terms: "COD",
  due_date: NGAY, invoice_date: NGAY, created_at: `${NGAY}T03:00:00Z`, sales_user_id: OWNER, posted_by: OWNER, stock_entry_id: entry,
})
const dhd = (id: string, inv: string, sp: string, q: number, i: number) => ({
  id, invoice_id: inv, product_id: sp, quantity: q, unit_name: "hộp", conversion_factor: 1, unit_price: 100000, line_discount: 0,
  vat_rate: 0.1, line_total: q * 100000, is_exchange: false, sort_order: i, order_line_id: null,
})
const phieu = (id: string, type: string, ngay: string, notes = "") => ({
  id, org_id: ORG, entry_code: id.toUpperCase(), type, status: "posted", posted_at: `${ngay}T03:00:00Z`, notes, ref_order_ids: type === "export" ? ["x"] : null,
})
const dong = (id: string, entry: string, sp: string, q: number, gia: number) => ({
  id, entry_id: entry, product_id: sp, quantity: q, qty_in_base_uom: q, conversion_factor_snapshot: 1, unit_cost: gia,
})
const IDS = {
  hd: ["hd-lc-1", "hd-lc-x", "hd-lc-2"],
  tra: ["tr-lc-b1", "tr-lc-a1"],
  phieu: ["se-lc-in", "se-lc-1", "se-lc-x", "se-lc-hoan", "se-lc-2", "se-lc-sau"],
  lo: ["lo-lc-a", "lo-lc-b"],
}

test.beforeAll(async () => {
  await them("suppliers", [
    { id: NCC_A, org_id: ORG, code: "LCA", name: "NCC Lọc Cũ A", status: "active", is_active: true },
    { id: NCC_B, org_id: ORG, code: "LCB", name: "NCC Lọc Cũ B", status: "active", is_active: true },
  ])
  await them("products", [
    { id: SP_A, org_id: ORG, sku: "LCA", name: "Hàng lọc cũ A", brand: "Hiệu Lọc A", base_unit: "hộp", sell_price: 100000, status: "active", primary_supplier_id: NCC_A, units: [], price_lists: [] },
    { id: SP_B, org_id: ORG, sku: "LCB", name: "Hàng lọc cũ B", brand: "Hiệu Lọc B", base_unit: "hộp", sell_price: 100000, status: "active", primary_supplier_id: NCC_B, units: [], price_lists: [] },
  ])
  await them("customer_groups", [{ id: NHOM, org_id: ORG, name: "Nhóm Lọc Cũ" }])
  await them("customers", [{ id: KH, org_id: ORG, store_name: "Khách Lọc Cũ", group_id: NHOM, channel: null, payment_terms: "COD", credit_limit: 0, status: "active" }])
  await them("sales_invoices", [
    hd("hd-lc-1", "HD-LC-1", KH, "posted", 900000, 90000, 990000, "se-lc-1"),
    hd("hd-lc-x", "HD-LC-X", KH, "cancelled", 500000, 0, 500000, "se-lc-x"),
    hd("hd-lc-2", "HD-LC-2", KHACH_MAU, "posted", 1000000, 0, 1000000, "se-lc-2"),
  ])
  await them("sales_invoice_lines", [
    dhd("sil-lc-1a", "hd-lc-1", SP_A, 8, 0),
    dhd("sil-lc-1b", "hd-lc-1", SP_B, 2, 1),
    dhd("sil-lc-x", "hd-lc-x", SP_A, 5, 0),
    dhd("sil-lc-2", "hd-lc-2", SP_B, 10, 0),
  ])
  await them("returns", [
    { id: "tr-lc-b1", org_id: ORG, customer_id: KH, invoice_id: "hd-lc-1", credit_note_amount: 110000, created_at: `${NGAY}T05:00:00Z`, revenue_date: NGAY, sales_user_id: OWNER, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed" },
    { id: "tr-lc-a1", org_id: ORG, customer_id: KH, invoice_id: "hd-lc-1", credit_note_amount: 110000, created_at: `${NGAY}T06:00:00Z`, revenue_date: NGAY, sales_user_id: OWNER, requested_by: OWNER, reason: "damaged", credit_with_invoice: false, status: "completed" },
  ])
  await them("return_lines", [
    { id: "rl-lc-b1", return_id: "tr-lc-b1", product_id: SP_B, unit_name: "hộp", quantity: 1, unit_price: 100000, line_total: 110000, is_exchange: false },
    { id: "rl-lc-a1", return_id: "tr-lc-a1", product_id: SP_A, unit_name: "hộp", quantity: 1, unit_price: 100000, line_total: 110000, is_exchange: false },
  ])
  await them("stock_entries", [
    phieu("se-lc-in", "import", "2026-09-28"),
    phieu("se-lc-1", "export", NGAY),
    phieu("se-lc-x", "export", NGAY),
    phieu("se-lc-hoan", "import", NGAY, "Hoàn kho HĐ huỷ HD-LC-X"),
    phieu("se-lc-2", "export", NGAY),
    phieu("se-lc-sau", "export", "2026-10-02"),
  ])
  await them("stock_entry_lines", [
    dong("sel-lc-in", "se-lc-in", SP_A, 30, 50000),
    dong("sel-lc-1a", "se-lc-1", SP_A, 8, 50000),
    dong("sel-lc-1b", "se-lc-1", SP_B, 2, 30000),
    dong("sel-lc-x", "se-lc-x", SP_A, 5, 50000),
    dong("sel-lc-hoan", "se-lc-hoan", SP_A, 5, 50000),
    dong("sel-lc-2", "se-lc-2", SP_B, 10, 100000),
    dong("sel-lc-sau", "se-lc-sau", SP_A, 3, 50000),
  ])
  await them("batches", [
    { id: "lo-lc-a", org_id: ORG, product_id: SP_A, batch_code: "LO-LC-A", qty_on_hand: 20, unit_cost: 50000, created_at: "2026-09-28T03:00:00Z" },
    { id: "lo-lc-b", org_id: ORG, product_id: SP_B, batch_code: "LO-LC-B", qty_on_hand: 10, unit_cost: 30000, created_at: "2026-09-28T03:00:00Z" },
  ])
  await them("sales_orders", [{
    id: "so-lc-1", org_id: ORG, order_code: "ĐH-LC-1", order_date: NGAY, status: "completed", total: 990000, subtotal: 900000, discount: 100000, vat: 90000,
    customer_id: KH, sales_user_id: OWNER, created_by: OWNER, payment_terms: "COD", created_at: `${NGAY}T02:00:00Z`,
  }])
  await them("sales_order_lines", [
    { id: "sol-lc-a", order_id: "so-lc-1", product_id: SP_A, quantity: 8, invoiced_qty: 8, unit_name: "hộp", conversion_factor: 1, unit_price: 100000, line_total: 800000 },
    { id: "sol-lc-b", order_id: "so-lc-1", product_id: SP_B, quantity: 2, invoiced_qty: 2, unit_name: "hộp", conversion_factor: 1, unit_price: 100000, line_total: 200000 },
  ])
})
test.afterAll(async () => {
  await xoa("sales_order_lines", "order_id", "so-lc-1")
  await xoa("sales_orders", "id", "so-lc-1")
  for (const id of IDS.lo) await xoa("batches", "id", id)
  for (const id of IDS.phieu) await xoa("stock_entry_lines", "entry_id", id)
  for (const id of IDS.phieu) await xoa("stock_entries", "id", id)
  for (const id of IDS.tra) await xoa("return_lines", "return_id", id)
  for (const id of IDS.tra) await xoa("returns", "id", id)
  for (const id of IDS.hd) await xoa("sales_invoice_lines", "invoice_id", id)
  for (const id of IDS.hd) await xoa("sales_invoices", "id", id)
  await xoa("customers", "id", KH)
  await xoa("customer_groups", "id", NHOM)
  for (const id of [SP_A, SP_B]) await xoa("products", "id", id)
  for (const id of [NCC_A, NCC_B]) await xoa("suppliers", "id", id)
})

async function chonTab(page: Page, ten: string) {
  await page.getByRole("combobox", { name: "Mối quan tâm" }).click()
  await page.getByRole("option", { name: ten, exact: true }).click()
}
async function chonNhieu(page: Page, nut: string, muc: RegExp) {
  await page.getByRole("button", { name: nut }).first().click()
  await page.getByRole("button", { name: muc }).first().click()
  await page.keyboard.press("Escape")
  await page.locator("h1").first().click()
}
const dongCo = (page: Page, chu: string | RegExp) => page.locator("tr", { hasText: chu })

test("Bán hàng (cũ) lọc NCC: tiền là phần của hàng NCC ấy ở mọi tab; tab Trả hàng và Lợi nhuận cùng lọc", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/sales")
  await chonNhieu(page, "Tất cả NCC", /NCC Lọc Cũ A/)
  // Thời gian: 30/09 doanh thu 792.000 (phần A), trả 110.000 (chỉ phiếu A), thuần 682.000.
  const ngay = dongCo(page, "30/09/2026")
  await expect(ngay).toContainText("792.000")
  await expect(ngay).toContainText("682.000")
  await expect(ngay).not.toContainText("990.000")
  // Trả hàng: chỉ phiếu có hàng NCC A.
  await chonTab(page, "Trả hàng")
  await expect(dongCo(page, "tr-lc-a1")).toContainText("110.000")
  await expect(dongCo(page, "tr-lc-b1")).toHaveCount(0)
  // Giảm giá HĐ: phần của A (80.000 trên tạm tính 800.000).
  await chonTab(page, "Giảm giá HĐ")
  await expect(dongCo(page, "HD-LC-1")).toContainText("80.000")
  await expect(dongCo(page, "HD-LC-1")).not.toContainText("100.000")
  // Lợi nhuận: giá vốn của hàng A đã lọc (8 × 50.000), không phải mọi phiếu xuất cả sổ → lãi 282.000.
  await chonTab(page, "Lợi nhuận")
  await expect(dongCo(page, "30/09/2026")).toContainText("400.000")
  await expect(dongCo(page, "30/09/2026")).toContainText("282.000")
})

test("Đặt hàng: tab Giao dịch qua lọc Hàng hoá (tiền phần của hàng) và Bảng giá / Nhóm khách", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/orders")
  await chonTab(page, "Giao dịch")
  await chonNhieu(page, "Tất cả hàng hóa", /Hàng lọc cũ A/)
  const don = dongCo(page, "ĐH-LC-1")
  await expect(don).toContainText("792.000")
  await expect(don).toContainText("8 hộp")
  await expect(don).not.toContainText("990.000")
  // Bỏ lọc hàng, lọc nhóm khách: chỉ đơn của khách thuộc nhóm.
  await page.reload()
  await chonTab(page, "Giao dịch")
  await page.getByRole("button", { name: "Chọn bảng giá" }).click()
  await page.getByRole("button", { name: /Nhóm Lọc Cũ/ }).first().click()
  await expect(dongCo(page, "ĐH-LC-1")).toContainText("990.000")
  await expect(page.getByText(/SL phiếu: 1\b/)).toBeVisible()
})

test("Hàng hoá: giá vốn không gồm phiếu xuất của HĐ đã huỷ; Xuất nhập tồn có tồn đầu / tồn cuối theo kỳ", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/products")
  await chonTab(page, "Lợi nhuận")
  const a = dongCo(page, "Hàng lọc cũ A")
  await expect(a).toContainText("400.000")
  await expect(a).not.toContainText("650.000")
  await chonTab(page, "Xuất nhập tồn")
  const x = dongCo(page, "Hàng lọc cũ A")
  // Tuần 28–30/09: đầu 1, cuối 23 (tồn hiện tại 20 + 3 xuất ngày 02/10).
  await expect(x).toContainText("23 hộp")
  await expect(x).toContainText("1 hộp")
  await expect(x).not.toContainText("20 hộp")
})

test("Cuối ngày (cũ): lọc khách → LN gộp trừ giá vốn của đúng hoá đơn khách ấy", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/end-of-day")
  await page.getByRole("button", { name: "Theo mã, tên, số điện thoại" }).click()
  await page.getByRole("button", { name: /Khách Lọc Cũ/ }).first().click()
  await page.keyboard.press("Escape")
  await page.locator("h1").first().click()
  // Thuần 990.000 − 220.000 = 770.000; giá vốn HD-LC-1 = 8 × 50.000 + 2 × 30.000 = 460.000 → LN gộp 310.000.
  const ln = page.locator("div", { has: page.getByText("LN gộp", { exact: true }) }).last()
  await expect(ln).toContainText("310.000")
  await expect(page.getByText("toàn NPP — không theo bộ lọc")).toBeVisible()
})
