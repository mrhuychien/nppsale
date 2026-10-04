import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ĐỘI TEST "KHO" — LỖI ĐÃ XÁC MINH ở màn THẺ KHO (/inventory/stock-card/[productId]). Đang ĐỎ; sửa xong phải XANH.
 *   bash scripts/e2e-khoa.sh e2e/doi-kho-loi.spec.ts
 *
 * LỖI A — lọc ngày theo mốc UTC: `m.date.slice(0, 10)` trên `posted_at` ISO (page.tsx: lọc `filtered` và tồn đầu kỳ).
 *   CLAUDE.md: "so bằng ngày theo giờ VN (vnDateKey), không so với mốc ISO/UTC". Phiếu ghi sổ 01:30 sáng 25/09 giờ VN
 *   (= 18:30Z ngày 24) hiện ngày "25/09/2026" trên chính dòng đó, nhưng lọc "Từ ngày 25/09" lại loại nó ra và lọc
 *   "Đến ngày 24/09" lại giữ nó.
 *
 * LỖI B — phiếu CHUYỂN KHO (bán → date) bị cộng vào tồn chạy: TYPE_META.transfer.sign = "adjust" nên `deltaOf` cộng
 *   +qty. Chuyển kho là hàng đổi chỗ, tổng tồn không đổi (stock-issue.ts: "Chuyển kho là hàng ĐỔI CHỖ — tổng tồn
 *   không đổi"); thẻ kho tổng phải giữ nguyên số.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const SP_A = "00000000-0000-4000-8000-00000000dc11"
const SP_B = "00000000-0000-4000-8000-00000000dc12"

async function gieo(bang: string, rows: unknown[]) {
  const r = await fetch(`${FAKE}/rest/v1/${bang}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  })
  expect(r.ok).toBe(true)
}
/* Dọn dữ liệu đã gieo — Supabase giả dùng chung cả lượt chạy, để lại là làm lệch bộ chạy sau (vd kiểm kê điện thoại đếm thêm mã). */
async function xoa(bang: string, ids: string[]) {
  await fetch(`${FAKE}/rest/v1/${bang}?id=in.(${ids.join(",")})`, { method: "DELETE" })
}
const phieu = (id: string, code: string, type: string, posted_at: string) => ({
  id, entry_code: code, type, status: "posted", posted_at, created_at: posted_at, supplier: null, creator: { full_name: "Hoàng Văn Em" },
})
const dong = (id: string, pid: string, qty: number, entry: ReturnType<typeof phieu>) => ({
  id, product_id: pid, batch_id: null, unit_name: "lon", quantity: qty, qty_in_base_uom: qty, conversion_factor_snapshot: 1,
  unit_cost: 5000, notes: null, batch: null, entry,
})
const hang = (page: Page, ma: string) => page.locator("tbody tr").filter({ hasText: ma })
const tonSau = (page: Page, ma: string) => hang(page, ma).locator("td").nth(-2)

test.afterAll(async () => {
  await xoa("stock_entry_lines", ["dkl-a1", "dkl-a2", "dkl-b1", "dkl-b2"])
  await xoa("products", [SP_A, SP_B])
})

test.beforeAll(async () => {
  await gieo("products", [
    { id: SP_A, org_id: ORG, sku: "DK-LA", name: "Thẻ kho giờ VN", base_unit: "lon", sell_price: 10000, status: "active" },
    { id: SP_B, org_id: ORG, sku: "DK-LB", name: "Thẻ kho chuyển kho", base_unit: "lon", sell_price: 10000, status: "active" },
  ])
  await gieo("stock_entry_lines", [
    dong("dkl-a1", SP_A, 100, phieu("dkl-ea1", "DKL-NK-A", "import", "2026-09-20T03:00:00Z")),
    // 01:30 sáng 25/09 giờ VN.
    dong("dkl-a2", SP_A, 10, phieu("dkl-ea2", "DKL-XK-A", "export", "2026-09-24T18:30:00Z")),
    dong("dkl-b1", SP_B, 30, phieu("dkl-eb1", "DKL-NK-B", "import", "2026-09-20T03:00:00Z")),
    // Chuyển 10 lon kho bán → kho date.
    dong("dkl-b2", SP_B, 10, phieu("dkl-eb2", "DKL-CK-B", "transfer", "2026-09-21T03:00:00Z")),
  ])
})

test("LỖI A: lọc Từ / Đến ngày theo giờ VN — phiếu 01:30 sáng 25/09 thuộc ngày 25/09", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/inventory/stock-card/${SP_A}`)
  await expect(hang(page, "DKL-XK-A")).toContainText("25/09/2026") // chính dòng ghi ngày 25/09 (giờ VN)
  await page.locator('input[type="date"]').nth(0).fill("2026-09-25")
  await expect(hang(page, "DKL-XK-A")).toHaveCount(1)
  await expect(tonSau(page, "DKL-XK-A")).toHaveText("90")
  await page.getByRole("button", { name: "Xóa lọc" }).click()
  await page.locator('input[type="date"]').nth(1).fill("2026-09-24")
  await expect(hang(page, "DKL-NK-A")).toHaveCount(1)
  await expect(hang(page, "DKL-XK-A")).toHaveCount(0)
})

test("LỖI B: chuyển kho không làm đổi tồn tổng trên thẻ kho (30 → vẫn 30)", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/inventory/stock-card/${SP_B}`)
  await expect(hang(page, "DKL-CK-B")).toHaveCount(1)
  await expect(tonSau(page, "DKL-NK-B")).toHaveText("30")
  await expect(tonSau(page, "DKL-CK-B")).toHaveText("30")
})
