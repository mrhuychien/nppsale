import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Các danh sách load nhanh 20 đơn trước, hiển thị luôn, trong khi vẫn load
 *   tiếp các đơn. Nó không bị chậm." Nhịp 2 (dòng 21 trở đi) bị cố ý làm chậm 4 giây: 20 đơn đầu
 *   phải hiện TRƯỚC khi nhịp 2 về, rồi đủ trang.
 */
test.use({ viewport: { width: 1440, height: 900 } })
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const homNay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())

test("Đơn hàng: mặc định 20 đơn / trang; chọn 50/trang thì phần còn lại nối vào sau", async ({ page }) => {
  const ids = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-00000000d${String(100 + i).padStart(3, "0")}`)
  await api("sales_orders", "POST", ids.map((id, i) => ({
    id, org_id: ORG, order_code: `DH-HN-${String(i + 1).padStart(2, "0")}`, customer_id: KHACH, sales_user_id: OWNER,
    status: "submitted", subtotal: 100_000, vat: 0, total: 100_000, order_date: homNay,
    created_at: new Date(Date.now() - i * 60_000).toISOString(), payment_terms: "COD",
    customer: { store_name: "Tạp hoá Cô Ba" }, sales_user: { full_name: "Chủ NPP" },
  })))
  try {
    await dangNhap(page)
    // Nhịp 2 = truy vấn danh sách đơn bắt đầu từ dòng 21 (offset=20): cố ý chậm 4 giây.
    let cham = 0
    await page.route(/:54321\/rest\/v1\/sales_orders\?.*offset=20/, async (r) => {
      cham++
      await new Promise((ok) => setTimeout(ok, 4000))
      await r.continue()
    })
    const t0 = Date.now()
    await page.goto("/orders")
    const dong = page.locator('[role="row"]').filter({ hasText: "DH-HN-" })
    // Mặc định 20 đơn / trang (chủ nhà 26/09/2026): một truy vấn, không có nhịp 2.
    await expect(dong).toHaveCount(20, { timeout: 3500 })
    expect(Date.now() - t0, "20 đơn đầu phải hiện ngay").toBeLessThan(4000)
    await expect(page.getByText("20/trang")).toBeVisible()
    expect(cham, "trang 20 dòng không tải thêm gì").toBe(0)
    // Chọn 50/trang: phần từ dòng 21 (chậm 4 giây) về sau — 20 đơn đang có KHÔNG bị xoá trong lúc chờ.
    await page.getByText("20/trang").click()
    await page.getByRole("option", { name: "50/trang" }).click()
    await page.waitForTimeout(1500)
    await expect(dong).toHaveCount(20)
    await expect(dong).toHaveCount(30, { timeout: 10_000 })
    expect(cham).toBeGreaterThan(0)
  } finally {
    await api(`sales_orders?id=in.(${ids.join(",")})`, "DELETE")
  }
})
