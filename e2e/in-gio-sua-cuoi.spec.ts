import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 01/10/2026: "Thời gian trên phiếu là ngày giờ tạo chứ ko phải ngày giờ in" →
 *   "Giờ sửa cuối. Hiện tại đang giờ tạo lần đầu". HD-E2E-1 lập 23/09 15:00 (giờ VN).
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"

const traGioSua = (page: import("@playwright/test").Page, kq: { updated_at: string } | "loi") =>
  page.route(/\/rest\/v1\/sales_invoices\?.*select=updated_at/, (r) => {
    if (kq === "loi") return r.fulfill({ status: 400, json: { code: "42703", message: "column sales_invoices.updated_at does not exist" } })
    const motDong = (r.request().headers()["accept"] || "").includes("vnd.pgrst.object")
    return r.fulfill({ json: motDong ? kq : [kq] })
  })

test("tờ in hoá đơn mang giờ sửa cuối, không phải giờ tạo lần đầu", async ({ page }) => {
  await traGioSua(page, { updated_at: "2026-09-25T03:42:00Z" })
  await dangNhap(page)
  for (const url of [`/sales-invoices/${HOA_DON}/print`, `/in/hoa-don/${HOA_DON}`]) {
    await page.goto(url)
    await expect(page.getByText("Ngày 25/09/2026 10:42").first(), url).toBeVisible()
    await expect(page.getByText("Ngày 23/09/2026 15:00"), url).toHaveCount(0)
  }
})

test("chưa chạy mig 220 (chưa có cột giờ sửa): vẫn in được, ra giờ tạo", async ({ page }) => {
  await traGioSua(page, "loi")
  await dangNhap(page)
  await page.goto(`/sales-invoices/${HOA_DON}/print`)
  await expect(page.getByText("Ngày 23/09/2026 15:00").first()).toBeVisible()
})
