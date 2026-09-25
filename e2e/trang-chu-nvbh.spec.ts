import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Làm lại trang chủ cho nhân viên bán hàng theo mẫu". Tài khoản
 *   e2e tạm đổi vai sang NVBH; một hóa đơn hôm nay đứng tên mình → "Doanh số của tôi".
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const HD = "00000000-0000-4000-8000-00000000c0de"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const homNay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())

test("NVBH: trang chủ theo mẫu — doanh số của tôi theo hóa đơn, tab kỳ, tạo đơn, chức năng, tìm", async ({ page }) => {
  await dangNhap(page)
  await api("sales_invoices", "POST", [{
    id: HD, org_id: ORG, invoice_code: "HD-E2E-NV", customer_id: KHACH, status: "posted",
    subtotal: 1_234_000, vat: 0, total: 1_234_000, invoice_date: homNay, sales_user_id: OWNER,
    created_at: new Date().toISOString(),
  }])
  await api(`users?id=eq.${OWNER}`, "PATCH", { role: "sales" })
  try {
    await page.goto("/home")
    const trang = page.getByTestId("trang-chu-nvbh")
    await expect(trang.getByRole("heading", { name: /^Chào / })).toBeVisible()
    await expect(trang.getByRole("tab", { name: "Tháng" })).toHaveAttribute("aria-selected", "true")
    await trang.getByRole("tab", { name: "Hôm nay" }).click()
    await expect(trang.getByRole("tab", { name: "Hôm nay" })).toHaveAttribute("aria-selected", "true")
    await expect(page.getByTestId("doanh-so-cua-toi")).toHaveText("1.234.000đ")
    await expect(trang.getByText("Đơn đã tạo")).toBeVisible()
    await expect(trang.getByRole("link", { name: /Tạo đơn hàng mới/ })).toBeVisible()
    await expect(trang.getByRole("heading", { name: "Chức năng" })).toBeVisible()
    await expect(trang.getByRole("link", { name: "Bán hàng" })).toBeVisible()
    // Kính lúp → màn tìm tính năng.
    await trang.getByRole("button", { name: "Tìm tính năng" }).click()
    await expect(page.getByPlaceholder("Tìm tính năng…")).toBeFocused()
  } finally {
    await api(`users?id=eq.${OWNER}`, "PATCH", { role: "owner" })
    await api(`sales_invoices?id=eq.${HD}`, "DELETE")
  }
})
