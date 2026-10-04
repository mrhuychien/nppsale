import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ĐỘI TEST HOÁ ĐƠN — LỖI ĐÃ XÁC MINH (ĐỎ tới khi sửa). Xem tests/doi-hoa-don-loi.test.ts.
 *
 * Màn POS Xuất hàng: gõ số lượng lẻ 1,5 hộp × 20.000 → cột Thành tiền của dòng phải là 30.000 (đúng số máy chủ
 * ghi = SL × giá), nhưng `lineGross` làm tròn SL lên 2 → hiện 40.000.
 */
const soLuong = (page: Page, nhan: string) => page.getByRole("button", { name: new RegExp(`^${nhan} — đang là`) })

test("LỖI: SL lẻ 1,5 × 20.000 — Thành tiền dòng phải 30.000", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("50")
  await expect(page.getByLabel("Đơn giá dòng 1")).toHaveValue("20.000")
  await soLuong(page, "số lượng dòng 1").click()
  await page.getByLabel("số lượng dòng 1", { exact: true }).fill("1.5")
  await page.getByLabel("số lượng dòng 1", { exact: true }).press("Enter")
  const dong = page.getByTestId("dong-hoa-don").first()
  await expect(dong).toContainText("30.000")
  await expect(dong).not.toContainText("40.000")
})
