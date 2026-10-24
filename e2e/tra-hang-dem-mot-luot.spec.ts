import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: màn Trả hàng (máy tính) bắn 1 câu đếm tổng + 5 câu
 *   HEAD theo lý do mỗi lần mở. Nay MỘT câu `reason, count()`.
 */
type Luot = { method: string; path: string; query?: string }

test("Trả hàng (máy tính): số tổng + phân loại lý do đọc bằng MỘT câu gom nhóm, không còn câu HEAD đếm lẻ", async ({ page }) => {
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/returns")
  await expect(page.getByText("Phân loại lý do")).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(800)
  const ds = ((await nhatKy()) as Luot[]).slice(t).filter((x) => x.path === "/rest/v1/returns")
  const gom = ds.filter((x) => x.method === "GET" && decodeURIComponent(x.query ?? "").includes("select=reason,count()"))
  expect(gom.length, "một câu reason,count()").toBe(1)
  expect(ds.filter((x) => x.method === "HEAD").length, "không còn HEAD đếm lẻ").toBe(0)
  /* Số tổng ở mô tả đầu trang (khung máy tính + khung điện thoại cùng chữ — lấy cái đầu). */
  await expect(page.getByText(/^\d+ phiếu trả • Tra cứu thông tin/).first()).toBeVisible()
})
