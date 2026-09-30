import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: làm lại màn Phiếu nhập kho trên điện thoại theo thiết kế "phieu-nhap" —
 *   đầu trắng (← Nhập kho · Phiếu mới · nháp · Huỷ nháp), Thông tin chung, Mặt hàng (ô tìm + quét mã,
 *   khung nét đứt khi trống), thanh đáy "N mặt hàng · N đơn vị" + tổng tiền + nút chính.
 *   Lệnh ghi giữ nguyên: RPC `post_stock_import`, lô theo đơn vị cơ sở.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test("phiếu nhập kho điện thoại: trống thì khoá nút, thêm hàng đổi thùng, ghi qua post_stock_import", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/stock-in")
  const man = page.getByTestId("nhap-kho-mobile")
  await expect(man).toBeVisible()
  await expect(man.getByTestId("dau-trang")).toContainText("Nhập kho")
  await expect(man.getByTestId("dau-trang")).toContainText("Phiếu mới · nháp")
  await expect(man.getByRole("button", { name: "Huỷ nháp" })).toBeVisible()
  await expect(man.getByText("Thông tin chung")).toBeVisible()
  await expect(man.getByTestId("nk-m-trong")).toHaveText("Chưa có mặt hàng. Tìm hoặc quét mã để thêm.")

  const bar = page.getByTestId("nk-m-thanh-day")
  await expect(bar).toContainText("0 mặt hàng · 0 đơn vị")
  await expect(bar.getByRole("button", { name: "Thêm ít nhất 1 mặt hàng" })).toBeDisabled()
  // Màn tự có thanh đáy → không có nav đáy chồng lên.
  await expect(page.locator("nav.fixed.bottom-0")).toHaveCount(0)

  await man.getByPlaceholder("Thêm mặt hàng: tên hoặc mã SKU").fill("Sữa")
  await man.getByRole("button", { name: /Sữa hộp/ }).first().click()
  await expect(man.getByTestId("nk-m-dong")).toHaveCount(1)
  await expect(man.getByTestId("nk-m-trong")).toHaveCount(0)

  const dong = man.getByTestId("nk-m-dong").first()
  // Ô đơn vị là ô chọn chung của app (CompactSelect), không phải <select> gốc.
  await dong.getByLabel("Đơn vị Sữa hộp").click()
  await page.getByRole("option", { name: "thùng", exact: true }).click()
  await dong.getByRole("button", { name: "Tăng Sữa hộp" }).click()
  // 2 thùng × 24 = 48 đơn vị cơ sở; giá thùng 450.000 → 900.000đ.
  await expect(bar).toContainText("1 mặt hàng · 48 đơn vị")
  await expect(page.getByTestId("nk-m-tong")).toHaveText(/900\.000/)

  await dong.getByRole("button", { name: /Lô tự sinh · chưa có HSD/ }).click()
  await dong.getByTestId("nk-m-lo").getByPlaceholder("Tự sinh").fill("L-E2E")
  await expect(dong).toContainText("L-E2E · chưa có HSD")

  await bar.getByRole("button", { name: "Xác nhận nhập kho" }).click()
  await expect
    .poll(async () => (await nhatKy()).filter((r) => r.method === "POST" && r.path.includes("post_stock_import")).length)
    .toBeGreaterThan(0)
  const goi = (await nhatKy()).filter((r) => r.method === "POST" && r.path.includes("post_stock_import")).at(-1)
  const p = (goi?.body as { p: { lines: Array<Record<string, unknown>> } }).p
  expect(p.lines).toHaveLength(1)
  expect(p.lines[0]).toMatchObject({ unit_name: "thùng", qty_tx: 2, conv: 24, base_qty: 48, batch_code: "L-E2E" })
})
