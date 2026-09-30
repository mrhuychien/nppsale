import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 30/09/2026: "Làm lại các màn" — thiết kế "ds-ncc" (danh sách nhà cung cấp trên điện thoại).
 *   Có sẵn Vinamilk; thêm "Detech Connai" + " detech  CONNAI" (trùng tên, so không dấu / hoa thường) và
 *   "Đông Trùng Hạ Thảo" → nhóm D, Đ, V; huy hiệu "Trùng tên"; băng "1 nhà cung cấp bị trùng tên" + "Gộp"
 *   lọc về 2 NCC trùng; bấm dòng mở xem nhanh.
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const ORG = "00000000-0000-4000-8000-0000000000a1"
const IDS = ["00000000-0000-4000-8000-0000000000f1", "00000000-0000-4000-8000-0000000000f2", "00000000-0000-4000-8000-0000000000f3"]
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test("điện thoại: danh sách NCC theo thiết kế — đầu xanh, nhóm chữ cái, trùng tên, Gộp lọc NCC trùng", async ({ page }) => {
  await dangNhap(page)
  await api("suppliers", "POST", [
    { id: IDS[0], org_id: ORG, code: "NCC2", name: "Detech Connai", phone: "0912345678", is_active: true },
    { id: IDS[1], org_id: ORG, code: "NCC3", name: " detech  CONNAI", is_active: true },
    { id: IDS[2], org_id: ORG, code: "NCC4", name: "Đông Trùng Hạ Thảo", is_active: true },
  ])
  try {
    await page.goto("/suppliers")
    const man = page.getByTestId("ncc-mobile")
    await expect(man.getByRole("heading", { name: "Nhà cung cấp" })).toBeVisible()
    await expect(man.getByTestId("ncc-dau-xanh")).toContainText("4 nhà cung cấp")
    await expect(man.getByPlaceholder("Tìm tên nhà cung cấp")).toBeVisible()
    await expect(man.getByRole("link", { name: "Thêm nhà cung cấp" })).toHaveAttribute("href", "/suppliers/new")

    // Nhóm chữ cái: D rồi Đ rồi V.
    await expect(man.getByTestId("ncc-nhom").locator("h2")).toHaveText(["D", "Đ", "V"])
    const dong = man.getByTestId("dong-ncc")
    await expect(dong).toHaveCount(4)
    await expect(dong.filter({ hasText: "Đông Trùng" })).toContainText("Đ")
    await expect(dong.filter({ hasText: "NCC2" })).toContainText("NCC2 · 0912345678")
    await expect(dong.filter({ hasText: "Trùng tên" })).toHaveCount(2)
    await expect(dong.filter({ hasText: "Vinamilk" })).not.toContainText("Trùng tên")

    // Băng trùng tên → "Gộp" lọc về 2 NCC trùng; "Bỏ lọc" trả lại đủ.
    const bang = man.getByTestId("ncc-bang-trung")
    await expect(bang).toContainText("1 nhà cung cấp bị trùng tên")
    await expect(bang).toContainText("Detech Connai")
    await bang.getByRole("button", { name: "Gộp" }).click()
    await expect(man.getByTestId("ncc-dang-loc-trung")).toBeVisible()
    await expect(dong).toHaveCount(2)
    await expect(man.getByTestId("ncc-dau-xanh")).toContainText("2 nhà cung cấp")
    await man.getByRole("button", { name: "Bỏ lọc" }).click()
    await expect(dong).toHaveCount(4)

    // Tìm.
    await man.getByPlaceholder("Tìm tên nhà cung cấp").fill("vinamilk")
    await expect(dong).toHaveCount(1)
    await man.getByRole("button", { name: "Xoá tìm kiếm" }).click()
    await expect(dong).toHaveCount(4)

    // Ngăn lọc mở được.
    await man.getByTestId("ncc-mo-loc").click()
    await expect(page.getByRole("dialog")).toBeVisible()
    await page.keyboard.press("Escape")

    // Bấm dòng như cũ: mở xem nhanh.
    await dong.filter({ hasText: "Vinamilk" }).click()
    await expect(page.getByRole("link", { name: /chi tiết/i }).first()).toBeVisible()

    await expect(man.getByText(/Xem thêm · đang hiện/)).toHaveCount(0)
    // Không còn app bar chuẩn chồng lên đầu trang xanh.
    await expect(page.locator("header").filter({ hasText: "Nhà cung cấp" }).first()).toBeHidden()
    await page.screenshot({ path: "test-results/ds-ncc-mobile.png", fullPage: true })
  } finally {
    await api(`suppliers?id=in.(${IDS.join(",")})`, "DELETE")
  }
})
