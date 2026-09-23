import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/**
 * ⚠ LỖI THẬT tìm ra khi chụp ảnh khối thống kê (23/09/2026): mọi trang
 *   dashboard báo "Hydration failed" — máy chủ vẽ nút "Ngoại tuyến"
 *   (Node ≥ 21 có `navigator` nhưng `onLine` undefined), trình duyệt thì
 *   không, và React vẽ lại cả trang. Chốt: các trang chính không có lỗi
 *   hydrate nào.
 */
test("không có lỗi hydrate ở các trang chính", async ({ page }) => {
  const loi: string[] = []
  page.on("pageerror", (e) => loi.push(String(e).slice(0, 200)))
  page.on("console", (m) => { if (m.type() === "error" && /hydrat|did not match/i.test(m.text())) loi.push(m.text().slice(0, 200)) })
  await dangNhap(page)
  for (const u of ["/orders", "/sales-invoices", "/returns", "/purchasing/receipts", "/notifications"]) {
    await page.goto(u)
    await page.waitForTimeout(1500)
  }
  expect(loi).toEqual([])
})
