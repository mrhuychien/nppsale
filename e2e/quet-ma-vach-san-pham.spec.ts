import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/10/2026: "phần thêm sản phẩm đoạn mã vạch thêm cho tao phần quét mã vạch nhé".
 *   Ô Mã vạch của form sản phẩm có nút quét → bộ quét dùng chung (camera + nhập tay). Chromium của e2e không có camera
 *   nên bài đi đường "Nhập tay" của chính hộp quét — mã gửi đi đúng như camera đọc được.
 *   Sữa hộp (8930000000011) và Mì tôm (8930000000028) có sẵn trong sổ giả → quét trúng là cảnh báo trùng.
 */
const SUA = "8930000000011"
const MI = "8930000000028"
const MOI = "8800000000099"

test.describe("máy tính — /products/new", () => {
  test("bấm nút quét → hộp quét → mã đọc được điền vào ô Mã vạch; mã đã của Sữa hộp thì cảnh báo", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/products/new")
    await expect(page.locator("#barcode")).toHaveValue("")
    await page.getByTestId("quet-ma-vach").click()
    const hop = page.getByRole("dialog", { name: "Quét mã vạch sản phẩm" })
    await expect(hop).toBeVisible()
    await hop.getByRole("button", { name: "Nhập tay" }).click()
    await hop.getByPlaceholder("Quét hoặc nhập mã vạch...").fill(SUA)
    await hop.getByRole("button", { name: "Dùng mã này" }).click()
    await expect(hop).toHaveCount(0)
    await expect(page.locator("#barcode")).toHaveValue(SUA)
    // Toast Radix còn đọc chữ ở vùng thông báo ẩn cho trình đọc màn hình → .first() như các bài khác.
    await expect(page.getByText("Mã vạch đã gắn cho sản phẩm khác").first()).toBeVisible()
    await expect(page.getByText(/đang là mã vạch của “Sữa hộp” \(SUA1\)/).first()).toBeVisible()
    // Vẫn ở form, không gửi gì.
    await expect(page).toHaveURL(/\/products\/new$/)
  })

  test("máy quét USB gõ mã rồi Enter vào ô Mã vạch: không gửi form, sang ô Tên hàng; mã mới thì không cảnh báo", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/products/new")
    /* Tên + đơn vị là ô `required` — để trống thì trình duyệt tự chặn gửi, Enter có lọt cũng không thấy. Điền đủ hai ô ấy,
       chừa NCC: form mà bị gửi thì handleSubmit kêu "Vui lòng chọn nhà cung cấp" (và không ghi gì vào sổ). */
    await page.locator("#name").fill("Hàng thử Enter")
    await page.locator("#base_unit").fill("gói")
    await page.locator("#barcode").fill(MOI)
    await page.locator("#barcode").press("Enter")
    await expect(page.locator("#name")).toBeFocused()
    await expect(page).toHaveURL(/\/products\/new$/)
    await expect(page.locator("#barcode")).toHaveValue(MOI)
    await expect(page.getByText("Vui lòng chọn nhà cung cấp")).toHaveCount(0)
    expect((await nhatKy()).some((r) => r.method === "POST" && r.path.endsWith("/products"))).toBe(false)
    // Có hỏi sổ theo đúng mã, nhưng không có hàng nào mang mã ấy → không cảnh báo.
    await expect.poll(async () =>
      (await nhatKy()).some((r) => r.method === "GET" && r.path.endsWith("/products") && (r.query ?? "").includes(`barcode=eq.${MOI}`))
    ).toBe(true)
    await expect(page.getByText("Mã vạch đã gắn cho sản phẩm khác")).toHaveCount(0)
  })
})

test.describe("điện thoại — khung tạo nhanh sản phẩm trong phiếu nhập", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("nút quét trong khung tạo nhanh: mã vào ô Mã vạch của khung; mã của Mì tôm thì cảnh báo", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/purchasing/receipts/new")
    await expect(page.getByTestId("buoc-them-hang")).toBeVisible()
    await page.getByTestId("them-san-pham").click()
    const khung = page.getByTestId("tao-nhanh-san-pham")
    await expect(khung).toBeVisible()
    const nut = khung.getByTestId("quet-ma-vach")
    await expect(nut).toBeVisible()
    expect((await nut.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    await nut.click()
    const hop = page.getByRole("dialog", { name: "Quét mã vạch sản phẩm" })
    await expect(hop).toBeVisible()
    await hop.getByRole("button", { name: "Nhập tay" }).click()
    await hop.getByPlaceholder("Quét hoặc nhập mã vạch...").fill(MI)
    await hop.getByPlaceholder("Quét hoặc nhập mã vạch...").press("Enter")
    await expect(hop).toHaveCount(0)
    await expect(khung.locator("#barcode")).toHaveValue(MI)
    await expect(page.getByText(/đang là mã vạch của “Mì tôm” \(MI1\)/).first()).toBeVisible()
    // Khung tạo nhanh vẫn mở, phiếu đang làm không mất.
    await expect(khung).toBeVisible()
    await expect(page).toHaveURL(/\/purchasing\/receipts\/new$/)
  })
})
