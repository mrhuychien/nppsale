import { test, expect } from "@playwright/test"
import { dangNhap, nhatKy, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 08/10/2026: "phiếu tự sinh theo đơn đặt hàng tao cũng muốn sửa được ngày tháng". Trang chi tiết phiếu
 *   trả có "Đổi ngày" cho mọi phiếu chưa huỷ, kể cả phiếu TỰ SINH (hàng / tiền của nó vẫn khoá — sửa từ hóa đơn).
 *   Luật máy chủ (ghi được return_date, doanh số vẫn theo ngày HĐ): scripts/sql/thu-doi-ngay-phieu-tra-tu-sinh.sql.
 */
const api = (path: string, method: string, body: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const HD1 = "00000000-0000-4000-8000-0000000000f1"

test.beforeEach(async () => {
  await api("returns?id=eq.r-e2e-5", "PATCH", {
    status: "submitted", credit_with_invoice: true, invoice_id: HD1, order_id: "o-e2e-1", return_code: "TH-0005", return_date: "2026-09-03",
    invoice: { invoice_code: "HD-E2E-1", invoice_date: "2026-09-20" }, order: { order_code: "DH-E2E-1" },
  })
})
test.afterAll(async () => {
  await api("returns?id=eq.r-e2e-5", "PATCH", { credit_with_invoice: false, invoice_id: null, order_id: null, invoice: null, order: null, return_code: null, return_date: null })
})

const ghiNgay = async () =>
  (await nhatKy()).filter((r) => r.method === "PATCH" && r.path.includes("/rest/v1/returns") && JSON.stringify(r.body).includes("return_date"))

for (const [ten, vp] of [["máy tính", { width: 1280, height: 900 }], ["điện thoại", { width: 390, height: 844 }]] as const) {
  test(`${ten}: phiếu tự sinh đổi được ngày phiếu — nói rõ doanh số / công nợ vẫn theo ngày hoá đơn`, async ({ page }) => {
    await page.setViewportSize(vp)
    const truoc = (await ghiNgay()).length
    await dangNhap(page)
    await page.goto("/returns/r-e2e-5")
    await expect(page.getByText("Tự sinh theo HĐ HD-E2E-1").first()).toBeVisible()
    await page.getByTestId("doi-ngay-phieu-tra").first().click()
    const khung = page.getByTestId("khung-doi-ngay").first()
    await expect(khung.locator("#ngay-phieu-tra")).toHaveValue("2026-09-03")
    await expect(khung).toContainText("vẫn tính theo ngày hóa đơn")
    // Ngày sau hôm nay (đồng hồ e2e 30/09/2026) → khoá Lưu, nói lý do.
    await khung.locator("#ngay-phieu-tra").fill("2026-12-31")
    await expect(khung).toContainText("không được sau hôm nay")
    await expect(khung.getByRole("button", { name: "Lưu" })).toBeDisabled()
    await khung.locator("#ngay-phieu-tra").fill("2026-09-25")
    await khung.getByRole("button", { name: "Lưu" }).click()
    await expect(page.getByText("Đã đổi ngày phiếu sang 25/09/2026").first()).toBeVisible()
    await expect.poll(async () => (await ghiNgay()).length).toBeGreaterThan(truoc)
    expect((await ghiNgay()).at(-1)?.body).toEqual({ return_date: "2026-09-25" })
    await expect(page.getByText(/Ngày: 25\/09\/2026/).filter({ visible: true }).first()).toBeVisible()
  })
}
