import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"
import { NCC, ORG } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 11/10/2026: "thêm dòng trả trước cho NCC vào" (mig 243). Bảng cân đối tính công nợ NCC RÒNG THEO TỪNG NCC:
 *   Vinamilk trả dư 50.000 (dòng trả trước của phiếu chi NCC) → "Trả trước cho NCC" 50.000 bên TÀI SẢN; NCC Ba Huân nợ
 *   120.000 → "Phải trả NCC" 120.000. Bản cũ kẹp từng dòng về 0 → 50.000 trả dư biến mất. Luật thật (gom theo NCC, dòng
 *   'paid' không tính, khớp màn Công nợ theo NCC) chạy ở scripts/sql/thu-243-can-doi-tra-truoc-ncc.sql.
 */
test.use({ viewport: { width: 1280, height: 900 } })

const NCC2 = "00000000-0000-4000-8000-0000000243e2"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeAll(async () => {
  await api("suppliers", "POST", [{ id: NCC2, org_id: ORG, code: "NCC-BH", name: "Ba Huân", is_active: true }])
  await api("payables", "POST", [
    { id: "pay-243-tt", org_id: ORG, supplier_id: NCC, invoice_number: "PCNCC-0243", amount: 0, paid: 50000, status: "open", opening_balance: false, created_at: "2026-09-25T03:00:00Z" },
    { id: "pay-243-no", org_id: ORG, supplier_id: NCC2, invoice_number: "HD-BH1", amount: 120000, paid: 0, status: "open", opening_balance: false, created_at: "2026-09-26T03:00:00Z" },
  ])
})
test.afterAll(async () => {
  await api("payables?id=in.(pay-243-tt,pay-243-no)", "DELETE")
  await api(`suppliers?id=eq.${NCC2}`, "DELETE")
})

test("bảng cân đối: NCC trả dư nằm ở 'Trả trước cho NCC' (tài sản), NCC còn nợ ở phải trả — vẫn cân", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/reports/finance/balance-sheet")
  await expect(page.getByTestId("bs-tra-truoc-ncc")).toHaveText(/Trả trước cho NCC\s*50\.000đ/)
  await expect(page.getByText("Công nợ nhà cung cấp").locator("..")).toContainText("120.000đ")
  await expect(page.getByText("TỔNG TÀI SẢN", { exact: true }).locator("..")).toContainText("50.000đ")
  await expect(page.getByText("✓ Bảng cân đối đã cân")).toBeVisible()
})

test("Báo cáo tổng hợp › Tài sản – Nguồn vốn: có dòng 'Trả trước cho NCC'; bấm mở Công nợ theo NCC", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/bao-cao/tai-chinh")
  await page.getByRole("tab", { name: "Tài sản – Nguồn vốn" }).click()
  const bang = page.getByTestId("bc-bang")
  await expect(bang).toContainText("Vốn chủ (phần chênh)")
  const dong = bang.getByRole("row").filter({ hasText: "Trả trước cho NCC" })
  await expect(dong).toContainText("50.000")
  await expect(bang.getByRole("row").filter({ hasText: "Phải trả nhà cung cấp" })).toContainText("120.000")
  await dong.click()
  await expect(page).toHaveURL(/\/payables\/by-supplier$/)
})
