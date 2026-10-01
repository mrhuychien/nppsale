import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKy, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 27/09/2026: "Xử lý các ô tìm kiếm ở các danh sách (và các chỗ khác sử
 *   dụng ô tìm kiếm): tìm kiếm chính xác, linh hoạt hơn, tìm kiếm được không dấu."
 *
 * Một luật cho mọi ô tìm: bỏ dấu, MỖI từ phải có mặt (thứ tự nào cũng được), mã /
 * SĐT gõ liền, có gạch hay bỏ số 0 đầu đều ra; ô chọn thì xếp trùng khớp lên đầu.
 */
const tongDon = (page: Page) =>
  page.locator("div", { has: page.getByText("Tổng tiền hàng", { exact: true }) }).locator("visible=true").last()

test("danh sách đơn: mã gõ liền + bỏ số 0 đầu ('dh3' ra DH-0003), tên khách không dấu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  const o = page.getByPlaceholder("Tìm số đơn hàng, tên khách…").locator("visible=true").first()

  await o.fill("dh3")
  await expect(tongDon(page)).toContainText("1 đơn hàng")
  await expect(page.getByText("DH-0003").first()).toBeVisible()
  await expect(page.getByText("DH-0001")).toHaveCount(0)
  // Máy chủ nhận đúng khoá bỏ dấu viết liền của cột tính `tim_kd` (mig 205).
  const log = await nhatKy()
  expect(
    log.some((r) => r.path.endsWith("/sales_orders") && decodeURIComponent((r as { query?: string }).query ?? "").includes('tim_kd.ilike."%dh3%"'))
  ).toBe(true)

  // Đảo thứ tự, không dấu: "ba co" ra đơn của "Tạp hoá Cô Ba" (cả 4 đơn).
  await o.fill("ba co")
  await expect(tongDon(page)).toContainText("4 đơn hàng")

  // Từ chữ ở khách VÀ từ số ở mã đơn: "co ba 0002" chỉ còn DH-0002.
  await o.fill("co ba 0002")
  await expect(tongDon(page)).toContainText("1 đơn hàng")
  await expect(page.getByText("DH-0002").first()).toBeVisible()
})

test("POS: ô chọn hàng tìm không dấu, đảo thứ tự từ; ô chọn khách tìm SĐT có dấu cách", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/don-hang/moi")

  await page.getByRole("button", { name: /Chọn khách hàng/ }).click()
  const oKhach = page.getByPlaceholder("Tên cửa hàng, SĐT, địa chỉ…")
  await oKhach.fill("0922 222 222")
  await expect(page.getByText("1 kết quả")).toBeVisible()
  await oKhach.fill("dai ly")
  await expect(page.getByRole("dialog").getByText("Đại lý Minh")).toBeVisible()
  await expect(page.getByRole("dialog").getByText("Tạp hoá Cô Ba")).toHaveCount(0)
  await oKhach.press("Enter")
  await expect(page.getByRole("button", { name: /Chọn khách hàng/ })).toHaveCount(0)

  const oHang = page.getByPlaceholder(/Tên hàng, mã SKU/i)
  const dong = page.getByTestId("dong-don")
  // "hop sua": không dấu, ngược thứ tự — Enter chọn dòng đầu là "Sữa hộp".
  await oHang.fill("hop sua")
  await oHang.press("Enter")
  await expect(dong).toHaveCount(1)
  await expect(dong.first()).toContainText("Sữa hộp")
  // Mã gõ thường: "mi1" ra "Mì tôm".
  await oHang.fill("mi1")
  await oHang.press("Enter")
  await expect(dong).toHaveCount(2)
  await expect(dong.nth(1)).toContainText("Mì tôm")
})
