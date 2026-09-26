import { test, expect } from "@playwright/test"
import { dangNhap, chonKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "phần lọc trạng thái ở các danh sách cho phép chọn nhiều
 *   trạng thái để lọc. VD hiện tất cả các trạng thái trừ Hủy, bấm chọn được
 *   nhiều trạng thái 1 lúc ấy".
 */
test("đơn hàng: chọn Phiếu tạm + Hoàn thành cùng lúc = mọi thứ trừ Đã huỷ", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/orders")
  await chonKy(page, "Tất cả")
  const chip = (k: string) => page.locator(`[data-status-chip="${k}"]`).first()
  const dong = (ma: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name: ma, exact: true }) })
  await expect(dong("DH-0004")).toHaveCount(1) // đơn huỷ đang hiện ở "Tất cả"

  /* ⚠ Chủ nhà 25/09/2026: "Khi ấn vào tất cả thì chọn hết các trạng thái luôn" — từ Tất
     cả bấm một chip là TẮT nó; nên bấm "Đã huỷ" = Phiếu tạm + Hoàn thành (mọi thứ trừ huỷ). */
  // Đang "Tất cả" (sáng hết) — bấm thêm lần nữa là bỏ chọn hết (chủ nhà 26/09/2026), nên
  // không bấm; bấm "Đã huỷ" tắt riêng nó.
  await expect(chip("all")).toHaveAttribute("aria-pressed", "true")
  await expect(chip("submitted")).toHaveAttribute("aria-pressed", "true")
  await chip("cancelled").click()
  await expect(chip("cancelled")).toHaveAttribute("aria-pressed", "false")
  await expect(chip("submitted")).toHaveAttribute("aria-pressed", "true")
  await expect(chip("completed")).toHaveAttribute("aria-pressed", "true")
  await expect(chip("all")).toHaveAttribute("aria-pressed", "false")

  await expect(dong("DH-0001")).toHaveCount(1) // phiếu tạm
  await expect(dong("DH-0002")).toHaveCount(1) // hoàn thành
  await expect(dong("DH-0003")).toHaveCount(1)
  await expect(dong("DH-0004")).toHaveCount(0) // đã huỷ — bị loại

  // Tắt bớt một chip → chỉ còn nhóm kia.
  await chip("completed").click()
  await expect(dong("DH-0002")).toHaveCount(0)
  await expect(dong("DH-0001")).toHaveCount(1)

  // "Tất cả" chọn hết lại.
  await chip("all").click()
  await expect(chip("submitted")).toHaveAttribute("aria-pressed", "true")
  await expect(chip("cancelled")).toHaveAttribute("aria-pressed", "true")
  await expect(dong("DH-0004")).toHaveCount(1)

  /* ⚠ Chủ nhà 26/09/2026: "ấn thêm 1 lần vào tất cả thì bỏ chọn tất cả các trạng thái". */
  await chip("all").click()
  for (const k of ["all", "submitted", "completed", "cancelled"]) await expect(chip(k)).toHaveAttribute("aria-pressed", "false")
  await expect(dong("DH-0001")).toHaveCount(0)
  await expect(dong("DH-0004")).toHaveCount(0)
  await chip("completed").click() // từ bỏ-hết bấm một chip = chỉ chip đó
  await expect(dong("DH-0002")).toHaveCount(1)
  await expect(dong("DH-0001")).toHaveCount(0)
})

test("phiếu trả: bấm chọn nhiều trạng thái", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/returns")
  const chip = (k: string) => page.locator(`[data-status-chip="${k}"]`).first()
  await expect(chip("submitted")).toHaveAttribute("aria-pressed", "true") // mặc định Chờ xử lý
  await chip("completed").click()
  await expect(chip("submitted")).toHaveAttribute("aria-pressed", "true")
  await expect(chip("completed")).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()
})
