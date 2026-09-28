import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ QUÉT LUỒNG 28/09/2026 (mig 212): dòng công nợ khách trả DƯ (paid > amount) nay là
 *   'open' để được trừ vào tổng nợ — nhưng không phải khoản để thu: màn lập phiếu thu
 *   không liệt kê nó.
 */
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const ORG = "00000000-0000-4000-8000-0000000000a1"

test("lập phiếu thu: không liệt kê khoản khách đã trả dư", async ({ page }) => {
  const chen = (rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/receivables`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  await chen([
    { id: "rc-du", org_id: ORG, customer_id: KHACH, invoice_id: "hd-du", order_id: null, amount: 500000, paid: 700000, status: "open",
      due_date: "2026-09-30", order: null, invoice: { invoice_code: "HD-TRA-DU" } },
    { id: "rc-con", org_id: ORG, customer_id: KHACH, invoice_id: "hd-con", order_id: null, amount: 300000, paid: 0, status: "open",
      due_date: "2026-09-30", order: null, invoice: { invoice_code: "HD-CON-NO" } },
  ])
  try {
    await dangNhap(page)
    await page.goto(`/finance/cash-receipts/new?customerId=${KHACH}`)
    await expect(page.getByText("HD-CON-NO").first()).toBeVisible()
    await expect(page.getByText("HD-TRA-DU")).toHaveCount(0)
  } finally {
    for (const id of ["rc-du", "rc-con"]) await fetch(`${FAKE}/rest/v1/receivables?id=eq.${id}`, { method: "DELETE" })
  }
})
