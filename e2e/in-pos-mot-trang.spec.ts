import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Mẫu in hóa đơn trên pos luôn in ra 1 trang trắng phía
 *   sau dù đơn ngắn". Đo bằng PDF theo đúng `@page` của mẫu: chứng từ ngắn = 1 tờ.
 *   Gốc lỗi: `min-h-screen` ở khung `/in/*` — 100vh khi in lớn hơn vùng in.
 */
const TRANG = [
  ["hóa đơn", "/in/hoa-don/00000000-0000-4000-8000-0000000000f1", "HD-E2E-1"],
  ["đơn hàng", "/in/don-hang/o-e2e-1", "DH-0001"],
  ["phiếu trả", "/in/tra-hang/r-e2e-1", "PHIẾU TRẢ HÀNG"],
] as const

for (const [ten, url, cho] of TRANG) {
  test(`in ${ten} qua POS: chứng từ ngắn ra đúng 1 tờ, không tờ trắng`, async ({ page }) => {
    await dangNhap(page)
    await page.goto(url)
    await expect(page.getByText(cho).first()).toBeVisible()
    await page.emulateMedia({ media: "print" })
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    const soTo = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(soTo, `${ten} in ra ${soTo} tờ`).toBe(1)
  })
}
