import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, mocDonDep } from "./helpers"
import { KHACH, OWNER, ORG } from "./fixture.mjs"

/**
 * ⚠ CHỦ NHÀ 23/09/2026: "Xem nhanh Đơn hàng → Bấm sửa đơn ko ra pos" và "Mỗi
 *   khi mở pos bật tab mới đi". Máy tính: lối vào POS mở TAB MỚI thẳng tới
 *   màn POS; tab cũ đứng nguyên chỗ.
 */
test("xem nhanh đơn → Sửa đơn mở POS sửa đơn ở tab mới, tab cũ đứng yên", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/orders")
  // ⚠ Chỉ phần tử ĐANG HIỆN: màn đơn điện thoại (ẩn trên máy tính) cũng có chữ "DH-0001" và
  //   dựng xong trước bảng máy tính — `.first()` trần bấm nhầm vào nó rồi chờ tới hết giờ.
  await page.getByText("DH-0001").locator("visible=true").first().click()
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByText("Sửa đơn", { exact: true }).first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/don-hang\/o-e2e-1\/sua/)
  await expect(page, "tab cũ bị chuyển trang").toHaveURL(/\/orders/)
})

test("menu Bán hàng mở POS lập đơn ở tab mới", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/orders")
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Tạo đơn mới" }).first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/don-hang\/moi/)
  await expect(page).toHaveURL(/\/orders/)
})

/**
 * ⚠ CHỦ NHÀ 21/10/2026: "nút tạo đơn khoanh đỏ ở phần danh sách đơn hàng khi ấn vào chưa mở tab mới". Nút đi bằng
 *   `router.push` (không phải thẻ `<a>`) nên bộ bắt `PosNewTab` không thấy — phải gọi `diHoacMoPos`. Cùng kiểu: nút
 *   Tạo đơn ở chi tiết khách, nút Sửa đơn ở màn đơn nháp.
 */
test("danh sách đơn: nút Tạo đơn (góc phải) mở POS lập đơn ở tab mới, tab danh sách đứng yên", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/orders")
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "Tạo đơn", exact: true }).click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/don-hang\/moi$/)
  await expect(page, "tab danh sách bị chuyển trang").toHaveURL(/\/orders$/)
})

test("chi tiết khách: nút Tạo đơn mở POS lập đơn của đúng khách ở tab mới", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto(`/customers/${KHACH}`)
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("button", { name: "Tạo đơn", exact: true }).click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(new RegExp(`/pos/don-hang/moi\\?customerId=${KHACH}$`))
  await expect(page, "tab chi tiết khách bị chuyển trang").toHaveURL(new RegExp(`/customers/${KHACH}$`))
})

test("đơn nháp: Sửa đơn mở POS sửa đơn ở tab mới", async ({ page, context }) => {
  const donDep = await mocDonDep("sales_orders")
  const id = "o-e2e-nhap-tab"
  await fetch(`${FAKE}/rest/v1/sales_orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id, org_id: ORG, order_code: "DH-NHAP-TAB", customer_id: KHACH, sales_user_id: OWNER, status: "draft",
      subtotal: 100000, vat: 0, total: 100000, order_date: "2026-09-30", created_at: "2026-09-30T08:00:00Z",
      approval_reason: null, customer: { store_name: "Tạp hoá Cô Ba", credit_limit: 0 },
    }),
  })
  try {
    await dangNhap(page)
    await page.goto("/sell/drafts")
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      page.getByRole("button", { name: "Sửa đơn", exact: true }).click(),
    ])
    await tab.waitForLoadState()
    await expect(tab).toHaveURL(new RegExp(`/pos/don-hang/${id}/sua$`))
    await expect(page, "tab đơn nháp bị chuyển trang").toHaveURL(/\/sell\/drafts$/)
  } finally {
    await donDep()
  }
})

/** Điện thoại: không đụng — `/sell` như cũ, cùng tab. */
test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("menu Bán hàng vẫn vào /sell cùng tab", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/home")
    await page.getByRole("link", { name: /Bán hàng/ }).first().click()
    await expect(page).toHaveURL(/\/sell/)
  })
})

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Bấm tạo phiếu nhập hàng/trả hàng ncc từ danh sách ko ra
 *   pos ? … tạo phiếu nhập hàng / trả hàng ncc trên desktop trên pos hết".
 */
test("danh sách phiếu nhập hàng: Tạo phiếu mở POS nhập hàng ở tab mới", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts")
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.getByRole("link", { name: "Tạo phiếu" }).first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/nhap-hang\/moi/)
  await expect(page).toHaveURL(/\/purchasing\/receipts$/)
})

test("danh sách trả hàng NCC: tạo phiếu mở POS trả NCC ở tab mới", async ({ page, context }) => {
  await dangNhap(page)
  await page.goto("/purchase-returns")
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.locator('a[href="/purchase-returns/new"]').first().click(),
  ])
  await tab.waitForLoadState()
  await expect(tab).toHaveURL(/\/pos\/tra-ncc\/moi/)
})

test("mở thẳng màn tạo cũ trên máy tính → chuyển sang POS", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/purchasing/receipts/new")
  await expect(page).toHaveURL(/\/pos\/nhap-hang\/moi/)
  await page.goto("/purchase-returns/new")
  await expect(page).toHaveURL(/\/pos\/tra-ncc\/moi/)
})
