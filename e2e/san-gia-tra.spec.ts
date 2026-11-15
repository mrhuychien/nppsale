import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, chonDonVi, nhatKy, FAKE, tatTacVuDon } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 15/11/2026: "Em xử lý thêm phần hàng trả lại, giá trả không được thấp quá 20% giá niêm yết". Sàn = 80% giá bảng
 *   ĐÚNG đơn vị theo nhóm giá của khách (máy chủ chốt ở mig 263 — sổ giả e2e không có trigger, nên ở đây kiểm MÀN: ô đỏ, nói
 *   giá tối thiểu, không lưu được). Chủ NPP / kế toán không sàn → bài đóng vai QUẢN LÝ.
 *   Mẫu: Sữa hộp — hộp 20.000 (nhóm của Đại lý Minh 19.000), thùng 450.000; Mì tôm gói 5.000.
 */
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })
const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã|KHÁCH TRẢ LẠI/i)
async function them(page: Page, tu: string) {
  await oTim(page).fill(tu)
  await oTim(page).press("Enter")
}
/** Gõ giá như người dùng (ô tự chèn dấu nghìn). */
async function goGia(page: Page, nhan: string, gia: string) {
  const o = page.getByLabel(nhan, { exact: true })
  await o.fill("")
  await o.pressSequentially(gia)
}

test.afterEach(async () => {
  await doiVai("owner")
})

test.describe("POS (máy tính)", () => {
  test("POS trả hàng — quản lý: dưới 80% giá niêm yết thì ô đỏ, nói giá tối thiểu, không lưu được; đúng sàn thì được", async ({ page }) => {
    await dangNhap(page)
    await doiVai("manager")
    await page.goto("/pos/tra-hang/moi")
    await chonKhach(page, "Đại lý Minh")
    await them(page, "Sữa")
    const gia = page.getByLabel("Đơn giá dòng 1", { exact: true })
    await expect(gia, "giá nhóm khách").toHaveValue("19.000")
    const san = page.getByTestId("san-gia-tra")
    await expect(san).toHaveCount(0)
    const ghiNhan = page.getByRole("button", { name: "Ghi nhận & nhập kho" })
    const nhap = page.getByRole("button", { name: "Lưu nháp" })
    await expect(ghiNhan).toBeEnabled()

    // 15.000 < sàn nhóm 15.200 (80% × 19.000).
    await goGia(page, "Đơn giá dòng 1", "15000")
    await expect(san).toHaveText("≥ 15.200đ")
    await expect(gia).toHaveAttribute("aria-invalid", "true")
    await expect(ghiNhan).toBeDisabled()
    await expect(ghiNhan).toHaveAttribute("title", /dưới giá tối thiểu \(không được dưới giá niêm yết quá 20%\)/)
    await expect(nhap).toBeDisabled()

    // Đúng sàn → hết đỏ, lưu được.
    await goGia(page, "Đơn giá dòng 1", "15200")
    await expect(san).toHaveCount(0)
    await expect(ghiNhan).toBeEnabled()
    await expect(nhap).toBeEnabled()

    // Đổi sang thùng: giá thùng 450.000, sàn 360.000 — đúng đơn vị, không lấy giá hộp × 24.
    await chonDonVi(page.getByTestId("dong-tra"), "dòng trả 1", "thùng")
    await expect(gia).toHaveValue("450.000")
    await goGia(page, "Đơn giá dòng 1", "300000")
    await expect(san).toHaveText("≥ 360.000đ")
    await expect(ghiNhan).toBeDisabled()
  })

  test("POS trả hàng — chủ NPP toàn quyền: trả 1.000 không bị sàn", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/pos/tra-hang/moi")
    await chonKhach(page, "Đại lý Minh")
    await them(page, "Sữa")
    await goGia(page, "Đơn giá dòng 1", "1000")
    await expect(page.getByLabel("Đơn giá dòng 1", { exact: true })).toHaveValue("1.000")
    await expect(page.getByTestId("san-gia-tra")).toHaveCount(0)
    await expect(page.getByRole("button", { name: "Ghi nhận & nhập kho" })).toBeEnabled()
  })

  test("POS đơn hàng — quản lý: hàng trả kèm đơn dưới sàn thì dải báo + khoá Gửi đơn / Lưu nháp / F9; đúng sàn thì gửi được", async ({ page }) => {
    await dangNhap(page)
    await doiVai("manager")
    await page.goto("/pos/don-hang/moi")
    await chonKhach(page, "Tạp hoá Cô Ba")
    await them(page, "Sữa")
    await expect(page.getByTestId("dong-don")).toHaveCount(1)
    await page.getByRole("button", { name: "+ Thêm hàng trả" }).click()
    await them(page, "Sữa")
    await expect(page.getByTestId("dong-tra-don")).toHaveCount(1)
    await expect(page.getByLabel("Đơn giá trả dòng 1", { exact: true })).toHaveValue("20.000")

    await goGia(page, "Đơn giá trả dòng 1", "10000")
    await expect(page.getByTestId("dong-tra-don").getByTestId("san-gia-tra")).toHaveText("≥ 16.000đ")
    await expect(page.getByTestId("dai-san-gia-tra")).toContainText("1 dòng hàng trả dưới giá tối thiểu")
    const gui = page.getByRole("button", { name: /Gửi đơn/ })
    await expect(gui).toBeDisabled()
    await expect(page.getByRole("button", { name: /Lưu nháp/ })).toBeDisabled()
    // Phím tắt theo đúng điều kiện của nút: F9 không gửi gì đi.
    const moc = (await nhatKy()).length
    await page.keyboard.press("F9")
    await page.waitForTimeout(500)
    expect((await nhatKy()).slice(moc).some((r) => r.path.endsWith("/rpc/create_order_with_lines")), "F9 vẫn gửi đơn").toBe(false)

    await goGia(page, "Đơn giá trả dòng 1", "16000")
    await expect(page.getByTestId("dai-san-gia-tra")).toHaveCount(0)
    await expect(gui).toBeEnabled()
  })

  test("POS hoá đơn (Xuất hàng) — quản lý: hàng trả thêm dưới sàn thì khoá Xuất hàng & lập HĐ", async ({ page }) => {
    await tatTacVuDon(page)
    await dangNhap(page)
    await doiVai("manager")
    await page.goto("/pos/hoa-don/moi?order=o-e2e-1")
    await expect(page.getByRole("heading", { name: /Xuất hàng · lập hóa đơn/ })).toBeVisible()
    await page.getByRole("button", { name: /Thêm hàng trả/ }).click()
    await them(page, "Mì")
    await expect(page.getByTestId("dong-tra-moi")).toHaveCount(1)
    const xuat = page.getByRole("button", { name: /Xuất hàng & lập HĐ/ })
    await expect(xuat).toBeEnabled()

    // Mì gói 5.000 → sàn 4.000.
    await goGia(page, "Đơn giá trả mới 1", "3000")
    await expect(page.getByTestId("dong-tra-moi").getByTestId("san-gia-tra")).toHaveText("≥ 4.000đ")
    await expect(xuat).toBeDisabled()
    await expect(xuat).toHaveAttribute("title", /dòng hàng trả dưới giá tối thiểu/)

    // Dòng ĐỔI không trừ tiền → không sàn.
    await page.getByTestId("dong-tra-moi").getByRole("button", { name: "Đổi", exact: true }).click()
    await expect(page.getByTestId("san-gia-tra")).toHaveCount(0)
    await expect(xuat).toBeEnabled()
  })
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("phiếu trả trên điện thoại — quản lý: giá dưới sàn thì dòng nói giá tối thiểu và không lưu được", async ({ page }) => {
    await dangNhap(page)
    await doiVai("manager")
    await page.goto("/returns/new")
    await page.getByTestId("chon-khach-tra").click()
    await page.getByLabel("Tìm khách hàng").fill("0911")
    await page.getByRole("button", { name: /Tạp hoá Cô Ba/ }).click()
    await page.getByTestId("the-san-pham").filter({ hasText: "Sữa hộp" }).getByRole("button", { name: "hộp", exact: true }).click()
    await expect(page.getByTestId("buoc-phieu-tra")).toBeVisible()
    await page.getByRole("group", { name: "Lý do trả" }).getByRole("button").first().click()
    const luu = page.getByRole("button", { name: "Lưu phiếu trả" })
    await expect(luu).toBeEnabled()

    // Hộp 20.000 → sàn 16.000.
    await goGia(page, "Giá trả Sữa hộp", "10000")
    await expect(page.getByTestId("dong-tra-khach")).toContainText("Giá trả thấp quá — tối thiểu 16.000đ")
    await expect(page.getByText("Có dòng trả dưới giá tối thiểu (giá niêm yết − 20%)")).toBeVisible()
    await expect(luu).toBeDisabled()

    await goGia(page, "Giá trả Sữa hộp", "16000")
    await expect(page.getByTestId("dong-tra-khach")).not.toContainText("Giá trả thấp quá")
    await expect(luu).toBeEnabled()
  })
})
