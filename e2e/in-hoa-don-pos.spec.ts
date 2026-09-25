import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 25/09/2026: "Xem lại mẫu in hoá đơn từ pos. Mất hàng đổi trả. Lấy
 *   nguyên mẫu in hoá đơn thường ra mà copy". Tờ in POS phải GIỐNG HỆT tờ in
 *   của màn hóa đơn — cùng dòng hàng, cùng khối hàng đổi / trả, cùng tổng.
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"

test("in hóa đơn từ POS giống hệt in hóa đơn thường, có hàng đổi / trả", async ({ page }) => {
  const chen = (bang: string, rows: unknown[]) =>
    fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
  await chen("returns", [{
    id: "r-in-pos", org_id: "00000000-0000-4000-8000-0000000000a1", invoice_id: HOA_DON,
    customer_id: "00000000-0000-4000-8000-0000000000c1", status: "submitted", credit_note_amount: 40000,
    credit_with_invoice: true,
    lines: [
      { id: "rl-in1", unit_name: "hộp", quantity: 2, unit_price: 20000, line_total: 40000, is_exchange: false, product: { name: "Sữa hộp" } },
      { id: "rl-in2", unit_name: "gói", quantity: 1, unit_price: 5000, line_total: 5000, is_exchange: true, product: { name: "Mì tôm" } },
    ],
  }])
  try {
    await dangNhap(page)
    const doc = async (url: string) => {
      await page.goto(url)
      const to = page.locator(".print-only, [data-testid='to-in-hoa-don']").first()
      await expect(page.getByText("(Hàng trả)").first(), `${url}: mất hàng trả`).toBeVisible()
      await expect(page.getByText("(Hàng đổi)").first(), `${url}: mất hàng đổi`).toBeVisible()
      return (await (await to.count() ? to : page.locator("main")).innerText()).replace(/\s+/g, " ")
    }
    const thuong = await doc(`/sales-invoices/${HOA_DON}/print`)
    const pos = await doc(`/in/hoa-don/${HOA_DON}`)
    // Phần tờ in (từ tên hàng đầu tiên tới hết tổng) phải trùng khớp.
    const cat = (s: string) => s.slice(s.indexOf("STT") >= 0 ? s.indexOf("STT") : 0)
    expect(cat(pos)).toBe(cat(thuong))
  } finally {
    await fetch(`${FAKE}/rest/v1/returns?id=eq.r-in-pos`, { method: "DELETE" })
  }
})
