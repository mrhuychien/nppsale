import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 03/10/2026 (Update 3.10): "Phần nhập hàng trên di động — khi tìm kiếm hàng thêm nút thêm sản phẩm
 *   ở top, cạnh nút chọn nhiều sản phẩm. — Khi tìm kiếm ncc, thêm nút thêm NCC" · "Khi tạo xong sản phẩm hoặc
 *   NCC -> bấm xong thì quay về phần đang làm … add luôn".
 *   Tạo tại chỗ (tấm trượt kín màn), điền sẵn chữ đang tìm; lưu xong hàng vào phiếu / NCC được chọn.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const api = (p: string, init?: RequestInit) => fetch(`${FAKE}/rest/v1/${p}`, { headers: { "content-type": "application/json" }, ...init })
const SP = "B%C3%A1nh%20M%E1%BB%9Bi%20X"
const NCC = "NCC%20M%E1%BB%9Bi%20Y"

test.afterEach(async () => {
  await api(`products?name=eq.${SP}`, { method: "DELETE" })
  await api(`suppliers?name=eq.${NCC}`, { method: "DELETE" })
})

test("nhập hàng: tìm “Bánh Mới X” → Thêm sản phẩm ở đầu màn → lưu → dòng hàng vào phiếu luôn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
  await page.getByTestId("chon-ncc").click()
  await page.getByRole("dialog").getByRole("button", { name: /Vinamilk/ }).click()
  await page.getByLabel("Tìm sản phẩm").fill("Bánh Mới X")

  // Không khớp mã nào: ô trống cũng mời tạo, mang chữ đang tìm.
  await expect(page.getByTestId("hang-trong").getByRole("button", { name: "Thêm sản phẩm “Bánh Mới X”" })).toBeVisible()
  // Nút ở đầu màn, ngay cạnh "Chọn nhiều".
  const nut = page.getByTestId("them-san-pham")
  await expect(nut).toBeVisible()
  const [a, b] = [await nut.boundingBox(), await page.getByTestId("chon-nhieu").boundingBox()]
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(4)
  expect(a!.height).toBeGreaterThanOrEqual(36)
  await nut.click()

  const khung = page.getByTestId("tao-nhanh-san-pham")
  await expect(khung).toBeVisible()
  await expect(khung.locator("#name")).toHaveValue("Bánh Mới X")
  // NCC của phiếu điền sẵn.
  await expect(khung.locator("#primary_supplier")).toHaveValue(/Vinamilk/)
  await khung.locator("#base_unit").fill("gói")
  await khung.getByRole("button", { name: "Lưu", exact: true }).click()
  await expect(khung).toHaveCount(0)

  // Chọn từng mã (mặc định): thêm xong là sang phiếu, như chạm thẻ — 1 gói.
  await expect(page).toHaveURL(/\/purchasing\/receipts\/new$/)
  await expect(page.getByTestId("buoc-phieu")).toBeVisible()
  const dong = page.getByTestId("dong-phieu-ncc").filter({ hasText: "Bánh Mới X" })
  await expect(dong).toHaveCount(1)
  await expect(dong.getByLabel("Số lượng Bánh Mới X")).toHaveValue("1")
  await expect(dong).toContainText("/ gói")
  await expect(page.getByText("hàng của NCC khác")).toHaveCount(0)
  const ghi = await (await api(`products?name=eq.${SP}&select=*`)).json()
  expect(ghi).toHaveLength(1)
  // NCC của phiếu (Vinamilk) thành NCC chính của hàng mới.
  expect(ghi[0].primary_supplier_id).toBe("00000000-0000-4000-8000-0000000000e1")

  // Về bước thêm hàng: thẻ hàng vừa tạo có trong danh sách, báo đã có.
  await page.getByRole("button", { name: "Thêm hàng" }).click()
  await expect(page.getByTestId("the-hang-ncc").filter({ hasText: "Bánh Mới X" }).getByTestId("da-co-tren-phieu")).toHaveText("Đã có 1 gói")
})

test("nhập hàng: tấm chọn NCC → Thêm NCC (điền sẵn chữ tìm) → lưu → NCC được chọn, phiếu giữ nguyên", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  // Phiếu đang làm dở: một dòng hàng (chưa gán NCC thì vẫn hiện thẻ).
  await page.getByTestId("chon-nhieu").click()
  await expect(page.getByTestId("chon-nhieu")).toHaveAttribute("aria-pressed", "true")
  await page.getByTestId("the-hang-ncc").filter({ hasText: "Mì tôm" }).click()
  await expect(page.getByText("1 mặt hàng · 1 đơn vị")).toBeVisible()

  await page.getByTestId("chon-ncc").click()
  const tam = page.getByTestId("chon-ncc-sheet")
  await tam.getByLabel("Tìm nhà cung cấp").fill("NCC Mới Y")
  await expect(tam.getByText("Không tìm thấy NCC nào khớp.")).toBeVisible()
  // Dòng cuối danh sách mang chữ đang tìm; nút ở đầu tấm cũng mở cùng khung.
  await expect(tam.getByTestId("tao-ncc-moi")).toHaveText("Tạo nhà cung cấp mới “NCC Mới Y”")
  await tam.getByTestId("them-ncc").click()
  await expect(tam).toHaveCount(0)

  const khung = page.getByTestId("tao-nhanh-ncc")
  await expect(khung.getByPlaceholder("VD: Công ty TNHH ABC")).toHaveValue("NCC Mới Y")
  await khung.getByRole("button", { name: "Tạo mới" }).click()
  await expect(khung).toHaveCount(0)

  await expect(page.getByTestId("chon-ncc")).toContainText("NCC Mới Y")
  await expect(page.getByText("1 mặt hàng · 1 đơn vị")).toBeVisible()
  expect(await (await api(`suppliers?name=eq.${NCC}&select=id`)).json()).toHaveLength(1)
  // Mở lại tấm chọn: NCC mới có trong danh sách, đang chọn.
  await page.getByTestId("chon-ncc").click()
  await expect(page.getByTestId("chon-ncc-sheet").getByRole("button", { name: /NCC Mới Y.*Đang chọn/ })).toBeVisible()
})

test("trả NCC: dòng “+ Tạo nhà cung cấp mới” ở cuối danh sách cũng tạo tại chỗ và chọn luôn", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchase-returns/new")
  await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
  await expect(page.getByTestId("them-san-pham")).toBeVisible()
  await page.getByTestId("chon-ncc").click()
  const tam = page.getByTestId("chon-ncc-sheet")
  // Có kết quả thì dòng tạo mới vẫn ở cuối.
  await expect(tam.getByRole("button", { name: /Vinamilk/ })).toBeVisible()
  await tam.getByLabel("Tìm nhà cung cấp").fill("NCC Mới Y")
  await tam.getByTestId("tao-ncc-moi").click()
  const khung = page.getByTestId("tao-nhanh-ncc")
  await expect(khung.getByPlaceholder("VD: Công ty TNHH ABC")).toHaveValue("NCC Mới Y")
  await khung.getByRole("button", { name: "Tạo mới" }).click()
  await expect(khung).toHaveCount(0)
  await expect(page.getByTestId("chon-ncc")).toContainText("NCC Mới Y")
})

test("nhập kho trên điện thoại: nút Thêm sản phẩm cạnh nút quét mở khung tạo, điền sẵn chữ đang tìm", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/inventory/stock-in")
  await expect(page.getByTestId("nk-m-trong")).toBeVisible()
  await page.locator("#si-add-product-m").fill("Bánh Mới X")
  await page.getByTestId("nk-m-them-san-pham").click()
  const khung = page.getByTestId("tao-nhanh-san-pham")
  await expect(khung.locator("#name")).toHaveValue("Bánh Mới X")
  await khung.locator("#base_unit").fill("gói")
  await khung.locator("#primary_supplier").click()
  await khung.locator("#primary_supplier").fill("Vinamilk")
  await khung.getByTestId("search-select-xo").getByRole("button", { name: "Vinamilk", exact: true }).click()
  await khung.getByRole("button", { name: "Lưu", exact: true }).click()
  await expect(khung).toHaveCount(0)
  await expect(page.getByTestId("nk-m-dong").filter({ hasText: "Bánh Mới X" })).toHaveCount(1)
})
