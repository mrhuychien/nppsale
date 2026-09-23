import { expect, type Page } from "@playwright/test"

export const FAKE = "http://127.0.0.1:54321"

export async function dangNhap(page: Page) {
  await page.goto("/login")
  await page.fill("#identifier", "chu@npp.test")
  await page.fill("#password", "matkhau-e2e")
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/orders/)
}

/** Nhật ký yêu cầu của máy chủ giả (để đọc tải trọng app gửi đi). */
export async function nhatKy(): Promise<Array<{ method: string; path: string; body: unknown }>> {
  return (await fetch(`${FAKE}/__log`)).json()
}

export async function chonKhach(page: Page, ten: string) {
  await page.getByRole("button", { name: /Chọn khách hàng/ }).click()
  await page.getByPlaceholder("Tên cửa hàng, SĐT, địa chỉ…").fill(ten)
  await page.getByText(ten, { exact: false }).last().click()
  await expect(page.getByRole("button", { name: /Chọn khách hàng/ })).toHaveCount(0)
}

/** Máy tính: chọn kỳ ở ô "Khoảng thời gian" (mặc định Tháng này, chủ nhà chốt 23/09/2026). */
export async function chonKy(page: Page, nhan: "Hôm nay" | "Tuần này" | "Tháng này" | "Tất cả") {
  await page.getByRole("combobox", { name: "Khoảng thời gian" }).first().click()
  await page.getByRole("option", { name: nhan, exact: true }).click()
}
