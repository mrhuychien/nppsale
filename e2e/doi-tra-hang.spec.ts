import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ĐỘI TEST "TRẢ HÀNG" — màn chi tiết phiếu trả (máy tính) theo luật mig 191:
 *   · Tự sinh ĐÃ NHẬP KHO: nút "Huỷ nhập kho" (về Chờ xử lý, công nợ giữ nguyên), không "Sửa".
 *   · Tự lập ĐÃ HOÀN THÀNH không gắn HĐ: "Huỷ phiếu" (nợ tăng lại kể cả khi đã thu), nói rõ dư có.
 *   · Đã huỷ: không còn nút thao tác.
 *   · Tự sinh Chờ xử lý (máy tính): chọn ngày nhập kho, chặn trước ngày HĐ; gửi p_ngay.
 * Phiếu riêng của đội (r-dt-*) chèn vào máy chủ giả, xoá khi xong.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const HD1 = "00000000-0000-4000-8000-0000000000f1"
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

const phieu = (id: string, ma: string, o: Record<string, unknown>) => ({
  id, org_id: ORG, customer_id: KHACH, created_at: "2026-09-21T02:00:00Z", return_code: ma, reason: "damaged",
  credit_note_amount: 120000, return_date: "2026-09-21", requested_by: OWNER, requester: { full_name: "Chủ NPP" },
  sales_user_id: OWNER, seller: { full_name: "Chủ NPP" }, customer: { store_name: "Tạp hoá Đội Trả" },
  order: null, invoice: null, order_id: null, invoice_id: null, credit_with_invoice: false, ...o,
})

test.beforeAll(async () => {
  await api("returns", "POST", [
    phieu("r-dt-1", "TH-DT01", { status: "completed", destination_zone: "date", credit_with_invoice: true, invoice_id: HD1,
      invoice: { invoice_code: "HD-E2E-1", invoice_date: "2026-09-20" } }),
    phieu("r-dt-2", "TH-DT02", { status: "completed", destination_zone: "sale" }),
    phieu("r-dt-3", "TH-DT03", { status: "cancelled", cancel_reason: "khách lấy lại" }),
    phieu("r-dt-4", "TH-DT04", { status: "submitted", credit_with_invoice: true, invoice_id: HD1,
      invoice: { invoice_code: "HD-E2E-1", invoice_date: "2026-09-20" } }),
  ])
  await api("return_lines", "POST", ["r-dt-1", "r-dt-2", "r-dt-3", "r-dt-4"].map((r, i) => ({
    id: `rl-dt-${i}`, return_id: r, product_id: "00000000-0000-4000-8000-0000000000d1", unit_name: "thùng", quantity: 1,
    unit_price: 120000, line_total: 120000, is_exchange: false,
  })))
})
test.afterAll(async () => {
  for (const r of ["r-dt-1", "r-dt-2", "r-dt-3", "r-dt-4"]) {
    await api(`return_lines?return_id=eq.${r}`, "DELETE", {})
    await api(`returns?id=eq.${r}`, "DELETE", {})
  }
})

test("tự sinh đã nhập kho: 'Huỷ nhập kho' (về Chờ xử lý, nợ giữ), lý do bắt buộc, gửi cancel_return đúng phiếu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-dt-1")
  await expect(page.getByText(/Đã nhập kho \(kho cận date\)/)).toBeVisible()
  await expect(page.getByRole("button", { name: /Hoàn thành/ })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Sửa", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Sửa hóa đơn" })).toHaveAttribute("href", `/sales-invoices/${HD1}/edit`)
  await page.getByRole("button", { name: "Huỷ nhập kho" }).click()
  const hop = page.getByRole("dialog")
  await expect(hop.getByText("Huỷ nhập kho phiếu trả?")).toBeVisible()
  await expect(hop.getByText(/đưa phiếu về Chờ xử lý\. Công nợ giữ nguyên/)).toBeVisible()
  const nut = hop.getByRole("button", { name: "Huỷ phiếu trả" })
  await expect(nut).toBeDisabled()
  await hop.getByRole("textbox").fill("   ")
  await expect(nut).toBeDisabled()
  await hop.getByRole("textbox").fill("nhập nhầm kho")
  await nut.click()
  await expect.poll(async () => (await nhatKy()).filter((r) => r.path.endsWith("/rpc/cancel_return")).at(-1)?.body)
    .toMatchObject({ p_return_id: "r-dt-1", p_reason: "nhập nhầm kho" })
})

test("tự lập độc lập đã hoàn thành: nói rõ dư có (công nợ âm); Huỷ phiếu cảnh báo nợ cộng lại kể cả đã thu; Sửa mở POS", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-dt-2")
  await expect(page.getByText(/khoản trả đã ghi thành dư có \(công nợ âm\) của khách/)).toBeVisible()
  await expect(page.getByRole("link", { name: "Sửa", exact: true })).toHaveAttribute("href", "/pos/tra-hang/r-dt-2")
  await expect(page.getByRole("button", { name: "Huỷ nhập kho" })).toHaveCount(0)
  await page.getByRole("button", { name: "Huỷ phiếu" }).click()
  const hop = page.getByRole("dialog")
  await expect(hop.getByText("Huỷ phiếu trả?")).toBeVisible()
  await expect(hop.getByText(/cộng lại công nợ cho khách — kể cả khi tiền đã thu/)).toBeVisible()
  await hop.getByRole("button", { name: "Quay lại" }).click()
  await expect(hop).toBeHidden()
})

test("phiếu đã huỷ: hiện lý do, không còn Hoàn thành / Huỷ / Sửa", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-dt-3")
  await expect(page.getByText(/Phiếu đã huỷ\. .*Lý do: khách lấy lại/)).toBeVisible()
  await expect(page.getByRole("button", { name: /Hoàn thành/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Huỷ phiếu|Huỷ nhập kho/ })).toHaveCount(0)
  await expect(page.getByRole("link", { name: /^Sửa/ })).toHaveCount(0)
})

test("tự sinh Chờ xử lý (máy tính): ngày nhập kho trước HĐ / sau hôm nay bị chặn; hợp lệ gửi p_ngay + kho đã chọn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-dt-4")
  await expect(page.getByRole("button", { name: /Huỷ phiếu/ })).toHaveCount(0)
  const o = page.getByLabel("Ngày nhập kho")
  const nut = page.getByRole("button", { name: "Hoàn thành — nhập kho", exact: true })
  await o.fill("2026-09-19")
  await expect(page.getByText("Ngày nhập kho không được trước ngày hóa đơn")).toBeVisible()
  await expect(nut).toBeDisabled()
  await o.fill("2026-10-01")
  await expect(page.getByText("Ngày nhập kho không được sau hôm nay")).toBeVisible()
  await expect(nut).toBeDisabled()
  await o.fill("2026-09-20")
  await page.getByRole("button", { name: /Kho cận date/ }).click()
  await expect(nut).toBeEnabled()
  await nut.click()
  await expect.poll(async () => (await nhatKy()).filter((r) => r.path.endsWith("/rpc/complete_return")).at(-1)?.body)
    .toMatchObject({ p_return_id: "r-dt-4", p_zone: "date", p_ngay: "2026-09-20" })
})
