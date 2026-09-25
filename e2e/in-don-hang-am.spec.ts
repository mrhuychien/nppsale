import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Mẫu in đơn đặt hàng in ra sai bét" (DH-0366: đơn giá 0đ,
 *   Tổng tiền hàng 0đ, "Không đồng" trong khi hàng trả −250.000) và "phần còn phải
 *   thu phải in cả số âm nếu hóa đơn âm. (hiện tại khi âm thì in 0)".
 *   Tái hiện: đơn 1.000.000 hàng, trả 1.500.000 → `total` lưu đã kẹp về 0.
 */
const DON = "o-e2e-1"
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

test("in đơn đặt hàng có hàng trả vượt tiền hàng: đơn giá thật, Còn phải thu ÂM", async ({ page }) => {
  await api(`sales_orders?id=eq.${DON}`, "PATCH", { total: 0 })
  await api("returns", "POST", [{
    id: "r-in-am", org_id: "00000000-0000-4000-8000-0000000000a1", order_id: DON, status: "submitted",
    lines: [{ id: "rl-am", unit_name: "hộp", quantity: 75, unit_price: 20000, line_total: 1_500_000, is_exchange: false, product: { name: "Sữa hộp" } }],
  }])
  try {
    await dangNhap(page)
    await page.goto(`/orders/${DON}/print`)
    const to = page.locator("table").filter({ hasText: "Tổng cộng" }).first()
    await expect(to.getByRole("row").filter({ hasText: "Tổng cộng" })).toContainText("1.000.000")
    await expect(to.getByRole("row").filter({ hasText: "Trừ hàng trả" })).toContainText("1.500.000")
    await expect(to.getByRole("row").filter({ hasText: "Còn phải thu" })).toContainText(/[-−]500\.000/)
    await expect(page.getByText(/Âm năm trăm nghìn/)).toBeVisible()
    // Dòng hàng bán giữ giá thật — không bị giãn về 0đ.
    await expect(to.getByRole("row").filter({ hasText: "Sữa hộp" }).first()).toContainText("1.000.000")
  } finally {
    await api(`sales_orders?id=eq.${DON}`, "PATCH", { total: 1_000_000 })
    await api("returns?id=eq.r-in-am", "DELETE", {})
  }
})
