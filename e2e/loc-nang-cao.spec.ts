import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Rà soát lại các màn danh sách … form chung giống danh
 *   sách đơn hàng hiện tại nhưng thêm phần bộ lọc nâng cao (cho chọn trường bất
 *   kỳ để lọc giá trị)".
 *
 * Mẫu: DH-0001 1.000.000 · DH-0002 2.000.000 · DH-0003 5.000.000 · DH-0004 (huỷ) 9.000.000.
 */
async function chon(page: Page, nhan: string, luaChon: string) {
  await page.getByRole("combobox", { name: nhan }).click()
  await page.getByRole("option", { name: luaChon, exact: true }).click()
}

test("đơn hàng: lọc nâng cao theo Tổng tiền ≥ và trong khoảng, ghép VÀ, nhớ khi quay lại", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  await expect(page.getByText("DH-0001").first()).toBeVisible()

  await page.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).first().click()
  await chon(page, "Trường điều kiện 1", "Tổng tiền")
  await chon(page, "Phép so điều kiện 1", "≥ (từ)")
  await page.getByLabel("Giá trị điều kiện 1", { exact: true }).fill("2000000")
  await page.getByRole("button", { name: "Áp dụng" }).click()
  await expect(page.getByText("DH-0001")).toHaveCount(0)
  await expect(page.getByText("DH-0002").first()).toBeVisible()
  await expect(page.getByText("DH-0003").first()).toBeVisible()

  // Thêm điều kiện thứ hai (VÀ): Mã đơn có chứa 0003 → chỉ còn DH-0003.
  await page.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).first().click()
  await page.getByRole("button", { name: "Thêm điều kiện" }).click()
  await chon(page, "Trường điều kiện 2", "Mã đơn")
  await page.getByLabel("Giá trị điều kiện 2", { exact: true }).fill("0003")
  await page.getByRole("button", { name: "Áp dụng" }).click()
  await expect(page.getByText("DH-0002")).toHaveCount(0)
  await expect(page.getByText("DH-0003").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).first()).toContainText("2")

  // Quay lại màn: điều kiện còn nguyên.
  await page.reload()
  await chonKy(page, "Tất cả") // kỳ mặc định là Tháng này; DH-0003 thuộc 2025
  await expect(page.getByText("DH-0002")).toHaveCount(0)
  await expect(page.getByText("DH-0003").first()).toBeVisible()

  // "Trong khoảng" 900.000–1.500.000 thay điều kiện 1, bỏ điều kiện 2 → chỉ DH-0001.
  await page.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).first().click()
  await page.getByRole("button", { name: "Bỏ điều kiện 2" }).click()
  await chon(page, "Phép so điều kiện 1", "trong khoảng")
  await page.getByLabel("Giá trị điều kiện 1", { exact: true }).fill("900000")
  await page.getByLabel("Đến giá trị điều kiện 1", { exact: true }).fill("1500000")
  await page.getByRole("button", { name: "Áp dụng" }).click()
  await expect(page.getByText("DH-0001").first()).toBeVisible()
  await expect(page.getByText("DH-0002")).toHaveCount(0)

  // Xoá hết → về đủ.
  await page.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).first().click()
  await page.getByRole("button", { name: "Xoá hết" }).click()
  await expect(page.getByText("DH-0002").first()).toBeVisible()
})

test("khách hàng: lọc nâng cao theo trường bất kỳ (Hạn mức công nợ)", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/customers")
  await page.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).first().click()
  await chon(page, "Trường điều kiện 1", "Tên cửa hàng")
  await page.getByLabel("Giá trị điều kiện 1", { exact: true }).fill("Cô Ba")
  await page.getByRole("button", { name: "Áp dụng" }).click()
  await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()
  await expect(page.getByText("Đại lý Minh")).toHaveCount(0)
})

/* Hóa đơn: hàm lọc là useCallback — thiếu phụ thuộc là điều kiện mới không áp (lỗi tìm ra 24/09/2026). */
test("hóa đơn bán: lọc nâng cao Tổng tiền ≥ áp ngay", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices")
  await chonKy(page, "Tất cả")
  await expect(page.getByText("HD-E2E-2").first()).toBeVisible()
  await page.getByRole("button", { name: "Bộ lọc nâng cao", exact: true }).first().click()
  await chon(page, "Trường điều kiện 1", "Tổng tiền")
  await chon(page, "Phép so điều kiện 1", "≥ (từ)")
  await page.getByLabel("Giá trị điều kiện 1", { exact: true }).fill("500000")
  await page.getByRole("button", { name: "Áp dụng" }).click()
  await expect(page.getByText("HD-E2E-2")).toHaveCount(0)
  await expect(page.getByText("HD-E2E-1").first()).toBeVisible()
})
