import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 27/09/2026: "Phần chức năng của nhân viên bán hàng thêm phần Hoá đơn bán. Viết lại giao
 *   diện danh sách hoá đơn bán trên mobile theo mẫu danh sách Đơn hàng trên mobile. Check lại phần
 *   giao diện mới Trả hàng và Hoá đơn bán xem có API nhiều ko và tối ưu".
 */
test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const doiVai = (role: string) =>
  fetch(`${FAKE}/rest/v1/users?id=eq.${OWNER}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) })

type Luot = { method: string; path: string; query?: string }
const dem = (ds: Luot[], f: (x: Luot) => boolean) => ds.filter(f).length

test("điện thoại: hoá đơn bán theo mẫu Đơn hàng — đầu trang xanh, tab có số, thẻ có địa chỉ / SĐT, mở ngăn xem nhanh", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/sales-invoices")
  const man = page.getByTestId("hd-mobile")
  await expect(man.getByRole("heading", { name: "Hoá đơn bán" })).toBeVisible()
  await expect(man.getByPlaceholder("Tìm số HĐ, mã đơn, tên KH")).toBeVisible()
  await expect(man.getByRole("tab", { name: /^Đã xuất/ })).toHaveAttribute("aria-selected", "true")
  await expect(man.getByText("Tổng tiền hàng ·")).toBeVisible()
  // Không còn app bar chuẩn chồng lên đầu trang xanh.
  await expect(page.locator("header").filter({ hasText: "Hóa đơn bán" }).first()).toBeHidden()

  const the = man.getByTestId("the-hd").filter({ hasText: "HD-E2E-1" })
  await expect(the).toBeVisible()
  await expect(the).toContainText("Tạp hoá Cô Ba")
  await expect(the).toContainText("1 Lê Lợi")
  await expect(the.getByRole("link", { name: /0911111111/ })).toHaveAttribute("href", "tel:0911111111")
  await expect(man.getByText(/Đã hiển thị \d+ \/ \d+ hoá đơn/)).toBeVisible()

  await the.getByRole("button", { name: /Mở hoá đơn HD-E2E-1/ }).click()
  await expect(page.getByRole("dialog").getByText("HD-E2E-1").first()).toBeVisible()
})

test("NVBH: lưới Chức năng có Hoá đơn bán; danh sách 'Hoá đơn của tôi' không hiện tên NV", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto("/home")
    const o = page.getByRole("link", { name: /Hoá đơn bán/ })
    await expect(o).toHaveAttribute("href", "/sales-invoices")
    await o.click()
    await page.waitForURL(/\/sales-invoices/)
    const man = page.getByTestId("hd-mobile")
    await expect(man.getByRole("heading", { name: "Hoá đơn của tôi" })).toBeVisible()
    const the = man.getByTestId("the-hd").first()
    await expect(the).toBeVisible()
    await expect(the).not.toContainText("NV ")
  } finally {
    await doiVai("owner")
  }
})

test("ít lượt gọi: hoá đơn điện thoại không đọc danh mục lọc / dòng hàng; trả hàng mở ngăn không đọc lại phiếu", async ({ page }) => {
  await dangNhap(page)
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1000)

  // Hoá đơn bán
  let t = (await nhatKy()).length
  await page.goto("/sales-invoices")
  await expect(page.getByTestId("the-hd").first()).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1000)
  let ds: Luot[] = (await nhatKy()).slice(t)
  expect(dem(ds, (x) => x.path === "/rest/v1/sales_invoice_lines"), "dòng hàng (thẻ không dùng)").toBe(0)
  expect(dem(ds, (x) => x.path === "/rest/v1/customers" && !(x.query || "").includes("id=eq.")), "danh sách khách cho ô lọc").toBe(0)
  expect(dem(ds, (x) => x.path === "/rest/v1/sales_routes"), "tuyến cho ô lọc").toBe(0)
  expect(dem(ds, (x) => x.method === "HEAD" && x.path === "/rest/v1/sales_invoices"), "HEAD đếm").toBe(0)
  expect(dem(ds, (x) => x.path === "/rest/v1/sales_invoices" && decodeURIComponent(x.query || "").includes("count()")), "một lượt gom nhóm").toBe(1)
  // Mở tấm lọc thì mới đọc danh mục.
  t = (await nhatKy()).length
  await page.getByRole("button", { name: "Bộ lọc" }).click()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(800)
  ds = (await nhatKy()).slice(t)
  expect(dem(ds, (x) => x.path === "/rest/v1/customers"), "mở tấm lọc → đọc khách").toBeGreaterThan(0)
  await page.keyboard.press("Escape")

  // Đơn hàng (chủ nhà 27/09/2026: "Xử lý cả màn đơn hàng"): điện thoại không đọc danh mục lọc,
  // công nợ, hoá đơn MISA, dòng hàng, số đơn theo tuyến.
  t = (await nhatKy()).length
  await page.goto("/orders")
  await expect(page.getByTestId("the-don").first()).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(1000)
  ds = (await nhatKy()).slice(t)
  for (const bang of ["customers", "sales_routes", "receivables", "invoices", "sales_order_lines"]) {
    expect(dem(ds, (x) => x.path === `/rest/v1/${bang}`), `đơn hàng: ${bang}`).toBe(0)
  }
  expect(dem(ds, (x) => x.path === "/rest/v1/sales_orders" && decodeURIComponent(x.query || "").includes("customers!inner(channel)")), "số đơn theo tuyến").toBe(0)
  expect(dem(ds, (x) => x.path === "/rest/v1/organizations"), "tổ chức (nhớ trong máy)").toBe(0)

  // Trả hàng: mở ngăn một phiếu trong danh sách → không đọc lại phiếu đó.
  await page.goto("/returns")
  const the = page.getByTestId("the-tra").first()
  await expect(the).toBeVisible()
  await page.waitForLoadState("networkidle")
  await page.waitForTimeout(800)
  t = (await nhatKy()).length
  await the.click()
  await expect(page.getByTestId("tien-phieu-tra")).toBeVisible()
  await page.waitForTimeout(800)
  ds = (await nhatKy()).slice(t)
  expect(dem(ds, (x) => x.path === "/rest/v1/returns"), "ngăn dùng dòng đã tải").toBe(0)
  await page.keyboard.press("Escape")

  // Tải thêm: chỉ đọc phần mới (offset 20), không đọc lại 20 phiếu đầu.
  t = (await nhatKy()).length
  await page.getByRole("button", { name: /Tải thêm 20 phiếu/ }).click()
  await expect(page.getByText(/Đã hiển thị 40 \//)).toBeVisible()
  await page.waitForTimeout(800)
  ds = (await nhatKy()).slice(t)
  const docDs = ds.filter((x) => x.method === "GET" && x.path === "/rest/v1/returns" && decodeURIComponent(x.query || "").includes("customer:customers"))
  expect(docDs.length, "một lượt đọc phần mới").toBe(1)
  expect(decodeURIComponent(docDs[0].query || "")).toContain("offset=20")
})
