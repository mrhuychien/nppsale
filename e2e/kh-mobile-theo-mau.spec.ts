import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Thiết kế lại màn Khách hàng trên mobile theo mẫu".
 *   Một khoản nợ quá hạn của "Đại lý Minh" → thẻ Nợ quá hạn, "Nợ 2,2 tr", sắp Nợ nhiều nhất.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH_NHOM = "00000000-0000-4000-8000-0000000000c2"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const NO = "00000000-0000-4000-8000-00000000e0e1"
const NO2 = "00000000-0000-4000-8000-00000000e0e2"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test("điện thoại: khách hàng theo mẫu — đầu xanh, ba ô lọc, thẻ khách, nợ nhiều nhất", async ({ page }) => {
  await dangNhap(page)
  await api("receivables", "POST", [{
    id: NO, org_id: ORG, customer_id: KHACH_NHOM, amount: 2_200_000, paid: 0, status: "open",
    due_date: "2026-01-01", sales_user_id: OWNER, invoice_id: null, created_at: new Date().toISOString(),
  }, {
    // Cô Ba nợ ÍT hơn, chưa tới hạn — thứ tự tên (máy chủ trả) khác thứ tự nợ.
    id: NO2, org_id: ORG, customer_id: KHACH, amount: 1_000_000, paid: 0, status: "open",
    due_date: "2099-01-01", sales_user_id: OWNER, invoice_id: null, created_at: new Date().toISOString(),
  }])
  try {
    await page.goto("/customers")
    const man = page.getByTestId("kh-mobile")
    await expect(man.getByRole("heading", { name: "Khách hàng" })).toBeVisible()
    await expect(man.getByText(/khách hàng · Tuyến (T\d|CN) hôm nay/)).toBeVisible()
    await expect(man.getByPlaceholder("Tên cửa hàng, chủ quán, SĐT")).toBeVisible()
    await expect(man.locator('[data-o-khach="overdue"]')).toContainText("1")
    await expect(man.getByText("Tuyến hôm nay")).toBeVisible()
    await expect(man.getByRole("link", { name: "Thêm KH" })).toHaveAttribute("href", "/customers/new")

    const minh = man.getByTestId("the-khach").filter({ hasText: "Đại lý Minh" })
    await expect(minh).toContainText("Nợ 2,2 tr")
    await expect(minh).toContainText("Nợ quá hạn")
    await expect(minh).toContainText("2 Trần Phú")
    await expect(minh.getByRole("link", { name: "0922222222" })).toHaveAttribute("href", "tel:0922222222")
    await expect(man.getByTestId("the-khach").filter({ hasText: "Tạp hoá Cô Ba" })).toContainText("Nợ 1 tr")
    await expect(man.getByText("Tất cả · 2")).toBeVisible()
    const tenDau = (await man.getByTestId("the-khach").first().textContent()) ?? ""

    // Nợ nhiều nhất: sắp trên toàn bộ nợ — chỉ còn khách còn nợ.
    await man.getByRole("button", { name: "Tên A–Z" }).click()
    await expect(man.getByText("Còn nợ · 2")).toBeVisible()
    await expect(man.getByTestId("the-khach").first()).toContainText("Đại lý Minh") // nợ nhiều nhất trước
    expect(tenDau, "thứ tự tên phải khác thứ tự nợ, không thì phép kiểm vô nghĩa").toContain("Tạp hoá Cô Ba")
    await man.getByRole("button", { name: "Nợ nhiều nhất" }).click()
    await expect(man.getByText("Tất cả · 2")).toBeVisible()

    // Ô Nợ quá hạn là bộ lọc nhanh.
    await man.locator('[data-o-khach="overdue"]').click()
    await expect(man.getByText("Nợ quá hạn · 1")).toBeVisible()
    await expect(man.getByTestId("the-khach")).toHaveCount(1)
    await expect(man.getByText("Đã hiển thị 1 / 1 khách")).toBeVisible()

    // Không còn app bar chuẩn chồng lên đầu trang xanh.
    await expect(page.locator("header").filter({ hasText: "Khách hàng" }).first()).toBeHidden()
    await man.locator('[data-o-khach="all"]').click()
    await page.screenshot({ path: "test-results/kh-mobile.png", fullPage: true })
  } finally {
    await api(`receivables?id=eq.${NO}`, "DELETE")
    await api(`receivables?id=eq.${NO2}`, "DELETE")
  }
})

test("điện thoại: NVBH — tiêu đề Khách hàng của tôi, không hiện người phụ trách", async ({ page }) => {
  await dangNhap(page)
  await api(`users?id=eq.${OWNER}`, "PATCH", { role: "sales" })
  try {
    await page.goto("/customers")
    const man = page.getByTestId("kh-mobile")
    await expect(man.getByRole("heading", { name: "Khách hàng của tôi" })).toBeVisible()
    await expect(man.getByText(/^KH được phân công/)).toBeVisible()
    await expect(man.getByTestId("the-khach").first()).toBeVisible()
    await expect(man.getByTestId("the-khach").first()).not.toContainText("Chủ NPP")
  } finally {
    await api(`users?id=eq.${OWNER}`, "PATCH", { role: "owner" })
  }
})
