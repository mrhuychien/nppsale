import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ĐỘI TEST HOÁ ĐƠN — luồng màn POS Xuất hàng (tải trọng post_invoice thật mà màn gửi đi).
 * Luật: CLAUDE.md §1 — ngày HĐ theo giờ VN; xuất thiếu vẫn là MỘT hoá đơn; giảm giá đơn gửi số (kể cả 0) để Sửa HĐ
 * không lẫn với "giữ giảm cũ"; dòng bám dòng đơn.
 * Đồng hồ trình duyệt ghim 30/09/2026 10:00 giờ VN (helpers.HOM_NAY_E2E).
 */
const soLuong = (page: Page, nhan: string) => page.getByRole("button", { name: new RegExp(`^${nhan} — đang là`) })
async function datSo(page: Page, nhan: string, v: number) {
  await soLuong(page, nhan).click()
  await page.getByLabel(nhan, { exact: true }).fill(String(v))
  await page.getByLabel(nhan, { exact: true }).press("Enter")
}
const goiPost = async () => (await nhatKy()).filter((r) => r.path.endsWith("/rpc/post_invoice"))

test("xuất thiếu 30/50 trên POS: một lời gọi post_invoice, ngày HĐ = ngày VN, đúng dòng / giá / giảm 0", async ({ page }) => {
  await dangNhap(page)
  const truoc = (await goiPost()).length
  await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
  await expect(page.getByRole("heading", { name: /Xuất hàng · lập hóa đơn/ })).toBeVisible()
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("50")
  await datSo(page, "số lượng dòng 1", 30)
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("30")

  const nut = page.getByRole("button", { name: /Xuất hàng & lập HĐ/ })
  await nut.click()
  await expect.poll(async () => (await goiPost()).length).toBe(truoc + 1)
  const p = ((await goiPost()).at(-1)!.body as { p: Record<string, unknown> }).p as {
    order_id: string; invoice_date: string; discount: number; lines: Array<Record<string, unknown>>
  }
  expect(p.order_id).toBe("o-e2e-1")
  expect(p.invoice_date, "ngày HĐ phải là ngày VN của máy người dùng").toBe("2026-09-30")
  expect(p.discount).toBe(0)
  expect(p.lines).toHaveLength(1)
  expect(p.lines[0]).toMatchObject({ order_line_id: "sol1", quantity: 30, unit_name: "hộp", conversion_factor: 1 })
  expect(Number(p.lines[0].unit_price)).toBeGreaterThan(0)
  // Màn chuyển sang hoá đơn vừa lập — không ở lại để bấm lần hai.
  await expect(page).not.toHaveURL(/\/pos\/hoa-don\/moi/)
  expect((await goiPost()).length, "gửi hai lần").toBe(truoc + 1)
})

test("số lượng 0 ở mọi dòng: không gọi máy chủ", async ({ page }) => {
  await dangNhap(page)
  const truoc = (await goiPost()).length
  await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("50")
  await datSo(page, "số lượng dòng 1", 0)
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("0")
  const nut = page.getByRole("button", { name: /Xuất hàng & lập HĐ/ })
  if (await nut.isEnabled()) await nut.click()
  await page.waitForTimeout(500)
  expect((await goiPost()).length).toBe(truoc)
  await expect(page).toHaveURL(/\/pos\/hoa-don\/moi/)
})

test("số lượng lẻ 1,5 được gửi nguyên 1,5 (máy chủ nhận numeric)", async ({ page }) => {
  await dangNhap(page)
  const truoc = (await goiPost()).length
  await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
  await expect(soLuong(page, "số lượng dòng 1")).toHaveText("50")
  await datSo(page, "số lượng dòng 1", 1.5)
  await page.getByRole("button", { name: /Xuất hàng & lập HĐ/ }).click()
  await expect.poll(async () => (await goiPost()).length).toBe(truoc + 1)
  const p = ((await goiPost()).at(-1)!.body as { p: { lines: Array<Record<string, unknown>> } }).p
  expect(p.lines[0]).toMatchObject({ order_line_id: "sol1", quantity: 1.5 })
})
