import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 27/09/2026: "Sao từ một số khách hàng ấn tạo đơn lại báo 'Không tìm thấy khách hàng
 *   của đường dẫn này'?" — danh mục /sell trên máy giữ tới 30 phút và chỉ có khách đang hoạt động,
 *   nên khách vừa tạo / khách Tạm ngưng bị báo "không tìm thấy". Nay hỏi riêng máy chủ.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH_NHOM = "00000000-0000-4000-8000-0000000000c2"
const MOI = "00000000-0000-4000-8000-0000000000c9"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test("khách tạo SAU lần tải danh mục: Tạo đơn vẫn nhận đúng khách", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell")
  await expect(page.getByTestId("the-san-pham").first()).toBeVisible()
  await api("customers", "POST", {
    id: MOI, org_id: ORG, customer_code: "KH009", store_name: "Tạp hoá Mới Mở", owner_name: "Chị Tư",
    phone: "0999999999", address: "9 Hùng Vương", status: "active", group_id: null, credit_limit: 0, payment_terms: "COD",
  })
  try {
    await page.goto(`/sell?customerId=${MOI}`)
    await expect(page.getByText("Tạp hoá Mới Mở").first()).toBeVisible()
    await expect(page.getByText("Không tìm thấy khách hàng của đường dẫn này")).toHaveCount(0)
    const gio = await page.evaluate(() => JSON.parse(localStorage.getItem("npp.sell.cart.v1") || "{}"))
    expect(gio.customerId).toBe(MOI)
  } finally {
    await api(`customers?id=eq.${MOI}`, "DELETE")
  }
})

test("khách Tạm ngưng: nói rõ vì sao không tạo đơn được", async ({ page }) => {
  await api(`customers?id=eq.${KHACH_NHOM}`, "PATCH", { status: "suspended" })
  try {
    await dangNhap(page)
    await page.goto(`/sell?customerId=${KHACH_NHOM}`)
    await expect(page.getByTestId("sell-khach-ngung")).toContainText("Đại lý Minh")
    await expect(page.getByTestId("sell-khach-ngung")).toContainText("Tạm ngưng")
  } finally {
    await api(`customers?id=eq.${KHACH_NHOM}`, "PATCH", { status: "active" })
  }
})
