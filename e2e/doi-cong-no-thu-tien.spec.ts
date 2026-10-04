import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ĐỘI TEST CÔNG NỢ & THU TIỀN — màn Thu tiền (/receivables/collect).
 *
 * Luật (CLAUDE.md §1 "Công nợ ÂM"): "Màn thu tiền không liệt kê dòng âm (không phải khoản để thu)";
 * khoản trả dư (paid > amount) là dư có, cũng không phải khoản để thu. Thu vượt số còn nợ phải bị chặn
 * ngay ở màn (máy chủ cũng chặn — BAD_RECEIVABLE_LINE). Phiếu thu đi qua RPC `create_cash_receipt`
 * (một giao dịch), kèm `client_key` chống gửi trùng (mig 215).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const KH = { store_name: "Tạp hoá Cô Ba" }
const NO = [
  { id: "cn-e2e-a", org_id: ORG, customer_id: KHACH, invoice_id: null, order_id: null, amount: 900000, paid: 300000, status: "partial", due_date: "2026-10-15", customer: KH },
  { id: "cn-e2e-b", org_id: ORG, customer_id: KHACH, invoice_id: null, order_id: null, amount: 250000, paid: 0, status: "open", due_date: "2026-09-20", customer: KH },
  { id: "cn-e2e-am", org_id: ORG, customer_id: KHACH, invoice_id: null, order_id: null, amount: -200000, paid: 0, status: "open", due_date: null, customer: KH },
  { id: "cn-e2e-du", org_id: ORG, customer_id: KHACH, invoice_id: null, order_id: null, amount: 100000, paid: 150000, status: "open", due_date: "2026-09-01", customer: KH },
  { id: "cn-e2e-xong", org_id: ORG, customer_id: KHACH, invoice_id: null, order_id: null, amount: 400000, paid: 400000, status: "paid", due_date: "2026-09-01", customer: KH },
]

test.beforeEach(async () => {
  await fetch(`${FAKE}/rest/v1/receivables`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(NO) })
})
test.afterEach(async () => {
  for (const r of NO) await fetch(`${FAKE}/rest/v1/receivables?id=eq.${r.id}`, { method: "DELETE" })
})

test("chỉ liệt kê khoản CÒN phải thu (bỏ dòng âm, trả dư, đã thu đủ), xếp theo hạn", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/receivables/collect?customerId=${KHACH}`)
  const the = page.locator("button[aria-pressed]")
  await expect(the).toHaveCount(2)
  // Hạn 20/09 (250.000) đứng trước hạn 15/10 (600.000 còn lại).
  await expect(the.nth(0)).toContainText("250.000")
  await expect(the.nth(1)).toContainText("600.000")
  await expect(page.getByText(/-200\.000|−200\.000/)).toHaveCount(0)
})

test("thu vượt số còn nợ bị chặn ngay ở màn — không gọi RPC", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/receivables/collect?customerId=${KHACH}`)
  await page.locator("button[aria-pressed]").filter({ hasText: "600.000" }).click()
  const o = page.getByPlaceholder("0").first()
  await o.fill("700000")
  await expect(page.getByText(/Số tiền thu vượt quá số còn nợ/)).toBeVisible()
  await expect(page.getByRole("button", { name: /Xác nhận thu tiền|Vượt số còn nợ/ }).first()).toBeDisabled()
  expect((await nhatKy()).some((r) => r.path.endsWith("/rpc/create_cash_receipt"))).toBe(false)
})

test("Thu đủ → RPC create_cash_receipt đúng khách, đúng khoản, đúng 600.000, kèm client_key", async ({ page }) => {
  const moc = (await nhatKy()).length // bỏ qua các lệnh dựng dữ liệu của chính chốt
  await dangNhap(page)
  await page.goto(`/receivables/collect?customerId=${KHACH}`)
  await page.locator("button[aria-pressed]").filter({ hasText: "600.000" }).click()
  await page.getByRole("button", { name: /^Thu đủ/ }).click()
  await expect(page.getByText("Còn nợ sau khi thu").locator("..")).toContainText("0")
  await page.getByRole("button", { name: "Xác nhận thu tiền" }).first().click()
  await expect.poll(async () => (await nhatKy()).some((r) => r.path.endsWith("/rpc/create_cash_receipt"))).toBe(true)
  const goi = (await nhatKy()).filter((r) => r.path.endsWith("/rpc/create_cash_receipt")).at(-1)!
  const p = (goi.body as { p: Record<string, unknown> }).p
  expect(p.customer_id).toBe(KHACH)
  expect(p.method).toBe("cash")
  expect(p.lines).toEqual([{ receivable_id: "cn-e2e-a", amount: 600000 }])
  expect(p.use_credit).toBe(0)
  expect(String(p.client_key)).toMatch(/^[0-9a-f-]{20,}$/)
  // Không ghi thẳng bảng tiền từ trình duyệt.
  const ghiThang = (await nhatKy()).slice(moc).filter((r) => r.method !== "GET" && /\/rest\/v1\/(payments|receivables|cash_receipts|cash_receipt_lines)/.test(r.path))
  expect(ghiThang).toEqual([])
})
