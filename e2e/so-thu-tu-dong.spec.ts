import { test, expect } from "@playwright/test"
import { dangNhap } from "./helpers"

/** ⚠ CHỦ NHÀ 02/10/2026: "các màn làm đơn trên di động thêm số thứ tự đầu dòng". */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

test("giỏ /sell: mỗi dòng có số thứ tự 1, 2… đầu dòng, xoá dòng thì đánh lại", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("npp.sell.chon-nhieu", "1"))
  await dangNhap(page)
  await page.goto("/sell")
  await page.getByRole("button", { name: "Thêm Sữa hộp", exact: true }).click()
  await page.getByRole("button", { name: "Thêm Mì tôm", exact: true }).click()
  await page.getByRole("button", { name: "Xem đơn" }).click()
  const dong = page.getByTestId("dong-gio")
  await expect(dong).toHaveCount(2)
  await expect(dong.nth(0).getByTestId("stt-dong")).toHaveText("1")
  await expect(dong.nth(1).getByTestId("stt-dong")).toHaveText("2")
  // Số đứng ĐẦU dòng — trước tên hàng.
  const so = (await dong.nth(1).getByTestId("stt-dong").boundingBox())!
  const ten = (await dong.nth(1).getByRole("button").first().boundingBox())!
  expect(so.x).toBeLessThan(ten.x)
  await dong.nth(0).getByRole("button", { name: /^Xoá / }).click()
  await expect(dong).toHaveCount(1)
  await expect(dong.nth(0).getByTestId("stt-dong")).toHaveText("1")
})
