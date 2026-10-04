import { test, expect, type Page, type Route } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ĐỘI TEST "BÁO CÁO" — LỖI ĐÃ XÁC MINH (để NGUYÊN ĐỎ tới khi sửa).
 *
 * LỖI 4 — /reports/finance (menu "Tài chính" → "Kết quả HĐKD"): "Lợi nhuận gộp" = doanh thu thuần − giá vốn
 *   XUẤT, KHÔNG trừ giá vốn hàng trả đã nhập lại kho. Luật CLAUDE.md: "Lãi gộp = doanh thu thuần − (giá vốn −
 *   giá vốn hàng trả đã nhập kho)". Doanh thu thuần đã trừ hàng trả nhưng giá vốn của chính hàng đó (đã về
 *   kho) vẫn tính → lãi gộp thấp giả, và lệch với /reports/finance/pnl (finance_pnl trừ returns_cogs) cho CÙNG kỳ.
 *   Mã nghi: src/app/(dashboard)/reports/finance/page.tsx — `setCogs(cogsRes.cogs)` (chỉ fetchCogsForRange,
 *   không fetchReturnCosts) và `grossProfit = netRevenue - cogs`.
 *
 * Dữ liệu (tháng 9/2026, chặn bằng page.route — không đụng fixture dùng chung):
 *   HĐ 1.000.000 (100 hộp × 10.000); phiếu trả hoàn thành 20 hộp = 120.000 (revenue_date trong kỳ).
 *   Phiếu xuất 100 hộp × giá vốn 5.000 = 500.000; phiếu "Nhập lại từ phiếu trả" 20 hộp × 5.000 = 100.000.
 *   → Doanh thu thuần 880.000; giá vốn hàng bán = 500.000 − 100.000 = 400.000; lợi nhuận gộp 480.000.
 */
const SUA = "00000000-0000-4000-8000-0000000000d1"

async function tra(route: Route, rows: unknown[]) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0", "access-control-expose-headers": "content-range" },
    body: JSON.stringify(rows),
  })
}

async function chanDuLieu(page: Page) {
  const XUAT = { id: "se-xuat-bc", type: "export", status: "posted", posted_at: "2026-09-10T03:00:00Z", entry_code: "XK-BC", supplier_id: null }
  const NHAP = { id: "se-nhap-bc", type: "import", status: "posted", posted_at: "2026-09-15T05:00:00Z", entry_code: "NK-BC", supplier_id: null, notes: "Nhập lại từ phiếu trả r-bc-1" }
  await page.route(/\/rest\/v1\/sales_invoices\?/, (r) => tra(r, [{
    id: "hd-bc-1", invoice_code: "HD-BC-1", invoice_date: "2026-09-10", order_id: "o-bc-1", status: "posted",
    total: 1000000, subtotal: 1000000, vat: 0, customer_id: "00000000-0000-4000-8000-0000000000c1",
    sales_user_id: "00000000-0000-4000-8000-0000000000b1", posted_by: null, payment_terms: "COD",
  }]))
  await page.route(/\/rest\/v1\/sales_invoice_lines\?/, (r) => tra(r, [{
    id: "l-bc-1", invoice_id: "hd-bc-1", product_id: SUA, unit_name: "hộp", conversion_factor: 1, quantity: 100,
    unit_price: 10000, line_total: 1000000, is_exchange: false, line_discount: 0, order_line_id: null,
  }]))
  await page.route(/\/rest\/v1\/returns\?/, (r) => tra(r, [{ id: "r-bc-1", status: "completed", revenue_date: "2026-09-15", credit_note_amount: 120000 }]))
  await page.route(/\/rest\/v1\/expenses\?/, (r) => tra(r, []))
  await page.route(/\/rest\/v1\/stock_entries\?/, (r) => {
    const u = decodeURIComponent(r.request().url())
    if (u.includes("type=eq.export")) return tra(r, [XUAT])
    if (u.includes("type=eq.import")) return tra(r, [NHAP])
    return tra(r, [XUAT, NHAP])
  })
  await page.route(/\/rest\/v1\/stock_entry_lines\?/, (r) => {
    const u = decodeURIComponent(r.request().url())
    const rows = []
    if (u.includes("se-xuat-bc")) rows.push({ entry_id: "se-xuat-bc", product_id: SUA, quantity: 100, qty_in_base_uom: 100, conversion_factor_snapshot: 1, unit_cost: 5000 })
    if (u.includes("se-nhap-bc")) rows.push({ entry_id: "se-nhap-bc", product_id: SUA, quantity: 20, qty_in_base_uom: 20, conversion_factor_snapshot: 1, unit_cost: 5000 })
    return tra(r, rows)
  })
}

const dong = (page: Page, nhan: RegExp) => page.getByRole("row", { name: nhan }).first()

test("LỖI 4 — Kết quả HĐKD: giá vốn phải trừ giá vốn hàng trả đã nhập kho → lợi nhuận gộp 480.000", async ({ page }) => {
  await dangNhap(page)
  await chanDuLieu(page)
  await page.goto("/reports/finance")
  // Doanh thu thuần đúng luật (đã trừ hàng trả) — phần này ĐÚNG.
  await expect(dong(page, /Doanh thu thuần/)).toContainText("880.000")
  await expect(dong(page, /Giá trị hàng bán bị trả lại/)).toContainText("120.000")
  // Phần SAI: giá vốn chưa trừ 100.000 giá vốn hàng trả đã nhập lại kho.
  await expect(dong(page, /Giá vốn hàng bán/)).toContainText("400.000")
  await expect(dong(page, /Lợi nhuận gộp/)).toContainText("480.000")
})
