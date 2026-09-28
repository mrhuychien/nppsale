import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026: "Các phiếu trả tự sinh tao muốn sửa ngày lúc nhập kho" (mig 211).
 *   Phiếu tự sinh chọn được ngày nhập kho; không sau hôm nay, không trước ngày hóa đơn.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

test.beforeAll(async () => {
  await api("returns", "POST", [{
    id: "r-ts-ngay", org_id: ORG, customer_id: "00000000-0000-4000-8000-0000000000c1", created_at: "2026-09-20T02:00:00Z",
    return_code: "TH-M777", status: "submitted", reason: "damaged", credit_note_amount: 55000, return_date: "2026-09-20",
    credit_with_invoice: true, invoice_id: "00000000-0000-4000-8000-0000000000f1", order_id: null,
    requested_by: OWNER, requester: { full_name: "Chủ NPP" }, sales_user_id: OWNER, seller: { full_name: "Chủ NPP" },
    customer: { store_name: "Tạp hoá Ngày" }, order: null, invoice: { invoice_code: "HD-E2E-1", invoice_date: "2026-09-20" },
  }])
})
test.afterAll(async () => { await api("returns?id=eq.r-ts-ngay", "DELETE", {}) })

test("phiếu tự sinh: chọn ngày nhập kho khi hoàn thành; chặn trước ngày hóa đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const man = page.getByTestId("tra-mobile")
  await man.getByLabel("Tìm phiếu trả").fill("TH-M777")
  await man.getByTestId("the-tra").filter({ hasText: "Tạp hoá Ngày" }).click()
  const ngan = page.getByTestId("ngan-phieu-tra")
  const o = ngan.getByLabel("Ngày nhập kho")
  await expect(o).toBeVisible()
  await o.fill("2026-09-19")
  await expect(ngan.getByText("Ngày nhập kho không được trước ngày hóa đơn")).toBeVisible()
  await expect(ngan.getByRole("button", { name: /^Hoàn thành · nhập/ })).toBeDisabled()
  await o.fill("2026-09-22")
  await ngan.getByRole("button", { name: /^Hoàn thành · nhập/ }).click()
  await expect(ngan).toBeHidden()
  const goi = (await nhatKy()).filter((r) => r.path.endsWith("/rpc/complete_return")).at(-1)!
  expect(goi.body).toMatchObject({ p_return_id: "r-ts-ngay", p_ngay: "2026-09-22" })
})
