import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026: "Phần sản phẩm chi tiết, ô số đơn vị quy đổi nhỏ quá ko hiển thị được số"
 *   — tên đơn vị cơ sở dài ("Hộp sắt hình hoa") ép ô số về gần 0.
 */
const SUA = "00000000-0000-4000-8000-0000000000d1"
const doiDv = (base_unit: string) =>
  fetch(`${FAKE}/rest/v1/products?id=eq.${SUA}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ base_unit }) })

test.afterEach(async () => {
  await doiDv("hộp")
})

test("ô số quy đổi đủ rộng để thấy số, kể cả khi tên đơn vị cơ sở dài", async ({ page }) => {
  await doiDv("Hộp sắt hình hoa")
  await dangNhap(page)
  await page.goto(`/products/${SUA}`)
  const o = page.getByRole("spinbutton", { name: /^Số Hộp sắt hình hoa trong 1 thùng$/ })
  await expect(o).toHaveValue("24")
  const box = await o.boundingBox()
  expect(box?.width ?? 0, "ô số quy đổi").toBeGreaterThanOrEqual(80)
})
