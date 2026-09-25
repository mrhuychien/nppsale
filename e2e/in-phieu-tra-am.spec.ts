import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Mẫu in phiếu trả hàng cũng in số âm (lưu ý sửa cả in
 *   thường và in qua pos)". Hàng trả là khoản TRỪ công nợ — như dòng "(Hàng trả)
 *   … −220.000đ" trên hóa đơn.
 */
const PHIEU = "r-in-am-tra"
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

async function kiem(page: Page, url: string) {
  await page.goto(url)
  const bang = page.locator("table").filter({ hasText: "Tổng trừ công nợ" }).first()
  await expect(bang.getByRole("row").filter({ hasText: "Sữa hộp" })).toContainText(/20\.000đ[\s\S]*[-−]60\.000đ/)
  await expect(bang.getByRole("row").filter({ hasText: "Tổng trừ công nợ" })).toContainText(/[-−]60\.000đ/)
  await expect(bang.getByRole("row").filter({ hasText: "Mì tôm" })).toContainText("không trừ")
  await expect(page.getByText(/Âm sáu mươi nghìn/)).toBeVisible()
}

test("phiếu trả in số âm — cả trang in thường lẫn trang in POS", async ({ page }) => {
  await api("returns", "POST", [{
    id: PHIEU, org_id: "00000000-0000-4000-8000-0000000000a1", status: "completed", reason: "damaged",
    credit_note_amount: 60_000, created_at: "2026-09-25T08:00:00Z",
    customer: { store_name: "Tạp hoá Cô Ba" }, requester: { full_name: "Chủ NPP" }, order: null, invoice: null,
  }])
  await api("return_lines", "POST", [
    { id: "rl-t1", return_id: PHIEU, unit_name: "hộp", quantity: 3, unit_price: 20_000, line_total: 60_000, is_exchange: false, product: { name: "Sữa hộp", sku: "SUA1" } },
    { id: "rl-t2", return_id: PHIEU, unit_name: "gói", quantity: 1, unit_price: 5_000, line_total: 5_000, is_exchange: true, product: { name: "Mì tôm", sku: "MI1" } },
  ])
  try {
    await dangNhap(page)
    await kiem(page, `/returns/${PHIEU}/print`) // in thường
    await kiem(page, `/in/tra-hang/${PHIEU}`) // in qua POS
  } finally {
    await api(`returns?id=eq.${PHIEU}`, "DELETE", {})
    await api(`return_lines?return_id=eq.${PHIEU}`, "DELETE", {})
  }
})
