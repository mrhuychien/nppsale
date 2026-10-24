import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: chi tiết khách trên máy NVBH chạy cả bộ câu HAI
 *   LẦN (hồ sơ về đổi `laNvbh`), và tải cả bảng giá (hàng nghìn dòng) dù chỉ dùng ở tab "Bảng giá áp dụng".
 */
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
type Luot = { method: string; path: string; query?: string }
const dem = (ds: Luot[], f: (x: Luot) => boolean) => ds.filter(f).length
const laKhachChinh = (x: Luot) =>
  x.path === "/rest/v1/customers" && decodeURIComponent(x.query ?? "").includes("select=id,org_id,store_name,owner_name")
const laPhanCong = (x: Luot) => x.path === "/rest/v1/customer_assignments"
const laBangGia = (x: Luot) => x.path === "/rest/v1/price_lists"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("chủ NPP: mở chi tiết khách — mỗi câu một lần, bảng giá chỉ tải khi mở tab", async ({ page }) => {
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto(`/customers/${KHACH}`)
  await expect(page.getByRole("tab", { name: "Bảng giá áp dụng" })).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(800)
  const ds = (await nhatKy()).slice(t) as Luot[]
  expect(dem(ds, laKhachChinh), "hồ sơ khách đọc một lần").toBe(1)
  expect(dem(ds, laPhanCong), "phân công đọc một lần").toBe(1)
  expect(dem(ds, laBangGia), "chưa mở tab thì không tải bảng giá").toBe(0)

  await page.getByRole("tab", { name: "Bảng giá áp dụng" }).click()
  await expect
    .poll(async () => dem((await nhatKy()).slice(t) as Luot[], laBangGia), { message: "mở tab → tải bảng giá" })
    .toBeGreaterThan(0)
})

test("NVBH: hồ sơ về sau không làm trang tải lại từ đầu lần hai", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    const t = (await nhatKy()).length
    await page.goto(`/customers/${KHACH}`)
    await expect(page.getByRole("tab", { name: "Tổng quan" })).toBeVisible()
    await page.waitForLoadState("networkidle")
    await page.waitForTimeout(800)
    const ds = (await nhatKy()).slice(t) as Luot[]
    expect(dem(ds, laKhachChinh), "hồ sơ khách đọc một lần").toBe(1)
    expect(dem(ds, laPhanCong), "phân công đọc một lần").toBe(1)
  } finally {
    await doiVai("owner")
  }
})
