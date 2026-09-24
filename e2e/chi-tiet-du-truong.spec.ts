import { test, expect } from "@playwright/test"
import { dangNhap, FAKE } from "./helpers"

/**
 * ⚠ CHỦ NHÀ 24/09/2026: "Những cái có trên pos -> cập nhật ngược về chi tiết.
 *   Pos có trường gì thì chi tiết đơn hàng có trường ấy".
 *
 * Máy chủ giả không tự ghép bảng con — các trường ghép (`creator`, `product`,
 * `lines`) chèn sẵn trong dòng như PostgREST trả.
 */
const ORG = "00000000-0000-4000-8000-0000000000a1"
const KHACH = "00000000-0000-4000-8000-0000000000c1"
const SUA = "00000000-0000-4000-8000-0000000000d1"
const HD = "00000000-0000-4000-8000-0000000000e7"
const PT = "r-ct-1"

const chen = (bang: string, rows: unknown[]) =>
  fetch(`${FAKE}/rest/v1/${bang}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(rows) })
const xoa = (bang: string, cot: string, v: string) => fetch(`${FAKE}/rest/v1/${bang}?${cot}=eq.${v}`, { method: "DELETE" })

test("chi tiết hóa đơn: người tạo, tính cho NV, giảm giá dòng, quy đổi, lý do/ghi chú dòng trả", async ({ page }) => {
  await chen("sales_invoices", [{
    id: HD, org_id: "khong-hien-trong-danh-sach", invoice_code: "HD-CT-1", order_id: "o-ct-khong-co",
    customer_id: KHACH, status: "posted", subtotal: 880000, vat: 0, total: 880000,
    payment_terms: "COD", due_date: "2026-09-30", notes: null, invoice_date: "2026-09-24",
    stock_entry_id: null, created_at: "2026-09-24T08:00:00Z",
    customer: { store_name: "Tạp hoá Cô Ba" }, order: { order_code: "DH-CT" },
    sales_user: { full_name: "NV Bán Một" }, creator: { full_name: "Kế toán Lan" },
  }])
  await chen("sales_invoice_lines", [{
    id: "sil-ct1", invoice_id: HD, product_id: SUA, quantity: 2, unit_name: "thùng", conversion_factor: 24,
    unit_price: 440000, line_discount: 20000, vat_rate: 0, line_total: 880000, is_exchange: false, sort_order: 0,
    order_line_id: null, note: null, product: { name: "Sữa hộp", sku: "SUA1", base_unit: "hộp" },
  }])
  await chen("returns", [{
    id: "r-ct-hd", org_id: "khong-hien-trong-danh-sach", order_id: null, invoice_id: HD, customer_id: KHACH,
    status: "submitted", reason: "damaged", credit_note_amount: 20000, created_at: "2026-09-24T09:00:00Z",
    lines: [{ id: "rl-ct-hd", unit_name: "hộp", quantity: 1, unit_price: 20000, vat_rate: 0, line_total: 20000,
      is_exchange: false, note: "móp hộp", reason: "expired", product: { name: "Sữa hộp", sku: "SUA1" } }],
  }])
  try {
    await dangNhap(page)
    await page.goto(`/sales-invoices/${HD}`)
    await expect(page.getByText("HD-CT-1").first()).toBeVisible()
    await expect(page.getByText("Người phụ trách", { exact: true })).toBeVisible()
    await expect(page.getByText("Tính cho NV", { exact: true })).toBeVisible()
    await expect(page.getByText("NV Bán Một", { exact: true })).toBeVisible()
    await expect(page.getByText("Người tạo", { exact: true })).toBeVisible()
    await expect(page.getByText("Kế toán Lan", { exact: true })).toBeVisible()
    await expect(page.getByText(/^−20\.000/).first(), "mất cột giảm giá dòng").toBeVisible()
    await expect(page.getByText("Thuế", { exact: true }), "cột thuế từng dòng vẫn còn").toHaveCount(0)
    // Đơn giá trước giảm: 440.000 + 20.000 / 2.
    await expect(page.getByText(/^450\.000/).first()).toBeVisible()
    await expect(page.getByText(/· 48 hộp/).first(), "mất quy đổi về đơn vị cơ sở").toBeVisible()
    const khoi = page.getByTestId("hang-doi-tra")
    await expect(khoi).toContainText("Hết hạn sử dụng")
    await expect(khoi).toContainText("móp hộp")
  } finally {
    await xoa("sales_invoices", "id", HD)
    await xoa("sales_invoice_lines", "id", "sil-ct1")
    await xoa("returns", "id", "r-ct-hd")
  }
})

test("chi tiết phiếu trả: mã hàng, lý do và ghi chú từng dòng", async ({ page }) => {
  await chen("returns", [{
    id: PT, org_id: ORG, order_id: null, invoice_id: null, customer_id: KHACH, status: "submitted",
    reason: "damaged", credit_note_amount: 40000, notes: null, photo_url: null, created_at: "2026-09-24T09:00:00Z",
    destination_zone: "date", completed_at: null, cancel_reason: null, applied_receipt_id: null,
    customer: { id: KHACH, store_name: "Tạp hoá Cô Ba" }, requester: { full_name: "Chủ NPP" }, approver: null,
    order: null, invoice: null, sales_user_id: null, seller: null,
  }])
  await chen("return_lines", [
    { id: "rl-ct1", return_id: PT, product_id: SUA, unit_name: "hộp", quantity: 1, unit_price: 20000, vat_rate: 0,
      line_total: 20000, is_exchange: false, note: "móp góc", reason: "expired", product: { name: "Sữa hộp", sku: "SUA1" } },
    { id: "rl-ct2", return_id: PT, product_id: SUA, unit_name: "hộp", quantity: 1, unit_price: 20000, vat_rate: 0,
      line_total: 20000, is_exchange: false, note: null, reason: "damaged", product: { name: "Sữa hộp", sku: "SUA1" } },
  ])
  try {
    await dangNhap(page)
    await page.goto(`/returns/${PT}`)
    const bang = page.getByRole("table").first()
    await expect(bang).toContainText("SUA1")
    await expect(bang, "lý do riêng của dòng không hiện").toContainText("Lý do: Hết hạn sử dụng")
    await expect(bang).toContainText("Ghi chú: móp góc")
    /* Dòng có lý do trùng lý do phiếu thì khỏi lặp. */
    await expect(bang.getByText(/^Lý do:/)).toHaveCount(1)
  } finally {
    await xoa("returns", "id", PT)
    await xoa("return_lines", "return_id", PT)
  }
})
