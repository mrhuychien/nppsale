import { test, expect, type Page } from "@playwright/test"
import { dangNhap } from "./helpers"

/*
 * Chủ nhà 30/09/2026: làm lại màn Tổng quan điện thoại theo thiết kế "tongquan" — đầu xanh, thẻ
 * nổi (kỳ + doanh thu rút gọn + số đơn), Cần xử lý, Doanh thu theo kênh, Top khách, Đơn gần đây.
 * Ba RPC thuần được chặn trả số mẫu (máy chủ giả không có hàm này).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

async function giaRpc(page: Page) {
  const ky: string[] = []
  await page.route(/:54321\/rest\/v1\/rpc\/dashboard_summary/, async (r) => {
    ky.push(JSON.parse(r.request().postData() ?? "{}").p_period_start)
    await r.fulfill({
      json: { period_revenue: 964_775_500, period_orders: 542, open_receivables: 12_500_000, overdue_count: 3 },
    })
  })
  await page.route(/:54321\/rest\/v1\/rpc\/dashboard_top_customers/, (r) =>
    r.fulfill({
      json: [
        { customer_id: "c1", store_name: "Super market", total: 15_330_000, order_count: 4 },
        { customer_id: "c2", store_name: "Gia Bảo", total: 12_850_000, order_count: 2 },
      ],
    }),
  )
  await page.route(/:54321\/rest\/v1\/rpc\/dashboard_channel_revenue/, (r) =>
    r.fulfill({ json: [{ channel: "Khác", total: 700 }, { channel: "Kênh 02", total: 300 }] }),
  )
  return ky
}

test("tổng quan điện thoại theo thiết kế, không có app bar chuẩn", async ({ page }) => {
  const ky = await giaRpc(page)
  await dangNhap(page)
  await page.goto("/dashboard")
  const man = page.getByTestId("tong-quan-mobile")
  await expect(man).toBeVisible()
  await expect(man.getByTestId("dau-xanh")).toContainText("Tổng quan")
  await expect(man.getByTestId("dau-xanh")).toContainText("Cập nhật")
  await expect(page.locator("header").filter({ has: page.getByRole("button", { name: "Mở menu" }) })).toBeHidden()

  await expect(man.getByTestId("tq-doanh-thu")).toHaveText("964,78 tr")
  await expect(man.getByTestId("tq-so-don")).toHaveText("542")
  await expect(man).toContainText("964.775.500đ · trung bình 1,78 tr/đơn")

  await expect(man.getByTestId("tq-so-viec")).toHaveText("1 việc") // chỉ nợ quá hạn; kho giả đủ hàng
  await expect(man).toContainText("3 khoản nợ quá hạn")
  await expect(man.getByRole("link", { name: "Nhắc nợ" })).toHaveAttribute("href", "/receivables")
  await expect(man.getByTestId("tq-khong-het-han")).toBeVisible()

  await expect(man.getByTestId("tq-kenh")).toContainText("70%")
  await expect(man.getByTestId("tq-kenh")).toContainText("2 kênh")
  await expect(man.getByTestId("tq-top-khach")).toContainText("Super market")
  await expect(man.getByTestId("tq-top-khach")).toContainText("15,33 tr")
  await expect(man.getByTestId("tq-don-gan-day").getByRole("link").first()).toBeVisible()

  // Đổi kỳ → nạp lại với mốc đầu quý (giờ VN).
  await man.getByRole("tab", { name: "Quý này" }).click()
  await expect(page.getByTestId("tong-quan-mobile").getByRole("tab", { name: "Quý này" })).toHaveAttribute("aria-selected", "true")
  expect(ky.at(-1)).toMatch(/^\d{4}-(01|04|07|10)-01$/)
})
