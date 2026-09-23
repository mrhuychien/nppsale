import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ YÊU CẦU 23/09/2026: "Phần tìm trong các danh sách (đơn hàng, hóa đơn,
 *   trả hàng…) làm theo mẫu" — ô tìm + nút lọc; bấm nút xổ ra các ô theo
 *   trường, "Mở rộng" và "Tìm kiếm". Các trường ghép bằng VÀ.
 */
const tongDon = (page: Page) =>
  page.locator("div", { has: page.getByText("Tổng tiền hàng", { exact: true }) }).locator("visible=true").last()

test("đơn hàng: tìm theo mã, tên hàng — ghép VÀ với khách; tổng theo đúng bộ lọc", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await expect(page.getByText("DH-0001").first()).toBeVisible()

  await page.getByRole("button", { name: "Tìm theo từng trường" }).click()
  await expect(page.getByRole("textbox", { name: "Theo mã đơn hàng", exact: true })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Theo tên, số điện thoại khách hàng", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Mở rộng" })).toBeVisible()
  await page.getByRole("textbox", { name: "Theo mã, tên hàng", exact: true }).fill("Mì")
  await page.getByRole("button", { name: "Tìm kiếm" }).click()

  // Mì có ở DH-0002 và DH-0003 (không có ở DH-0001).
  await expect(page.getByText("DH-0001")).toHaveCount(0)
  await expect(page.getByText("DH-0002").first()).toBeVisible()
  await expect(page.getByText("DH-0003").first()).toBeVisible()
  await expect(page.getByText("Theo mã, tên hàng: Mì")).toBeVisible()
  await expect(tongDon(page)).toContainText("2 đơn hàng")
  await expect(tongDon(page)).toContainText("7.000.000")

  // Thêm "mã đơn 0003" → VÀ → chỉ còn DH-0003.
  await page.getByRole("button", { name: "Tìm theo từng trường" }).click()
  await expect(page.getByRole("textbox", { name: "Theo mã, tên hàng", exact: true }), "mở lại phải giữ trường đang áp").toHaveValue("Mì")
  await page.getByRole("textbox", { name: "Theo mã đơn hàng", exact: true }).fill("0003")
  await page.getByRole("textbox", { name: "Theo mã đơn hàng", exact: true }).press("Enter")
  await expect(tongDon(page)).toContainText("1 đơn hàng")
  await expect(page.getByText("DH-0002")).toHaveCount(0)
  await expect(page.getByText("DH-0003").first()).toBeVisible()

  // Khách không khớp ai → 0 đơn, KHÔNG phải cả danh sách.
  await page.getByRole("button", { name: "Tìm theo từng trường" }).click()
  await page.getByRole("textbox", { name: "Theo tên, số điện thoại khách hàng", exact: true }).fill("không có ai tên này")
  await page.getByRole("button", { name: "Tìm kiếm" }).click()
  // ⚠ Chờ KẾT QUẢ, không chờ "không thấy": lúc đang tải cũng "không thấy".
  await expect(tongDon(page)).toContainText("0 đơn hàng")
  await expect(page.getByText("DH-0003")).toHaveCount(0)

  // Gỡ từng nhãn → về lại.
  await page.getByRole("button", { name: "Bỏ Theo tên, số điện thoại khách hàng" }).click()
  await page.getByRole("button", { name: "Bỏ Theo mã đơn hàng" }).click()
  await page.getByRole("button", { name: "Bỏ Theo mã, tên hàng" }).click()
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  await expect(tongDon(page)).toContainText("4 đơn hàng")
})

/** "Serial/IMEI" của mẫu → "Theo số lô": hóa đơn nối tới lô qua phiếu xuất kho. */
test("hóa đơn bán: tìm theo số lô", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices")
  await expect(page.getByText("HD-E2E-2").first()).toBeVisible()
  await page.getByRole("button", { name: "Tìm theo từng trường" }).click()
  await page.getByRole("textbox", { name: "Theo số lô", exact: true }).fill("L1")
  await page.getByRole("button", { name: "Tìm kiếm" }).click()
  await expect(page.getByText("Theo số lô: L1")).toBeVisible()
  await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
  await expect(page.getByText("HD-E2E-2")).toHaveCount(0)
  await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
})

test("trả hàng: tìm theo hàng — tổng khoản có theo đúng bộ lọc", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  await page.getByRole("button", { name: "Tìm theo từng trường" }).click()
  await page.getByRole("textbox", { name: "Theo mã, tên hàng", exact: true }).fill("Mì")
  await page.getByRole("button", { name: "Tìm kiếm" }).click()
  const k = page.locator("div", { has: page.getByText("Tổng tiền trả hàng", { exact: true }) }).last()
  await expect(k).toContainText("2 phiếu trả")
  await expect(k).toContainText("20.000")
})

test("đơn hàng — điện thoại: các ô theo trường nằm trong tấm lọc", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await dangNhap(page)
  await page.goto("/orders")
  await expect(page.getByText("2 đơn hàng").locator("visible=true")).toHaveCount(1)
  await page.getByRole("button", { name: /Bộ lọc|Lọc/ }).locator("visible=true").first().click()
  await page.getByRole("textbox", { name: "Theo mã, tên hàng", exact: true }).locator("visible=true").fill("Mì")
  await page.keyboard.press("Escape")
  // Tháng này: DH-0001 (Sữa) và DH-0002 (Mì) → còn 1 đơn.
  await expect(page.getByText("1 đơn hàng").locator("visible=true")).toHaveCount(1)
  await ctx.close()
})

/**
 * ⚠ DẤU PHẨY / NGOẶC trong chữ gõ làm vỡ cú pháp `or=` của PostgREST nếu giá
 *   trị không nằm trong ngoặc kép — danh sách báo lỗi. Chốt: gõ vào ô tìm
 *   theo mã và ô tìm nhanh, danh sách vẫn đọc được (0 kết quả, không lỗi).
 */
test("đơn hàng: chữ tìm có dấu phẩy, ngoặc không làm hỏng truy vấn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  await page.getByRole("button", { name: "Tìm theo từng trường" }).click()
  await page.getByRole("textbox", { name: "Theo mã đơn hàng", exact: true }).fill("DH,00 (1)")
  await page.getByRole("button", { name: "Tìm kiếm" }).click()
  await expect(tongDon(page)).toContainText("0 đơn hàng")
  await expect(page.getByText(/Không tải được|lỗi/i)).toHaveCount(0)
  await page.getByRole("button", { name: "Bỏ Theo mã đơn hàng" }).click()
  await expect(tongDon(page)).toContainText("4 đơn hàng")
})
