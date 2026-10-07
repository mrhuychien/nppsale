import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"
import { SUA, MI } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 07/10/2026: "Phiếu trả hàng tạo trên mobile chưa có giao diện như sell mobile". Màn /returns/new trên
 *   điện thoại nay như /sell: thẻ sản phẩm có quy cách, chọn từng mã / chọn nhiều, thanh đáy "Xem phiếu"; bước phiếu:
 *   khách, hoá đơn, lý do, dòng hàng (ĐVT, giá trả, Trả tiền / Đổi hàng, SL), Lưu phiếu trả.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const goiRpc = async (fn: string) => (await nhatKy()).filter((r) => r.method === "POST" && r.path.endsWith(`/rpc/${fn}`))

test("lập phiếu trả trên điện thoại kiểu /sell: chọn thùng trên thẻ, đổi hàng một dòng, lưu đúng dòng", async ({ page }) => {
  const truoc = (await goiRpc("create_return_with_lines")).length
  await dangNhap(page)
  await page.goto("/returns/new")
  await expect(page.getByTestId("buoc-them-hang-tra")).toBeVisible()
  // Không có thanh đáy / đầu trang chung che nút.
  await expect(page.getByRole("heading", { name: "Trả hàng" })).toBeVisible()

  await page.getByTestId("chon-khach-tra").click()
  await page.getByLabel("Tìm khách hàng").fill("0911")
  await page.getByRole("button", { name: /Tạp hoá Cô Ba/ }).click()
  await expect(page.getByTestId("chon-khach-tra")).toContainText("Tạp hoá Cô Ba")

  // Chọn từng mã (mặc định): chạm quy cách "thùng" trên thẻ là vào phiếu ngay với 1 thùng, giá thùng của bảng giá.
  const the = page.getByTestId("the-san-pham").filter({ hasText: "Sữa hộp" })
  await the.getByRole("button", { name: "thùng", exact: true }).click()
  await expect(page.getByTestId("buoc-phieu-tra")).toBeVisible()
  const dong = page.getByTestId("dong-tra-khach")
  await expect(dong).toHaveCount(1)
  await expect(dong).toContainText("giá bảng 450.000")
  await expect(page.getByTestId("tien-tra-khach")).toHaveText("450.000đ")

  // Nút Lưu khoá và nói rõ vì sao khi chưa chọn lý do.
  await expect(page.getByRole("button", { name: "Lưu phiếu trả" })).toBeDisabled()
  await expect(page.getByText("Chọn lý do trả")).toBeVisible()
  await page.getByRole("group", { name: "Lý do trả" }).getByRole("button").first().click()

  // Thêm Mì tôm rồi để dòng đó là Đổi hàng → không trừ tiền.
  await page.getByRole("button", { name: "Thêm hàng", exact: true }).click()
  await page.getByTestId("the-san-pham").filter({ hasText: "Mì tôm" }).click()
  await expect(page.getByTestId("buoc-phieu-tra")).toBeVisible()
  await page.getByRole("group", { name: "Loại dòng Mì tôm" }).getByRole("button", { name: "Đổi hàng" }).click()
  await expect(page.getByTestId("tien-tra-khach")).toHaveText("450.000đ")

  // Đổi ĐVT dòng sữa ngay trên dòng: thùng → hộp, giá theo bảng giá hộp.
  await page.getByRole("group", { name: "Đơn vị tính Sữa hộp" }).getByRole("button", { name: "hộp" }).click()
  await expect(page.getByTestId("tien-tra-khach")).toHaveText("20.000đ")

  await page.getByRole("button", { name: "Lưu phiếu trả" }).click()
  await expect.poll(async () => (await goiRpc("create_return_with_lines")).length).toBeGreaterThan(truoc)
  const body = (await goiRpc("create_return_with_lines")).at(-1)?.body as {
    p_head: Record<string, unknown>; p_lines: Array<Record<string, unknown>>
  }
  expect(body.p_head).toMatchObject({ status: "draft", credit_note_amount: 20000 })
  expect(body.p_lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ product_id: SUA, unit_name: "hộp", quantity: 1, unit_price: 20000, is_exchange: false }),
    expect.objectContaining({ product_id: MI, unit_name: "gói", is_exchange: true }),
  ]))
  await expect(page).toHaveURL(/\/returns\/00000000-0000-4000-8000-00000000f002$/)
})
