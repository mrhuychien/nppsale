import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ĐỘI TEST "BÁN HÀNG / ĐƠN HÀNG" — luồng màn /sell điện thoại (xanh).
 *
 * Gửi một đơn có giảm giá dòng + giảm giá cả đơn, rồi đọc TẢI TRỌNG thật app gửi
 * vào RPC tạo đơn nguyên tử (create_order_with_lines, mig 169): con số trên màn và
 * con số đi xuống sổ phải khớp từng đồng.
 *
 * Mẫu (e2e/fixture.mjs): Sữa hộp 20.000/hộp, thùng 24 hộp giá bảng 450.000.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const KHACH = "00000000-0000-4000-8000-0000000000c1"

type TaiTrong = {
  client_request_id: string
  order: { customer_id: string; subtotal: number; vat: number; total: number; status: string }
  lines: Array<{ unit_name: string; quantity: number; unit_price: number; line_discount: number; line_total: number; conversion_factor: number }>
}
const goiTaoDon = async (sau: number) =>
  (await nhatKy()).slice(sau).filter((r) => r.path.endsWith("/rpc/create_order_with_lines"))

async function moGio(page: Page) {
  await page.goto(`/sell?customerId=${KHACH}`)
  await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await expect(page).toHaveURL(/\/sell\/cart/)
}

test("/sell: 2 hộp giảm 10% + giảm đơn 1.000 → sổ nhận 18.000/hộp, tổng 35.000, một lần gọi", async ({ page }) => {
  await dangNhap(page)
  await moGio(page)

  const sheet = page.getByRole("dialog")
  await page.getByTestId("dong-gio").getByRole("button", { name: /Sữa hộp/ }).first().click()
  await sheet.getByRole("button", { name: "Tăng" }).click()
  await sheet.getByRole("button", { name: "Giảm dòng theo %" }).click()
  await sheet.getByLabel("Giảm giá dòng", { exact: true }).fill("10")
  await sheet.getByRole("button", { name: /^Cập nhật/ }).click()

  await page.getByLabel("Giảm giá đơn", { exact: true }).fill("1000")
  const tong = page.getByRole("button", { name: /Tổng tiền/ })
  // 2 × 20.000 = 40.000 − 4.000 (dòng) − 1.000 (đơn) = 35.000
  await expect(tong).toContainText("35.000")

  const truoc = (await nhatKy()).length
  const gui = page.getByRole("button", { name: "Gửi đơn", exact: true })
  await expect(gui).toBeEnabled()
  await gui.click()
  await expect.poll(async () => (await goiTaoDon(truoc)).length).toBe(1)
  const p = ((await goiTaoDon(truoc))[0].body as { p: TaiTrong }).p

  expect(p.client_request_id).toMatch(/^[0-9a-f-]{36}$/)
  expect(p.order).toMatchObject({ customer_id: KHACH, subtotal: 35_000, vat: 0, total: 35_000, status: "submitted" })
  expect(p.lines).toHaveLength(1)
  expect(p.lines[0]).toMatchObject({ unit_name: "hộp", quantity: 2, unit_price: 18_000, line_discount: 4_000, line_total: 36_000, conversion_factor: 1 })
  // Tổng dòng − giảm đơn = subtotal đơn (hóa đơn suy lại giảm đơn từ đây — giamCuaChungTu)
  expect(p.lines.reduce((s, l) => s + l.line_total, 0) - p.order.subtotal).toBe(1_000)
})

test("/sell: đổi sang thùng lấy GIÁ BẢNG thùng 450.000 (không 24 × 20.000) và hệ số 24 đi xuống sổ", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/sell?customerId=${KHACH}`)
  await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()
  const the = page.getByTestId("the-san-pham").filter({ hasText: "Sữa hộp" }).first()
  await the.getByRole("button", { name: "thùng", exact: true }).click()
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  await expect(page.getByRole("button", { name: /Tổng tiền/ })).toContainText("450.000")

  const truoc = (await nhatKy()).length
  await page.getByRole("button", { name: "Gửi đơn", exact: true }).click()
  await expect.poll(async () => (await goiTaoDon(truoc)).length).toBe(1)
  const p = ((await goiTaoDon(truoc))[0].body as { p: TaiTrong }).p
  expect(p.lines[0]).toMatchObject({ unit_name: "thùng", quantity: 1, unit_price: 450_000, line_total: 450_000, conversion_factor: 24 })
  expect(p.order.total).toBe(450_000)
})
