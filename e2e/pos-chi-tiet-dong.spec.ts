import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy, chonDonVi } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Bỏ VAT từng dòng, phần giảm giá, cho vào chi tiết
 *   dòng, chọn bấm vào mới hiện lên trên dòng. Trong dòng: nút xóa dòng cho
 *   thành thùng rác để ra đầu dòng. Nút chọn đơn vị tính cho cạnh ô số lượng.
 *   (bấm vào nhảy lần lượt, không dàn hàng)" · "Bỏ VAT từng dòng cả ở POS".
 *
 * Mẫu: Sữa hộp — hộp 20.000, thùng (×24) bảng giá 450.000.
 */
const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã SKU|KHÁCH TRẢ LẠI/i)

test("đơn hàng: giảm giá trong chi tiết dòng, đơn vị bấm-nhảy, thùng rác đầu dòng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/don-hang/moi")
  await chonKhach(page, "Tạp hoá Cô Ba")
  await oTim(page).fill("Sữa")
  await oTim(page).press("Enter")
  const dong = page.getByTestId("dong-don")
  await expect(dong).toHaveCount(1)

  // Không còn thuế trên dòng; giảm giá gập trong chi tiết.
  await expect(page.getByRole("button", { name: /Thuế GTGT dòng/ })).toHaveCount(0)
  await expect(page.getByLabel("Giảm giá dòng 1", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Chi tiết dòng 1" }).click()
  await expect(page.getByTestId("chi-tiet-dong")).toBeVisible()
  await page.getByRole("button", { name: /^Đơn vị giảm dòng 1 — đang là đồng/ }).click()
  await page.getByLabel("Giảm giá dòng 1", { exact: true }).fill("10")
  await expect(dong.first()).toContainText("18.000")

  // Gập lại: giá trị bị giấu hiện thành tóm tắt, không vô hình.
  await page.getByRole("button", { name: "Chi tiết dòng 1" }).click()
  await expect(page.getByTestId("chi-tiet-dong")).toHaveCount(0)
  await expect(dong.first()).toContainText("Giảm 10%")

  // Một nút đơn vị, bấm là sang đơn vị kế tiếp — và tra lại bảng giá.
  const gia = page.getByLabel("Đơn giá dòng 1")
  await expect(page.getByRole("button", { name: "thùng", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: /^Đơn vị dòng 1 — đang là hộp,/ }).click()
  await expect(page.getByRole("button", { name: /^Đơn vị dòng 1 — đang là thùng,/ })).toBeVisible()
  await expect(gia).toHaveValue("450.000")
  await chonDonVi(page, "dòng 1", "hộp")
  await expect(gia, "quay về hộp mà giá vẫn là giá thùng").toHaveValue("20.000")
  await chonDonVi(page, "dòng 1", "thùng")
  await page.getByLabel("Ghi chú dòng 1", { exact: true }).fill("e2e-chi-tiet-dong")

  // Dòng thứ hai để thử thùng rác: xoá một cú bấm, dòng kia còn nguyên.
  await oTim(page).fill("Mì")
  await oTim(page).press("Enter")
  await expect(dong).toHaveCount(2)
  await page.getByRole("button", { name: "Xoá dòng 2" }).click()
  await expect(dong).toHaveCount(1)

  await page.getByRole("button", { name: /Lưu nháp/ }).click()
  const cuaToi = async () =>
    (await nhatKy())
      .filter((r) => r.path.endsWith("/rpc/create_order_with_lines"))
      .find((r) => JSON.stringify(r.body).includes("e2e-chi-tiet-dong"))
  await expect.poll(async () => !!(await cuaToi())).toBe(true)
  const p = ((await cuaToi())!.body as { p: { lines: Array<Record<string, unknown>> } }).p
  expect(p.lines).toHaveLength(1)
  // Giảm 10% quy vào đơn giá thùng: 450.000 × 0,9.
  expect(p.lines[0]).toMatchObject({ unit_name: "thùng", unit_price: 405_000 })
})
