import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 26/09/2026: "Giao diện phần Báo cáo tổng hợp đây … Hãy hoàn thiện nốt đi nhé" —
 *   6 màn theo thiết kế, chạy song song báo cáo cũ. Kỳ ghim cứng tháng 9/2026 (dữ liệu mẫu) để
 *   bài không đổi kết quả theo ngày chạy.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const KHACH_NHOM = "00000000-0000-4000-8000-0000000000c2"
const KY = "ky=custom&ca=2026-09-01&cb=2026-09-30"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
const doiVai = (role: string) => api(`users?id=eq.${OWNER}`, "PATCH", { role })

test("menu: nhóm Báo cáo tổng hợp đủ 6 mục, chỉ mục đang mở sáng; báo cáo cũ vẫn còn", async ({ page }) => {
  await dangNhap(page)
  await page.getByRole("button", { name: /Báo cáo tổng hợp/ }).click()
  for (const h of ["/bao-cao", "/bao-cao/ban-hang", "/bao-cao/cuoi-ngay", "/bao-cao/kho", "/bao-cao/cong-no", "/bao-cao/tai-chinh"]) {
    await expect(page.locator(`a[href="${h}"]`).first()).toBeVisible()
  }
  await page.locator('a[href="/bao-cao/kho"]').first().click()
  await expect(page.getByRole("heading", { name: "Kho", level: 1 })).toBeVisible()
  await page.getByRole("button", { name: "Báo cáo", exact: true }).click()
  await expect(page.locator('a[href="/reports/sales"]').first()).toBeVisible()
})

test("Bán hàng: bấm để đào sâu Khách → Mặt hàng → Hoá đơn → xem nhanh; Quay lại lùi một bước", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/bao-cao/ban-hang?${KY}&xem=cust`)
  const bang = page.getByTestId("bc-bang")
  await expect(page.getByTestId("bc-kpi-net")).toContainText("1,2 tr")
  await expect(bang.getByRole("row", { name: /Tạp hoá Cô Ba/ })).toContainText("1.200.000")
  // Dòng Tổng ghim đầu bảng = thẻ Doanh thu thuần.
  await expect(bang.getByTestId("bc-dong-tong")).toContainText("1.200.000")

  await bang.getByRole("row", { name: /Tạp hoá Cô Ba/ }).click()
  await expect(page.getByTestId("bc-duong-dao")).toContainText("Tạp hoá Cô Ba")
  await expect(bang).toContainText("Theo mặt hàng")
  await expect(bang.getByRole("row", { name: /Sữa hộp/ })).toContainText("900.000")
  // Hàng đổi trên hoá đơn không phải hàng bán — Mì tôm không có dòng.
  await expect(bang.getByRole("row", { name: /Mì tôm/ })).toHaveCount(0)

  await bang.getByRole("row", { name: /Sữa hộp/ }).click()
  await expect(bang).toContainText("HD-E2E-1")
  await bang.getByRole("row", { name: /HD-E2E-1/ }).click()
  await expect(page.getByTestId("bc-xem-nhanh")).toContainText("Hoá đơn HD-E2E-1")
  await page.keyboard.press("Escape")

  await page.goBack()
  await expect(bang).toContainText("Theo mặt hàng")
  await page.getByTestId("bc-duong-dao").getByRole("button", { name: "Về trạng thái ban đầu" }).click()
  await expect(page.getByTestId("bc-duong-dao")).toHaveCount(0)
  await expect(bang).toContainText("Theo khách")
})

test("Bán hàng: nguồn Đơn đặt có băng hổ phách; đổi chế độ xem giữ kỳ", async ({ page }) => {
  await dangNhap(page)
  await page.goto(`/bao-cao/ban-hang?${KY}`)
  await expect(page.getByTestId("bc-bang-ho-phach")).toHaveCount(0)
  await page.getByRole("tab", { name: "Đơn đặt" }).click()
  await expect(page.getByTestId("bc-bang-ho-phach")).toContainText("không phải doanh thu")
  await expect(page.getByTestId("bc-kpi-on")).toBeVisible()
  await page.getByTestId("bc-xem-theo").getByRole("button", { name: "Mặt hàng" }).click()
  await expect(page).toHaveURL(/ca=2026-09-01/)
  await expect(page).toHaveURL(/nguon=ord/)
})

test("NVBH: lọc nhân viên khoá vào mình, không có chế độ Nhân viên, không có lãi; không vào Tài chính", async ({ page }) => {
  await dangNhap(page)
  await doiVai("sales")
  try {
    await page.goto(`/bao-cao/ban-hang?${KY}`)
    await expect(page.getByTestId("bc-thanh-loc")).toContainText("Nhân viên: Chủ NPP")
    await expect(page.getByTestId("bc-xem-theo").getByRole("button", { name: "Nhân viên" })).toHaveCount(0)
    await expect(page.getByTestId("bc-kpi-gp")).toHaveCount(0)
    await page.goto("/bao-cao/tai-chinh")
    await expect(page).toHaveURL(/\/home$/)
  } finally {
    await doiVai("owner")
  }
})

test("Công nợ: dư có không ép về 0; tuổi nợ; sổ chi tiết một khách", async ({ page }) => {
  const rc = [
    { id: "bc-rc-1", org_id: ORG, customer_id: KHACH, sales_user_id: OWNER, invoice_id: "00000000-0000-4000-8000-0000000000f1", amount: 900000, paid: 200000, due_date: "2026-09-01", status: "partial", created_at: "2026-08-20T03:00:00Z", invoice: { invoice_code: "HD-E2E-1", invoice_date: "2026-08-20" } },
    { id: "bc-rc-2", org_id: ORG, customer_id: KHACH_NHOM, sales_user_id: OWNER, invoice_id: null, return_id: "r-bc", amount: -150000, paid: 0, due_date: null, status: "open", created_at: "2026-09-10T03:00:00Z", invoice: null },
  ]
  await api("receivables", "POST", rc)
  try {
    await dangNhap(page)
    await page.goto("/bao-cao/cong-no")
    await expect(page.getByTestId("bc-kpi-debt")).toContainText("700.000")
    await expect(page.getByTestId("bc-kpi-credit")).toContainText("150.000")
    const bang = page.getByTestId("bc-bang")
    await expect(bang.getByRole("row", { name: /Đại lý Minh/ })).toContainText("Dư có 150.000")
    await page.getByTestId("bc-xem-theo").getByRole("button", { name: "Tuổi nợ" }).click()
    for (const n of ["Trong hạn", "1–30 ngày", "31–60 ngày", "61–90 ngày", "Trên 90 ngày"]) await expect(bang).toContainText(n)
    await page.getByTestId("bc-xem-theo").getByRole("button", { name: "Khách" }).click()
    await bang.getByRole("row", { name: /Tạp hoá Cô Ba/ }).click()
    await expect(bang).toContainText("Sổ chi tiết · Tạp hoá Cô Ba")
  } finally {
    await api("receivables?id=in.(bc-rc-1,bc-rc-2)", "DELETE")
  }
})

test("Kho · Cuối ngày · Tài chính: chế độ xem, chọn ngày, tab", async ({ page }) => {
  await dangNhap(page)
  await page.goto("/bao-cao/kho")
  await expect(page.getByTestId("bc-bang").getByRole("row", { name: /Sữa hộp/ })).toContainText("41 thùng 16 hộp")
  await page.getByTestId("bc-xem-theo").getByRole("button", { name: "Sắp hết hạn" }).click()
  await expect(page.getByTestId("bc-bang")).toContainText("Lô sắp hết hạn")

  await page.goto("/bao-cao/cuoi-ngay")
  const nut = page.getByTestId("bc-nut-ngay").locator("visible=true")
  await expect(nut).toContainText("Hôm nay")
  await page.getByRole("button", { name: "Ngày trước" }).click()
  await expect(nut).not.toContainText("Hôm nay")
  await expect(page).toHaveURL(/ngay=/)
  await expect(page.getByRole("button", { name: "In báo cáo cuối ngày" })).toBeVisible()

  await page.goto("/bao-cao/tai-chinh")
  await expect(page.getByTestId("bc-bang")).toContainText("= Lãi thuần")
  await page.getByRole("tab", { name: "Dòng tiền" }).click()
  await expect(page.getByTestId("bc-bang")).toContainText("= Tồn quỹ cuối kỳ")
  await page.getByRole("tab", { name: "Tài sản – Nguồn vốn" }).click()
  await expect(page.getByTestId("bc-bang")).toContainText("Vốn chủ (phần chênh)")
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test("Bán hàng: đầu trang xanh + nút Lọc; bảng thành danh sách thẻ, bấm thẻ đào sâu", async ({ page }) => {
    await dangNhap(page)
    await page.goto(`/bao-cao/ban-hang?${KY}&xem=cust`)
    const loc = page.getByTestId("bc-thanh-loc-mobile")
    await expect(loc.getByRole("button", { name: "Lọc" })).toBeVisible()
    await expect(page.getByTestId("bc-thanh-loc")).toBeHidden()
    const bang = page.getByTestId("bc-bang")
    await bang.getByRole("button", { name: /Tạp hoá Cô Ba/ }).click()
    await expect(page.getByRole("button", { name: "Về trạng thái ban đầu" }).last()).toBeVisible()
    await expect(bang).toContainText("Sữa hộp")
    await loc.getByRole("button", { name: "Lọc" }).click()
    await expect(page.getByRole("dialog")).toContainText("Thêm lọc")
  })
})
