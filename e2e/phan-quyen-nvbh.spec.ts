import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Xây dựng cho tao phân quyền mẫu cho nhân viên bán hàng: Đủ để nhân
 *   viên bán hàng; Không xem được các thông tin quan trọng của nhà phân phối".
 *   Tài khoản e2e tạm đổi vai sang NVBH.
 */
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const SUA = "00000000-0000-4000-8000-0000000000d1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("NVBH: không vào lãi lỗ / lô hàng / sản phẩm / kho / phiếu thu; vẫn lên đơn", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    /* Chủ nhà 26/09/2026: NVBH chỉ còn module bán hàng + công nợ / báo cáo bán hàng / phiếu lương. */
    for (const url of ["/reports/finance/pnl", "/inventory/batches", "/inventory", `/products/${SUA}`,
      "/finance/cash-receipts", "/reports/products", "/reports"]) {
      await page.goto(url)
      await expect(page, url).not.toHaveURL(new RegExp(url.replace(/\//g, "\\/") + "$"))
    }

    await page.goto("/sell")
    await expect(page.getByRole("button", { name: "Thêm Sữa hộp", exact: true })).toBeVisible()
  } finally {
    await doiVai("owner")
  }
})

test("NVBH: Phiếu lương của tôi — kỳ đã chốt, các khoản cộng ra thực nhận", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/luong-cua-toi")
    const ds = page.getByTestId("phieu-luong")
    await expect(ds.getByText("Tháng 08/2026")).toBeVisible()
    await expect(ds.getByText("8.660.000đ").first()).toBeVisible()
    await expect(ds.getByText("BHXH")).toBeVisible()
    await expect(ds.getByText("-840.000đ")).toBeVisible()
  } finally {
    await doiVai("owner")
  }
})

test("chủ NPP: thấy giá vốn; màn Phân quyền có nút Áp mẫu NVBH", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/products/${SUA}`)
  await expect(page.getByLabel("Giá vốn")).toBeVisible()
  await page.goto("/settings/permissions")
  await page.getByRole("button", { name: /NV Bán hàng/ }).first().click()
  await expect(page.getByRole("button", { name: "Áp mẫu NVBH" })).toBeVisible()
})
