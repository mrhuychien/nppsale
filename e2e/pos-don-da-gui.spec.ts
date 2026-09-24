import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ CHỐT 24/09/2026: "Sau khi gửi đơn -> Các nút chuyển thành: In ·
 *   Tạo hoá đơn · Lưu (trường hợp thay đổi sau khi tạo ngay trên màn hình đó)".
 */
test("POS đơn đã gửi: In · Tạo hoá đơn · Lưu — Lưu chỉ bật khi có thay đổi", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/don-hang/o-e2e-1")
  const luu = page.getByRole("button", { name: "Lưu (F9)", exact: true })
  const taoHD = page.getByRole("button", { name: "Tạo hoá đơn", exact: true })
  await expect(page.getByRole("button", { name: "In", exact: true })).toBeVisible()
  await expect(taoHD).toBeEnabled()
  await expect(luu, "chưa đổi gì mà Lưu đã bật").toBeDisabled()
  await expect(page.getByRole("button", { name: /Lưu nháp/ }), "đơn đã gửi còn nút Lưu nháp").toHaveCount(0)
  await expect(page.getByRole("button", { name: /Gửi đơn/ })).toHaveCount(0)

  // Đổi trên màn: Lưu bật, Tạo hoá đơn tắt (phải lưu trước).
  await page.getByRole("button", { name: "Tăng số lượng dòng 1", exact: true }).click()
  await expect(luu).toBeEnabled()
  await expect(taoHD).toBeDisabled()

  // Tải lại (bỏ thay đổi): Tạo hoá đơn đưa sang màn xuất hàng của đơn.
  await page.reload()
  await expect(taoHD).toBeEnabled()
  await taoHD.click()
  await expect(page).toHaveURL(/\/pos\/hoa-don\/moi\?order=o-e2e-1/)
})

test("POS đơn mới (nháp): vẫn đúng hai nút Lưu nháp · Gửi đơn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/don-hang/moi")
  await expect(page.getByRole("button", { name: /Lưu nháp \(F6\)/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Gửi đơn \(F9\)/ })).toBeVisible()
  await expect(page.getByRole("button", { name: "Tạo hoá đơn", exact: true })).toHaveCount(0)
})
