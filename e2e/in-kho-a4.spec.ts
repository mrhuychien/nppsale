import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Trong các trang in hiện tại (Đơn hàng/hoá đơn/trả hàng) đang
 *   mặc định A5, tôi muốn khi chọn khổ A4, tự giãn ra đầy trang."
 *   Lỗi cũ (đo bằng PDF): chọn A4 vẫn ra trang 148 × 210 mm — `html[…] @page` là CSS
 *   sai, trình duyệt bỏ qua. Chốt: bấm In → Khổ A4 → PDF đúng 210 × 297 mm, chữ to ra.
 */
const khoMm = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\]/) ?? []).slice(1).map((x) => Math.round((Number(x) / 72) * 25.4))

/** Chặn hộp in thật; GIỮ khổ giấy mà code đặt ngay lúc gọi `window.print()` để đo. */
async function chanIn(page: Page) {
  await page.addInitScript(() => {
    const goc = window.addEventListener.bind(window)
    // Trang in tự rời màn sau `afterprint` — xuất PDF cũng bắn sự kiện ấy.
    window.addEventListener = ((t: string, ...a: unknown[]) => (t === "afterprint" ? undefined : (goc as never as (...x: unknown[]) => void)(t, ...a))) as typeof window.addEventListener
    window.print = () => {
      const w = window as unknown as { __kho: { rule: string; attr: string | null } }
      w.__kho = { rule: document.getElementById("npp-kho-giay-in")?.textContent ?? "", attr: document.documentElement.getAttribute("data-paper-size") }
      const giu = document.createElement("style")
      giu.id = "giu-kho"
      giu.textContent = w.__kho.rule
      document.head.appendChild(giu)
    }
  })
}

const TRANG = [
  ["hóa đơn", "/sales-invoices/00000000-0000-4000-8000-0000000000f1/print", /In hóa đơn/],
  ["đơn hàng", "/orders/o-e2e-1/print", /In đơn hàng/],
  ["phiếu trả", "/returns/r-e2e-1/print", /In/],
] as const

for (const [ten, url, nut] of TRANG) {
  test(`in ${ten}: chọn Khổ A4 → trang A4 thật, chữ giãn đầy trang`, async ({ page }) => {
    await chanIn(page)
    await dangNhap(page)
    await page.goto(url)
    await page.getByRole("button", { name: nut }).first().click()
    await page.getByRole("menuitem", { name: /Khổ A4/ }).click()
    const kho = await page.evaluate(() => (window as unknown as { __kho: { rule: string; attr: string | null } }).__kho)
    expect(kho.rule).toContain("size: A4 portrait")
    expect(kho.attr).toBe("A4")

    // Giữ đúng trạng thái lúc in để đo. Code tự trả về A5 sau 200 ms — đợi qua mốc ấy
    // rồi mới đặt lại, không thì phép trả về chen giữa lúc đo.
    await page.waitForTimeout(500)
    await expect.poll(() => page.evaluate(() => document.getElementById("npp-kho-giay-in"))).toBeNull()
    await page.evaluate(() => document.documentElement.setAttribute("data-paper-size", "A4"))
    await page.emulateMedia({ media: "print" })
    expect(khoMm(await page.pdf({ preferCSSPageSize: true }))).toEqual([210, 297])
    const co = await page.evaluate(() => getComputedStyle(document.querySelector(".a4-doc")!).fontSize)
    expect(parseFloat(co), "A4 phải to hơn cỡ A5 (14px = 10,5pt)").toBeGreaterThan(18)

    // Không chọn gì → vẫn A5 như cũ.
    await page.evaluate(() => { document.getElementById("giu-kho")?.remove(); document.documentElement.removeAttribute("data-paper-size") })
    expect(khoMm(await page.pdf({ preferCSSPageSize: true }))).toEqual([148, 210])
  })
}
