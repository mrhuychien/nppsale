import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026 "ok" — chống bấm Lưu phiếu thu hai lần (mig 215): màn gửi kèm
 *   `client_key`; máy chủ gặp lại khoá cũ thì trả lại phiếu đã lập.
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"

test("lập phiếu thu gửi kèm client_key", async ({ page }) => {
  await fetch(`${FAKE}/rest/v1/receivables`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{ id: "rc-k1", org_id: "00000000-0000-4000-8000-0000000000a1", customer_id: KHACH, invoice_id: HOA_DON,
      order_id: null, amount: 900000, paid: 0, status: "open", due_date: "2026-09-30", order: null, invoice: { invoice_code: "HD-E2E-1" } }]),
  })
  try {
    await dangNhap(page)
    await page.goto(`/finance/cash-receipts/new?customerId=${KHACH}&invoiceId=${HOA_DON}`)
    await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
    await page.getByRole("button", { name: "Lập phiếu thu" }).click()
    await expect.poll(async () => (await nhatKy()).some((r) => r.path.endsWith("/rpc/create_cash_receipt"))).toBe(true)
    const goi = (await nhatKy()).filter((r) => r.path.endsWith("/rpc/create_cash_receipt")).at(-1)!
    const p = (goi.body as { p: { client_key?: string } }).p
    expect(p.client_key, "không gửi khoá chống gửi trùng").toMatch(/^[0-9a-f-]{20,}$/)
  } finally {
    await fetch(`${FAKE}/rest/v1/receivables?id=eq.rc-k1`, { method: "DELETE" })
  }
})
