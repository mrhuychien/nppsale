import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy, FAKE, chonDonVi, theoDoiIn } from "./helpers"

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
  // Khuôn dòng như màn đơn hàng: thùng rác đầu dòng, nút đơn vị bấm-nhảy, ghi chú dòng, bước số lượng.
  await expect(dong.getByRole("button", { name: "Xoá dòng trả 1" })).toBeVisible()
  await expect(dong.getByRole("button", { name: /^Đơn vị dòng trả 1 — đang là hộp,/ })).toBeVisible()
  await chonDonVi(dong, "dòng trả 1", "thùng")
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
  /* ⚠ Lấy ĐÚNG lượt chèn của chốt này (ghi chú "móp thùng") — các chốt khác chạy
     song song cũng chèn return_lines, lấy lượt cuối là đọc nhầm của người khác. */
  const cuaToi = (b: unknown) =>
    (Array.isArray(b) ? b : [b]).some((r) => (r as { note?: string }).note === "móp thùng")
  await expect.poll(async () =>
    (await nhatKy()).some((r) => r.method === "POST" && r.path.endsWith("/rest/v1/return_lines") && cuaToi(r.body))
  ).toBe(true)
  const log = await nhatKy()
  const chen = log.filter((r) => r.method === "POST" && r.path.endsWith("/rest/v1/return_lines") && cuaToi(r.body)).at(-1)!
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

/** ⚠ CHỦ NHÀ 24/09/2026: "Trả hàng, in đơn tại chỗ ko cần mở tab. Chỉ bật cửa sổ in". */
test("trả hàng POS: nút In in tại chỗ bằng mẫu phiếu trả, không mở tab", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-hang/r-e2e-0")
  const inAn = await theoDoiIn(page)
  const nut = page.getByRole("button", { name: "In", exact: true })
  await expect(nut).toBeEnabled()
  await nut.click()
  await expect.poll(inAn.khung).toContainEqual("/returns/r-e2e-0/print?auto=1")
  expect(inAn.tabMoi()).toBe(0)
  // Mẫu in phiếu trả có thật.
  await page.goto("/returns/r-e2e-0/print")
  await expect(page.getByRole("heading", { name: "PHIẾU TRẢ HÀNG", exact: true })).toBeVisible()
  await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()
})
