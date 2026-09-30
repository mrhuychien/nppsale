import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: "Làm màn nhập hàng, trả hàng NCC (vẫn giữ 2 màn riêng nhé) trên di động
 *   giống màn làm đơn hàng trên di động" — thêm hàng bằng thẻ (+1, − số +), thanh đáy "Xem phiếu",
 *   màn phiếu có NCC / dòng hàng / tổng tiền dưới đáy / Lưu tạm + Hoàn thành.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const goiCuoi = async (duong: string, method = "POST") =>
  (await nhatKy()).filter((r) => r.method === method && r.path.includes(duong)).at(-1)

async function chonNcc(page: Page) {
  await page.getByTestId("chon-ncc").click()
  await page.getByRole("dialog").getByRole("button", { name: /Vinamilk/ }).click()
  await expect(page.getByTestId("chon-ncc")).toContainText("Vinamilk")
}

test("nhập hàng trên điện thoại: chạm thẻ thêm hàng, đổi thùng, xem phiếu, hoàn thành", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Nhập hàng" })).toBeVisible()
  await chonNcc(page)

  const sua = page.getByTestId("the-hang-ncc").filter({ hasText: "Sữa hộp" })
  await sua.getByRole("button", { name: "thùng", exact: true }).click()
  await expect(sua).toContainText("360.000")
  // Mặc định CHỌN TỪNG MÃ: chạm một mã là sang phiếu ngay.
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "false")
  await sua.click()
  await expect(page.getByTestId("buoc-phieu")).toBeVisible()
  await page.getByRole("button", { name: "Thêm hàng" }).click()
  // Bật CHỌN NHIỀU: thêm xong vẫn ở lại; nút chỉ đổi khi bấm, tải lại trang vẫn giữ.
  await page.getByTestId("chon-nhieu").click()
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "true")
  await sua.getByRole("button", { name: "Tăng Sữa hộp" }).click()
  await page.getByTestId("the-hang-ncc").filter({ hasText: "Mì tôm" }).click()
  await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "true")
  await page.getByTestId("the-hang-ncc").filter({ hasText: "Mì tôm" }).getByRole("button", { name: "Bớt Mì tôm" }).click()
  await expect(sua.getByLabel("Số lượng Sữa hộp")).toHaveText("2")
  await expect(page.getByText("1 mặt hàng · 2 đơn vị")).toBeVisible()

  await page.getByRole("button", { name: "Xem phiếu" }).click()
  await expect(page.getByTestId("buoc-phieu")).toBeVisible()
  await expect(page.getByTestId("dong-phieu-ncc")).toContainText("360.000đ / thùng")
  await expect(page.getByTestId("tong-phieu-ncc")).toHaveText("720.000đ")

  // Back của điện thoại về bước thêm hàng, phiếu còn nguyên.
  await page.goBack()
  await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
  await expect(page.getByText("1 mặt hàng · 2 đơn vị")).toBeVisible()
  await page.getByRole("button", { name: "Xem phiếu" }).click()

  // Sửa dòng: giá theo HĐ NCC.
  await page.getByTestId("dong-phieu-ncc").getByRole("button", { name: /^Sữa hộp/ }).first().click()
  await page.locator("#sua-dong-gia").fill("350000")
  await page.getByRole("button", { name: "Xong" }).click()
  await expect(page.getByTestId("tong-phieu-ncc")).toHaveText("700.000đ")

  await page.locator("#pn-so-hd").fill("HD-NCC-9")
  // Giảm giá phiếu TRƯỚC thuế (10% của 700.000) + VAT một mức cho cả phiếu (chủ nhà 30/09/2026).
  await page.getByRole("group", { name: "Giảm giá phiếu theo" }).getByRole("button", { name: "%" }).click()
  await page.locator("#phieu-ncc-giam").fill("10")
  await page.getByRole("group", { name: "VAT cả phiếu" }).getByRole("button", { name: "10%" }).click()
  await expect(page.getByTestId("tong-phieu-ncc")).toHaveText("693.000đ")
  await page.getByRole("button", { name: "Hoàn thành" }).click()
  await expect.poll(async () => !!(await goiCuoi("/rpc/complete_purchase_invoice"))).toBe(true)
  const dau = (await goiCuoi("/rest/v1/purchase_invoices"))!.body as Record<string, unknown>
  expect(dau).toMatchObject({ invoice_number: "HD-NCC-9", status: "draft", subtotal: 700000, discount: 70000, vat_override: 63000, total: 693000 })
  const dong = (await goiCuoi("/rest/v1/purchase_invoice_lines"))!.body as Array<Record<string, unknown>>
  expect(dong[0]).toMatchObject({ unit_name: "thùng", quantity: 2, unit_price: 350000, conversion_factor: 24, vat_rate: 0 })
})

test("trả hàng NCC trên điện thoại: màn riêng, chọn lý do + kho, gửi phiếu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchase-returns/new")
  await expect(page.getByRole("heading", { name: "Trả hàng NCC" })).toBeVisible()
  // Chưa chọn NCC mà xem phiếu: nút chính nói thiếu gì.
  // Chọn từng mã (mặc định): chạm là sang phiếu.
  await page.getByTestId("the-hang-ncc").filter({ hasText: "Mì tôm" }).click()
  await expect(page.getByRole("button", { name: "Chọn NCC" })).toBeDisabled()
  await page.getByRole("button", { name: "Thêm hàng" }).click()
  await chonNcc(page)
  await page.getByRole("button", { name: "Xem phiếu" }).click()

  await page.getByRole("group", { name: "Lý do trả" }).getByRole("button", { name: "Hàng hư hỏng" }).click()
  await page.getByRole("group", { name: "Xuất từ kho" }).getByRole("button", { name: "Kho hàng bán" }).click()
  await expect(page.getByTestId("tong-phieu-ncc")).toHaveText("4.000đ")
  await page.getByRole("button", { name: "Gửi phiếu" }).click()
  await expect.poll(async () => !!(await goiCuoi("/rpc/complete_supplier_return"))).toBe(true)
  const dau = (await goiCuoi("/rest/v1/supplier_returns"))!.body as Record<string, unknown>
  expect(dau).toMatchObject({ reason: "damaged", warehouse_zone: "sale", status: "draft" })
})

test("nút chọn nhiều chỉ đổi khi bấm, nhớ qua lần mở sau; nhập và trả NCC nhớ riêng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  const nut = page.getByTestId("chon-nhieu")
  await expect(nut).toHaveAttribute("aria-pressed", "false")
  await nut.click()
  await page.reload()
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "true")
  await page.goto("/purchase-returns/new")
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "false")
  await page.goto("/purchasing/receipts/new")
  await page.getByTestId("chon-nhieu").click()
  await page.reload()
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "false")
})
