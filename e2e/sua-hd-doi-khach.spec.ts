import { test, expect, type Page } from "@playwright/test"
import { dangNhap, nhatKy, FAKE, tatTacVuDon } from "./helpers"
import { KHACH, KHACH_NHOM } from "./fixture.mjs"

/**
 * Chủ nhà 12/11/2026: "E sửa phần sửa hoá đơn cho phép đổi khách hàng (cả trên đt và pos)" (mig 261). Bấm thật trên màn
 * Sửa HĐ: chọn khách khác → câu báo "Đổi khách: … → …", lưu gửi `customer_id` của khách mới trong tải trọng
 * `reissue_invoice`; giữ khách cũ / không đổi thì KHÔNG gửi khoá ấy. Tờ đã thu tiền: không có nút đổi, nói lý do.
 */
const HOA_DON = "00000000-0000-4000-8000-0000000000f1"
const DON_HD = "00000000-0000-4000-8000-0000000000f9"
const chen = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, id: string) => fetch(`${FAKE}/rest/v1/${bang}?id=eq.${id}`, { method: "DELETE" })
const goiCuoi = async (fn: string) => (await nhatKy()).filter((r) => r.path.endsWith(`/rpc/${fn}`)).at(-1)
const soGoi = async (fn: string) => (await nhatKy()).filter((r) => r.path.endsWith(`/rpc/${fn}`)).length

/** Đơn gốc của HD-E2E-1 + dòng đơn — chèn riêng rồi gỡ (dữ liệu mẫu chung giữ nguyên số đơn cho bài khác). */
async function chenDonGoc() {
  await chen("sales_orders", [{
    id: DON_HD, org_id: "00000000-0000-4000-8000-0000000000a1", order_code: "DH-0009",
    customer_id: KHACH, sales_user_id: "00000000-0000-4000-8000-0000000000b1",
    status: "completed", payment_terms: "COD", notes: null, order_date: "2026-09-23",
    customer: { store_name: "Tạp hoá Cô Ba", phone: "0911111111", address: "1 Lê Lợi" },
  }])
  await chen("sales_order_lines", [{
    id: "sol9", order_id: DON_HD, product_id: "00000000-0000-4000-8000-0000000000d1", unit_name: "thùng",
    quantity: 2, conversion_factor: 24, unit_price: 450000, invoiced_qty: 2, line_total: 900000,
  }])
}
async function goDonGoc() {
  await xoa("sales_order_lines", "sol9")
  await xoa("sales_orders", DON_HD)
}

async function taiTrongLapLai(page: Page, truoc: number) {
  await expect.poll(() => soGoi("reissue_invoice"), "chưa gửi reissue_invoice").toBeGreaterThan(truoc)
  return ((await goiCuoi("reissue_invoice"))!.body as { p_invoice_id: string; p: Record<string, unknown> })
}

test.describe("POS máy tính", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("Sửa HĐ trên POS: đổi khách (nút Đổi khách / F4), giữ khách cũ, lưu gửi customer_id của khách mới", async ({ page }) => {
    await chenDonGoc()
    try {
      await tatTacVuDon(page)
      await dangNhap(page)
      await page.goto(`/pos/hoa-don/${HOA_DON}/sua`)
      await expect(page.getByRole("heading", { name: /Sửa hóa đơn/ })).toBeVisible()
      await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()

      // Đổi sang "Đại lý Minh" bằng nút trên thẻ khách.
      await page.getByRole("button", { name: /^Đổi khách/ }).click()
      const hop = page.getByRole("dialog", { name: "Đổi khách của hóa đơn" })
      await hop.getByPlaceholder("Tên cửa hàng, SĐT, địa chỉ…").fill("Minh")
      await hop.getByRole("button", { name: /Đại lý Minh/ }).click()
      const bao = page.getByTestId("doi-khach")
      await expect(bao).toContainText("Đổi khách: Tạp hoá Cô Ba → Đại lý Minh")

      // Giữ khách cũ → hết câu báo; F4 mở lại hộp chọn, chọn lại khách mới.
      await bao.getByRole("button", { name: "Giữ khách cũ" }).click()
      await expect(page.getByTestId("doi-khach")).toHaveCount(0)
      /* Nút vừa bấm biến mất → tiêu điểm rơi ra <body>, khung POS lấy lại sau một nhịp vẽ — bấm vào khung trước phím tắt. */
      await page.getByRole("heading", { name: /Sửa hóa đơn/ }).click()
      await page.keyboard.press("F4")
      await hop.getByPlaceholder("Tên cửa hàng, SĐT, địa chỉ…").fill("Minh")
      await hop.getByRole("button", { name: /Đại lý Minh/ }).click()
      await expect(page.getByTestId("doi-khach")).toContainText("→ Đại lý Minh")

      const truoc = await soGoi("reissue_invoice")
      await page.getByRole("button", { name: /Huỷ HĐ & lập lại/ }).click()
      const t = await taiTrongLapLai(page, truoc)
      expect(t.p_invoice_id).toBe(HOA_DON)
      expect(t.p.customer_id, "không gửi khách mới").toBe(KHACH_NHOM)
    } finally {
      await goDonGoc()
    }
  })

  test("Sửa HĐ trên POS: tờ đã thu tiền thì không đổi được khách (không nút, F4 không mở), lưu không gửi customer_id", async ({ page }) => {
    await chenDonGoc()
    /* Máy chủ giả không tự ghép bảng con — phiếu thu đi kèm dòng như PostgREST trả. */
    await chen("cash_receipt_lines", [{
      id: "crl-261", invoice_id: HOA_DON, amount: 100000, receipt: { status: "confirmed", receipt_code: "PT-E2E-261" },
    }])
    try {
      await tatTacVuDon(page)
      await dangNhap(page)
      await page.goto(`/pos/hoa-don/${HOA_DON}/sua`)
      await expect(page.getByRole("heading", { name: /Sửa hóa đơn/ })).toBeVisible()
      await expect(page.getByTestId("khoa-doi-khach")).toContainText("Hóa đơn đã thu tiền của khách này")
      await expect(page.getByRole("button", { name: /^Đổi khách/ })).toHaveCount(0)
      await page.keyboard.press("F4")
      await expect(page.getByRole("dialog", { name: "Đổi khách của hóa đơn" })).toHaveCount(0)

      const truoc = await soGoi("reissue_invoice")
      await page.getByRole("button", { name: /Huỷ HĐ & lập lại/ }).click()
      const t = await taiTrongLapLai(page, truoc)
      expect(t.p, "tờ không đổi khách mà vẫn gửi customer_id").not.toHaveProperty("customer_id")
    } finally {
      await xoa("cash_receipt_lines", "crl-261")
      await goDonGoc()
    }
  })
})

test.describe("Điện thoại", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

  test("Sửa HĐ trên điện thoại: nút Đổi khách → chọn khách (kèm địa chỉ) → thẻ khách đổi, lưu gửi customer_id", async ({ page }) => {
    await chenDonGoc()
    try {
      await dangNhap(page)
      await page.goto(`/sales-invoices/${HOA_DON}/edit`)
      await expect(page.getByRole("heading", { name: /Sửa hóa đơn HD-E2E-1/ })).toBeVisible()
      await expect(page.getByText("Tạp hoá Cô Ba").first()).toBeVisible()

      await page.getByTestId("nut-doi-khach").click()
      await expect(page.getByText("Đổi khách của hóa đơn")).toBeVisible()
      await page.getByLabel("Tìm khách hàng").fill("Minh")
      const dong = page.getByTestId("dong-chon-khach-hd")
      await expect(dong).toHaveCount(1)
      await expect(dong).toContainText("2 Trần Phú")
      await dong.click()
      await expect(page.getByTestId("doi-khach")).toContainText("Đổi khách: Tạp hoá Cô Ba → Đại lý Minh")
      await expect(page.getByText("Đại lý Minh").first()).toBeVisible()

      /* Thanh nav đáy từng đè kín thanh "Lập lại" của màn này (z-40 trên z-30) — màn có thanh riêng thì không có nav. */
      await expect(page.getByRole("navigation", { name: "Điều hướng chính" })).toHaveCount(0)
      const truoc = await soGoi("reissue_invoice")
      await page.getByRole("button", { name: "Lập lại" }).click()
      const t = await taiTrongLapLai(page, truoc)
      expect(t.p_invoice_id).toBe(HOA_DON)
      expect(t.p.customer_id, "không gửi khách mới").toBe(KHACH_NHOM)
    } finally {
      await goDonGoc()
    }
  })
})
