import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Phần xem nhanh Hoá đơn từ Danh sách hoá đơn: thêm nút
 *   Trả hàng và Thu tiền. Bấm vào Trả hàng -> tạo trả hàng gắn với Hoá đơn.
 *   Bấm vào Thu tiền -> tạo phiếu thu gắn với Hoá đơn và khách hàng".
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"

test("xem nhanh hóa đơn có Trả hàng và Thu tiền, cả hai mang theo hóa đơn + khách", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices")
  await page.getByRole("row").filter({ hasText: "HD-E2E-1" }).first().getByText("Tạp hoá Cô Ba").first().click()
  const ngan = page.getByRole("dialog")
  const tra = ngan.getByRole("link", { name: "Trả hàng", exact: true })
  const thu = ngan.getByRole("link", { name: "Thu tiền", exact: true })
  await expect(tra).toHaveAttribute("href", `/pos/tra-hang/moi?invoice=${HOA_DON}&customerId=${KHACH}`)
  await expect(thu).toHaveAttribute("href", `/finance/cash-receipts/new?customerId=${KHACH}&invoiceId=${HOA_DON}`)
})

test("Thu tiền từ hóa đơn: phiếu thu mở sẵn khách và điền số còn nợ của đúng tờ ấy", async ({ page }) => {
  const chen = (bang: string, rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  await chen("receivables", [
    { id: "rc-x1", org_id: "00000000-0000-4000-8000-0000000000a1", customer_id: KHACH, invoice_id: HOA_DON, order_id: null,
      amount: 900000, paid: 200000, status: "partial", due_date: "2026-09-30",
      order: null, invoice: { invoice_code: "HD-E2E-1" } },
    { id: "rc-x2", org_id: "00000000-0000-4000-8000-0000000000a1", customer_id: KHACH, invoice_id: "khac", order_id: null,
      amount: 500000, paid: 0, status: "open", due_date: "2026-09-30",
      order: null, invoice: { invoice_code: "HD-KHAC" } },
  ])
  try {
    await dangNhap(page)
    await page.goto(`/finance/cash-receipts/new?customerId=${KHACH}&invoiceId=${HOA_DON}`)
    await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
    // Còn nợ 700.000 của đúng tờ ấy được điền; tờ khác để trống.
    await expect(page.getByText("700.000").first()).toBeVisible()
    const oTien = page.locator("input").filter({ hasNot: page.locator("[type=date]") })
    await expect.poll(async () => (await oTien.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).filter((v) => v === "700.000").length).toBeGreaterThan(0)
  } finally {
    for (const id of ["rc-x1", "rc-x2"]) await fetch(`${FAKE}/rest/v1/receivables?id=eq.${id}`, { method: "DELETE" })
  }
})
