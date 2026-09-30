import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: "Làm lại các màn … Danh sách sản phẩm" (thiết kế "ds-san-pham").
 *   Sữa hộp gán NCC chính Vinamilk, Mì tôm chưa gán → chip "Tất cả 2" · "Vinamilk 1" · "Chưa gán NCC 1";
 *   thẻ "SUA1 · hộp · Vinamilk" + giá 20.000; bấm chip lọc; "Chọn" bật chế độ chọn nhiều; bấm thẻ mở xem nhanh.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const SUA = "00000000-0000-4000-8000-0000000000d1"
const NCC = "00000000-0000-4000-8000-0000000000e1"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test("điện thoại: danh sách sản phẩm theo thiết kế — đầu xanh, chip NCC có số, thẻ, chọn nhiều", async ({ page }) => {
  await dangNhap(page)
  // Máy chủ giả không nhúng quan hệ — gắn sẵn `supplier` cho thẻ.
  await api(`products?id=eq.${SUA}`, "PATCH", { primary_supplier_id: NCC, supplier: { id: NCC, name: "Vinamilk" } })
  try {
    await page.goto("/products")
    const man = page.getByTestId("sp-mobile")
    await expect(man.getByRole("heading", { name: "Sản phẩm" })).toBeVisible()
    await expect(man.getByTestId("sp-dau-xanh")).toContainText("2 đang bán")
    await expect(man.getByPlaceholder("Tên, SKU hoặc nhãn hàng")).toBeVisible()
    await expect(man.getByRole("link", { name: "Thêm sản phẩm" })).toHaveAttribute("href", "/products/new")

    const chip = man.getByTestId("sp-chip-ncc")
    await expect(chip.getByRole("button", { name: /Tất cả\s*2/ })).toHaveAttribute("aria-pressed", "true")
    await expect(chip.getByRole("button", { name: /Vinamilk\s*1/ })).toBeVisible()
    await expect(chip.getByRole("button", { name: /Chưa gán NCC\s*1/ })).toBeVisible()

    await expect(man.getByTestId("sp-so-dem")).toHaveText("2 sản phẩm")
    const sua = man.getByTestId("the-san-pham").filter({ hasText: "Sữa hộp" })
    await expect(sua).toContainText("SUA1 · hộp · Vinamilk")
    await expect(sua).toContainText(/20\.000/)

    // Chip NCC là bộ lọc.
    await chip.getByRole("button", { name: /Vinamilk\s*1/ }).click()
    await expect(man.getByTestId("the-san-pham")).toHaveCount(1)
    await expect(man.getByTestId("sp-so-dem")).toHaveText("1 sản phẩm")
    await chip.getByRole("button", { name: /Chưa gán NCC/ }).click()
    await expect(man.getByTestId("the-san-pham")).toHaveCount(1)
    await expect(man.getByTestId("the-san-pham").first()).toContainText("Mì tôm")
    await chip.getByRole("button", { name: /Tất cả/ }).click()
    await expect(man.getByTestId("the-san-pham")).toHaveCount(2)

    // Sắp xếp Tên Z–A.
    await man.getByRole("button", { name: "Tên A–Z" }).click()
    await expect(man.getByRole("button", { name: "Tên Z–A" })).toBeVisible()
    await expect(man.getByTestId("the-san-pham").first()).toContainText("Sữa hộp")
    await man.getByRole("button", { name: "Tên Z–A" }).click()

    // Chọn nhiều → thanh thao tác hàng loạt; bấm thẻ lúc chọn không mở xem nhanh.
    await man.getByRole("button", { name: "Chọn" }).click()
    await sua.click()
    await expect(sua).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByText("sản phẩm đã chọn")).toBeVisible()
    await man.getByRole("button", { name: "Xong" }).click()
    await expect(page.getByText("sản phẩm đã chọn")).toBeHidden()

    // Bấm thẻ như cũ: mở xem nhanh.
    await sua.click()
    await expect(page.getByRole("link", { name: /chi tiết/i }).first()).toBeVisible()

    // Hết hàng để xem thêm.
    await expect(man.getByText(/Xem thêm · đang hiện/)).toHaveCount(0)
    // Không còn app bar chuẩn chồng lên đầu trang xanh.
    await expect(page.locator("header").filter({ hasText: "Sản phẩm" }).first()).toBeHidden()
    await page.screenshot({ path: "test-results/ds-san-pham-mobile.png", fullPage: true })
  } finally {
    await api(`products?id=eq.${SUA}`, "PATCH", { primary_supplier_id: null, supplier: null })
  }
})
