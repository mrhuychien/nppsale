import { test, expect } from "@playwright/test"
import { dangNhap, chonKy, FAKE } from "./helpers"

/**
 * ⚠ YÊU CẦU 23/09/2026: "Thêm phần thống kê này vào các danh sách Đơn hàng
 *   / Hóa đơn / trả hàng... (trên desktop và mobile)" — "Tổng tiền hàng
 *   503.410.450đ · 285 đơn hàng". Tổng là của CẢ BỘ LỌC, không phải trang.
 */
const khoi = (page: import("@playwright/test").Page, nhan: string) =>
  page.locator("div", { has: page.getByText(nhan, { exact: true }) }).last()

test("đơn hàng — máy tính: 'Tất cả' ra cả đơn năm ngoái; đơn huỷ không vào tổng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  // ⚠ LỖI CŨ: viên thuốc "Tháng này" của điện thoại lọc ngầm cả máy tính —
  //   đơn DH-0003 (06/2025) không bao giờ hiện trên máy tính.
  await expect(page.getByText("DH-0003").first()).toBeVisible()
  const k = khoi(page, "Tổng tiền hàng")
  // DH-0004 (huỷ, 9.000.000) đếm vào 4 đơn nhưng KHÔNG vào tổng.
  await expect(k).toContainText("4 đơn hàng")
  await expect(k).toContainText("8.000.000")
})

test("đơn hàng — máy tính: mặc định 'Tháng này', đơn năm ngoái ẩn", async ({ page }) => {
  // ⚠ YÊU CẦU 23/09/2026: "Các danh sách có bộ lọc thời gian: Mặc định để tháng này".
  await dangNhap(page)
  await page.goto("/orders")
  await expect(page.getByRole("combobox", { name: "Khoảng thời gian" }).first()).toContainText("Tháng này")
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  await expect(page.getByText("DH-0003")).toHaveCount(0)
  await expect(khoi(page, "Tổng tiền hàng")).toContainText("2 đơn hàng")
})

test("đơn hàng — điện thoại: khối tóm tắt theo viên thuốc", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await dangNhap(page)
  await page.goto("/orders")
  // Mặc định "Tháng này": hai đơn tháng này.
  await expect(page.getByText("2 đơn hàng").locator("visible=true")).toHaveCount(1)
  await expect(page.getByText("3.000.000đ").locator("visible=true").first()).toBeVisible()
  await ctx.close()
})

test("trả hàng: tổng khoản có của CẢ bộ lọc (60 phiếu), không phải trang 50 dòng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const k = khoi(page, "Tổng tiền trả hàng")
  await expect(k).toContainText("60 phiếu trả")
  await expect(k, "cộng trang đang hiện thay vì cả bộ lọc").toContainText("600.000")
})

test("phiếu nhập: phiếu huỷ không vào tổng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts")
  const k = khoi(page, "Tổng tiền phiếu nhập")
  await expect(k).toContainText("3 phiếu nhập")
  await expect(k).toContainText("1.000.000")
})

/* ⚠ CHỦ NHÀ 24/09/2026: "Danh sách trả hàng thêm cột hiển thị Tính cho nhân viên". */
test("trả hàng — máy tính: cột 'Tính cho NV' là người được tính, không phải người lập", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  await expect(page.locator("thead").getByText("Tính cho NV", { exact: true })).toBeVisible()
  const o = page.getByTestId("tinh-cho-nv")
  await expect(o.first()).toBeVisible()
  await expect(o.filter({ hasText: "NV Bán Một" }).first()).toBeVisible()
  await expect(o.filter({ hasText: "NV Bán Hai" }).first()).toBeVisible()
  await expect(o.filter({ hasText: "Chủ NPP" })).toHaveCount(0)
})

/* ⚠ CHỦ NHÀ 24/09/2026: lọc danh sách trả hàng theo NV được tính. Tổng của CẢ bộ lọc đi theo. */
test("trả hàng — lọc theo NV được tính (và 'Chưa gán NV'); tổng đi theo bộ lọc", async ({ page }) => {
  const NV = [
    { id: "00000000-0000-4000-8000-0000000000b7", full_name: "NV Bán Một" },
    { id: "00000000-0000-4000-8000-0000000000b8", full_name: "NV Bán Hai" },
  ].map((u) => ({ ...u, org_id: "00000000-0000-4000-8000-0000000000a1", role: "sales", is_active: true }))
  await fetch(`${FAKE}/rest/v1/users`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(NV) })
  try {
    await dangNhap(page)
    await page.goto("/returns")
    const k = khoi(page, "Tổng tiền trả hàng")
    await expect(k).toContainText("60 phiếu trả")
    const chon = async (nhan: string) => {
      await page.getByRole("combobox", { name: "Lọc theo NV" }).click()
      await page.getByRole("option", { name: nhan, exact: true }).click()
    }
    await chon("NV Bán Hai")
    await expect(k).toContainText("20 phiếu trả")
    await expect(k).toContainText("200.000")
    const o = page.getByTestId("tinh-cho-nv")
    await expect(o.first()).toHaveText("NV Bán Hai")
    await expect(o.filter({ hasNotText: "NV Bán Hai" })).toHaveCount(0)

    await chon("Chưa gán NV")
    await expect(k).toContainText("20 phiếu trả")
    await expect(o.filter({ hasNotText: "—" })).toHaveCount(0)

    await chon("Tất cả NV")
    await expect(k).toContainText("60 phiếu trả")
  } finally {
    for (const u of NV) await fetch(`${FAKE}/rest/v1/users?id=eq.${u.id}`, { method: "DELETE" })
  }
})

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Danh sách đơn hàng và Danh sách hóa đơn -> thêm cột
 *   Tính cho NV (đặt mặc định) còn cột người tạo (option)".
 */
for (const [duong, ten] of [["/orders", "đơn hàng"], ["/sales-invoices", "hóa đơn"]] as const) {
  test(`${ten} — máy tính: 'Tính cho NV' mặc định, 'Người tạo' bật được trong Cột hiển thị`, async ({ page }) => {
    await dangNhap(page)
    await page.goto(duong)
    await chonKy(page, "Tất cả")
    await expect(page.getByText("Tính cho NV", { exact: true }).first()).toBeVisible()
    await expect(page.getByTestId("nguoi-tao-dong"), "cột Người tạo phải tắt mặc định").toHaveCount(0)

    await page.getByRole("button", { name: /Cột hiển thị/ }).first().click()
    await page.getByText("Người tạo", { exact: true }).last().click()
    await page.keyboard.press("Escape")
    const o = page.getByTestId("nguoi-tao-dong")
    await expect(o.filter({ hasText: "Kế toán Lan" }).first()).toBeVisible()
    await expect(o.filter({ hasText: "Chủ NPP" }), "Người tạo lấy nhầm người được tính").toHaveCount(0)
  })
}
