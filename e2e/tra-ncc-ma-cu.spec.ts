import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 08/10/2026: "Đổi đầu PTNCC", chọn "Đánh lại cả phiếu cũ" (mig 240). Phiếu cũ TH-YYMMDD-HHMMSS được đánh
 *   lại PTNCC-xxxx; mã cũ giữ ở `return_code_cu` — danh sách tìm được theo CẢ mã cũ (số trên giấy đã đưa NCC), thấy
 *   dòng "cũ …" dưới mã mới; màn chi tiết hiện "Mã cũ".
 *   Dòng dữ liệu RIÊNG của spec này.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const NCC = "00000000-0000-4000-8000-0000000000e1"
const them = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

const PHIEU = {
  id: "sr-ma-cu", org_id: ORG, supplier_id: NCC, return_code: "PTNCC-0042", return_code_cu: "TH-250901-080000",
  return_date: "2026-10-01", warehouse_zone: "sale", status: "completed", reason: "Hàng lỗi", notes: null,
  subtotal: 30000, vat: 0, discount: 0, total: 30000, created_by: OWNER, created_at: "2026-10-01T02:00:00Z",
  supplier: { id: NCC, name: "Vinamilk", code: "NCC1" },
}

test.beforeAll(async () => { await them("supplier_returns", [PHIEU]) })
test.afterAll(async () => { await xoa("supplier_returns", "id", PHIEU.id) })

test("máy tính: tìm phiếu trả NCC theo mã cũ TH-… và mã mới PTNCC-…; chi tiết hiện mã cũ", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await dangNhap(page)
  await page.goto("/purchase-returns")
  const dong = page.getByRole("row").filter({ hasText: "PTNCC-0042" })
  await expect(dong.getByTestId("ma-cu-tra-ncc")).toHaveText("cũ TH-250901-080000")
  const o = page.getByPlaceholder("Mã phiếu, tên NCC…").first()
  for (const tu of ["TH-250901-080000", "PTNCC-0042"]) {
    await o.fill("HD-9999")
    await expect(dong, "gõ một mã không có thì phải lọc mất").toHaveCount(0)
    await o.fill(tu)
    await expect(dong, `gõ "${tu}"`).toHaveCount(1)
  }
  await page.goto(`/purchase-returns/${PHIEU.id}`)
  await expect(page.getByText("Mã cũ (trên giấy cũ)")).toBeVisible()
  await expect(page.getByText("TH-250901-080000")).toBeVisible()
})
