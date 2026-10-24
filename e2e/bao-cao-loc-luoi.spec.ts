import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: mở báo cáo nào ở /reports cũng kéo cả sổ khách +
 *   danh mục hàng cho ô lọc chưa ai bấm. Nay ô chọn mở mới tải.
 */
type Luot = { method: string; path: string; query?: string }
const q = (x: Luot) => decodeURIComponent(x.query ?? "")
const laSoKhachLoc = (x: Luot) => x.path === "/rest/v1/customers" && q(x).includes("select=id,store_name,phone")
const laHangLoc = (x: Luot) => x.path === "/rest/v1/products" && q(x).includes("select=id,sku,name,brand,status")
const dem = (ds: Luot[], f: (x: Luot) => boolean) => ds.filter(f).length

test("báo cáo Đặt hàng: mở màn không kéo sổ khách / danh mục hàng; mở ô Khách hàng mới tải", async ({ page }) => {
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/reports/orders")
  await expect(page.getByRole("button", { name: "Tất cả khách hàng" })).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(800)
  let ds = ((await nhatKy()) as Luot[]).slice(t)
  expect(dem(ds, laSoKhachLoc), "mở màn không đọc sổ khách cho ô lọc").toBe(0)
  expect(dem(ds, laHangLoc), "mở màn không đọc danh mục hàng cho ô lọc").toBe(0)
  expect(dem(ds, (x) => x.path === "/rest/v1/sales_routes"), "danh mục nhẹ (tuyến) vẫn tải").toBeGreaterThan(0)

  await page.getByRole("button", { name: "Tất cả khách hàng" }).click()
  await expect.poll(async () => dem(((await nhatKy()) as Luot[]).slice(t), laSoKhachLoc), { message: "mở ô → tải sổ khách" }).toBeGreaterThan(0)
  await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()
  ds = ((await nhatKy()) as Luot[]).slice(t)
  expect(dem(ds, laHangLoc), "hàng + thương hiệu tải cùng lượt").toBeGreaterThan(0)
})

test("báo cáo Bán hàng: sổ khách / hàng chỉ còn một lượt (của phần tính), ô lọc không kéo thêm", async ({ page }) => {
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/reports/sales")
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1200)
  const ds = ((await nhatKy()) as Luot[]).slice(t)
  expect(dem(ds, laSoKhachLoc), "ô lọc không kéo sổ khách").toBe(0)
  expect(dem(ds, laHangLoc), "ô lọc không kéo danh mục hàng").toBe(0)
})
