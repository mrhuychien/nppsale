import { test, expect, type Page } from "@playwright/test"
import { dangNhap, chonKhach, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026 "tốc độ load trang chậm lắm" → rà soát lại: POS nhập hàng / trả NCC chỉ làm với NCC mà vẫn kéo
 *   cả sổ khách (≈1 MB với 3.000 khách). Nay màn NCC không tải khách; mở thêm tab đơn / hoá đơn thì tải riêng khách.
 */
type Luot = { method: string; path: string; query?: string; client?: string }
const tuTrinhDuyet = (x: Luot) => (x.client ?? "").includes("createBrowserClient")
const sau = async (t: number) => ((await nhatKy()) as Luot[]).slice(t).filter(tuTrinhDuyet)
const laSoKhachPos = (x: Luot) => x.path === "/rest/v1/customers" && decodeURIComponent(x.query ?? "").includes("credit_limit")
const laDanhMucHang = (x: Luot) => x.path === "/rest/v1/products" && decodeURIComponent(x.query ?? "").includes("price_lists(")
const oTim = (page: Page) => page.getByPlaceholder(/Tên hàng, mã hàng/i).first()
async function them(page: Page, tu: string) {
  await oTim(page).fill(tu)
  await oTim(page).press("Enter")
}

for (const [ten, duong] of [["nhập hàng", "/pos/nhap-hang/moi"], ["trả NCC", "/pos/tra-ncc/moi"]] as const) {
  test(`POS ${ten}: không kéo sổ khách — danh mục hàng vẫn tải, thêm hàng được`, async ({ page }) => {
    await dangNhap(page)
    const t = (await nhatKy()).length
    await page.goto(duong)
    await them(page, "Mì")
    await expect(page.locator("[data-dong]").first()).toContainText("Mì tôm")
    await page.waitForLoadState("networkidle")
    const ds = await sau(t)
    expect(ds.filter(laSoKhachPos).length, "không đọc sổ khách").toBe(0)
    expect(ds.filter(laDanhMucHang).length, "danh mục hàng vẫn tải").toBeGreaterThan(0)
  })
}

test("đang ở POS nhập hàng, mở thêm tab Đơn đặt hàng → tải riêng sổ khách (không tải lại hàng), chọn khách được", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/pos/nhap-hang/moi")
  await them(page, "Mì")
  await expect(page.locator("[data-dong]").first()).toContainText("Mì tôm")
  await page.waitForLoadState("networkidle")

  const t = (await nhatKy()).length
  await page.getByRole("button", { name: "Mở chứng từ mới" }).click()
  await page.getByRole("button", { name: "Đơn đặt hàng", exact: true }).click()
  await page.waitForURL(/\/pos\/don-hang\/moi/)
  await expect
    .poll(async () => (await sau(t)).filter(laSoKhachPos).length, { message: "mở tab cần khách → tải riêng sổ khách" })
    .toBeGreaterThan(0)
  await chonKhach(page, "Tạp hoá Cô Ba")
  expect((await sau(t)).filter(laDanhMucHang).length, "không tải lại danh mục hàng").toBe(0)
})

test("POS trả hàng khách vẫn tải sổ khách như cũ", async ({ page }) => {
  await dangNhap(page)
  const t = (await nhatKy()).length
  await page.goto("/pos/tra-hang/moi")
  await expect.poll(async () => (await sau(t)).filter(laSoKhachPos).length, { message: "trả hàng khách cần khách" }).toBeGreaterThan(0)
})
