import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "tao muốn chọn khổ nào thì tràn ra khổ đấy trên hộp thoại in
 *   của trình duyệt" (Đơn hàng / Hoá đơn / Trả hàng).
 *   · Chọn khổ trong hộp thoại = `page.pdf({ format })`. Có `preferCSSPageSize` mà PDF
 *     vẫn đúng khổ đã chọn → CSS không ép khổ (bản cũ ép A5: chọn A4 vẫn ra 148 × 210).
 *   · Chữ giãn theo bề rộng vùng in của khổ đó (lề 8mm mỗi bên).
 */
const khoMm = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/) ?? []).slice(1).map((x) => Math.round((Number(x) / 72) * 25.4))

const mmPx = (mm: number) => Math.floor((mm * 96) / 25.4)
const KHO = [
  // khổ, kích thước mm, bề rộng vùng in (trừ lề 2 × 8mm), cỡ chữ thân tối thiểu (px)
  ["A5", [148, 210], 148 - 16, 14],
  ["A4", [210, 297], 210 - 16, 19],
  ["A3", [297, 420], 297 - 16, 28],
] as const

/** Chặn hộp in thật và việc trang in tự rời màn sau `afterprint` (xuất PDF cũng bắn). */
async function chanIn(page: Page) {
  await page.addInitScript(() => {
    const goc = window.addEventListener.bind(window)
    window.addEventListener = ((t: string, ...a: unknown[]) => (t === "afterprint" ? undefined : (goc as never as (...x: unknown[]) => void)(t, ...a))) as typeof window.addEventListener
    window.print = () => {
      const w = window as unknown as { __soLanIn?: number }
      w.__soLanIn = (w.__soLanIn ?? 0) + 1
    }
  })
}

const TRANG = [
  ["hóa đơn", "/sales-invoices/00000000-0000-4000-8000-0000000000f1/print", /In hóa đơn/],
  ["đơn hàng", "/orders/o-e2e-1/print", /In đơn hàng/],
  ["phiếu trả", "/returns/r-e2e-1/print", /In phiếu trả/],
] as const

for (const [ten, url, nut] of TRANG) {
  test(`in ${ten}: chọn khổ nào trong hộp thoại thì tràn ra khổ đấy`, async ({ page }) => {
    await chanIn(page)
    await dangNhap(page)
    await page.goto(url)

    // Bấm In là mở thẳng hộp thoại — không còn dropdown ép khổ.
    await page.getByRole("button", { name: nut }).first().click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __soLanIn?: number }).__soLanIn ?? 0)).toBe(1)
    await expect(page.getByRole("menuitem")).toHaveCount(0)

    await page.emulateMedia({ media: "print" })
    for (const [kho, mm, rongIn, coToiThieu] of KHO) {
      expect(khoMm(await page.pdf({ format: kho, preferCSSPageSize: true })), `chọn ${kho}`).toEqual(mm)
      await page.setViewportSize({ width: mmPx(rongIn), height: 900 })
      const co = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".a4-doc")!).fontSize))
      expect(co, `cỡ chữ ở khổ ${kho}`).toBeGreaterThanOrEqual(coToiThieu)
      expect(co, `cỡ chữ ở khổ ${kho}`).toBeLessThan(coToiThieu + 3)
    }
  })
}
