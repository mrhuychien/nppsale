import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/** ⚠ Chủ nhà 26/09/2026: menu "Báo cáo tổng hợp" (6 màn) dựng song song báo cáo cũ. */
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("chủ NPP: nhóm Báo cáo tổng hợp đủ 6 mục; màn Kho dẫn tới báo cáo cũ", async ({ page }) => {
  await dangNhap(page)
  await page.getByRole("button", { name: /Báo cáo tổng hợp/ }).click()
  for (const m of ["Tổng quan", "Bán hàng", "Cuối ngày", "Kho", "Công nợ", "Tài chính"]) {
    await expect(page.locator(`a[href="${{ "Tổng quan": "/bao-cao", "Bán hàng": "/bao-cao/ban-hang", "Cuối ngày": "/bao-cao/cuoi-ngay", Kho: "/bao-cao/kho", "Công nợ": "/bao-cao/cong-no", "Tài chính": "/bao-cao/tai-chinh" }[m]}"]`).first()).toBeVisible()
  }
  await page.locator('a[href="/bao-cao/kho"]').first().click()
  const man = page.getByTestId("bao-cao-tam")
  await expect(man.getByRole("heading", { name: "Kho" })).toBeVisible()
  await expect(man.getByRole("link", { name: "Báo cáo tồn kho" })).toHaveAttribute("href", "/reports/inventory")
  // Báo cáo cũ vẫn còn trong menu (mở nhóm "Báo cáo" cũ ra xem).
  await page.getByRole("button", { name: "Báo cáo", exact: true }).click()
  await expect(page.locator('a[href="/reports/sales"]').first()).toBeVisible()
})

test("NVBH: Bán hàng chỉ dẫn tới báo cáo mình được xem; không vào được Tài chính", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/bao-cao/ban-hang")
    const man = page.getByTestId("bao-cao-tam")
    await expect(man.getByRole("link", { name: "Báo cáo bán hàng" })).toBeVisible()
    await expect(man.getByRole("link", { name: "Nhân viên" })).toHaveCount(0)
    await expect(man.getByRole("link", { name: "Đặt hàng" })).toHaveCount(0)
    await page.goto("/bao-cao/tai-chinh")
    await expect(page).toHaveURL(/\/home$/)
  } finally {
    await doiVai("owner")
  }
})
