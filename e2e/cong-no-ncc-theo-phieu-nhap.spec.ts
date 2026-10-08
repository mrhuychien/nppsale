import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"
import { NCC } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 05/10/2026: "Vào xem chi tiết nhà cung cấp hiển thị công nợ chưa đúng (công nợ tính theo phiếu nhập)" ·
 *   "Phần công nợ NCC thêm phần công nợ theo NCC".
 *   Sổ: phiếu nhập PN-1 phải trả 300.000 (đã trả 100.000) · phiếu trả NCC −50.000 (NCC hoàn lại) · một khoản đã trả
 *   xong 200.000 → còn phải trả 300.000 − 100.000 − 50.000 = 150.000 (dòng âm trừ vào, khoản đã trả xong không tính).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

const NO = [
  { id: "pay-ncc-1", org_id: ORG, supplier_id: NCC, invoice_number: "HD1", amount: 300000, paid: 100000, status: "partial", created_at: "2026-09-20T08:00:00Z", opening_balance: false },
  { id: "pay-ncc-2", org_id: ORG, supplier_id: NCC, invoice_number: "TN-NCC-1", amount: -50000, paid: 0, status: "open", created_at: "2026-09-25T08:00:00Z", opening_balance: false },
  { id: "pay-ncc-3", org_id: ORG, supplier_id: NCC, invoice_number: "HD-CU", amount: 200000, paid: 200000, status: "paid", created_at: "2026-08-01T08:00:00Z", opening_balance: false },
]

test.beforeAll(async () => {
  await api("payables", "POST", NO)
  await api("purchase_invoices?id=eq.pi1", "PATCH", { payable_id: "pay-ncc-1", supplier_id: NCC })
  await api("supplier_returns", "POST", [{ id: "sr-ncc-1", org_id: ORG, supplier_id: NCC, return_code: "TN-NCC-1", status: "completed", payable_credit_id: "pay-ncc-2", total: 50000 }])
})
test.afterAll(async () => {
  for (const r of NO) await api(`payables?id=eq.${r.id}`, "DELETE")
  await api("supplier_returns?id=eq.sr-ncc-1", "DELETE")
  await api("purchase_invoices?id=eq.pi1", "PATCH", { payable_id: null })
})

test("chi tiết NCC: còn phải trả tính từ sổ công nợ (phiếu nhập − trả NCC − đã trả), tab Công nợ dẫn về phiếu nhập", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC}?tab=debt`)
  await expect(page.getByTestId("ncc-con-no")).toHaveText("150.000đ")
  const dong = page.getByTestId("dong-no-ncc")
  await expect(dong).toHaveCount(3)
  await expect(dong.filter({ hasText: "PN-1" })).toContainText("Phiếu nhập")
  await expect(dong.filter({ hasText: "TN-NCC-1" })).toContainText("Trả NCC")
  await dong.filter({ hasText: "PN-1" }).click()
  await expect(page).toHaveURL(/\/purchasing\/receipts\/pi1$/)
})

test("công nợ theo NCC: thanh chuyển ở màn Công nợ NCC, bấm NCC mở tab Công nợ của NCC", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await dangNhap(page)
  await page.goto("/payables")
  await page.getByTestId("che-do-cong-no-ncc").getByRole("link", { name: "Theo NCC" }).click()
  await expect(page).toHaveURL(/\/payables\/by-supplier$/)
  const hang = page.getByRole("row").filter({ hasText: "Vinamilk" })
  await expect(hang).toContainText("150.000")
  /* Chủ nhà 08/10/2026: "thêm cột hàng trả lại, đã trả đổi tên thành đã thanh toán". Tổng nợ 300.000 − hàng trả lại
     50.000 − đã thanh toán 100.000 = còn lại 150.000. */
  const dau = page.getByRole("row").filter({ hasText: "Mã NCC" })
  await expect(dau).toContainText("Hàng trả lại")
  await expect(dau).toContainText("Đã thanh toán")
  await expect(dau).not.toContainText("Đã trả")
  const o = hang.getByRole("cell")
  await expect(o.nth(3)).toHaveText(/300\.000/)
  await expect(o.nth(4)).toHaveText(/50\.000/)
  await expect(o.nth(5)).toHaveText(/100\.000/)
  await expect(o.nth(6)).toHaveText(/150\.000/)
  await hang.click()
  await expect(page).toHaveURL(new RegExp(`/suppliers/${NCC}\\?tab=debt$`))
  await expect(page.getByTestId("ncc-con-no")).toHaveText("150.000đ")
})
