import { test, expect, type Route } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 23/10/2026: "tốc độ load trang chậm lắm". Đo trang chủ NVBH (điện thoại 4G): 4 vòng mạng nối đuôi —
 *   9 câu chính → tên khách → tên kênh → kho. Nay tên kênh đi ngay đợt đầu; tên khách đi ngay khi hoá đơn / hàng
 *   trả / công nợ về, không đợi câu chậm nhất. Dựng "câu chậm" bằng cách GIỮ câu mục tiêu tháng (không trả lời).
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

test("câu tên kênh + tên khách không đợi câu chậm nhất (mục tiêu tháng đang treo)", async ({ page }) => {
  await dangNhap(page)
  // Màn Đơn hàng (nơi đăng nhập xong) cũng hỏi tuyến / khách — chờ nó xong hẳn để không đếm nhầm câu của nó.
  await page.waitForLoadState("networkidle")
  await doiVai("sales")
  try {
    const giu: Route[] = []
    await page.route(/:54321\/rest\/v1\/rpc\/my_sales_target/, (r) => void giu.push(r))
    const thay = { khach: false, kenh: false }
    page.on("request", (r) => {
      const u = decodeURIComponent(r.url())
      if (u.includes("/rest/v1/customers?") && u.includes("credit_limit")) thay.khach = true
      if (u.includes("/rest/v1/sales_routes?")) thay.kenh = true
    })
    await page.goto("/home")
    await expect.poll(() => giu.length, { message: "câu mục tiêu tháng phải đã đi (và đang bị giữ)" }).toBeGreaterThan(0)
    /* ⚠ CỬA SỔ 5 GIÂY, dưới hẹn giờ 10 giây của app (`fetchCoHetGio`): đợi lâu hơn thì câu bị giữ tự hết giờ, chuỗi
       nối đuôi cũ cũng chạy tiếp — chốt xanh oan. */
    await expect.poll(() => thay.kenh, { message: "tên kênh hỏi ngay đợt đầu, không đợi câu nào", timeout: 5000 }).toBe(true)
    await expect.poll(() => thay.khach, { message: "tên khách hỏi ngay khi hoá đơn / trả / nợ về", timeout: 5000 }).toBe(true)
    // Trả lời câu đang giữ → trang vẽ xong số liệu như thường.
    for (const r of giu.splice(0)) await r.continue()
    await page.unroute(/:54321\/rest\/v1\/rpc\/my_sales_target/)
    await expect(page.getByText("Doanh số").first()).toBeVisible()
  } finally {
    await doiVai("owner")
  }
})
