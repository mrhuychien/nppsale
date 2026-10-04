import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ĐỘI TEST "KHO" — màn THẺ KHO (/inventory/stock-card/[productId]) đọc đúng số (phép kiểm đang XANH).
 *   bash scripts/e2e-khoa.sh e2e/doi-kho-the-kho.spec.ts
 * Luật: số lượng trên thẻ kho là ĐƠN VỊ CƠ SỞ (thùng × hệ số), tồn chạy cộng tồn trước "Từ ngày" (rà soát 03/10/2026),
 * chỉ phiếu đã ghi sổ (nháp / huỷ không vào thẻ kho). Dữ liệu tự gieo vào Supabase giả qua REST — không sửa fixture chung.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const SP = "00000000-0000-4000-8000-00000000dc01"

async function gieo(bang: string, rows: unknown[]) {
  const r = await fetch(`${FAKE}/rest/v1/${bang}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  })
  expect(r.ok).toBe(true)
}
const phieu = (id: string, code: string, type: string, status: string, posted_at: string) => ({
  id, entry_code: code, type, status, posted_at, created_at: posted_at, supplier: null, creator: { full_name: "Hoàng Văn Em" },
})
const hang = (page: Page, ma: string) => page.locator("tbody tr").filter({ hasText: ma })
/** Cột cuối-1 là "Tồn sau" (cột cuối là giá vốn). */
const tonSau = (page: Page, ma: string) => hang(page, ma).locator("td").nth(-2)

test.beforeAll(async () => {
  await gieo("products", [{ id: SP, org_id: ORG, sku: "DK-TK1", name: "Nước ngọt thẻ kho", base_unit: "lon", sell_price: 10000, status: "active" }])
  await gieo("batches", [{ id: "dk-b1", org_id: ORG, product_id: SP, batch_code: "TK-L1", qty_on_hand: 70, unit_cost: 5000, warehouse_zone: "sale", expires_at: "2027-12-31" }])
  await gieo("stock_entry_lines", [
    // Nhập 3 thùng × 24 = 72 lon, 10:00 VN 20/09.
    { id: "dk-l1", product_id: SP, batch_id: "dk-b1", unit_name: "thùng", quantity: 3, qty_in_base_uom: 72, conversion_factor_snapshot: 24, unit_cost: 5000,
      notes: null, batch: { batch_code: "TK-L1" }, entry: phieu("dk-e1", "DK-NK1", "import", "posted", "2026-09-20T03:00:00Z") },
    // Xuất 2 lon, 10:00 VN 22/09.
    { id: "dk-l2", product_id: SP, batch_id: "dk-b1", unit_name: "lon", quantity: 2, qty_in_base_uom: 2, conversion_factor_snapshot: 1, unit_cost: 5000,
      notes: null, batch: { batch_code: "TK-L1" }, entry: phieu("dk-e2", "DK-XK1", "export", "posted", "2026-09-22T03:00:00Z") },
    // Phiếu NHÁP và phiếu ĐÃ HUỶ: không vào thẻ kho.
    { id: "dk-l3", product_id: SP, batch_id: null, unit_name: "lon", quantity: 50, qty_in_base_uom: 50, conversion_factor_snapshot: 1, unit_cost: 0,
      notes: null, batch: null, entry: phieu("dk-e3", "DK-NHAP", "export", "draft", "2026-09-23T03:00:00Z") },
    { id: "dk-l4", product_id: SP, batch_id: null, unit_name: "lon", quantity: 9, qty_in_base_uom: 9, conversion_factor_snapshot: 1, unit_cost: 0,
      notes: null, batch: null, entry: phieu("dk-e4", "DK-HUY", "import", "cancelled", "2026-09-23T04:00:00Z") },
  ])
})

test("thẻ kho: số theo đơn vị cơ sở, tồn chạy, KPI kỳ; nháp / huỷ không vào", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/inventory/stock-card/${SP}`)
  await expect(page.getByRole("main").getByRole("heading", { name: /Thẻ kho: Nước ngọt thẻ kho/ })).toBeVisible()
  await expect(hang(page, "DK-NK1")).toHaveCount(1)
  // Dòng nhập: +72 (đơn vị cơ sở) kèm "3 thùng"; tồn sau 72.
  await expect(hang(page, "DK-NK1")).toContainText("+72")
  await expect(hang(page, "DK-NK1")).toContainText("3 thùng")
  await expect(tonSau(page, "DK-NK1")).toHaveText("72")
  await expect(hang(page, "DK-XK1")).toContainText("-2")
  await expect(tonSau(page, "DK-XK1")).toHaveText("70")
  await expect(hang(page, "DK-NHAP")).toHaveCount(0)
  await expect(hang(page, "DK-HUY")).toHaveCount(0)
  await expect(page.getByText("Tồn hiện tại").locator("..")).toContainText("70")
  await expect(page.getByText("Nhập (kỳ)").locator("../..")).toContainText("+72")
  await expect(page.getByText("Xuất (kỳ)").locator("../..")).toContainText("-2")
  // Ngày hiện theo giờ VN.
  await expect(hang(page, "DK-NK1")).toContainText("20/09/2026")
})

test("thẻ kho: lọc Từ ngày giữ tồn đầu kỳ (tồn sau không bắt đầu lại từ 0)", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/inventory/stock-card/${SP}`)
  await expect(hang(page, "DK-NK1")).toHaveCount(1)
  await page.locator('input[type="date"]').nth(0).fill("2026-09-21")
  await expect(hang(page, "DK-NK1")).toHaveCount(0)
  await expect(tonSau(page, "DK-XK1")).toHaveText("70")
  await expect(page.getByText("Nhập (kỳ)").locator("../..")).toContainText("+0")
  // Đến ngày trước phiếu xuất → không còn dòng nào trong kỳ.
  await page.locator('input[type="date"]').nth(1).fill("2026-09-21")
  await expect(page.getByText("Chưa có giao dịch")).toBeVisible()
  await page.getByRole("button", { name: "Xóa lọc" }).click()
  await expect(hang(page, "DK-NK1")).toHaveCount(1)
})
