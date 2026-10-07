import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 07/10/2026: "Phiếu trả hàng NCC cả ở pos và mobile chưa chọn được đơn vị tính".
 *   POS: cột ĐVT trên dòng (giá quy theo hệ số). Điện thoại: nút ĐVT ngay trên dòng của phiếu (trước chỉ có ở khung sửa
 *   dòng, phải chạm tên hàng mới thấy).
 */
/* ⚠ Nhật ký CHUNG cả lượt chạy — đếm trước khi bấm, chờ lần ghi MỚI (không đọc nhầm lần ghi của spec trước). */
const cacLan = async (duong: string, method = "POST") =>
  (await nhatKy()).filter((r) => r.method === method && r.path.includes(duong))

test("POS trả NCC: có cột ĐVT, đổi thùng / hộp thì giá quy theo hệ số", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-ncc/moi")
  const tim = page.getByPlaceholder(/^Tên hàng, mã hàng/)
  await tim.fill("Sữa")
  await tim.press("Enter")
  const dvt = page.getByLabel("Đơn vị tính dòng 1")
  const gia = page.getByLabel("Giá nhập dòng 1")
  await expect(dvt).toHaveValue("hộp")
  await gia.fill("")
  await gia.pressSequentially("15000", { delay: 30 })
  await dvt.selectOption("thùng")
  await expect(gia).toHaveValue("360.000")
  await dvt.selectOption("hộp")
  await expect(gia).toHaveValue("15.000")
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("phiếu trả NCC: đổi ĐVT ngay trên dòng của phiếu", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/purchase-returns/new")
    await page.getByTestId("chon-ncc").click()
    await page.getByRole("dialog").getByRole("button", { name: /Vinamilk/ }).click()
    await page.getByTestId("the-hang-ncc").filter({ hasText: "Sữa hộp" }).click()
    await expect(page.getByTestId("buoc-phieu")).toBeVisible()
    const dong = page.getByTestId("dong-phieu-ncc")
    await expect(dong).toContainText("/ hộp")
    await dong.getByTestId("dvt-dong-ncc").getByRole("button", { name: "thùng" }).click()
    await expect(dong).toContainText("/ thùng")
    await expect(dong.getByTestId("dvt-dong-ncc").getByRole("button", { name: "thùng" })).toHaveAttribute("aria-pressed", "true")
    const truoc = (await cacLan("/rest/v1/supplier_return_lines")).length
    await page.getByRole("button", { name: "Lưu nháp" }).click()
    await expect.poll(async () => (await cacLan("/rest/v1/supplier_return_lines")).length).toBeGreaterThan(truoc)
    const ghi = (await cacLan("/rest/v1/supplier_return_lines")).at(-1)!.body as Array<Record<string, unknown>>
    expect(ghi[0]).toMatchObject({ unit_name: "thùng", conversion_factor: 24 })
  })
})
