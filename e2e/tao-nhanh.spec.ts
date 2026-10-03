import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/10/2026 (Update 3.10): "list search nào cũng đáp ứng: tìm, danh sách, không có trong danh sách
 *   có nút tạo mới ở cuối. Khi bấm tạo -> sang tạo mới có trường đang search đó luôn" · "Khi tạo xong sản phẩm
 *   hoặc NCC -> bấm xong thì quay về phần đang làm … add luôn khách vừa thêm vào".
 *   Tạo NGAY TẠI CHỖ (hộp thoại / tấm trượt), tạo xong tự chọn — chứng từ đang làm không mất.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })

test.beforeEach(async () => {
  await api("sales_routes", { method: "POST", body: JSON.stringify([{ id: "tuyen-tn", org_id: ORG, code: "TN", name: "Tạo Nhanh", is_active: true, sort_order: 1 }]) })
})
test.afterEach(async () => {
  await api("sales_routes?id=eq.tuyen-tn", { method: "DELETE" })
  await api("customers?phone=eq.0987654321", { method: "DELETE" })
  await api("suppliers?name=eq.NCC%20H%E1%BA%A3i%20H%C3%A0%20M%E1%BB%9Bi", { method: "DELETE" })
  await api("products?name=eq.S%E1%BB%AFa%20chua%20m%E1%BB%9Bi", { method: "DELETE" })
})

const xo = (page: Page) => page.getByTestId("search-select-xo").filter({ visible: true })

test("phiếu thu: gõ tên khách chưa có → + Tạo khách hàng mới → tạo tại chỗ, tự chọn, phiếu giữ nguyên", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/finance/cash-receipts/new")
  // Đang làm dở phiếu: ghi chú đã gõ phải còn sau khi tạo khách.
  const ghiChu = page.locator("textarea").first()
  await ghiChu.fill("Thu tại chợ sáng")

  await page.locator("#cr-customer").click()
  await page.locator("#cr-customer").fill("Cô Bảy Mới")
  await expect(xo(page)).toContainText("Không có trong danh sách")
  const dong = xo(page).getByRole("button", { name: "Tạo khách hàng mới “Cô Bảy Mới”" })
  await expect(dong).toBeVisible()
  await dong.click()

  const khung = page.getByTestId("tao-nhanh-khach")
  await expect(khung).toBeVisible()
  await expect(khung.locator("#cf-store")).toHaveValue("Cô Bảy Mới")
  await expect(khung.locator("#cf-phone")).toHaveValue("")
  await khung.locator("#cf-owner").fill("Trần Thị Bảy")
  await khung.locator("#cf-phone").fill("0987654321")
  await khung.locator("#cf-address").fill("5 Cầu Đất")
  await khung.locator("#customer-route").click()
  await khung.locator("#customer-route").fill("TN")
  await khung.getByTestId("search-select-xo").getByRole("button", { name: /TN — Tạo Nhanh/ }).click()
  await khung.getByRole("button", { name: "Tạo mới" }).click()

  await expect(khung).toHaveCount(0)
  await expect(page).toHaveURL(/\/finance\/cash-receipts\/new$/)
  await expect(page.locator("#cr-customer")).toHaveValue("Cô Bảy Mới")
  await expect(ghiChu).toHaveValue("Thu tại chợ sáng")
  const ghi = await (await api("customers?phone=eq.0987654321&select=*")).json()
  expect(ghi).toHaveLength(1)
  expect(ghi[0]).toMatchObject({ store_name: "Cô Bảy Mới", channel: "TN" })
})

test("ô tìm khách: mũi tên xuống tới dòng tạo mới, Enter mở khung; gõ SĐT thì gán vào ô SĐT", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/finance/cash-receipts/new")
  await page.locator("#cr-customer").click()
  await page.locator("#cr-customer").fill("0987 654 321")
  await expect(xo(page).getByTestId("search-select-tao-moi")).toHaveText("Tạo khách hàng mới “0987 654 321”")
  await page.locator("#cr-customer").press("ArrowDown")
  await page.locator("#cr-customer").press("Enter")
  const khung = page.getByTestId("tao-nhanh-khach")
  await expect(khung.locator("#cf-phone")).toHaveValue("0987654321")
  await expect(khung.locator("#cf-store")).toHaveValue("")
  // Huỷ: khung đóng, không ghi gì.
  await khung.getByRole("button", { name: "Hủy" }).click()
  await expect(khung).toHaveCount(0)
  // Đóng khung không trả tiêu điểm về ô tìm (nếu trả, ô xổ lại danh sách che phiếu).
  await page.waitForTimeout(500)
  await expect(xo(page)).toHaveCount(0)
  expect(await (await api("customers?phone=eq.0987654321&select=id")).json()).toHaveLength(0)
})

test("phiếu nhập kho: tạo NCC tại chỗ (thay link mở tab mới) — tự chọn, số hoá đơn đang gõ còn nguyên", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/stock-in")
  const soHd = page.getByPlaceholder("VD: HD-2026-001").filter({ visible: true })
  await soHd.fill("HD-TN-01")

  const o = page.locator("#stockin-supplier")
  await o.click()
  await o.fill("NCC Hải Hà Mới")
  // Ô cho gõ tự do: Enter vẫn là "dùng chữ gõ tay"; dòng tạo mới vẫn có ở cuối.
  await expect(xo(page)).toContainText("Enter để dùng “NCC Hải Hà Mới”")
  await xo(page).getByRole("button", { name: "Tạo nhà cung cấp mới “NCC Hải Hà Mới”" }).click()

  const khung = page.getByTestId("tao-nhanh-ncc")
  await expect(khung.getByPlaceholder("VD: Công ty TNHH ABC")).toHaveValue("NCC Hải Hà Mới")
  await khung.getByRole("button", { name: "Tạo mới" }).click()
  await expect(khung).toHaveCount(0)

  await expect(page).toHaveURL(/\/inventory\/stock-in$/)
  await expect(o).toHaveValue("NCC Hải Hà Mới")
  // Đã chọn NCC trong danh mục (không phải chữ gõ tay) → lúc lưu sinh công nợ NCC.
  await expect(page.getByText("công nợ NCC").filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText("không sinh công nợ NCC")).toHaveCount(0)
  await expect(soHd).toHaveValue("HD-TN-01")
})

test("phiếu nhập kho: tạo sản phẩm tại chỗ — dòng hàng vừa tạo được thêm luôn vào phiếu", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/stock-in")
  const tim = page.locator("#si-add-product")
  await tim.click()
  await tim.fill("Sữa chua mới")
  await page.getByTestId("product-picker-tao-moi").filter({ visible: true }).click()

  const khung = page.getByTestId("tao-nhanh-san-pham")
  await expect(khung.locator("#name")).toHaveValue("Sữa chua mới")
  // Bỏ trường Nhóm hàng (chủ nhà 03/10/2026).
  await expect(khung.getByText("Nhóm hàng")).toHaveCount(0)
  await expect(khung.getByRole("button", { name: /Tạo thêm hàng/ })).toHaveCount(0)
  await khung.locator("#base_unit").fill("hộp")
  // NCC của SP nay là ô tìm (Update 3.10) — gõ rồi chọn trong danh sách xổ.
  await khung.locator("#primary_supplier").click()
  await khung.locator("#primary_supplier").fill("Vinamilk")
  await khung.getByTestId("search-select-xo").getByRole("button", { name: /^Vinamilk/ }).click()
  await khung.getByRole("button", { name: "Lưu", exact: true }).click()
  await expect(khung).toHaveCount(0)

  await expect(page.getByText("Sữa chua mới").filter({ visible: true }).first()).toBeVisible()
  const ghi = await (await api("products?name=eq.S%E1%BB%AFa%20chua%20m%E1%BB%9Bi&select=*")).json()
  expect(ghi).toHaveLength(1)
  expect(ghi[0].category ?? null).toBeNull()
})

/* ---------------- Đợt 2: các ô chọn còn lại ---------------- */

test("công nợ NCC: ô NCC là ô tìm — tạo NCC tại chỗ, tự chọn, số tiền đang gõ còn nguyên", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/payables/new")
  // Link mở trang tạo NCC cũ đã bỏ.
  await expect(page.getByRole("link", { name: "+ Tạo NCC mới" })).toHaveCount(0)
  const hd = page.getByPlaceholder("VD: HD-2024-001")
  await hd.fill("HD-CN-01")

  const o = page.locator("#payable-supplier")
  await o.click()
  await o.fill("NCC Hải Hà Mới")
  await expect(xo(page)).toContainText("Không có trong danh sách")
  await xo(page).getByRole("button", { name: "Tạo nhà cung cấp mới “NCC Hải Hà Mới”" }).click()

  const khung = page.getByTestId("tao-nhanh-ncc")
  await expect(khung.getByPlaceholder("VD: Công ty TNHH ABC")).toHaveValue("NCC Hải Hà Mới")
  await khung.getByRole("button", { name: "Tạo mới" }).click()
  await expect(khung).toHaveCount(0)

  await expect(page).toHaveURL(/\/payables\/new$/)
  await expect(o).toHaveValue("NCC Hải Hà Mới")
  await expect(hd).toHaveValue("HD-CN-01")
  // Đã chọn NCC thật: ô phiếu nhập (chỉ mở khi có NCC) bật lên.
  await expect(page.getByRole("combobox").filter({ hasText: "Chọn phiếu nhập" })).toBeEnabled()
})

test("biểu mẫu SP lồng khung NCC: tạo NCC ngay trong khung tạo sản phẩm, gắn luôn vào SP", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/stock-in")
  const tim = page.locator("#si-add-product")
  await tim.click()
  await tim.fill("Sữa chua mới")
  await page.getByTestId("product-picker-tao-moi").filter({ visible: true }).click()

  const khungSp = page.getByTestId("tao-nhanh-san-pham")
  await khungSp.locator("#base_unit").fill("hộp")
  const ncc = khungSp.locator("#primary_supplier")
  await ncc.click()
  await ncc.fill("NCC Hải Hà Mới")
  await khungSp.getByTestId("search-select-xo").getByRole("button", { name: "Tạo nhà cung cấp mới “NCC Hải Hà Mới”" }).click()

  const khungNcc = page.getByTestId("tao-nhanh-ncc")
  await expect(khungNcc.getByPlaceholder("VD: Công ty TNHH ABC")).toHaveValue("NCC Hải Hà Mới")
  await khungNcc.getByRole("button", { name: "Tạo mới" }).click()
  await expect(khungNcc).toHaveCount(0)
  // Khung SP còn nguyên chữ đã gõ, NCC vừa tạo đã gắn.
  await expect(khungSp.locator("#name")).toHaveValue("Sữa chua mới")
  await expect(ncc).toHaveValue("NCC Hải Hà Mới")
  await khungSp.getByRole("button", { name: "Lưu", exact: true }).click()
  await expect(khungSp).toHaveCount(0)

  await expect(page).toHaveURL(/\/inventory\/stock-in$/)
  const [sp] = await (await api("products?name=eq.S%E1%BB%AFa%20chua%20m%E1%BB%9Bi&select=*")).json()
  const [n] = await (await api("suppliers?name=eq.NCC%20H%E1%BA%A3i%20H%C3%A0%20M%E1%BB%9Bi&select=id")).json()
  expect(sp.primary_supplier_id).toBe(n.id)
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("phiếu thu: tạo khách ở tấm trượt kín màn, lưu xong quay lại phiếu với khách đã chọn", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/finance/cash-receipts/new")
    await page.locator("#cr-customer").click()
    await page.locator("#cr-customer").fill("Cô Bảy Mới")
    await xo(page).getByRole("button", { name: "Tạo khách hàng mới “Cô Bảy Mới”" }).click()

    const khung = page.getByTestId("tao-nhanh-khach")
    await expect(khung).toBeVisible()
    await expect(khung.getByTestId("tk-shop")).toHaveValue("Cô Bảy Mới")
    await khung.getByTestId("tk-owner").fill("Trần Thị Bảy")
    await khung.getByTestId("tk-phone").fill("0987654321")
    await khung.getByTestId("tk-street").fill("5 Cầu Đất")
    await khung.locator("#tk-route").click()
    await khung.locator("#tk-route").fill("TN")
    await khung.getByTestId("search-select-xo").getByRole("button", { name: /TN · Tạo Nhanh/ }).click()
    await khung.getByTestId("tk-luu").click()

    await expect(khung).toHaveCount(0)
    await expect(page).toHaveURL(/\/finance\/cash-receipts\/new$/)
    await expect(page.locator("#cr-customer")).toHaveValue("Cô Bảy Mới")
  })

  test("phiếu trả hàng: tạo sản phẩm tại chỗ — dòng hàng vừa tạo được thêm luôn vào phiếu", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/returns/new")
    const tim = page.locator("#ret-add-product")
    await tim.click()
    await tim.fill("Sữa chua mới")
    await expect(page.getByTestId("product-picker-tao-moi").filter({ visible: true })).toHaveText("Tạo sản phẩm mới “Sữa chua mới”")
    await page.getByTestId("product-picker-tao-moi").filter({ visible: true }).click()

    const khung = page.getByTestId("tao-nhanh-san-pham")
    await expect(khung.locator("#name")).toHaveValue("Sữa chua mới")
    await khung.locator("#base_unit").fill("hộp")
    await khung.locator("#primary_supplier").click()
    await khung.locator("#primary_supplier").fill("Vinamilk")
    await khung.getByTestId("search-select-xo").getByRole("button", { name: /^Vinamilk/ }).click()
    await khung.getByRole("button", { name: "Lưu", exact: true }).click()
    await expect(khung).toHaveCount(0)

    await expect(page).toHaveURL(/\/returns\/new$/)
    await expect(page.getByText("Chưa có mặt hàng nào. Chọn từ đơn ở trên hoặc tìm trong danh mục.")).toHaveCount(0)
    await expect(page.getByText("Sữa chua mới").filter({ visible: true }).first()).toBeVisible()
  })
})
