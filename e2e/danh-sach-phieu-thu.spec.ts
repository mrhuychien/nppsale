import { test, expect } from "@playwright/test"
import { dangNhap, FAKE, HOM_NAY_E2E, nhatKy } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 27/09/2026: "Làm danh sách Phiếu thu format giống Danh sách đơn hàng / Hóa đơn
 *   đi, giờ đang 1 mình 1 format." Khuôn chung: dải trạng thái có số đếm, một thẻ gồm thanh
 *   công cụ · dòng tổng · lưới · phân trang 20/trang, bấm dòng mở xem nhanh; điện thoại có
 *   dải tóm tắt + thẻ.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const homNay = () => HOM_NAY_E2E.slice(0, 10)
const id = (i: number) => `00000000-0000-4000-8000-00000000f${String(i).padStart(3, "0")}`

function phieu() {
  return Array.from({ length: 25 }, (_, i) => ({
    id: id(i),
    org_id: ORG,
    receipt_code: `PT-E2E-${String(i + 1).padStart(3, "0")}`,
    receipt_date: homNay(),
    created_at: new Date(new Date(HOM_NAY_E2E).getTime() - i * 60_000).toISOString(),
    source_type: "standalone",
    // Phiếu cuối ĐÃ HUỶ — vẫn đếm, không vào tổng.
    status: i === 24 ? "voided" : "received",
    expected_amount: 100000,
    submitted_amount: 100000,
    notes: null,
    collector: { full_name: "Kế toán Thu" },
    creator: { full_name: "Kế toán Thu" },
    receiver: { full_name: "Kế toán Thu" },
  }))
}
const DONG = [{
  id: "00000000-0000-4000-8000-00000000fe01",
  receipt_id: id(0),
  amount: 100000,
  kind: "payment",
  invoice: { id: "hd", invoice_code: "HD-E2E-PT", customer: { store_name: "Tạp hoá Phiếu Thu" } },
  receivable: { customer: { store_name: "Tạp hoá Phiếu Thu", phone: "0909" } },
}]

const khoi = (page: import("@playwright/test").Page, nhan: string) =>
  page.locator("div", { has: page.getByText(nhan, { exact: true }) }).filter({ visible: true }).last()

test.describe("danh sách phiếu thu — khuôn đơn / hóa đơn", () => {
  test.beforeEach(async () => {
    await fetch(`${FAKE}/rest/v1/cash_receipts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(phieu()) })
    await fetch(`${FAKE}/rest/v1/cash_receipt_lines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(DONG) })
  })
  test.afterEach(async () => {
    await fetch(`${FAKE}/rest/v1/cash_receipts?org_id=eq.${ORG}`, { method: "DELETE" })
    await fetch(`${FAKE}/rest/v1/cash_receipt_lines?receipt_id=eq.${id(0)}`, { method: "DELETE" })
  })

  test("máy tính: dải trạng thái, dòng tổng của CẢ bộ lọc, 20 dòng/trang, bấm dòng mở xem nhanh", async ({ page }) => {
    const loi: string[] = []
    page.on("pageerror", (e) => loi.push(e.message))
    await dangNhap(page)
    await page.goto("/finance/cash-receipts")

    // Bản điện thoại (đầu xanh) cũng có dải này trong DOM nhưng ẩn — chỉ xét bản đang hiện.
    await expect(page.locator('[data-status-chip="received"]').filter({ visible: true })).toContainText("24")
    await expect(page.locator('[data-status-chip="voided"]').filter({ visible: true })).toContainText("1")

    const k = khoi(page, "Tổng tiền phiếu thu")
    await expect(k).toContainText("25 phiếu thu")
    // 24 × 100.000 — phiếu huỷ không vào tổng; không phải tổng của trang 20 dòng.
    await expect(k).toContainText("2.400.000")

    const may = page.locator('[data-doc-list="desktop"]')
    await expect(may.getByText("PT-E2E-001")).toBeVisible()
    await expect(may.getByText(/Hiển thị\s*1–20/)).toContainText("25")
    await expect(may.getByTestId("dong-phieu-thu")).toHaveCount(20)
    await expect(may.getByText("PT-E2E-021")).toHaveCount(0)
    // Khách + hóa đơn suy từ dòng phiếu.
    await expect(may.getByText("Tạp hoá Phiếu Thu")).toBeVisible()
    await expect(may.getByText("HD-E2E-PT")).toBeVisible()

    await may.getByText("Tạp hoá Phiếu Thu").click()
    const ngan = page.getByRole("dialog")
    await expect(ngan.getByText("PT-E2E-001")).toBeVisible()
    await expect(ngan.getByRole("link", { name: "Chi tiết" })).toHaveAttribute("href", `/finance/cash-receipts/${id(0)}`)
    expect(loi).toEqual([])
  })

  /**
   * ⚠ XẾP Ở MÁY CHỦ (rà soát 03/10/2026). Bảng cũ xếp 20 dòng đang xem — bấm "Số tiền ↓" mà
   *   phiếu lớn nhất nằm ở trang 2 thì không bao giờ thấy nó. Nay bấm tiêu đề là hỏi lại máy chủ
   *   với `order=expected_amount…`, về trang 1, và phiếu lớn nhất của CẢ bộ lọc lên đầu.
   */
  test("máy tính: bấm tiêu đề Số tiền gửi thứ tự xuống máy chủ — phiếu lớn nhất ở trang 2 lên đầu", async ({ page }) => {
    // Phiếu thứ 23 (trang 2 theo thứ tự mặc định) là phiếu lớn nhất.
    await fetch(`${FAKE}/rest/v1/cash_receipts?id=eq.${id(22)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_amount: 900000 }),
    })
    await dangNhap(page)
    await page.goto("/finance/cash-receipts")
    const may = page.locator('[data-doc-list="desktop"]')
    await expect(may.getByTestId("dong-phieu-thu")).toHaveCount(20)
    await expect(may.getByText("PT-E2E-023")).toHaveCount(0)

    const truoc = (await nhatKy()).length
    const nut = may.locator('[data-sort-key="total"]')
    await nut.click() // tăng dần
    await nut.click() // giảm dần
    await expect(nut).toHaveAttribute("data-sort-dir", "desc")
    await expect(may.getByTestId("dong-phieu-thu").first()).toContainText("PT-E2E-023")

    const goi = ((await nhatKy()).slice(truoc) as Array<{ method: string; path: string; query?: string }>)
      .filter((r) => r.method === "GET" && r.path === "/rest/v1/cash_receipts" && /[?&]order=/.test(r.query ?? ""))
      .map((r) => decodeURIComponent(new URLSearchParams(r.query).get("order") ?? ""))
    // Cột bấm đứng đầu, thứ tự mặc định + mốc `id` theo sau.
    expect(goi).toContain("expected_amount.desc.nullslast,receipt_date.desc,created_at.desc,id.asc")
    // Cột tính ra (khách suy từ dòng phiếu) không bấm được.
    await expect(may.locator('[data-sort-key="customer"]')).toHaveCount(0)
  })

  test("điện thoại: đầu xanh (thẻ tổng) + thẻ theo khuôn đơn / hóa đơn", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await dangNhap(page)
    await page.goto("/finance/cash-receipts")
    const dt = page.locator('[data-doc-list="mobile"]')
    const tong = dt.getByTestId("ds-the-tong")
    await expect(tong).toContainText("Tổng tiền phiếu thu")
    await expect(tong.getByTestId("ds-so-dem")).toHaveText("25")
    await expect(tong.getByTestId("ds-tong-tien")).toContainText("2.400.000")
    const the = dt.locator("[data-doc-card-list]")
    await expect(the.getByText("Tạp hoá Phiếu Thu")).toBeVisible()
    await expect(the.getByText(/PT-E2E-001/)).toBeVisible()
    await ctx.close()
  })
})
