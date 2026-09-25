import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026 (mig 191):
 *   "Phiếu trả sinh ra tự động thì chỉ huỷ phiếu ko sửa được (muốn sửa thì sửa từ hoá
 *    đơn) … Phiếu trả do người dùng tạo -> sửa/huỷ được -> mọi thứ cập nhật theo."
 *   "Lưu ý trạng thái Chờ xử lý chỉ có ở phiếu trả tự sinh."
 * r-e2e-5 = phiếu TỰ SINH theo HD-E2E-1 (Chờ xử lý); r-e2e-6 = phiếu TỰ LẬP ở Nháp.
 */
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const HD1 = "00000000-0000-4000-8000-0000000000f1"

test.beforeAll(async () => {
  await api("returns?id=eq.r-e2e-5", "PATCH", {
    credit_with_invoice: true, invoice_id: HD1, order_id: "o-e2e-1", return_code: "TH-0005", return_date: "2026-09-03",
    invoice: { invoice_code: "HD-E2E-1", invoice_date: "2026-09-20" }, order: { order_code: "DH-E2E-1" },
  })
  await api("returns?id=eq.r-e2e-6", "PATCH", { status: "draft", return_code: "TH-0006" })
})
test.afterAll(async () => {
  await api("returns?id=eq.r-e2e-5", "PATCH", { credit_with_invoice: false, invoice_id: null, order_id: null, invoice: null, order: null, return_code: null, return_date: null })
  await api("returns?id=eq.r-e2e-6", "PATCH", { status: "submitted", return_code: null })
})

test("web: phiếu tự sinh chỉ Hoàn thành (nhập kho) — không Huỷ, không Sửa, chỉ đường sửa hóa đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-e2e-5")
  await expect(page.getByText("Tự sinh theo HĐ HD-E2E-1")).toBeVisible()
  await expect(page.getByText(/muốn sửa hay bỏ hàng trả thì sửa hóa đơn/)).toBeVisible()
  await expect(page.getByRole("link", { name: "Mở hóa đơn" })).toHaveAttribute("href", `/sales-invoices/${HD1}`)
  await expect(page.getByRole("button", { name: "Hoàn thành — nhập kho", exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /Huỷ phiếu/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /^Sửa$/ })).toHaveCount(0)
})

test("web: phiếu tự lập ở Nháp hoàn thành thẳng (nhập kho + trừ nợ), huỷ và sửa được", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns/r-e2e-6")
  await expect(page.getByRole("button", { name: "Hoàn thành — nhập kho & trừ công nợ" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Huỷ phiếu/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Sửa/ }).first()).toBeVisible()
  await expect(page.getByText(/Tự sinh theo HĐ/)).toHaveCount(0)
})

test("danh sách: phiếu tự sinh có nhãn Theo HĐ, mặc định gồm cả Chờ xử lý và Nháp", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  await expect(page.getByRole("button", { name: "Chờ xử lý", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("button", { name: "Nháp", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("Theo HĐ", { exact: true }).first()).toBeVisible()
})

test("POS: mở phiếu tự sinh là chỉ xem, nút Ghi nhận khoá", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-hang/r-e2e-5")
  await expect(page.getByText(/Phiếu trả tự sinh theo hóa đơn — chỉ xem/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Ghi nhận & nhập kho" })).toBeDisabled()
})

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Phiếu trả có đánh số TH- · Bấm vào số thì vào xem chi tiết, bấm
 *   vào dòng thì ra xem nhanh · Trong xem nhanh có các nút: tự sinh: In/ Sửa (nhảy ra sửa
 *   hoá đơn) / Chi tiết; tự lập: In/Sửa (nhảy ra pos sửa phiếu) / Chi tiết".
 */
test("danh sách: bấm số TH- → chi tiết; bấm dòng → xem nhanh với In / Sửa hóa đơn / Chi tiết", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const so = page.getByRole("link", { name: "TH-0005" }).first()
  await expect(so).toHaveAttribute("href", "/returns/r-e2e-5")

  // Bấm dòng (không phải số) → ngăn xem nhanh.
  await page.getByRole("row").filter({ has: so }).getByRole("cell").nth(1).click()
  const ngan = page.getByRole("dialog")
  await expect(ngan.getByText("TH-0005")).toBeVisible()
  await expect(ngan.getByRole("link", { name: "In", exact: true })).toBeVisible()
  await expect(ngan.getByRole("link", { name: "Sửa hóa đơn" })).toHaveAttribute("href", `/sales-invoices/${HD1}/edit`)
  await expect(ngan.getByRole("link", { name: "Chi tiết" })).toHaveAttribute("href", "/returns/r-e2e-5")
  await page.keyboard.press("Escape")

  // Phiếu tự lập → Sửa mở POS sửa phiếu.
  await page.getByRole("row").filter({ has: page.getByRole("link", { name: "TH-0006" }) }).getByRole("cell").nth(1).click()
  await expect(page.getByRole("dialog").getByRole("link", { name: "Sửa", exact: true })).toHaveAttribute("href", "/pos/tra-hang/r-e2e-6")

  // Bấm số → sang màn chi tiết, tiêu đề mang số phiếu.
  await page.keyboard.press("Escape")
  await so.click()
  await expect(page).toHaveURL(/\/returns\/r-e2e-5$/)
  await expect(page.getByRole("heading", { name: /TH-0005/ }).first()).toBeVisible()
})

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Danh sách Hoá đơn bán HD 0403 thực chất số tiền còn 2988500 (sau khi
 *   trừ hàng trả)". HD-E2E-1 900.000, phiếu tự sinh 10.000 (Chờ xử lý) → danh sách hiện 890.000.
 */
test("danh sách hóa đơn: tiền là số còn lại sau hàng trả", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices")
  const dong = page.getByText("HD-E2E-1", { exact: true }).first().locator("xpath=ancestor::*[contains(., 'trả 10.000')][1]")
  await expect(dong).toContainText("890.000đ")
  await expect(dong).toContainText("HĐ 900.000đ · trả 10.000đ")
})

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Cập nhật ngày trong phiếu trả nhưng ngoài list hiển thị vẫn ngày cũ ?" ·
 *   "Trong chi tiết phiếu trả có các phím chức năng như ngoài xem nhanh" · "Các danh sách khi chọn
 *   lọc trạng thái ko lưu ? Load lại là ra như ban đầu. Khi ấn vào tất cả thì chọn hết các trạng thái".
 */
test("danh sách hiện ngày chứng từ; chi tiết có In / Sửa hóa đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  await expect(page.getByRole("row").filter({ has: page.getByRole("link", { name: "TH-0005" }) })).toContainText("03/09/2026")
  await page.goto("/returns/r-e2e-5")
  await expect(page.getByRole("link", { name: "In", exact: true })).toHaveAttribute("href", "/returns/r-e2e-5/print?auto=1")
  await expect(page.getByRole("link", { name: "Sửa hóa đơn" })).toHaveAttribute("href", `/sales-invoices/${HD1}/edit`)
  await page.goto("/returns/r-e2e-6")
  await expect(page.getByRole("link", { name: "Sửa", exact: true })).toHaveAttribute("href", "/pos/tra-hang/r-e2e-6")
})

test("lọc trạng thái nhớ qua tải lại; Tất cả = sáng hết", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const chip = (t: string) => page.getByRole("button", { name: t, exact: true })
  await chip("Tất cả").click()
  for (const t of ["Tất cả", "Chờ xử lý", "Nháp", "Đã nhập kho", "Đã huỷ"]) await expect(chip(t)).toHaveAttribute("aria-pressed", "true")
  // Từ Tất cả bấm "Đã huỷ" → tất cả trừ Huỷ.
  await chip("Đã huỷ").click()
  await expect(chip("Đã huỷ")).toHaveAttribute("aria-pressed", "false")
  await expect(chip("Tất cả")).toHaveAttribute("aria-pressed", "false")
  await expect(chip("Nháp")).toHaveAttribute("aria-pressed", "true")
  await page.reload()
  await expect(chip("Đã huỷ")).toHaveAttribute("aria-pressed", "false")
  await expect(chip("Đã nhập kho")).toHaveAttribute("aria-pressed", "true")
  await chip("Đã huỷ").click()
  await expect(chip("Tất cả")).toHaveAttribute("aria-pressed", "true")
})
