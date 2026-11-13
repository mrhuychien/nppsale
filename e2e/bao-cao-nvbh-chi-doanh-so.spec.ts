import { test, expect, type Page } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 13/11/2026: "Sửa Nvbh chỉ được xem doanh số tổng bán (ngày,tuần,tháng)" — chốt "Chỉ sửa màn Báo cáo" (trang
 *   chủ giữ nguyên). NVBH ở Báo cáo tổng hợp › Bán hàng chỉ còn doanh số của mình theo Ngày / Tuần / Tháng; báo cáo bán hàng
 *   cũ /reports/sales đưa sang Bán hàng. Kỳ ghim tháng 9/2026 — dữ liệu mẫu: cả NPP DT thuần 1.200.000, của riêng Chủ NPP (người
 *   đóng vai NVBH ở đây) 900.000 (HĐ 23/09; HĐ 22/09 của nhân viên khác) — số 900.000 cũng là phép thử khoá nhân viên.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
/** Quyền riêng: chủ NPP lỡ cấp "Báo cáo · Xuất file" cho người này — NVBH vẫn không có nút Xuất (chỉ doanh số tổng). */
const OV_XUAT = "ov-nvbh-xuat-bc"
const KY = "ky=custom&ca=2026-09-01&cb=2026-09-30"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, "PATCH", { role })

/** Tiêu đề cột của bảng chính (máy tính). */
const tieuDeCot = (page: Page) => page.getByTestId("bc-bang").locator("thead th")

test.afterEach(async () => {
  await doiVai("owner")
  await api(`user_permission_overrides?id=eq.${OV_XUAT}`, "DELETE")
})

test("NVBH: chỉ doanh số theo thời gian — kể cả đường dẫn gõ tay xem=cust / nguon=ord / lọc / đào sâu", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await api("user_permission_overrides", "POST", [{ id: OV_XUAT, user_id: OWNER, org_id: ORG, permission_key: "reports.export", granted: true }])
  const dao = encodeURIComponent(JSON.stringify([{ l: "Tạp hoá Cô Ba", v: "docs", f: { cust: KHACH } }]))
  await page.goto(`/bao-cao/ban-hang?${KY}&xem=cust&nguon=ord&l_prod=SUA&dao=${dao}`)

  // Xem theo: chỉ Ngày / Tuần / Tháng (tháng 9 = 30 ngày → Ngày); không chiều Mặt hàng / Khách / NCC / Kênh.
  const xem = page.getByTestId("bc-xem-theo")
  await expect(xem.getByRole("button")).toHaveText(["Ngày", "Tuần", "Tháng"])
  await expect(xem.getByRole("button", { name: "Ngày" })).toHaveAttribute("aria-pressed", "true")
  // Không có nguồn Đơn đặt, không băng hổ phách, không đường đào sâu.
  await expect(page.getByRole("tab", { name: "Đơn đặt" })).toHaveCount(0)
  await expect(page.getByTestId("bc-bang-ho-phach")).toHaveCount(0)
  await expect(page.getByTestId("bc-duong-dao")).toHaveCount(0)

  // Thẻ số: chỉ doanh số (thuần) + hàng trả — của riêng mình.
  await expect(page.getByTestId("bc-kpi-net")).toContainText("900.000")
  await expect(page.getByTestId("bc-kpi-ret")).toBeVisible()
  for (const id of ["nInv", "avg", "gp"]) await expect(page.getByTestId(`bc-kpi-${id}`), id).toHaveCount(0)

  // Bảng: Ngày | Doanh thu | Hàng trả | DT thuần — không Số HĐ / Khách mua / TB; tổng = 900.000 (lọc hàng `l_prod` của đường
  // dẫn còn tác dụng thì không dòng nào khớp — màn trống).
  await expect(tieuDeCot(page)).toHaveText([/^Ngày/, /^Doanh thu/, /^Hàng trả/, /^DT thuần/])
  await expect(page.getByTestId("bc-dong-tong")).toContainText("900.000")
  await expect(page.getByRole("button", { name: /^Cột/ })).toHaveCount(0)

  // Bấm dòng không đào sâu (không sang Khách / chứng từ).
  const url = page.url()
  await page.getByTestId("bc-bang").locator("tbody tr").filter({ hasText: "23/09" }).first().click()
  await page.waitForTimeout(400)
  expect(page.url()).toBe(url)
  await expect(page.getByTestId("bc-duong-dao")).toHaveCount(0)

  // Không khối hàng trả / giảm giá, không xuất Excel, không ô lọc — còn kỳ + thẻ "Nhân viên: tôi".
  await expect(page.getByTestId("bc-khoi-tra")).toHaveCount(0)
  await expect(page.getByTestId("bc-khoi-giam")).toHaveCount(0)
  await expect(page.getByTestId("bc-xuat")).toHaveCount(0)
  const thanh = page.getByTestId("bc-thanh-loc")
  await expect(thanh).toContainText("Nhân viên: Chủ NPP")
  await expect(thanh.getByRole("button", { name: /Thêm lọc/ })).toHaveCount(0)
})

test("NVBH: bấm Tuần / Tháng — gom lại theo tuần / tháng, tổng không đổi, nằm trên đường dẫn", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.goto(`/bao-cao/ban-hang?${KY}`)
  const xem = page.getByTestId("bc-xem-theo")
  await expect(page.getByTestId("bc-dong-tong")).toContainText("900.000")

  await xem.getByRole("button", { name: "Tuần" }).click()
  await expect(page).toHaveURL(/hat=week/)
  await expect(tieuDeCot(page).first()).toHaveText(/^Tuần/)
  await expect(page.getByTestId("bc-bang").locator("tbody tr").filter({ hasText: "Tuần 21/09" })).toContainText("900.000")
  await expect(page.getByTestId("bc-dong-tong")).toContainText("900.000")

  await xem.getByRole("button", { name: "Tháng" }).click()
  await expect(page).toHaveURL(/hat=month/)
  await expect(tieuDeCot(page).first()).toHaveText(/^Tháng/)
  await expect(page.getByTestId("bc-bang").locator("tbody tr").filter({ hasText: "Tháng 9" })).toContainText("900.000")
  await expect(xem.getByRole("button", { name: "Tháng" })).toHaveAttribute("aria-pressed", "true")

  // Tải lại vẫn giữ lựa chọn.
  await page.reload()
  await expect(tieuDeCot(page).first()).toHaveText(/^Tháng/)
})

test("NVBH mở báo cáo bán hàng cũ /reports/sales → sang Bán hàng của mình (không về Trang chủ)", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.goto("/reports/sales")
  await expect(page).toHaveURL(/\/bao-cao\/ban-hang$/)
  await expect(page.getByTestId("bc-xem-theo").getByRole("button")).toHaveText(["Ngày", "Tuần", "Tháng"])
})

test("NVBH trên điện thoại: thanh dưới Báo cáo → Ngày / Tuần / Tháng, không Hoá đơn / Đơn đặt", async ({ page, baseURL }) => {
  await dangNhap(page)
  await doiVai("sales")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.context().addCookies([{ name: "npp_kho", value: "hep", url: baseURL! }])
  await page.goto(`/bao-cao/ban-hang?${KY}`)
  await expect(page.getByTestId("bc-xem-theo").getByRole("button")).toHaveText(["Ngày", "Tuần", "Tháng"])
  await expect(page.getByRole("tab", { name: "Hoá đơn" })).toHaveCount(0)
  await expect(page.getByTestId("bc-kpi-net")).toContainText("900.000")
  if (process.env.CHUP_NVBH) await page.screenshot({ path: process.env.CHUP_NVBH, fullPage: true })
})

test("chủ NPP không đổi: đủ chiều xem, có Hoá đơn / Đơn đặt, vào được /reports/sales", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/bao-cao/ban-hang?${KY}`)
  const xem = page.getByTestId("bc-xem-theo")
  for (const ten of ["Thời gian", "Mặt hàng", "Nhà cung cấp", "Khách", "Kênh", "Nhân viên"]) {
    await expect(xem.getByRole("button", { name: ten, exact: true }), ten).toBeVisible()
  }
  await expect(page.getByRole("tab", { name: "Đơn đặt" })).toBeVisible()
  await expect(page.getByTestId("bc-kpi-nInv")).toBeVisible()
  await page.goto("/reports/sales")
  await expect(page).toHaveURL(/\/reports\/sales$/)
})
