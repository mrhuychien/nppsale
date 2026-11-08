import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"
import { ORG } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 08/11/2026: "phần chi tiết công nợ từng ncc chưa có dư nợ sau mỗi giao dịch, kiểm tra xem phần tiền thanh toán
 *   cho ncc cũng chưa có trong công nợ".
 * Tab Công nợ ở chi tiết NCC là SỔ CHI TIẾT: mỗi giao dịch một dòng + dư nợ sau giao dịch. Sổ mẫu theo đúng luật mig 242:
 *   nợ đầu kỳ 100.000 (01/09) · phiếu nhập PN-SO1 300.000 (10/09) · trả thẳng 80.000 vào PN-SO1 (12/09) · trả NCC PTNCC-SO1
 *   −50.000 (15/09) · phiếu chi PCNCC-SO1 400.000 (20/09) trừ đầu kỳ 100.000 + PN-SO1 220.000, dư 80.000 thành trả trước.
 *   → dư nợ 100.000 → 400.000 → 320.000 → 270.000 → −130.000 (NCC đang giữ 130.000 của mình).
 */
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

const NCC_SO = "00000000-0000-4000-8000-0000000005c1"
const NO = [
  { id: "pay-so-dk", org_id: ORG, supplier_id: NCC_SO, invoice_number: null, amount: 100000, paid: 100000, status: "paid", opening_balance: true, due_date: null, notes: "Nợ đầu kỳ", created_at: "2026-09-01T03:00:00Z" },
  { id: "pay-so-pn", org_id: ORG, supplier_id: NCC_SO, invoice_number: "HD-SO1", amount: 300000, paid: 300000, status: "paid", opening_balance: false, due_date: null, notes: null, created_at: "2026-09-10T03:00:00Z" },
  { id: "pay-so-tn", org_id: ORG, supplier_id: NCC_SO, invoice_number: null, amount: -50000, paid: 0, status: "open", opening_balance: false, due_date: null, notes: null, created_at: "2026-09-15T03:00:00Z" },
  { id: "pay-so-tt", org_id: ORG, supplier_id: NCC_SO, invoice_number: "PCNCC-SO1", amount: 0, paid: 80000, status: "open", opening_balance: false, due_date: null, notes: "Trả trước NCC — phiếu chi PCNCC-SO1", created_at: "2026-09-20T05:00:00Z" },
]
const TRA = [
  { id: "pp-so-thang", payable_id: "pay-so-pn", amount: 80000, method: "cash", paid_at: "2026-09-12T03:00:00Z", supplier_payment_id: null },
  { id: "pp-so-a", payable_id: "pay-so-dk", amount: 100000, method: "transfer", paid_at: "2026-09-20T05:00:00Z", supplier_payment_id: "sp-so1" },
  { id: "pp-so-b", payable_id: "pay-so-pn", amount: 220000, method: "transfer", paid_at: "2026-09-20T05:00:00Z", supplier_payment_id: "sp-so1" },
  { id: "pp-so-c", payable_id: "pay-so-tt", amount: 80000, method: "transfer", paid_at: "2026-09-20T05:00:00Z", supplier_payment_id: "sp-so1" },
]

test.beforeAll(async () => {
  await api("suppliers", "POST", [{ id: NCC_SO, org_id: ORG, code: "NCC-SO", name: "NCC Sổ chi tiết", is_active: true }])
  await api("payables", "POST", NO)
  await api("payable_payments", "POST", TRA)
  await api("purchase_invoices", "POST", [{
    id: "pi-so1", org_id: ORG, supplier_id: NCC_SO, receipt_code: "PN-SO1", invoice_number: "HD-SO1", invoice_date: "2026-09-10",
    status: "completed", warehouse_zone: "sale", subtotal: 300000, vat: 0, discount: 0, total: 300000, payable_id: "pay-so-pn",
    completed_at: "2026-09-10T03:00:00Z", created_at: "2026-09-10T02:00:00Z",
  }])
  await api("supplier_returns", "POST", [{
    id: "sr-so1", org_id: ORG, supplier_id: NCC_SO, return_code: "PTNCC-SO1", status: "completed", payable_credit_id: "pay-so-tn",
    total: 50000, return_date: "2026-09-15", created_at: "2026-09-15T03:00:00Z",
  }])
  await api("supplier_payments", "POST", [{
    id: "sp-so1", org_id: ORG, seq: 901, code: "PCNCC-SO1", supplier_id: NCC_SO, paid_date: "2026-09-20", amount: 400000,
    method: "transfer", reference_code: null, notes: null, status: "posted", prepay_payable_id: "pay-so-tt", created_by: null,
    created_at: "2026-09-20T05:00:00Z", cancelled_at: null, cancel_reason: null,
  }])
})
test.afterAll(async () => {
  await api("payable_payments?id=in.(pp-so-thang,pp-so-a,pp-so-b,pp-so-c)", "DELETE")
  await api("payables?id=in.(pay-so-dk,pay-so-pn,pay-so-tn,pay-so-tt)", "DELETE")
  await api("purchase_invoices?id=eq.pi-so1", "DELETE")
  await api("supplier_returns?id=eq.sr-so1", "DELETE")
  await api("supplier_payments?id=eq.sp-so1", "DELETE")
  await api(`suppliers?id=eq.${NCC_SO}`, "DELETE")
})

test("sổ chi tiết công nợ NCC: mỗi giao dịch một dòng (cả tiền đã trả), dư nợ sau từng giao dịch, dòng cuối = dư nợ hiện tại", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC_SO}?tab=debt`)
  await expect(page.getByTestId("ncc-du-no-hien-tai")).toHaveText("-130.000đ")
  await expect(page.getByTestId("ncc-con-no")).toHaveText("-130.000đ")

  const dong = page.getByTestId("dong-no-ncc")
  await expect(dong).toHaveCount(5)
  await expect(dong.getByTestId("du-no-sau")).toHaveText(["-130.000đ", "270.000đ", "320.000đ", "400.000đ", "100.000đ"])
  await expect(dong.nth(0)).toContainText("PCNCC-SO1")
  await expect(dong.nth(0)).toContainText("Phiếu chi trả NCC · Chuyển khoản")
  await expect(dong.nth(0).getByTestId("giam-no")).toHaveText("400.000đ")
  await expect(dong.nth(0)).toContainText("Đã chi · trả trước 80.000đ")
  await expect(dong.nth(1)).toContainText("PTNCC-SO1")
  await expect(dong.nth(1)).toContainText("Trả hàng NCC")
  await expect(dong.nth(2)).toContainText("Trả tiền NCC · Tiền mặt")
  await expect(dong.nth(2).getByTestId("giam-no")).toHaveText("80.000đ")
  await expect(dong.nth(3)).toContainText("PN-SO1")
  await expect(dong.nth(3).getByTestId("tang-no")).toHaveText("300.000đ")
  await expect(dong.nth(3)).toContainText("Đã thanh toán")
  await expect(dong.nth(4)).toContainText("Nợ đầu kỳ")
  // Dòng "Trả trước NCC" của phiếu chi không thành dòng thứ hai (tiền đã nằm trong dòng phiếu chi).
  await expect(dong.filter({ hasText: "PCNCC-SO1" })).toHaveCount(1)

  // Bấm dòng phiếu chi → mở phiếu chi.
  await dong.nth(0).click()
  await expect(page).toHaveURL(/\/finance\/phieu-chi-ncc\/sp-so1$/)
})

test("sổ chi tiết công nợ NCC trên điện thoại: thẻ ghi số tiền và dư nợ sau giao dịch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await dangNhap(page)
  await page.goto(`/suppliers/${NCC_SO}?tab=debt`)
  const the = page.getByTestId("dong-no-ncc-mobile")
  await expect(the).toHaveCount(5)
  await expect(the.nth(0)).toContainText("PCNCC-SO1")
  await expect(the.nth(0)).toContainText("−400.000đ")
  await expect(the.nth(0)).toContainText("Dư nợ -130.000đ")
  await expect(the.nth(3)).toContainText("+300.000đ")
  await expect(the.nth(3)).toContainText("Dư nợ 400.000đ")
  // Không cuộn ngang.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})
