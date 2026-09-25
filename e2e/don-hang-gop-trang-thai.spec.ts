import { test, expect } from "@playwright/test"
import { dangNhap, chonKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "gộp trạng thái Xuất một phần vào Hoàn thành (coi như Hoàn thành)
 *   bỏ trạng thái Xuất một phần". DH-0003 tạm chuyển sang `partially_invoiced`.
 */
const api = (path: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

test.beforeAll(async () => { await api("sales_orders?id=eq.o-e2e-3", { status: "partially_invoiced" }) })
test.afterAll(async () => { await api("sales_orders?id=eq.o-e2e-3", { status: "completed" }) })

test("đơn hàng: không còn chip Xuất một phần; đơn xuất một phần nằm trong Hoàn thành", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  await expect(page.locator('[data-status-chip="partially_invoiced"]')).toHaveCount(0)
  await expect(page.getByText("Xuất một phần")).toHaveCount(0)
  const chip = (k: string) => page.locator(`[data-status-chip="${k}"]`).first()
  // Từ Tất cả: tắt Phiếu tạm và Đã huỷ → chỉ còn Hoàn thành.
  await chip("all").click()
  await chip("submitted").click()
  await chip("cancelled").click()
  const dong = page.getByRole("row").filter({ has: page.getByRole("link", { name: "DH-0003", exact: true }) })
  await expect(dong).toHaveCount(1)
  await expect(dong).toContainText("Hoàn thành")
})
