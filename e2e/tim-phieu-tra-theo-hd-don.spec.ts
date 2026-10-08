import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 08/10/2026: "Danh sách Phiếu trả hàng cho phép tìm kiếm theo số hoá đơn hoặc số đơn hàng".
 *   Ô tìm của /returns (máy tính lẫn điện thoại): gõ số hoá đơn / số đơn hàng gốc thì ra phiếu trả của chứng từ ấy —
 *   kể cả khi chỉ gõ phần số (luật 01/10 "số chỉ tìm đúng chứng từ" vẫn không lan sang SĐT khách).
 *   Dòng dữ liệu RIÊNG của spec này (không dùng chung HD-E2E-* với spec khác).
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const OWNER = "00000000-0000-4000-8000-0000000000b1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const api = (path: string, method: string, body?: unknown) =>
  fetch(`${FAKE}/rest/v1/${path}`, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })

test.beforeAll(async () => {
  await api("sales_orders", "POST", [{
    id: "o-tim-tra", org_id: ORG, order_code: "DH-7741", customer_id: KHACH, status: "completed",
    created_at: "2026-10-01T02:00:00Z", total: 120000,
  }])
  await api("sales_invoices", "POST", [{
    id: "hd-tim-tra", org_id: ORG, invoice_code: "HD-5528", order_id: "o-tim-tra", customer_id: KHACH, status: "posted",
    subtotal: 120000, vat: 0, total: 120000, invoice_date: "2026-10-01", created_at: "2026-10-01T03:00:00Z",
  }])
  await api("returns", "POST", [{
    id: "r-tim-tra", org_id: ORG, customer_id: KHACH, created_at: "2026-10-02T02:00:00Z",
    /* Phiếu tự sinh theo HĐ đang Chờ xử lý — danh sách máy tính mặc định hiện Nháp + Chờ xử lý, điện thoại hiện Chờ xử lý. */
    return_code: "PT-0391", status: "submitted", reason: "damaged", credit_note_amount: 24000, return_date: "2026-10-02",
    credit_with_invoice: true, invoice_id: "hd-tim-tra", order_id: "o-tim-tra",
    requested_by: OWNER, requester: { full_name: "Chủ NPP" }, sales_user_id: OWNER, seller: { full_name: "Chủ NPP" },
    customer: { store_name: "Tạp hoá Tìm Số" }, order: { order_code: "DH-7741" }, invoice: { invoice_code: "HD-5528", invoice_date: "2026-10-01" },
  }])
})
test.afterAll(async () => {
  await api("returns?id=eq.r-tim-tra", "DELETE")
  await api("sales_invoices?id=eq.hd-tim-tra", "DELETE")
  await api("sales_orders?id=eq.o-tim-tra", "DELETE")
})

test("máy tính: gõ số hoá đơn / số đơn hàng / phần số → ra phiếu trả của chứng từ ấy", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await dangNhap(page)
  await page.goto("/returns")
  const o = page.getByRole("textbox", { name: "Tìm số phiếu / số HĐ / số đơn, khách, NV…" })
  const dong = page.getByRole("row").filter({ hasText: "Tạp hoá Tìm Số" })
  /* ⚠ Phiếu hiện sẵn trước khi gõ — trước mỗi từ khoá phải thấy danh sách LỌC MẤT nó (gõ một số không có), không thì
     phép kiểm "có 1 dòng" đạt ngay trước khi lượt tìm kịp chạy (đã thử phá: bỏ tra số HĐ mà vẫn xanh). */
  for (const tu of ["HD-5528", "DH-7741", "5528", "7741", "PT-0391", "TH-0391"]) {
    await o.fill("HD-9999")
    await expect(dong, "gõ một số không có thì phải lọc mất").toHaveCount(0)
    await o.fill(tu)
    await expect(dong, `gõ "${tu}"`).toHaveCount(1)
  }
})

test.describe("điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test("gõ số hoá đơn / số đơn hàng → ra phiếu trả", async ({ page }) => {
    await dangNhap(page)
    await page.goto("/returns")
    const man = page.getByTestId("tra-mobile")
    const the = man.getByTestId("the-tra").filter({ hasText: "Tạp hoá Tìm Số" })
    for (const tu of ["HD-5528", "DH-7741"]) {
      await man.getByLabel("Tìm phiếu trả").fill("HD-9999")
      await expect(the, "gõ một số không có thì phải lọc mất").toHaveCount(0)
      await man.getByLabel("Tìm phiếu trả").fill(tu)
      await expect(the, `gõ "${tu}"`).toHaveCount(1)
    }
  })
})
