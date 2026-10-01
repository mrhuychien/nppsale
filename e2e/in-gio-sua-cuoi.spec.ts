import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 01/10/2026: "Sao không lấy luôn trường ngày trên hoá đơn" → chọn chỉ in NGÀY hoá đơn, bỏ hẳn giờ.
 *   HD-E2E-1: ngày hoá đơn 23/09/2026; lập lúc 08:00 UTC (15:00 giờ VN) — giờ đó không được lên tờ.
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"

test("tờ in hoá đơn (thường và POS) ghi ngày hoá đơn, không có giờ", async ({ page }) => {
  await dangNhap(page)
  for (const url of [`/sales-invoices/${HOA_DON}/print`, `/in/hoa-don/${HOA_DON}`]) {
    await page.goto(url)
    await expect(page.getByText("Ngày 23/09/2026", { exact: true }).first(), url).toBeVisible()
    await expect(page.getByText(/Ngày 23\/09\/2026 \d\d:\d\d/), url).toHaveCount(0)
  }
})
