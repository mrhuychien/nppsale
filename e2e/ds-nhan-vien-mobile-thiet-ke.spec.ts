import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: "Làm lại các màn" — danh sách nhân viên (thiết kế "ds-nhan-vien").
 *   Đầu xanh "Nhân viên" + "N đang hoạt động · N tạm khoá"; ô tìm + nút "+"; chip có số (Đang hoạt động ·
 *   theo vai · Tạm khoá · Tất cả); thẻ "Vai trò · 0912 420 924"; chạm thẻ = xem nhanh.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

const ORG = "00000000-0000-4000-8000-0000000000a1"
const NV = [
  { id: "00000000-0000-4000-8000-0000000000d7", full_name: "Đồng Thị Hiền", role: "sales", phone: "0979222026", is_active: true },
  { id: "00000000-0000-4000-8000-0000000000d8", full_name: "Nguyễn Thị Với", role: "warehouse", phone: "0912420923", is_active: true },
  { id: "00000000-0000-4000-8000-0000000000d9", full_name: "Trần Khoá", role: "sales", phone: "0902115159", is_active: false },
].map((u) => ({ ...u, org_id: ORG }))

test("điện thoại: danh sách nhân viên theo thiết kế — đầu xanh, chip có số, thẻ, xem nhanh", async ({ page }) => {
  await fetch(`${FAKE}/rest/v1/users`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(NV) })
  try {
    await dangNhap(page)
    await page.goto("/settings/users")
    const man = page.getByTestId("nv-mobile")
    await expect(man.getByRole("heading", { name: "Nhân viên" })).toBeVisible()
    // Chủ NPP (fixture) + 2 đang hoạt động, 1 khoá.
    await expect(man.getByTestId("nv-dau-xanh")).toContainText("3 đang hoạt động · 1 tạm khoá")
    await expect(man.getByPlaceholder("Họ tên hoặc số điện thoại")).toBeVisible()
    await expect(man.getByRole("link", { name: "Tạo nhân viên" })).toHaveAttribute("href", "/settings/users/new")

    const chip = man.getByTestId("nv-chip")
    await expect(chip.getByRole("button", { name: /Đang hoạt động\s*3/ })).toHaveAttribute("aria-pressed", "true")
    await expect(chip.getByRole("button", { name: /NV Bán hàng\s*1/ })).toBeVisible()
    await expect(chip.getByRole("button", { name: /NV Kho\s*1/ })).toBeVisible()
    await expect(chip.getByRole("button", { name: /Tạm khoá\s*1/ })).toBeVisible()
    await expect(chip.getByRole("button", { name: /Tất cả\s*4/ })).toBeVisible()

    // Mặc định Đang hoạt động: Chủ NPP lên đầu, người khoá không có.
    const the = man.getByTestId("nv-the")
    await expect(the).toHaveCount(3)
    await expect(the.first()).toContainText("Chủ NPP · 0900 000 000")
    await expect(the.filter({ hasText: "Đồng Thị Hiền" })).toContainText("NV Bán hàng · 0979 222 026")
    await expect(the.filter({ hasText: "Đồng Thị Hiền" })).toContainText("TH")
    await expect(the.filter({ hasText: "Trần Khoá" })).toHaveCount(0)
    // Không phải iPhone → không có nút đăng nhập (luật ở e2e/qr-mo-tab-moi.spec.ts).
    await expect(man.getByTestId("nv-dang-nhap")).toHaveCount(0)

    // Chip vai lọc.
    await chip.getByRole("button", { name: /NV Kho\s*1/ }).click()
    await expect(the).toHaveCount(1)
    await expect(the.first()).toContainText("Nguyễn Thị Với")

    // Tạm khoá: thẻ có nhãn "Tạm khoá".
    await chip.getByRole("button", { name: /Tạm khoá\s*1/ }).click()
    await expect(the).toHaveCount(1)
    await expect(the.first()).toContainText("Trần Khoá")
    await expect(the.first()).toContainText("Tạm khoá")

    // Tìm theo SĐT, chip đếm theo kết quả tìm.
    await chip.getByRole("button", { name: /Tất cả/ }).click()
    await man.getByPlaceholder("Họ tên hoặc số điện thoại").fill("0979")
    await expect(the).toHaveCount(1)
    await expect(chip.getByRole("button", { name: /Tất cả\s*1/ })).toBeVisible()
    await man.getByPlaceholder("Họ tên hoặc số điện thoại").fill("khong-co-ai")
    await expect(man.getByText("Không tìm thấy nhân viên")).toBeVisible()
    await man.getByRole("button", { name: "Xoá tìm kiếm" }).click()

    // Chạm thẻ = xem nhanh (Tạm khoá / Chỉnh sửa / QR / Xoá).
    await the.filter({ hasText: "Đồng Thị Hiền" }).click()
    const ngan = page.getByRole("dialog")
    await expect(ngan).toContainText("Đồng Thị Hiền")
    await expect(ngan.getByRole("button", { name: /Tạm khóa/ })).toBeVisible()
    await expect(ngan.getByRole("button", { name: /Chỉnh sửa/ })).toBeVisible()
    await expect(ngan.getByRole("button", { name: "Mã QR đăng nhập" })).toBeVisible()
    await expect(ngan.getByRole("button", { name: "Xoá người dùng" })).toBeVisible()

    // Không còn app bar chuẩn chồng lên đầu xanh.
    await expect(page.locator("header").filter({ has: page.getByRole("button", { name: "Mở menu" }) })).toBeHidden()
  } finally {
    for (const u of NV) await fetch(`${FAKE}/rest/v1/users?id=eq.${u.id}`, { method: "DELETE" })
  }
})
