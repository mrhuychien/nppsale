import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy } from "./helpers"

/**
 * ⚠ LỖI THẬT 23/09/2026 — chủ nhà: "tạo đơn hàng trên pos, chuyển đổi đơn
 *   vị tính k thay đổi đơn giá trong phần hàng đổi trả". 4.000 chốt đơn vị
 *   xanh mà lỗi vẫn lọt, vì không chốt nào BẤM nút. Chốt này bấm.
 *
 * Mẫu: Sữa hộp — hộp 20.000, thùng (×24) bảng giá 450.000.
 */
const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã SKU|KHÁCH TRẢ LẠI/i)

async function themHang(page: Page, tu: string) {
  await oTim(page).fill(tu)
  await oTim(page).press("Enter")
}

test("đơn hàng: đổi đơn vị ở dòng bán và dòng hàng trả đều đổi đơn giá", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/don-hang/moi")
  await chonKhach(page, "Tạp hoá Cô Ba")

  // Dòng bán
  await themHang(page, "Sữa")
  const giaBan = page.getByLabel("Đơn giá dòng 1")
  await expect(giaBan).toHaveValue("20.000")
  await page.getByRole("button", { name: "thùng", exact: true }).first().click()
  await expect(giaBan, "đổi sang thùng mà giá không tra bảng giá thùng").toHaveValue("450.000")

  // Dòng hàng trả kèm đơn — đúng chỗ chủ nhà báo lỗi
  await page.getByRole("button", { name: "+ Thêm hàng trả" }).click()
  await themHang(page, "Sữa")
  const giaTra = page.getByLabel("Đơn giá trả dòng 1")
  await expect(giaTra).toHaveValue("20.000")
  const khoiTra = page.locator("div", { has: giaTra }).filter({ has: page.getByLabel("Lý do trả dòng 1") }).last()
  await khoiTra.getByRole("button", { name: "thùng", exact: true }).click()
  await expect(giaTra, "hàng trả đổi sang thùng mà đơn giá vẫn là giá hộp").toHaveValue("450.000")
  await expect(page.getByText("− 450.000").first()).toBeVisible()

  // Ô giá chia khối nghìn — yêu cầu cùng ngày
  await giaTra.fill("")
  await giaTra.pressSequentially("220000")
  await expect(giaTra).toHaveValue("220.000")

  // Lý do theo dòng: ô chọn có tìm (thay `<select>` gốc, 23/09/2026).
  await page.getByLabel("Lý do trả dòng 1").click()
  await page.getByRole("option", { name: "Sai hàng" }).click()
  await expect(page.getByLabel("Lý do trả dòng 1")).toContainText("Sai hàng")

  // Lưu nháp → tải trọng gửi xuống máy chủ mang đúng đơn vị và giá
  await page.getByRole("button", { name: /Lưu nháp/ }).click()
  await expect.poll(async () => (await nhatKy()).some((r) => r.path.endsWith("/rpc/create_order_with_lines"))).toBe(true)
  const goi = (await nhatKy()).filter((r) => r.path.endsWith("/rpc/create_order_with_lines")).at(-1)!
  const p = (goi.body as { p: { lines: Array<Record<string, unknown>>; return_lines: Array<Record<string, unknown>> } }).p
  expect(p.lines[0]).toMatchObject({ unit_name: "thùng", unit_price: 450_000, conversion_factor: 24 })
  expect(p.return_lines[0]).toMatchObject({ unit_name: "thùng", unit_price: 220_000, line_total: 220_000, reason: "wrong_item" })
})

/** Giá vốn không có bảng giá: thùng 480.000 thì hộp 20.000 (chủ nhà chốt 23/09/2026). */
test("nhập hàng: đổi đơn vị thì giá nhập đi theo hệ số", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/moi")
  const tim = page.getByPlaceholder("Tên hàng, mã hàng, mã vạch…")
  await tim.fill("Sữa")
  await tim.press("Enter")
  const donVi = page.getByLabel("Đơn vị tính dòng 1")
  const gia = page.getByLabel("Giá nhập dòng 1")
  await donVi.selectOption("thùng")
  await gia.pressSequentially("480000")
  await expect(gia).toHaveValue("480.000")
  await donVi.selectOption("hộp")
  await expect(gia, "đổi sang hộp mà giá nhập vẫn là giá thùng").toHaveValue("20.000")
  await donVi.selectOption("thùng")
  await expect(gia).toHaveValue("480.000")
})

/** Màn Trả hàng trước đây chỉ có đơn vị cơ sở và giá sell_price phẳng. */
test("trả hàng: giá theo bảng giá nhóm khách, chọn được thùng", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/tra-hang/moi")
  // Khách nhóm G1: hộp 19.000 — lấy `sell_price` phẳng thì ra 20.000.
  await chonKhach(page, "Đại lý Minh")
  const tim = page.getByPlaceholder("Tên hàng, mã hàng…")
  await tim.fill("Sữa")
  await tim.press("Enter")
  const gia = page.getByLabel("Đơn giá dòng 1")
  await expect(gia, "thêm hàng trả bỏ qua bảng giá nhóm khách").toHaveValue("19.000")
  await page.getByLabel("Đơn vị trả dòng 1").selectOption("thùng")
  await expect(gia, "đổi sang thùng mà giá trả vẫn là giá hộp").toHaveValue("450.000")
})

/* Chốt "sửa hóa đơn giữ hệ số 24" dời sang e2e/pos-hoa-don.spec.ts — màn mới. */
