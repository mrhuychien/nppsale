import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ BÁO 23/09/2026 (POS Trả hàng):
 *   - "Lưu đơn hàng trả lỗi … null value in column line_total … (23502)"
 *   - "chưa gán được nhân viên"
 *   - "phần dòng hàng các chi tiết ko giống làm đơn hàng, làm cho giống"
 */
const oTim = (page: Page) => page.getByPlaceholder("Tên hàng, mã hàng…")

test("trả hàng POS: dòng giống đơn hàng, lưu có line_total, gán người phụ trách khi lưu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-hang/moi")
  await chonKhach(page, "Đại lý Minh")
  await oTim(page).fill("Sữa")
  await oTim(page).press("Enter")

  const dong = page.getByTestId("dong-tra")
  await expect(dong).toHaveCount(1)
  // Khuôn dòng như màn đơn hàng: chip đơn vị, ghi chú dòng, bước số lượng.
  await expect(dong.getByRole("button", { name: "Đơn vị hộp dòng trả 1" })).toHaveAttribute("aria-pressed", "true")
  await dong.getByRole("button", { name: "Đơn vị thùng dòng trả 1" }).click()
  await expect(page.getByLabel("Đơn giá dòng 1")).toHaveValue("450.000")
  await page.getByLabel("Ghi chú dòng trả 1").fill("móp thùng")
  await page.getByRole("button", { name: "Tăng số lượng trả dòng 1", exact: true }).click()

  // Phiếu MỚI: chủ NPP chọn người phụ trách trước khi lưu.
  await page.getByRole("button", { name: "Gán đơn cho nhân viên bán hàng" }).click()
  await page.getByRole("listitem").filter({ hasText: "Chủ NPP" }).first().click()

  await page.getByRole("button", { name: "Lưu nháp" }).click()
  await expect.poll(async () =>
    (await nhatKy()).some((r) => r.method === "POST" && r.path.endsWith("/rest/v1/return_lines"))
  ).toBe(true)
  const log = await nhatKy()
  const chen = log.filter((r) => r.method === "POST" && r.path.endsWith("/rest/v1/return_lines")).at(-1)!
  const rows = (Array.isArray(chen.body) ? chen.body : [chen.body]) as Array<Record<string, unknown>>
  expect(rows[0], "thiếu line_total — lỗi 23502").toMatchObject({ unit_name: "thùng", unit_price: 450000, note: "móp thùng" })
  expect(rows[0].quantity).toBe(2)
  expect(rows[0].line_total).toBe(900000)

  await expect.poll(async () =>
    (await nhatKy()).filter((r) => r.path.endsWith("/rpc/assign_doc_seller")).at(-1)?.body ?? null
  ).toMatchObject({ p_kind: "return", p_user: "00000000-0000-4000-8000-0000000000b1" })

  const id = rows[0].return_id as string
  await fetch(`${FAKE}/rest/v1/return_lines?return_id=eq.${id}`, { method: "DELETE" })
  await fetch(`${FAKE}/rest/v1/returns?id=eq.${id}`, { method: "DELETE" })
})
