import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 01/10/2026 — làm lại màn Tạo khách hàng mới trên điện thoại:
 *   "Tìm số điện thoại không có -> vào tạo khách hàng mới phải gán luôn số điện thoại tìm" · "Phường xã: dropdown
 *   list kèm tìm kiếm các phường ở Hải Phòng (sau sát nhập)" · "Tuyến -> trường bắt buộc" · "Chống bấm tạo khách
 *   hàng 2 lần ? -> báo lỗi đã có khách hàng, ko chuyển trang".
 *   Dữ liệu giả: khách "Tạp hoá Cô Ba" SĐT 0911111111.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const SDT = "0912345678"
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })

test.beforeEach(async () => {
  await api("sales_routes", { method: "POST", body: JSON.stringify([{ id: "tuyen-t2", org_id: ORG, code: "T2", name: "Thứ Hai", is_active: true, sort_order: 1 }]) })
})
test.afterEach(async () => {
  await api("sales_routes?id=eq.tuyen-t2", { method: "DELETE" })
  await api(`customers?phone=eq.${SDT}`, { method: "DELETE" })
})

async function chon(page: Page, id: string, go: string, ten: string | RegExp) {
  await page.locator(`#${id}`).click()
  await page.locator(`#${id}`).fill(go)
  await page.getByTestId("search-select-xo").filter({ visible: true }).getByRole("button", { name: ten }).first().click()
}

test("tìm SĐT không ra → tạo khách gán sẵn số; tuyến bắt buộc; phường có tìm; bấm Lưu 2 lần chỉ tạo 1", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers")
  await page.locator('input[type="search"]').filter({ visible: true }).fill("0912 345 678")
  await page.getByTestId("tao-khach-voi-sdt").filter({ visible: true }).click()
  await expect(page).toHaveURL(/\/customers\/new\?sdt=0912345678/)
  await expect(page.getByTestId("tk-phone")).toHaveValue("0912 345 678")

  // Thiếu tuyến (và tên…) → báo lỗi, chưa ghi gì.
  await page.getByTestId("tk-luu").click()
  await expect(page.getByText("Chọn tuyến bán hàng")).toBeVisible()
  await expect(page.getByText("Nhập tên cửa hàng")).toBeVisible()

  await page.getByTestId("tk-shop").fill("Tạp hoá Bà Hai")
  await page.getByTestId("tk-owner").fill("Nguyễn Thị Hai")
  await page.getByTestId("tk-street").fill("12 Lạch Tray")
  // Phường Hải Phòng sau sáp nhập — gõ không dấu.
  await chon(page, "tk-ward", "hong bang", "Phường Hồng Bàng")
  await expect(page.locator("#tk-ward")).toHaveValue("Phường Hồng Bàng")
  await chon(page, "tk-route", "T2", /T2 · Thứ Hai/)

  // Bấm Lưu 2 lần liền — chỉ MỘT khách được ghi.
  await page.getByTestId("tk-luu").dblclick()
  await expect(page.getByTestId("tk-xong")).toContainText("Đã thêm Tạp hoá Bà Hai")
  await expect(page.getByTestId("tk-xong")).toContainText("Tuyến Thứ Hai")
  const ghi = await (await api(`customers?phone=eq.${SDT}&select=*`)).json()
  expect(ghi).toHaveLength(1)
  expect(ghi[0]).toMatchObject({ channel: "T2", ward: "Phường Hồng Bàng", store_name: "Tạp hoá Bà Hai" })
})

test("SĐT đã có khách → báo 'đã có khách hàng' tại chỗ, không ghi, không chuyển trang", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers/new?sdt=0911111111")
  await expect(page.getByTestId("tk-phone")).toHaveValue("0911 111 111")
  await expect(page.getByText(/Đã có khách hàng dùng số 0911 111 111: Tạp hoá Cô Ba/)).toBeVisible()
  await expect(page.getByTestId("tk-mo-khach-trung")).toBeVisible()
  await page.getByTestId("tk-shop").fill("Trùng")
  await page.getByTestId("tk-owner").fill("Trùng")
  await page.getByTestId("tk-street").fill("1 Trùng")
  await chon(page, "tk-route", "T2", /T2 · Thứ Hai/)
  await page.getByTestId("tk-luu").click()
  await expect(page).toHaveURL(/\/customers\/new\?sdt=0911111111/)
  await expect(page.getByTestId("tk-xong")).toHaveCount(0)
  const ghi = await (await api("customers?phone=eq.0911111111&select=id")).json()
  expect(ghi).toHaveLength(1)
})

test("chọn khách ở /sell: tìm SĐT không ra → tạo khách mới TẠI CHỖ, gán sẵn số (Update 3.10)", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sell/customer")
  await page.getByLabel("Tìm khách hàng").fill(SDT)
  await page.getByTestId("tao-khach-voi-sdt").click()
  await expect(page).toHaveURL(/\/sell\/customer$/)
  await expect(page.getByTestId("tao-nhanh-khach").getByTestId("tk-phone")).toHaveValue("0912 345 678")
})

test.describe("máy tính", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false })
  test("form máy tính: SĐT gán sẵn từ ô tìm; thiếu tuyến không lưu", async ({ page }) => {
    await dangNhap(page)
    await page.goto(`/customers/new?sdt=${SDT}`)
    await expect(page.getByPlaceholder("0901000001")).toHaveValue(SDT)
    await page.getByPlaceholder("VD: Tạp hóa Bà Hai").fill("Tạp hoá Bà Ba")
    await page.locator("form input[required]").nth(1).fill("Bà Ba")
    await page.getByPlaceholder("Số nhà, tên đường").fill("3 Lạch Tray")
    await page.getByRole("button", { name: "Tạo mới" }).click()
    await expect(page.getByText("Chưa chọn tuyến bán hàng").first()).toBeVisible()
    expect(await (await api(`customers?phone=eq.${SDT}&select=id`)).json()).toHaveLength(0)
  })
})
