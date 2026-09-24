import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: quyền giảm giá theo từng nhân viên, "Đặt dưới phần bật/tắt
 *   chức năng sửa giá trong tuỳ chỉnh từng nhân viên. Mặc định là tắt" (mig 185).
 */
const NV = "00000000-0000-4000-8000-0000000000b7"

test("cài đặt nhân viên: bật giảm giá, đặt tối đa 5%, lưu đúng ba cột", async ({ page }) => {
  await fetch(`${FAKE}/rest/v1/users`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify([{
      id: NV, org_id: "00000000-0000-4000-8000-0000000000a1", full_name: "NV Thử Giảm", role: "sales",
      phone: "0977000111", is_active: true, created_at: "2026-09-24T00:00:00Z",
      allow_price_edit: false, price_edit_max_increase_pct: 0,
      allow_discount: false, discount_max_type: "pct", discount_max_value: null,
    }]),
  })
  try {
    await dangNhap(page)
    await page.goto(`/settings/users/${NV}`)
    const khoi = page.getByTestId("quyen-giam-gia")
    await expect(khoi).toBeVisible()
    const bat = khoi.getByRole("switch", { name: "Cho phép giảm giá" })
    await expect(bat, "mặc định phải tắt").toHaveAttribute("aria-checked", "false")
    await expect(khoi.getByLabel("Giảm tối đa")).toBeDisabled()
    await bat.click()
    await khoi.getByLabel("Giảm tối đa").fill("5")
    await page.getByRole("button", { name: /Lưu/ }).first().click()
    await expect.poll(async () =>
      (await nhatKy()).some((r) => r.method === "PATCH" && r.path.endsWith("/rest/v1/users")
        && JSON.stringify(r.body).includes('"allow_discount":true'))
    ).toBe(true)
    const goi = (await nhatKy()).filter((r) => r.method === "PATCH" && JSON.stringify(r.body).includes("allow_discount")).at(-1)!
    expect(goi.body).toMatchObject({ allow_discount: true, discount_max_type: "pct", discount_max_value: 5 })
  } finally {
    await fetch(`${FAKE}/rest/v1/users?id=eq.${NV}`, { method: "DELETE" })
  }
})
