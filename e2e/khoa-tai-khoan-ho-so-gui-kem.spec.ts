import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ Hồ sơ do máy chủ gửi kèm trang (chủ nhà 23/10/2026 "load trang chậm lắm") cũng phải qua chốt TÀI KHOẢN BỊ KHOÁ
 *   (mig 122): đang mở app mà bị khoá → tải lại trang là bị đăng xuất, không ở lại với nguyên quyền của vai mình.
 */
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const datKhoa = (khoa: boolean) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_active: !khoa }) })

test("bị khoá giữa chừng → tải lại trang là bị đăng xuất (dù hồ sơ đến từ máy chủ)", async ({ page }) => {
  await dangNhap(page)
  await page.waitForLoadState("networkidle")
  await datKhoa(true)
  try {
    const t = (await nhatKy()).length
    await page.reload()
    await expect.poll(async () => (await nhatKy()).slice(t).some((x) => x.method === "POST" && x.path === "/auth/v1/logout"), {
      message: "phải gọi đăng xuất",
    }).toBe(true)
    // Hồ sơ đi đường gửi kèm: trình duyệt không tự đọc lại.
    const ds = (await nhatKy()).slice(t)
    expect(ds.filter((x) => x.path === "/rest/v1/users" && (x.query ?? "").includes("price_edit_max_increase_pct") && (x.client ?? "").includes("createBrowserClient"))).toHaveLength(0)
  } finally {
    await datKhoa(false)
  }
})
