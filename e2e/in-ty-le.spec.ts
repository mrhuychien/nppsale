import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 28/09/2026: "khi in chỉnh tỷ lệ trong khổ cố định. VD tỷ lệ 80% chữ đột nhiên to ra
 *   như 100%, tỷ lệ 80% lại to hơn 81-82% rất nhiều".
 *
 * Chromium tính `@media print (min-width)` trên bề rộng vùng in ÷ tỷ lệ (đo bằng page.pdf: A5 ở
 * 80% báo ~165mm). Chốt này dựng lại đúng điều ấy: media in + viewport = vùng in ÷ tỷ lệ, đọc cỡ
 * chữ tờ in, nhân tỷ lệ = cỡ trên giấy. Trong khoảng đã chốt, hạ tỷ lệ thì chữ PHẢI nhỏ đi.
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const MM = 96 / 25.4
/** Vùng in (khổ − 2 × lề 8mm). */
const VUNG = { A5: 148 - 16, A4: 210 - 16 } as const

async function coChuTrenGiay(page: Page, kho: keyof typeof VUNG, tyLe: number): Promise<number> {
  await page.setViewportSize({ width: Math.round((VUNG[kho] * MM) / tyLe), height: 900 })
  const px = await page.locator(".a4-doc").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  return px * tyLe
}

test("in theo tỷ lệ: cùng khổ, hạ tỷ lệ thì chữ nhỏ đi — không nhảy to ở 80%", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/in/hoa-don/${HOA_DON}`)
  await expect(page.locator(".a4-doc").first()).toBeVisible()
  await page.emulateMedia({ media: "print" })

  for (const [kho, cacTyLe] of [
    ["A5", [1, 0.95, 0.9, 0.85, 0.83, 0.82, 0.81, 0.8, 0.75, 0.72]],
    ["A4", [1.04, 1, 0.9, 0.82, 0.8, 0.75, 0.72]],
  ] as const) {
    const co: number[] = []
    for (const t of cacTyLe) co.push(await coChuTrenGiay(page, kho, t))
    for (let i = 1; i < co.length; i++) {
      expect(co[i], `${kho}: ${cacTyLe[i]} (${co[i].toFixed(2)}px) to hơn ${cacTyLe[i - 1]} (${co[i - 1].toFixed(2)}px)`).toBeLessThan(co[i - 1])
    }
  }
  // Khổ lớn vẫn chữ lớn hơn ở cùng tỷ lệ 100% (giữ "tự giãn theo khổ").
  expect(await coChuTrenGiay(page, "A4", 1)).toBeGreaterThan(await coChuTrenGiay(page, "A5", 1))
})
