import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"
import { SUA, NCC } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 06/10/2026: "vá luôn vat đi". POS nhập hàng / trả NCC nạp lại thuế của phiếu đã lưu: khớp mức % thì chọn
 *   sẵn mức đó, số gõ tay lẻ thì giữ nguyên ("Theo phiếu"). Trước đây sửa phiếu có VAT là lưu lại thuế 0.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (p: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${p}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const DONG = {
  id: "pil-vat-e2e", invoice_id: "pi-vat", product_id: SUA, unit_name: "thùng", quantity: 2, unit_price: 150000, line_discount: 0,
  vat_rate: 0, conversion_factor: 24, notes: null, sort_order: 1, product: { name: "Sữa hộp", sku: "SUA1" },
}
/* Phiếu riêng của spec này (không dùng chung `pi1` — spec khác cũng sửa nó, chạy song song là giẫm nhau). */
const phieuNhap = async (vat: number) => {
  await api("purchase_invoices?id=eq.pi-vat", "DELETE")
  await api("purchase_invoices", "POST", [{
    id: "pi-vat", org_id: ORG, receipt_code: "PN-VAT", invoice_number: "HD1", invoice_date: "2026-09-20", status: "completed",
    supplier_id: NCC, warehouse_zone: "sale", discount: 0, vat_override: vat, vat, total: 300000 + vat, notes: null,
    created_at: "2026-09-20T08:00:00Z", supplier: { name: "Vinamilk", code: "NCC1" }, lines: [DONG],
  }])
}
/* ⚠ Lọc theo phiếu của spec này — nhật ký là CHUNG, spec khác chạy song song cũng gọi cùng RPC. */
const goiRpc = async (fn: string) =>
  (await nhatKy()).filter(
    (r) => r.method === "POST" && r.path.endsWith(`/rpc/${fn}`) &&
      (fn !== "sua_phieu_nhap" || (r.body as { p_invoice_id?: string } | null)?.p_invoice_id === "pi-vat")
  )

test.afterAll(async () => {
  await api("purchase_invoices?id=eq.pi-vat", "DELETE")
  await api("supplier_returns?id=eq.sr-vat-1", "DELETE")
})

test("POS nhập hàng: phiếu VAT 10% (30.000) nạp lại đúng 10%, lưu giữ thuế", async ({ page }) => {
  await phieuNhap(30000)
  const daGoi = (await goiRpc("sua_phieu_nhap")).length
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/pi-vat/sua")
  await expect(page.getByLabel("Giá nhập dòng 1")).toHaveValue("150.000")
  await expect(page.locator("#p-vat")).toHaveValue("10")
  await page.getByRole("button", { name: "Lưu sửa" }).click()
  await expect.poll(async () => (await goiRpc("sua_phieu_nhap")).length).toBeGreaterThan(daGoi)
  const body = (await goiRpc("sua_phieu_nhap")).at(-1)?.body as { p_head: Record<string, unknown> }
  expect(body.p_head.vat_override).toBe(30000)
})

test("POS nhập hàng: thuế gõ tay lẻ (12.345) giữ nguyên số — \"Theo phiếu\"; chọn lại 8% thì tính theo mức", async ({ page }) => {
  await phieuNhap(12345)
  const truoc = (await goiRpc("sua_phieu_nhap")).length
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/pi-vat/sua")
  await expect(page.locator("#p-vat")).toHaveValue("giu")
  await expect(page.getByText("12.345").first()).toBeVisible()
  await page.getByRole("button", { name: "Lưu sửa" }).click()
  await expect.poll(async () => (await goiRpc("sua_phieu_nhap")).length).toBeGreaterThan(truoc)
  expect(((await goiRpc("sua_phieu_nhap")).at(-1)?.body as { p_head: Record<string, unknown> }).p_head.vat_override).toBe(12345)
  // Chọn lại một mức → bỏ số giữ theo phiếu, tính theo mức (300.000 × 8%).
  await page.locator("#p-vat").selectOption("8")
  await expect(page.locator("#p-vat")).toHaveValue("8")
  await expect(page.getByText("24.000").first()).toBeVisible()
})

test("POS trả NCC: phiếu có thuế nạp lại mức, lưu gửi vat_override", async ({ page }) => {
  await api("supplier_returns", "POST", [{
    id: "sr-vat-1", org_id: ORG, supplier_id: NCC, return_code: "TN-VAT-1", return_date: "2026-09-25", warehouse_zone: "sale",
    reason: "damaged", status: "draft", discount: 0, vat: 10000, vat_override: 10000, notes: null, total: 110000,
    supplier: { name: "Vinamilk", code: "NCC1" },
    lines: [{ product_id: SUA, unit_name: "hộp", quantity: 5, unit_price: 20000, line_discount: 0, conversion_factor: 1, notes: null, product: { name: "Sữa hộp", sku: "SUA1" } }],
  }])
  const daTra = (await goiRpc("complete_supplier_return")).length
  await dangNhap(page)
  await page.goto("/pos/tra-ncc/sr-vat-1/sua")
  await expect(page.locator("#sr-vat")).toHaveValue("10")
  await expect(page.getByText("110.000").first()).toBeVisible()
  await page.getByRole("button", { name: "Ghi nhận & xuất kho" }).click()
  await expect.poll(async () => (await goiRpc("complete_supplier_return")).length).toBeGreaterThan(daTra)
  const ghi = (await nhatKy()).filter((r) => r.method === "PATCH" && r.path.includes("supplier_returns")).at(-1)
  expect((ghi?.body as Record<string, unknown>).vat_override).toBe(10000)
})
