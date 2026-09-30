import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026 gửi thiết kế "Kiểm kê" + "Duyệt điều chỉnh" cho điện thoại.
 *   Kiểm kê (/inventory/stocktake-adjust): dải Hao hụt / Thừa / Chênh ròng, thẻ dòng có "Khớp",
 *   thanh đáy Huỷ + nút chính. Duyệt điều chỉnh (/inventory/adjustments): thẻ phiếu chờ duyệt,
 *   Huỷ phiếu / Duyệt điều chỉnh qua RPC có sẵn.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const goiCuoi = async (duong: string, method = "POST") =>
  (await nhatKy()).filter((r) => r.method === method && r.path.includes(duong)).at(-1)

test("kiểm kê trên điện thoại: tải tồn, Khớp, đếm lệch, gửi phiếu nháp rồi sang màn duyệt", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/stocktake-adjust")
  const man = page.getByTestId("kiem-ke-mobile")
  await expect(man.getByRole("heading", { name: "Kiểm kê" })).toBeVisible()
  const gui = page.getByTestId("kiem-ke-gui")
  await expect(gui).toBeDisabled()

  await man.getByRole("button", { name: /Tải toàn bộ tồn kho/ }).click()
  await expect(man.getByTestId("dong-kiem-ke")).toHaveCount(2)
  await expect(man.getByText("Danh sách kiểm (2)")).toBeVisible()
  await expect(page.getByTestId("kiem-ke-da-dem")).toHaveText("0/2 đã đếm")
  await expect(gui).toHaveText("Nhập tồn thực tế để gửi")
  await expect(man.getByText("Chưa đếm")).toHaveCount(2)

  // "Khớp" = số đếm bằng hệ thống → đã đếm nhưng không chênh.
  const sua = man.getByTestId("dong-kiem-ke").filter({ hasText: "Sữa hộp" })
  await expect(sua).toContainText("SUA1 · Lô L1")
  await sua.getByRole("button", { name: "Khớp" }).click()
  await expect(sua.getByLabel("Tồn thực tế Sữa hộp")).toHaveValue("1000")
  await expect(sua.getByTestId("chenh-dong-kiem-ke")).toHaveText("Khớp")
  await expect(page.getByTestId("kiem-ke-da-dem")).toHaveText("1/2 đã đếm")
  await expect(gui).toHaveText("Không có chênh lệch")
  await expect(gui).toBeDisabled()

  // Mì đếm thiếu 3 gói.
  const mi = man.getByTestId("dong-kiem-ke").filter({ hasText: "Mì tôm" })
  await mi.getByLabel("Tồn thực tế Mì tôm").fill("897")
  await expect(mi.getByTestId("chenh-dong-kiem-ke")).toHaveText("-3")
  await expect(page.getByTestId("kiem-ke-tom-tat")).toContainText("-3")
  await expect(gui).toHaveText("Gửi duyệt (1 chênh lệch)")
  await mi.getByLabel("Ghi chú Mì tôm").fill("rách thùng")
  await man.getByLabel("Ghi chú phiếu").fill("Kiểm kê định kỳ")

  await gui.click()
  await page.waitForURL(/\/inventory\/adjustments$/)
  const phieu = await goiCuoi("/rest/v1/stock_entries")
  expect(phieu?.body).toMatchObject({ type: "stocktake", status: "draft", notes: "Kiểm kê định kỳ" })
  const dong = (await goiCuoi("/rest/v1/stock_entry_lines"))?.body as Array<Record<string, unknown>>
  // Chỉ dòng có chênh được ghi (luồng cũ), số có dấu.
  expect(dong).toHaveLength(1)
  expect(dong[0]).toMatchObject({ quantity: -3, batch_id: "b2", unit_name: "gói", notes: "rách thùng" })

  // Màn Duyệt điều chỉnh: đầu trắng, phiếu vừa lập nằm ở Chờ duyệt.
  const duyet = page.getByTestId("duyet-dc-mobile")
  await expect(duyet.getByRole("heading", { name: "Duyệt điều chỉnh" })).toBeVisible()
  await expect(duyet.getByRole("link", { name: /Kiểm kê/ })).toHaveAttribute("href", "/inventory/stocktake-adjust")
  const the = duyet.getByTestId("phieu-cho-duyet")
  await expect(the).toHaveCount(1)
  await expect(the).toContainText("Chờ duyệt")
  await expect(page.getByTestId("so-phieu-cho-duyet")).toHaveText("1 phiếu")
  await the.getByRole("button", { name: /Chi tiết dòng kiểm/ }).click()
  await expect(the.getByTestId("dong-kiem-chi-tiet")).toBeVisible()

  // Huỷ phiếu đi qua RPC reject_stock_adjustment (không UPDATE thẳng).
  page.once("dialog", (d) => d.accept())
  await the.getByRole("button", { name: "Huỷ phiếu" }).click()
  await expect.poll(async () => (await goiCuoi("/rest/v1/rpc/reject_stock_adjustment"))?.body).toMatchObject({
    p_entry_id: expect.any(String),
  })
  await expect(the.getByRole("button", { name: "Duyệt điều chỉnh" })).toBeVisible()
})
