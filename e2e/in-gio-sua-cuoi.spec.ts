import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"
import { ORG } from "./fixture.mjs"

/**
 * Mốc ngày trên tờ in hoá đơn: chủ nhà 01/10/2026 chọn "chỉ in ngày hoá đơn, bỏ hẳn giờ"; 10/11/2026: "Thêm vào cạnh ngày
 * hóa đơn giờ tạo hóa đơn". HD-E2E-1: ngày hoá đơn 23/09/2026, lập lúc 08:00 UTC = 15:00 giờ VN cùng ngày.
 * Đơn đặt hàng vẫn chỉ ngày đơn (chủ nhà chỉ nói hoá đơn).
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const DON = "o-e2e-1"

test("tờ in hoá đơn (thường và POS) ghi ngày hoá đơn kèm giờ tạo; đơn đặt hàng chỉ ngày", async ({ page }) => {
  await dangNhap(page)
  for (const url of [`/sales-invoices/${HOA_DON}/print`, `/in/hoa-don/${HOA_DON}`]) {
    await page.goto(url)
    await expect(page.getByText("Ngày 23/09/2026 15:00", { exact: true }).first(), url).toBeVisible()
  }
  await page.goto(`/orders/${DON}/print`)
  await expect(page.getByText(/^Ngày \d\d\/\d\d\/\d{4}$/)).toBeVisible()
  await expect(page.getByText(/^Ngày \d\d\/\d\d\/\d{4} \d\d:\d\d/)).toHaveCount(0)
})

/**
 * Chủ nhà 10/11/2026: "thêm cho tao vào dưới bảng đơn hàng/hóa đơn : Lưu ý: Khách hàng thanh toán bằng tiền mặt và chỉ chuyển
 * khoản vào số tài khoản của NPP …". Câu là cài đặt của NPP (Cài đặt → Cấu hình tổ chức) — đi đúng đường người dùng: nhập,
 * Lưu, rồi mở tờ in. Câu thử dùng tài khoản giả.
 */
test("câu Lưu ý nhập ở Cấu hình tổ chức → in ngay dưới bảng hàng của hoá đơn (thường + POS) và đơn đặt hàng", async ({ page }) => {
  const CAU = "Lưu ý: Khách hàng chỉ chuyển khoản vào số tài khoản của NPP: Ngân hàng Thử - 0000 - NPP THU."
  try {
    await dangNhap(page)
    const docXong = page.waitForResponse((r) => r.url().includes("/rest/v1/organizations") && r.url().includes("settings"))
    await page.goto("/settings/org")
    await docXong
    const o = page.getByLabel("Lưu ý in dưới bảng hàng")
    await expect(o).toHaveValue("")
    await o.fill(CAU)
    await page.getByRole("button", { name: "Lưu thay đổi" }).click()
    await expect(page.getByText("Đã cập nhật thông tin tổ chức").first()).toBeVisible()

    for (const url of [`/sales-invoices/${HOA_DON}/print`, `/in/hoa-don/${HOA_DON}`, `/orders/${DON}/print`]) {
      await page.goto(url)
      const ly = page.getByTestId("luu-y-in")
      await expect(ly, url).toHaveText(CAU)
      await expect(ly.locator("span.font-bold"), url).toHaveText("Lưu ý:")
      // Ngay dưới bảng hàng: phần tử liền trước là chính bảng hàng.
      expect(await ly.evaluate((el) => el.previousElementSibling?.tagName), url).toBe("TABLE")
    }

    // Mở lại màn cài đặt: câu đã lưu.
    const docLai = page.waitForResponse((r) => r.url().includes("/rest/v1/organizations") && r.url().includes("settings"))
    await page.goto("/settings/org")
    await docLai
    await expect(page.getByLabel("Lưu ý in dưới bảng hàng")).toHaveValue(CAU)
  } finally {
    /* Sổ giả dùng chung cả lượt chạy — trả cài đặt về như cũ để bài in khác không thấy câu này. */
    await fetch(`${FAKE}/rest/v1/organizations?id=eq.${ORG}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: {} }),
    })
  }
})
